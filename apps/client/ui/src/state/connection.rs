//! One live daemon connection per saved host (ui-next `daemon/store.ts` pool). One host is
//! active: `client()` returns its `DaemonClient`, and the rest of the app talks to that one.
//!
//! Every call into `frogg-client-core` (`DaemonClient::new`, `ws::connect`, requests) lives in
//! this file, so the core's API can grow (auth options, built-in reconnect, relay) with one edit.

use std::cell::RefCell;
use std::collections::HashMap;

use frogg_client_core::protocol::inbound;
#[cfg(target_arch = "wasm32")]
use frogg_client_core::{relay, ws};
use frogg_client_core::{
    ClientConfig, ClientOptions, ConnectOptions, ConnectionState, DaemonClient, ErrorInfo, Event,
    SessionFrame,
};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::Value;

use super::agents::{Agents, Session};
use super::hosts::{Host, Hosts};
use super::storage;
use super::ui::Ui;

const CLIENT_ID_KEY: &str = "frogg.clientId";

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
    /// Retries stopped after the host failed to answer [`GIVE_UP_AFTER`] times in a row; only a
    /// user action (Retry, picking the host) dials again.
    pub paused: bool,
    /// Quick retries used since the last drop of a live connection; they don't count toward
    /// [`GIVE_UP_AFTER`].
    pub quick: u32,
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
            paused: false,
            quick: 0,
        }
    }
}

struct Pooled {
    key: String,
    client: DaemonClient,
    listener: u64,
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

/// The local Frogg Next daemon, dialled when nothing else names a host.
pub const LOCAL_DAEMON: &str = "127.0.0.1:9969";

/// A saved host that won't answer is retried more gently than core's default (1.5 s to 30 s),
/// so a gone host doesn't fill the console with failed handshakes.
const RECONNECT_BASE_MS: u64 = 4_000;
/// A host that drops a live connection (daemon restart) is first retried quickly: 0.5 s, 1 s,
/// 2 s, 4 s, then the gentle backoff above.
const QUICK_RETRIES: u32 = 4;
const RECONNECT_MAX_MS: u64 = 300_000;
/// Consecutive failed dials (first try included) before retries stop until the user asks.
pub const GIVE_UP_AFTER: u32 = 5;

/// Where the page itself was served from, when that may be a daemon (http(s), not the Trunk dev
/// server or the Tauri webview).
fn same_origin_candidate() -> Option<String> {
    let location = web_sys::window()?.location();
    let protocol = location.protocol().ok()?;
    if protocol != "http:" && protocol != "https:" {
        return None;
    }
    let host = location.host().ok()?;
    (!host.starts_with("localhost:1420") && !host.starts_with("tauri.localhost")).then_some(host)
}

/// `?daemon=host:port`, when given (desktop shell, dev).
fn query_endpoint() -> Option<String> {
    web_sys::window()
        .and_then(|w| w.location().search().ok())
        .and_then(|s| web_sys::UrlSearchParams::new_with_str(&s).ok())
        .and_then(|p| p.get("daemon"))
        .map(|d| d.trim().to_owned())
        .filter(|d| !d.is_empty())
        .map(|q| {
            q.trim_start_matches("ws://")
                .trim_start_matches("wss://")
                .trim_end_matches("/ws")
                .to_owned()
        })
}

/// The daemon address the page already knows: `?daemon=`, else the active direct host's
/// endpoint. Prefills forms that need a host address (pair by code).
pub fn known_endpoint() -> Option<String> {
    query_endpoint().or_else(|| {
        crate::state::get()
            .hosts
            .active_id
            .get_untracked()
            .and_then(|id| crate::state::get().hosts.find_untracked(&id))
            .filter(|h| !h.is_relay())
            .map(|h| h.endpoint)
    })
}

/// True when `GET /api/health` on the page's origin answers JSON, i.e. a daemon served the page.
#[cfg(target_arch = "wasm32")]
async fn origin_is_daemon() -> bool {
    use wasm_bindgen::JsCast;
    use wasm_bindgen_futures::JsFuture;
    let Some(window) = web_sys::window() else {
        return false;
    };
    let Ok(response) = JsFuture::from(window.fetch_with_str("/api/health")).await else {
        return false;
    };
    let Ok(response) = response.dyn_into::<web_sys::Response>() else {
        return false;
    };
    if !response.ok() {
        return false;
    }
    let Ok(text) = response.text() else {
        return false;
    };
    let text = JsFuture::from(text)
        .await
        .ok()
        .and_then(|t| t.as_string())
        .unwrap_or_default();
    serde_json::from_str::<Value>(&text).is_ok_and(|v| v.is_object())
}

#[cfg(not(target_arch = "wasm32"))]
async fn origin_is_daemon() -> bool {
    false
}

/// `?daemon=host:port` names where to look (desktop shell, dev); a page served by a daemon
/// dials its own origin; otherwise the local Frogg Next daemon. A synchronous best guess: the
/// startup path (`Connections::start`) probes the origin before saving it as a host.
pub fn default_endpoint() -> String {
    query_endpoint()
        .or_else(same_origin_candidate)
        .unwrap_or_else(|| LOCAL_DAEMON.to_owned())
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
    DaemonClient::with_options(
        client_config(),
        ClientOptions {
            reconnect_base_delay_ms: RECONNECT_BASE_MS,
            reconnect_max_delay_ms: RECONNECT_MAX_MS,
            reconnect_fast_retries: QUICK_RETRIES,
            reconnect_fast_base_delay_ms: 500,
            reconnect_fast_max_delay_ms: 4_000,
            ..ClientOptions::default()
        },
    )
}

fn client_config() -> ClientConfig {
    ClientConfig {
        client_id: client_id(),
        client_type: inbound::HelloClientType::Browser,
        app_version: Some(env!("CARGO_PKG_VERSION").to_owned()),
        device_name: None,
    }
}

/// Opens the transport for `host`: a direct socket, or the relay with E2EE. The core owns the
/// lifecycle from here (reconnect with backoff, heartbeat, server-id pinning).
fn dial(client: &DaemonClient, host: &Host) -> Result<(), String> {
    let options = ConnectOptions {
        password: host.password.clone().filter(|p| !p.is_empty()),
        token: None,
    };
    if let Some(relay_info) = &host.relay {
        let server_id = host
            .server_id
            .clone()
            .ok_or_else(|| "relay host has no server id".to_owned())?;
        #[cfg(target_arch = "wasm32")]
        return relay::connect(
            client,
            &relay::RelayTarget {
                endpoint: host.endpoint.clone(),
                use_tls: host.tls.unwrap_or(true),
                server_id,
                daemon_public_key_b64: relay_info.daemon_public_key_b64.clone(),
            },
            options,
        );
        #[cfg(not(target_arch = "wasm32"))]
        return {
            let _ = (client, relay_info, server_id, options);
            Err("no WebSocket off wasm32".into())
        };
    }
    client.set_expected_server_id(host.server_id.clone());
    #[cfg(target_arch = "wasm32")]
    return ws::connect(client, &host.url(), options);
    // Native builds (unit tests) have no browser socket.
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = options;
        Err("no WebSocket off wasm32".into())
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
        let saved = self.hosts.hosts.with_untracked(|h| !h.is_empty());
        let named = query_endpoint();
        let origin = same_origin_candidate();
        if saved || named.is_some() || origin.is_none() {
            let endpoint = named.unwrap_or_else(|| LOCAL_DAEMON.to_owned());
            let host = self.hosts.active_or_default(&endpoint);
            self.activate(&host.id);
            return;
        }
        // Only save the page's origin as a host when a daemon actually served the bundle.
        let this = *self;
        spawn_local(async move {
            let endpoint = match origin {
                Some(o) if origin_is_daemon().await => o,
                _ => LOCAL_DAEMON.to_owned(),
            };
            let host = this.hosts.active_or_default(&endpoint);
            this.activate(&host.id);
        });
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
    #[track_caller]
    pub fn link(&self, host_id: &str) -> Link {
        self.links
            .with(|l| l.get(host_id).cloned())
            .unwrap_or_else(|| Link {
                conn: Conn::Offline,
                ..Link::default()
            })
    }

    /// Link state of the active host (reactive).
    #[track_caller]
    pub fn active_link(&self) -> Link {
        match self.hosts.active_id.get() {
            Some(id) => self.link(&id),
            None => Link {
                conn: Conn::Offline,
                ..Link::default()
            },
        }
    }

    /// [`Self::active_link`] for component setup and handlers (no tracking context).
    pub fn active_link_untracked(&self) -> Link {
        match self.hosts.active_id.get_untracked() {
            Some(id) => self
                .links
                .with_untracked(|l| l.get(&id).cloned())
                .unwrap_or_else(|| Link {
                    conn: Conn::Offline,
                    ..Link::default()
                }),
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
        if let Some(x) = gone {
            x.client.unsubscribe(x.listener);
            x.client.close();
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
                },
            )
        });
        self.set_link(&host_id, |l| *l = Link::default());
        self.redial(&host_id);
    }

    /// Hands the host to the core's transport; the core reconnects from then on (the only
    /// reconnect loop).
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
        }
    }

    fn on_event(&self, host_id: &str, event: &Event) {
        match event {
            Event::State(ConnectionState::Connecting) => self.set_link(host_id, |l| {
                // A dial after a drop is a retry.
                if l.conn == Conn::Offline {
                    l.attempt += 1;
                }
                l.conn = Conn::Connecting;
                l.paused = false;
            }),
            // Connected means server_info arrived.
            Event::State(ConnectionState::Connected) => self.on_connected(host_id),
            Event::State(ConnectionState::Disconnected) => {
                let error = self
                    .client_of(host_id)
                    .and_then(|c| match c.last_error_info() {
                        Some(ErrorInfo::PairingRequired { reason, .. }) => {
                            Some(format!("pairing required: {reason}"))
                        }
                        Some(ErrorInfo::ServerIdentityMismatch { .. }) => {
                            Some("a different daemon answered".into())
                        }
                        None => c.last_error(),
                    });
                // Synchronous with the core's reconnect decision: turning reconnect off here makes
                // this drop the last dial until the user asks again.
                // A quick retry follows a drop of a live connection; it isn't a dead-host strike.
                let quick = self
                    .client_of(host_id)
                    .is_some_and(|c| c.fast_retry_pending());
                let link = self.link_untracked(host_id);
                let give_up =
                    !quick && link.attempt.saturating_sub(link.quick) + 1 >= GIVE_UP_AFTER;
                if give_up {
                    if let Some(c) = self.client_of(host_id) {
                        c.set_reconnect_enabled(false);
                    }
                }
                self.set_link(host_id, |l| {
                    l.conn = Conn::Offline;
                    l.error = error;
                    l.paused = give_up;
                    if quick {
                        l.quick += 1;
                    }
                });
            }
            Event::State(ConnectionState::Idle) => {}
            Event::Session(frame) => self.on_frame(host_id, frame),
        }
    }

    fn on_frame(&self, host_id: &str, frame: &SessionFrame) {
        match frame.kind.as_str() {
            "agent_update" | "agent_deleted" => {
                if let Ok(p) = frame.payload::<Value>() {
                    self.agents.apply_push(host_id, &frame.kind, &p);
                }
            }
            _ => {}
        }
    }

    fn on_connected(&self, host_id: &str) {
        let info = self.client_of(host_id).and_then(|c| c.server_info());
        let name = info
            .as_ref()
            .and_then(|i| i.hostname_str())
            .map(str::to_owned);
        let server_id = info.as_ref().map(|i| i.server_id.clone());
        let version = info
            .as_ref()
            .and_then(|i| i.version_str())
            .map(str::to_owned);
        self.set_link(host_id, |l| {
            l.conn = Conn::Online;
            l.attempt = 0;
            l.quick = 0;
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
            let placeholder = saved.name == saved.endpoint.split(':').next().unwrap_or_default()
                || saved.server_id.as_deref() == Some(saved.name.as_str());
            if placeholder && saved.name != name {
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
            let request = inbound::FetchAgentsRequest {
                request_id: String::new(),
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
            };
            let Ok(page) = client.fetch_agents_with(&request).await else {
                return;
            };
            let Ok(payload) = serde_json::to_value(&page) else {
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
