//! One live daemon connection per saved host (ui-next `daemon/store.ts` pool). One host is
//! active: `client()` returns its `DaemonClient`, and the rest of the app talks to that one.
//!
//! Every call into `frogg-client-core` (`DaemonClient::new`, `ws::connect`, requests) lives in
//! this file, so the core's API can grow (auth options, built-in reconnect, relay) with one edit.

use std::cell::RefCell;
use std::collections::HashMap;
use std::time::Duration;

use frogg_client_core::protocol::inbound;
#[cfg(target_arch = "wasm32")]
use frogg_client_core::ws;
use frogg_client_core::{ClientConfig, ConnectionState, DaemonClient, Event, SessionFrame};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::Value;

use super::agents::{Agents, Session};
use super::hosts::{Host, Hosts};
use super::storage;
use super::ui::Ui;

const CLIENT_ID_KEY: &str = "frogg.clientId";
const BACKOFF_MS: [u64; 6] = [500, 1000, 2000, 4000, 8000, 15000];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Conn {
    Connecting,
    Online,
    Offline,
}

impl Conn {
    pub fn id(self) -> &'static str {
        match self {
            Conn::Connecting => "connecting",
            Conn::Online => "online",
            Conn::Offline => "offline",
        }
    }
}

/// Live link state of one host.
#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub conn: Conn,
    /// Reconnect attempt number while connecting; 0 on the first try.
    pub attempt: u32,
    pub server_name: Option<String>,
    pub server_id: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

impl Default for Link {
    fn default() -> Self {
        Self {
            conn: Conn::Connecting,
            attempt: 0,
            server_name: None,
            server_id: None,
            version: None,
            error: None,
        }
    }
}

struct Pooled {
    key: String,
    client: DaemonClient,
    listener: u64,
    /// Bumped on every (re)dial and on close, so a stale retry timer does nothing.
    generation: u64,
    closed: bool,
}

thread_local! {
    static POOL: RefCell<HashMap<String, Pooled>> = RefCell::new(HashMap::new());
}

#[derive(Clone, Copy)]
pub struct Connections {
    /// Link state per host id.
    pub links: RwSignal<HashMap<String, Link>>,
    hosts: Hosts,
    agents: Agents,
    ui: Ui,
}

/// `?daemon=host:port` names where to look (desktop shell, dev); a page served by a daemon
/// dials its own origin; otherwise the local Frogg Next daemon.
pub fn default_endpoint() -> String {
    let location = web_sys::window().map(|w| w.location());
    if let Some(q) = location
        .as_ref()
        .and_then(|l| l.search().ok())
        .and_then(|s| web_sys::UrlSearchParams::new_with_str(&s).ok())
        .and_then(|p| p.get("daemon"))
        .map(|d| d.trim().to_owned())
        .filter(|d| !d.is_empty())
    {
        return q
            .trim_start_matches("ws://")
            .trim_start_matches("wss://")
            .trim_end_matches("/ws")
            .to_owned();
    }
    let protocol = location
        .as_ref()
        .and_then(|l| l.protocol().ok())
        .unwrap_or_default();
    if protocol == "http:" || protocol == "https:" {
        if let Some(host) = location.and_then(|l| l.host().ok()) {
            if !host.starts_with("localhost:1420") && !host.starts_with("tauri.localhost") {
                return host;
            }
        }
    }
    "127.0.0.1:9969".to_owned()
}

pub fn client_id() -> String {
    storage::get(CLIENT_ID_KEY).unwrap_or_else(|| {
        let id = format!(
            "rs-{:012x}",
            (js_sys::Math::random() * 2f64.powi(48)) as u64
        );
        storage::set(CLIENT_ID_KEY, &id);
        id
    })
}

fn new_client() -> DaemonClient {
    DaemonClient::new(ClientConfig {
        client_id: client_id(),
        client_type: inbound::HelloClientType::Browser,
        app_version: Some(env!("CARGO_PKG_VERSION").to_owned()),
        device_name: None,
    })
}

/// Opens the transport for `host`. Relay hosts wait on the core's `relay::connect` and report
/// offline until then.
fn dial(client: &DaemonClient, host: &Host) -> Result<(), String> {
    if host.is_relay() {
        return Err("relay hosts need the relay transport (not in the client core yet)".into());
    }
    match host.password.as_deref().filter(|p| !p.is_empty()) {
        Some(pw) => bearer::connect(client, &host.url(), pw),
        #[cfg(target_arch = "wasm32")]
        None => ws::connect(client, &host.url()),
        // Native builds (unit tests) have no browser socket.
        #[cfg(not(target_arch = "wasm32"))]
        None => Err("no WebSocket off wasm32".into()),
    }
}

/// Password / device-token auth the way `@frogg/client` sends it from a browser: the
/// `frogg.bearer.<token>` WebSocket subprotocol. A stand-in until the core's
/// `ws::connect(&client, url, ConnectOptions)` lands; then `dial` calls that and this goes.
mod bearer {
    use std::rc::Rc;

    use frogg_client_core::{DaemonClient, Transport};
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen::JsCast;
    use web_sys::{Event, MessageEvent, WebSocket};

    struct Ws(WebSocket);

    impl Transport for Ws {
        fn send(&self, text: String) -> Result<(), String> {
            self.0.send_with_str(&text).map_err(|e| format!("{e:?}"))
        }
        fn close(&self) {
            let _ = self.0.close();
        }
    }

    pub fn connect(client: &DaemonClient, url: &str, token: &str) -> Result<(), String> {
        let socket = WebSocket::new_with_str(url, &format!("frogg.bearer.{token}"))
            .map_err(|e| format!("{e:?}"))?;
        let c = client.clone();
        let on_open = Closure::<dyn FnMut(Event)>::new(move |_: Event| c.handle_open());
        let c = client.clone();
        let on_message = Closure::<dyn FnMut(Event)>::new(move |e: Event| {
            if let Some(text) = e
                .dyn_ref::<MessageEvent>()
                .and_then(|m| m.data().as_string())
            {
                c.handle_frame(&text);
            }
        });
        let c = client.clone();
        let on_close = Closure::<dyn FnMut(Event)>::new(move |_: Event| c.handle_close());
        // Owned by the socket (see core ws.rs: dropping them from inside onclose is unsound).
        socket.set_onopen(Some(on_open.into_js_value().unchecked_ref()));
        socket.set_onmessage(Some(on_message.into_js_value().unchecked_ref()));
        socket.set_onclose(Some(on_close.into_js_value().unchecked_ref()));
        client.attach(Rc::new(Ws(socket)));
        Ok(())
    }
}

impl Connections {
    pub fn init(hosts: Hosts, agents: Agents, ui: Ui) -> Self {
        let this = Self {
            links: RwSignal::new(HashMap::new()),
            hosts,
            agents,
            ui,
        };
        // Keep one connection per saved host; drop those of forgotten hosts.
        Effect::new(move |_| {
            let list = hosts.hosts.get();
            this.sync(&list);
        });
        this
    }

    /// Connects the saved active host (or the default endpoint) once hosts are loaded.
    pub fn start(&self) {
        let host = self.hosts.active_or_default(&default_endpoint());
        self.activate(&host.id);
    }

    /// The active host's client, when it has one.
    pub fn client(&self) -> Option<DaemonClient> {
        let id = self.hosts.active_id.get_untracked()?;
        self.client_of(&id)
    }

    pub fn client_of(&self, host_id: &str) -> Option<DaemonClient> {
        POOL.with(|p| p.borrow().get(host_id).map(|x| x.client.clone()))
    }

    /// Link state of a host (reactive).
    pub fn link(&self, host_id: &str) -> Link {
        self.links
            .with(|l| l.get(host_id).cloned())
            .unwrap_or_else(|| Link {
                conn: Conn::Offline,
                ..Link::default()
            })
    }

    /// Link state of the active host (reactive).
    pub fn active_link(&self) -> Link {
        match self.hosts.active_id.get() {
            Some(id) => self.link(&id),
            None => Link {
                conn: Conn::Offline,
                ..Link::default()
            },
        }
    }

    /// Makes a saved host the active one; asking for the active (or an offline) host redials it.
    pub fn activate(&self, host_id: &str) {
        let Some(host) = self.hosts.find_untracked(host_id) else {
            return;
        };
        let previous = self.hosts.active_id.get_untracked();
        let same = previous.as_deref() == Some(host_id);
        if !same {
            self.ui.reset_for_host_switch();
        }
        self.hosts.active_id.set(Some(host_id.to_owned()));
        let offline = self.link_untracked(host_id).conn == Conn::Offline;
        let changed = POOL.with(|p| {
            p.borrow()
                .get(host_id)
                .map(|x| x.key != host.route_key())
                .unwrap_or(true)
        });
        if same || offline || changed {
            self.close(host_id);
            self.open(&host);
        }
    }

    fn link_untracked(&self, host_id: &str) -> Link {
        self.links
            .with_untracked(|l| l.get(host_id).cloned())
            .unwrap_or_default()
    }

    fn set_link(&self, host_id: &str, f: impl FnOnce(&mut Link)) {
        self.links
            .update(|l| f(l.entry(host_id.to_owned()).or_default()));
    }

    fn sync(&self, hosts: &[Host]) {
        let open: Vec<String> = POOL.with(|p| p.borrow().keys().cloned().collect());
        for id in open {
            match hosts.iter().find(|h| h.id == id) {
                None => self.close(&id),
                Some(h) => {
                    let stale = POOL.with(|p| {
                        p.borrow()
                            .get(&id)
                            .map(|x| x.key != h.route_key())
                            .unwrap_or(false)
                    });
                    // A pinned serverId alone doesn't need a new socket.
                    if stale && !self.only_pin_changed(&id, h) {
                        self.close(&id);
                        self.open(h);
                    }
                }
            }
        }
        for h in hosts {
            if POOL.with(|p| !p.borrow().contains_key(&h.id)) {
                self.open(h);
            }
        }
    }

    fn only_pin_changed(&self, id: &str, h: &Host) -> bool {
        let mut unpinned = h.clone();
        unpinned.server_id = None;
        let key = POOL.with(|p| p.borrow().get(id).map(|x| x.key.clone()));
        if key.as_deref() == Some(unpinned.route_key().as_str()) {
            POOL.with(|p| {
                if let Some(x) = p.borrow_mut().get_mut(id) {
                    x.key = h.route_key();
                }
            });
            true
        } else {
            false
        }
    }

    fn close(&self, host_id: &str) {
        let gone = POOL.with(|p| p.borrow_mut().remove(host_id));
        if let Some(mut x) = gone {
            x.closed = true;
            x.client.unsubscribe(x.listener);
            x.client.disconnect();
        }
        self.links.update(|l| {
            l.remove(host_id);
        });
        self.agents.drop_host(host_id);
    }

    fn open(&self, host: &Host) {
        let client = new_client();
        let host_id = host.id.clone();
        let this = *self;
        let listener = {
            let host_id = host_id.clone();
            client.subscribe(move |event| this.on_event(&host_id, event))
        };
        POOL.with(|p| {
            p.borrow_mut().insert(
                host_id.clone(),
                Pooled {
                    key: host.route_key(),
                    client: client.clone(),
                    listener,
                    generation: 0,
                    closed: false,
                },
            )
        });
        self.set_link(&host_id, |l| *l = Link::default());
        self.redial(&host_id);
    }

    fn redial(&self, host_id: &str) {
        let Some(host) = self.hosts.find_untracked(host_id) else {
            return;
        };
        let Some(client) = self.client_of(host_id) else {
            return;
        };
        if let Err(e) = dial(&client, &host) {
            self.set_link(host_id, |l| {
                l.conn = Conn::Offline;
                l.error = Some(e);
            });
            if !host.is_relay() {
                self.schedule_retry(host_id);
            }
        }
    }

    fn schedule_retry(&self, host_id: &str) {
        let Some(generation) = POOL.with(|p| {
            p.borrow_mut()
                .get_mut(host_id)
                .filter(|x| !x.closed)
                .map(|x| {
                    x.generation += 1;
                    x.generation
                })
        }) else {
            return;
        };
        let attempt = self.link_untracked(host_id).attempt;
        let delay = BACKOFF_MS[(attempt as usize).min(BACKOFF_MS.len() - 1)];
        self.set_link(host_id, |l| l.attempt = attempt + 1);
        let this = *self;
        let host_id = host_id.to_owned();
        set_timeout(
            move || {
                let live = POOL.with(|p| {
                    p.borrow()
                        .get(&host_id)
                        .map(|x| x.generation == generation && !x.closed)
                        .unwrap_or(false)
                });
                if live {
                    this.set_link(&host_id, |l| l.conn = Conn::Connecting);
                    this.redial(&host_id);
                }
            },
            Duration::from_millis(delay),
        );
    }

    fn on_event(&self, host_id: &str, event: &Event) {
        match event {
            Event::State(ConnectionState::Connecting) => {
                self.set_link(host_id, |l| l.conn = Conn::Connecting)
            }
            // The socket is open, but the daemon may still refuse the handshake (4401 pairing
            // required): the host counts as online once its server_info arrives.
            Event::State(ConnectionState::Connected) => {}
            Event::State(ConnectionState::Disconnected) => {
                self.set_link(host_id, |l| l.conn = Conn::Offline);
                self.schedule_retry(host_id);
            }
            Event::State(ConnectionState::Idle) => {}
            Event::Session(frame) => self.on_frame(host_id, frame),
        }
    }

    fn on_frame(&self, host_id: &str, frame: &SessionFrame) {
        match frame.kind.as_str() {
            "status" => {
                let Ok(p) = frame.payload::<Value>() else {
                    return;
                };
                if p.get("status").and_then(Value::as_str) == Some("server_info") {
                    self.on_server_info(host_id, &p);
                }
            }
            "agent_update" | "agent_deleted" => {
                if let Ok(p) = frame.payload::<Value>() {
                    self.agents.apply_push(host_id, &frame.kind, &p);
                }
            }
            _ => {}
        }
    }

    fn on_server_info(&self, host_id: &str, info: &Value) {
        let text = |k: &str| info.get(k).and_then(Value::as_str).map(str::to_owned);
        let name = text("hostname");
        let server_id = text("serverId");
        let version = text("version");
        self.set_link(host_id, |l| {
            l.conn = Conn::Online;
            l.attempt = 0;
            l.error = None;
            l.server_name = name.clone();
            l.server_id = server_id.clone();
            l.version = version;
        });
        self.hosts.mark_online(host_id);
        self.load_sessions(host_id);
        let Some(saved) = self.hosts.find_untracked(host_id) else {
            return;
        };
        // A host saved by address alone learns which daemon it is, and takes its name.
        if saved.server_id.is_none() && server_id.is_some() {
            self.hosts.update(host_id, |h| h.server_id = server_id);
        }
        if let Some(name) = name {
            if saved.name == saved.endpoint.split(':').next().unwrap_or_default() {
                self.hosts.rename(host_id, &name);
            }
        }
    }

    fn load_sessions(&self, host_id: &str) {
        let Some(client) = self.client_of(host_id) else {
            return;
        };
        let this = *self;
        let host_id = host_id.to_owned();
        spawn_local(async move {
            let request_id = client.next_request_id();
            let message =
                inbound::SessionMessage::FetchAgentsRequest(inbound::FetchAgentsRequest {
                    request_id: request_id.clone(),
                    scope: None,
                    filter: None,
                    sort: None,
                    page: Some(inbound::FetchAgentsRequestPage {
                        limit: 200,
                        cursor: None,
                    }),
                    subscribe: Some(inbound::FetchAgentsRequestSubscribe {
                        subscription_id: None,
                    }),
                    sync: None,
                });
            let Ok(frame) = client.request(&request_id, &message).await else {
                return;
            };
            let Ok(payload) = frame.payload::<Value>() else {
                return;
            };
            // Ignore an answer from a connection that was replaced meanwhile.
            if this.client_of(&host_id).map(|c| c.state()) != Some(ConnectionState::Connected) {
                return;
            }
            let mut sessions = HashMap::new();
            for e in payload
                .get("entries")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(s) = e
                    .get("agent")
                    .and_then(|a| Session::from_entry(a, e.get("project")))
                else {
                    continue;
                };
                if s.agent.archived_at.is_none() {
                    sessions.insert(s.agent.id.clone(), s);
                }
            }
            this.agents.replace_host(&host_id, sessions);
        });
    }
}
