//! The connection core of the Rust `DaemonClient`: state machine, request correlation,
//! timeouts, reconnect with backoff, liveness heartbeat and the stale-socket guard.
//! RPC methods live in `rpc.rs`; transports in `ws.rs` / `relay.rs`.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::rc::{Rc, Weak};

use frogg_protocol::inbound;
use futures::channel::oneshot;
use serde::Deserialize;
use serde_json::Value;

use crate::binary::{self, FileFrame};
use crate::frame::{self, IncomingFrame, SessionFrame};
use crate::terminal::{TerminalStreamEvent, TerminalStreamRouter};
use crate::timer::{default_scheduler, Scheduler, TimerId};
use crate::{Error, Result};

/// Capabilities the TS client advertises in `hello`; the daemon gates payload shapes on them.
const HELLO_CAPABILITIES: &[&str] = &[
    "customModeIcons",
    "reasoningMergeEnum",
    "terminalReflowableSnapshot",
    "providerSubagents",
    "projectUpdates",
    "compactProviderSnapshots",
];

pub const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 30_000;
pub const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 15_000;
pub const DEFAULT_RECONNECT_BASE_DELAY_MS: u64 = 1_500;
pub const DEFAULT_RECONNECT_MAX_DELAY_MS: u64 = 30_000;
pub const LIVENESS_HEARTBEAT_INTERVAL_MS: u64 = 10_000;
pub const LIVENESS_HEARTBEAT_TIMEOUT_MS: u64 = 15_000;
pub const LIVENESS_FAILURE_RECONNECT_THRESHOLD: u32 = 2;
pub const DEFAULT_LIVENESS_TIMEOUT_MS: u64 = 5_000;
pub const AUTH_FAILED_CLOSE_CODE: u16 = 4401;
const AUTH_RATE_LIMITED_REASON: &str = "Too many failed attempts";
const GENERIC_TRANSPORT_ERROR: &str = "Transport error";

/// One socket. Implementations deliver events to the [`TransportSink`] they were built with,
/// always asynchronously (never from inside the constructor or `send`).
pub trait Transport {
    fn send(&self, text: String) -> std::result::Result<(), String>;
    fn close(&self);
    fn send_binary(&self, _bytes: Vec<u8>) -> std::result::Result<(), String> {
        Err("binary frames are not supported by this transport".into())
    }
    fn close_with(&self, _code: u16, _reason: &str) {
        self.close();
    }
    /// Bytes queued but not yet on the wire, when known.
    fn buffered_amount(&self) -> u64 {
        0
    }
}

/// Where a transport reports what its socket did.
pub trait TransportSink {
    fn open(&self);
    fn text(&self, text: &str);
    fn binary(&self, bytes: &[u8]);
    fn close(&self, code: Option<u16>, reason: &str);
    fn error(&self, message: &str);
}

/// Builds a transport for one connection attempt. Set by `ws::connect` / `relay::connect`.
pub type Connector = Rc<dyn Fn(Link) -> std::result::Result<Rc<dyn Transport>, String>>;

#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub client_id: String,
    pub client_type: inbound::HelloClientType,
    pub app_version: Option<String>,
    pub device_name: Option<String>,
}

/// Tuning beside [`ClientConfig`]; `Default` matches the TS client.
#[derive(Clone)]
pub struct ClientOptions {
    pub scheduler: Rc<dyn Scheduler>,
    pub request_timeout_ms: u64,
    pub connect_timeout_ms: u64,
    pub reconnect: bool,
    pub reconnect_base_delay_ms: u64,
    pub reconnect_max_delay_ms: u64,
    /// Liveness pings every 10 s once connected; two missed pongs force a reconnect.
    pub heartbeat: bool,
    /// Refuse a daemon that answers with another `serverId`.
    pub expected_server_id: Option<String>,
}

impl Default for ClientOptions {
    fn default() -> Self {
        Self {
            scheduler: default_scheduler(),
            request_timeout_ms: DEFAULT_REQUEST_TIMEOUT_MS,
            connect_timeout_ms: DEFAULT_CONNECT_TIMEOUT_MS,
            reconnect: true,
            reconnect_base_delay_ms: DEFAULT_RECONNECT_BASE_DELAY_MS,
            reconnect_max_delay_ms: DEFAULT_RECONNECT_MAX_DELAY_MS,
            heartbeat: true,
            expected_server_id: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Idle,
    Connecting,
    /// Connected means the daemon answered `hello` with `server_info`.
    Connected,
    Disconnected,
}

/// Structured detail for [`DaemonClient::last_error`].
#[derive(Debug, Clone, PartialEq)]
pub enum ErrorInfo {
    /// The daemon refused our credentials; reconnecting stops until `connect` is called again.
    PairingRequired {
        credential_rejected: bool,
        reason: String,
    },
    ServerIdentityMismatch {
        expected_server_id: String,
        actual_server_id: String,
    },
}

#[derive(Debug, Clone)]
pub enum Event {
    State(ConnectionState),
    /// Every session message the daemon sends: pushes, stream updates, `status`, responses.
    Session(SessionFrame),
}

/// The `server_info` status payload. Fields the generated types do not model are read from
/// `raw`; `features` gates RPCs like the TS client.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub server_id: String,
    #[serde(default)]
    pub hostname: Option<Value>,
    #[serde(default)]
    pub version: Option<Value>,
    #[serde(default)]
    pub caller_role: Option<String>,
    #[serde(default)]
    pub permissions: Option<Vec<Value>>,
    #[serde(default)]
    pub desktop_managed: Option<bool>,
    #[serde(default)]
    pub chat_providers: Option<Vec<String>>,
    #[serde(default)]
    pub features: serde_json::Map<String, Value>,
    #[serde(skip)]
    pub raw: Value,
}

impl ServerInfo {
    pub fn parse(payload: &Value) -> Option<Self> {
        if payload.get("status")?.as_str()? != "server_info" {
            return None;
        }
        let mut info: ServerInfo = serde_json::from_value(payload.clone()).ok()?;
        if info.server_id.trim().is_empty() {
            return None;
        }
        info.server_id = info.server_id.trim().to_owned();
        info.raw = payload.clone();
        Some(info)
    }

    /// `features.<name> === true`.
    pub fn feature(&self, name: &str) -> bool {
        self.features.get(name) == Some(&Value::Bool(true))
    }

    pub fn hostname_str(&self) -> Option<&str> {
        self.hostname.as_ref()?.as_str()
    }

    pub fn version_str(&self) -> Option<&str> {
        self.version.as_ref()?.as_str()
    }
}

type Listener = Rc<dyn Fn(&Event)>;
type StateListener = Rc<dyn Fn(ConnectionState)>;
type TerminalListener = Rc<dyn Fn(&TerminalStreamEvent)>;
pub(crate) type Matcher = Box<dyn Fn(&SessionFrame) -> bool>;

struct Waiter {
    id: u64,
    request_id: Option<String>,
    matches: Matcher,
    tx: oneshot::Sender<Result<SessionFrame>>,
    timer: Option<TimerId>,
}

struct PingProbe {
    started: f64,
    timer: TimerId,
    drives_liveness: bool,
    waiters: Vec<PingCallback>,
}

type PingCallback = Box<dyn FnOnce(Result<f64>)>;

pub(crate) struct BinaryRead {
    pub cwd: String,
    pub path: String,
    pub max_bytes: Option<u64>,
    pub begin: Option<binary::FileBeginMetadata>,
    pub chunks: Vec<u8>,
}

/// A file read over binary frames (`read_file`, `zip_directory`).
#[derive(Debug, Clone, PartialEq)]
pub struct FileReadResult {
    pub bytes: Vec<u8>,
    pub mime: String,
    pub size: u64,
    pub path: String,
    /// `"text"`, `"image"` or `"binary"`.
    pub kind: String,
    pub modified_at: Option<String>,
    pub revision: Option<String>,
}

pub(crate) struct Inner {
    pub(crate) config: ClientConfig,
    pub(crate) options: ClientOptions,
    connector: Option<Connector>,
    pub(crate) password: Option<String>,
    pub(crate) relay: bool,
    transport: Option<Rc<dyn Transport>>,
    generation: u64,
    state: ConnectionState,
    disposed: bool,
    should_reconnect: bool,
    reconnect_attempt: u32,
    reconnect_timer: Option<TimerId>,
    connect_timer: Option<TimerId>,
    error_timer: Option<TimerId>,
    heartbeat_timer: Option<TimerId>,
    ping: Option<PingProbe>,
    liveness_failures: u32,
    last_rtt_ms: Option<f64>,
    last_error: Option<String>,
    last_error_info: Option<ErrorInfo>,
    server_info: Option<ServerInfo>,
    waiters: Vec<Waiter>,
    /// Requests made while connecting, sent once `server_info` arrives.
    send_queue: Vec<(u64, String)>,
    ready: Vec<oneshot::Sender<Result<()>>>,
    listeners: Vec<(u64, Listener)>,
    state_listeners: Vec<(u64, StateListener)>,
    terminal_listeners: Vec<(u64, TerminalListener)>,
    pub(crate) terminals: TerminalStreamRouter,
    pub(crate) checkout_diff_subs: BTreeMap<String, (String, Value)>,
    pub(crate) terminal_dir_subs: BTreeMap<String, (String, Option<String>)>,
    pub(crate) binary_reads: HashMap<String, BinaryRead>,
    pub(crate) completed_reads: HashMap<String, FileReadResult>,
    next_id: u64,
}

/// Cheap to clone; clones share one connection. Single-threaded (`Rc`).
#[derive(Clone)]
pub struct DaemonClient {
    pub(crate) inner: Rc<RefCell<Inner>>,
}

/// A transport's handle back to the client for one connection attempt. Events from a link
/// whose attempt is no longer current are dropped: an old socket's late `close` must not tear
/// down a newer connection.
#[derive(Clone)]
pub struct Link {
    client: Weak<RefCell<Inner>>,
    generation: u64,
}

impl Link {
    fn live(&self) -> Option<DaemonClient> {
        let inner = self.client.upgrade()?;
        let current = inner.borrow().generation == self.generation;
        current.then_some(DaemonClient { inner })
    }

    pub fn is_current(&self) -> bool {
        self.live().is_some()
    }

    pub fn scheduler(&self) -> Option<Rc<dyn Scheduler>> {
        Some(self.client.upgrade()?.borrow().options.scheduler.clone())
    }
}

impl TransportSink for Link {
    fn open(&self) {
        if let Some(c) = self.live() {
            c.on_open();
        }
    }
    fn text(&self, text: &str) {
        if let Some(c) = self.live() {
            c.on_text(text);
        }
    }
    fn binary(&self, bytes: &[u8]) {
        if let Some(c) = self.live() {
            c.on_binary(bytes);
        }
    }
    fn close(&self, code: Option<u16>, reason: &str) {
        if let Some(c) = self.live() {
            c.on_close(code, reason);
        }
    }
    fn error(&self, message: &str) {
        if let Some(c) = self.live() {
            c.on_error(message);
        }
    }
}

fn describe_close(code: Option<u16>, reason: &str) -> String {
    let reason = reason.trim();
    if !reason.is_empty() {
        reason.to_owned()
    } else if let Some(code) = code {
        format!("Transport closed (code {code})")
    } else {
        "Transport closed".to_owned()
    }
}

/// HTTP 401 on the WebSocket upgrade, as native stacks report it (browsers hide the status).
pub fn is_http_unauthorized_handshake_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "unexpected server response",
        "bad response code from server",
        "expected http 101 response but was",
    ]
    .iter()
    .any(|p| {
        lower.find(p).is_some_and(|i| {
            let rest = lower[i + p.len()..].trim_start_matches(|c: char| !c.is_alphanumeric());
            rest.starts_with("401") && !rest[3..].starts_with(|c: char| c.is_ascii_digit())
        })
    })
}

impl DaemonClient {
    pub fn new(config: ClientConfig) -> Self {
        Self::with_options(config, ClientOptions::default())
    }

    pub fn with_options(config: ClientConfig, options: ClientOptions) -> Self {
        Self {
            inner: Rc::new(RefCell::new(Inner {
                config,
                options,
                connector: None,
                password: None,
                relay: false,
                transport: None,
                generation: 0,
                state: ConnectionState::Idle,
                disposed: false,
                should_reconnect: true,
                reconnect_attempt: 0,
                reconnect_timer: None,
                connect_timer: None,
                error_timer: None,
                heartbeat_timer: None,
                ping: None,
                liveness_failures: 0,
                last_rtt_ms: None,
                last_error: None,
                last_error_info: None,
                server_info: None,
                waiters: Vec::new(),
                send_queue: Vec::new(),
                ready: Vec::new(),
                listeners: Vec::new(),
                state_listeners: Vec::new(),
                terminal_listeners: Vec::new(),
                terminals: TerminalStreamRouter::default(),
                checkout_diff_subs: BTreeMap::new(),
                terminal_dir_subs: BTreeMap::new(),
                binary_reads: HashMap::new(),
                completed_reads: HashMap::new(),
                next_id: 0,
            })),
        }
    }

    // ---- state ------------------------------------------------------------------------------

    pub fn state(&self) -> ConnectionState {
        self.inner.borrow().state
    }

    pub fn is_connected(&self) -> bool {
        self.state() == ConnectionState::Connected
    }

    pub fn is_disposed(&self) -> bool {
        self.inner.borrow().disposed
    }

    pub fn last_error(&self) -> Option<String> {
        self.inner.borrow().last_error.clone()
    }

    pub fn last_error_info(&self) -> Option<ErrorInfo> {
        self.inner.borrow().last_error_info.clone()
    }

    pub fn last_liveness_rtt_ms(&self) -> Option<f64> {
        self.inner.borrow().last_rtt_ms
    }

    /// `getLastServerInfoMessage`: the `server_info` of the current connection.
    pub fn server_info(&self) -> Option<ServerInfo> {
        self.inner.borrow().server_info.clone()
    }

    /// `server_info.features.<name> === true` on the current connection.
    pub fn has_feature(&self, name: &str) -> bool {
        self.inner
            .borrow()
            .server_info
            .as_ref()
            .is_some_and(|s| s.feature(name))
    }

    pub fn client_id(&self) -> String {
        self.inner.borrow().config.client_id.clone()
    }

    pub fn set_expected_server_id(&self, server_id: Option<String>) {
        self.inner.borrow_mut().options.expected_server_id = server_id;
    }

    pub fn set_reconnect_enabled(&self, enabled: bool) {
        self.inner.borrow_mut().options.reconnect = enabled;
    }

    pub fn scheduler(&self) -> Rc<dyn Scheduler> {
        self.inner.borrow().options.scheduler.clone()
    }

    // ---- listeners --------------------------------------------------------------------------

    /// Registers a listener; returns a handle for [`DaemonClient::unsubscribe`].
    pub fn subscribe(&self, listener: impl Fn(&Event) + 'static) -> u64 {
        let id = self.next_id();
        self.inner
            .borrow_mut()
            .listeners
            .push((id, Rc::new(listener)));
        id
    }

    /// Removes any listener registered by `subscribe`, `subscribe_connection_status` or
    /// `on_terminal_stream_event`.
    pub fn unsubscribe(&self, id: u64) {
        let mut inner = self.inner.borrow_mut();
        inner.listeners.retain(|(i, _)| *i != id);
        inner.state_listeners.retain(|(i, _)| *i != id);
        inner.terminal_listeners.retain(|(i, _)| *i != id);
    }

    /// Calls `listener` now with the current state and on every change.
    pub fn subscribe_connection_status(&self, listener: impl Fn(ConnectionState) + 'static) -> u64 {
        let id = self.next_id();
        let listener: StateListener = Rc::new(listener);
        self.inner
            .borrow_mut()
            .state_listeners
            .push((id, listener.clone()));
        listener(self.state());
        id
    }

    pub fn on_terminal_stream_event(
        &self,
        listener: impl Fn(&TerminalStreamEvent) + 'static,
    ) -> u64 {
        let id = self.next_id();
        self.inner
            .borrow_mut()
            .terminal_listeners
            .push((id, Rc::new(listener)));
        id
    }

    // ---- connection -------------------------------------------------------------------------

    /// Installs the transport factory used for this and every reconnect attempt.
    pub fn set_connector(&self, connector: Connector, password: Option<String>, relay: bool) {
        let mut inner = self.inner.borrow_mut();
        inner.connector = Some(connector);
        inner.password = password
            .map(|p| p.trim().to_owned())
            .filter(|p| !p.is_empty());
        inner.relay = relay;
    }

    /// Starts connecting (no-op while connected or connecting). Re-enables reconnecting after
    /// [`DaemonClient::disconnect`] or an auth rejection.
    pub fn connect(&self) {
        {
            let mut inner = self.inner.borrow_mut();
            if inner.disposed {
                return;
            }
            inner.should_reconnect = true;
            if matches!(
                inner.state,
                ConnectionState::Connected | ConnectionState::Connecting
            ) {
                return;
            }
            if let Some(t) = inner.reconnect_timer.take() {
                inner.options.scheduler.clear_timeout(t);
            }
        }
        self.attempt_connect();
    }

    /// Resolves once connected (`server_info` received); fails when the client gives up
    /// (auth rejected, reconnect disabled, disposed).
    pub async fn ready(&self) -> Result<()> {
        let rx = {
            let mut inner = self.inner.borrow_mut();
            if inner.disposed {
                return Err(Error::Disposed);
            }
            if inner.state == ConnectionState::Connected {
                return Ok(());
            }
            let (tx, rx) = oneshot::channel();
            inner.ready.push(tx);
            rx
        };
        rx.await.unwrap_or(Err(Error::Closed))
    }

    fn attempt_connect(&self) {
        let connector = {
            let inner = self.inner.borrow();
            if inner.disposed || !inner.should_reconnect {
                return;
            }
            if inner.state == ConnectionState::Connecting && inner.transport.is_some() {
                return;
            }
            let Some(connector) = inner.connector.clone() else {
                return;
            };
            connector
        };
        // Always dispose the previous transport first: close/error ordering can overlap.
        self.dispose_transport(1001, "Reconnecting");
        let link = {
            let mut inner = self.inner.borrow_mut();
            inner.generation += 1;
            inner.server_info = None;
            Link {
                client: Rc::downgrade(&self.inner),
                generation: inner.generation,
            }
        };
        self.set_state(ConnectionState::Connecting);
        let timeout = self.inner.borrow().options.connect_timeout_ms.max(1);
        let weak = Rc::downgrade(&self.inner);
        let generation = link.generation;
        let timer = self.scheduler().set_timeout(
            timeout,
            Box::new(move || {
                let Some(inner) = weak.upgrade() else { return };
                let c = DaemonClient { inner };
                {
                    let mut i = c.inner.borrow_mut();
                    if i.generation != generation || i.state != ConnectionState::Connecting {
                        return;
                    }
                    i.connect_timer = None;
                    i.last_error = Some("Connection timed out".into());
                }
                c.dispose_transport(1001, "Connection timed out");
                c.schedule_reconnect("Connection timed out");
            }),
        );
        self.inner.borrow_mut().connect_timer = Some(timer);
        match connector(link) {
            Ok(t) => {
                let mut inner = self.inner.borrow_mut();
                if inner.generation == generation {
                    inner.transport = Some(t);
                } else {
                    t.close();
                }
            }
            Err(e) => {
                self.clear_connect_timer();
                self.inner.borrow_mut().last_error = Some(e.clone());
                self.schedule_reconnect(&e);
            }
        }
    }

    /// Stops reconnecting and closes the socket; requests in flight fail with `Closed`.
    /// `connect` (or `ws::connect`) starts again.
    pub fn disconnect(&self) {
        {
            let mut inner = self.inner.borrow_mut();
            inner.should_reconnect = false;
            if let Some(t) = inner.reconnect_timer.take() {
                inner.options.scheduler.clear_timeout(t);
            }
        }
        self.dispose_transport(1000, "Client closed");
        self.fail_connection(Error::Closed);
        self.inner.borrow_mut().generation += 1;
        if self.state() != ConnectionState::Idle {
            self.set_state(ConnectionState::Disconnected);
        }
    }

    /// Disposes the client for good (TS `close()`).
    pub fn close(&self) {
        self.disconnect();
        let mut inner = self.inner.borrow_mut();
        inner.disposed = true;
        inner.terminals.clear_slots();
        for tx in inner.ready.drain(..) {
            let _ = tx.send(Err(Error::Disposed));
        }
    }

    fn dispose_transport(&self, code: u16, reason: &str) {
        self.stop_heartbeat();
        self.clear_connect_timer();
        let transport = {
            let mut inner = self.inner.borrow_mut();
            if let Some(t) = inner.error_timer.take() {
                inner.options.scheduler.clear_timeout(t);
            }
            inner.transport.take()
        };
        if let Some(t) = transport {
            t.close_with(code, reason);
        }
    }

    fn clear_connect_timer(&self) {
        let mut inner = self.inner.borrow_mut();
        if let Some(t) = inner.connect_timer.take() {
            inner.options.scheduler.clear_timeout(t);
        }
    }

    /// Fails waiters, the send queue and the ping probe; forgets per-connection state.
    fn fail_connection(&self, error: Error) {
        let (waiters, ping) = {
            let mut inner = self.inner.borrow_mut();
            inner.send_queue.clear();
            inner.terminals.clear_slots();
            inner.server_info = None;
            inner.binary_reads.values_mut().for_each(|r| {
                r.begin = None;
                r.chunks.clear()
            });
            (std::mem::take(&mut inner.waiters), inner.ping.take())
        };
        let scheduler = self.scheduler();
        for w in waiters {
            if let Some(t) = w.timer {
                scheduler.clear_timeout(t);
            }
            let _ = w.tx.send(Err(error.clone()));
        }
        if let Some(p) = ping {
            scheduler.clear_timeout(p.timer);
            for tx in p.waiters {
                tx(Err(error.clone()));
            }
        }
    }

    fn schedule_reconnect(&self, reason: &str) {
        {
            let mut inner = self.inner.borrow_mut();
            if let Some(t) = inner.reconnect_timer.take() {
                inner.options.scheduler.clear_timeout(t);
            }
            if !reason.trim().is_empty() {
                inner.last_error = Some(reason.trim().to_owned());
            }
            // The socket that failed is done; its late events must not reach a new attempt.
            inner.generation += 1;
        }
        self.stop_heartbeat();
        self.clear_connect_timer();
        let transport = self.inner.borrow_mut().transport.take();
        drop(transport);
        self.fail_connection(Error::Closed);
        if self.is_disposed() {
            return;
        }
        self.set_state(ConnectionState::Disconnected);
        let (give_up, delay) = {
            let mut inner = self.inner.borrow_mut();
            let give_up =
                !inner.should_reconnect || !inner.options.reconnect || inner.connector.is_none();
            let attempt = inner.reconnect_attempt.min(20);
            let delay = inner
                .options
                .reconnect_base_delay_ms
                .saturating_mul(1u64 << attempt)
                .min(inner.options.reconnect_max_delay_ms);
            if !give_up {
                inner.reconnect_attempt += 1;
            }
            (give_up, delay)
        };
        if give_up {
            let ready = std::mem::take(&mut self.inner.borrow_mut().ready);
            for tx in ready {
                let _ = tx.send(Err(Error::Daemon(reason.to_owned())));
            }
            return;
        }
        let weak = Rc::downgrade(&self.inner);
        let timer = self.scheduler().set_timeout(
            delay,
            Box::new(move || {
                let Some(inner) = weak.upgrade() else { return };
                let c = DaemonClient { inner };
                {
                    let mut i = c.inner.borrow_mut();
                    i.reconnect_timer = None;
                    if !i.should_reconnect {
                        return;
                    }
                }
                c.attempt_connect();
            }),
        );
        self.inner.borrow_mut().reconnect_timer = Some(timer);
    }

    fn report_auth_rejected(&self, reason: &str) {
        {
            let mut inner = self.inner.borrow_mut();
            let credential_rejected = inner.password.is_some();
            inner.last_error = Some(reason.to_owned());
            inner.last_error_info = Some(ErrorInfo::PairingRequired {
                credential_rejected,
                reason: reason.to_owned(),
            });
            inner.should_reconnect = false;
        }
        self.schedule_reconnect(reason);
    }

    // ---- transport events -------------------------------------------------------------------

    fn on_open(&self) {
        {
            let mut inner = self.inner.borrow_mut();
            if let Some(t) = inner.error_timer.take() {
                inner.options.scheduler.clear_timeout(t);
            }
            inner.last_error = None;
        }
        if let Err(e) = self.send_hello() {
            self.inner.borrow_mut().last_error = Some(e.to_string());
            self.dispose_transport(1001, "Hello failed");
            self.schedule_reconnect(&e.to_string());
        }
    }

    fn on_close(&self, code: Option<u16>, reason: &str) {
        self.clear_connect_timer();
        {
            let mut inner = self.inner.borrow_mut();
            if let Some(t) = inner.error_timer.take() {
                inner.options.scheduler.clear_timeout(t);
            }
            inner.transport = None;
        }
        let reason = describe_close(code, reason);
        if code == Some(AUTH_FAILED_CLOSE_CODE) && reason != AUTH_RATE_LIMITED_REASON {
            self.report_auth_rejected(&reason);
            return;
        }
        self.schedule_reconnect(&reason);
    }

    fn on_error(&self, message: &str) {
        self.clear_connect_timer();
        let message = if message.trim().is_empty() {
            GENERIC_TRANSPORT_ERROR
        } else {
            message.trim()
        };
        if is_http_unauthorized_handshake_error(message) {
            self.dispose_transport(1000, "Unauthorized");
            self.report_auth_rejected(message);
            return;
        }
        if message == GENERIC_TRANSPORT_ERROR {
            // Browsers follow a detail-free error with a close that says more; wait for it.
            let mut inner = self.inner.borrow_mut();
            if inner.last_error.is_none() {
                inner.last_error = Some(message.to_owned());
            }
            if inner.error_timer.is_none() {
                let weak = Rc::downgrade(&self.inner);
                let generation = inner.generation;
                let timer = inner.options.scheduler.set_timeout(
                    250,
                    Box::new(move || {
                        let Some(inner) = weak.upgrade() else { return };
                        let c = DaemonClient { inner };
                        {
                            let mut i = c.inner.borrow_mut();
                            i.error_timer = None;
                            if i.generation != generation {
                                return;
                            }
                        }
                        c.dispose_transport(1001, GENERIC_TRANSPORT_ERROR);
                        c.schedule_reconnect(GENERIC_TRANSPORT_ERROR);
                    }),
                );
                inner.error_timer = Some(timer);
            }
            return;
        }
        self.dispose_transport(1001, message);
        self.schedule_reconnect(message);
    }

    fn on_text(&self, text: &str) {
        let Some(frame) = frame::parse(text) else {
            return;
        };
        self.inner.borrow_mut().liveness_failures = 0;
        match frame {
            IncomingFrame::Pong => self.resolve_ping(),
            IncomingFrame::Session(session) => self.handle_session(session),
            IncomingFrame::Other(_) => {}
        }
    }

    fn on_binary(&self, bytes: &[u8]) {
        if let Some(f) = binary::decode_file_frame(bytes) {
            self.inner.borrow_mut().liveness_failures = 0;
            self.handle_file_frame(f);
            return;
        }
        if let Some(f) = binary::decode_terminal_frame(bytes) {
            self.inner.borrow_mut().liveness_failures = 0;
            let event = self.inner.borrow().terminals.route(f);
            if let Some(event) = event {
                let listeners: Vec<TerminalListener> = self
                    .inner
                    .borrow()
                    .terminal_listeners
                    .iter()
                    .map(|(_, l)| l.clone())
                    .collect();
                for l in listeners {
                    l(&event);
                }
            }
            return;
        }
        // Some transports deliver text as binary.
        if let Ok(text) = std::str::from_utf8(bytes) {
            self.on_text(text);
        }
    }

    fn handle_file_frame(&self, frame: FileFrame) {
        let synthesized = {
            let mut inner = self.inner.borrow_mut();
            let rid = frame.request_id().to_owned();
            let Some(read) = inner.binary_reads.get_mut(&rid) else {
                return;
            };
            match frame {
                FileFrame::Begin { metadata, .. } => {
                    read.begin = Some(metadata);
                    read.chunks.clear();
                    None
                }
                FileFrame::Chunk { payload, .. } => {
                    let Some(begin) = &read.begin else { return };
                    // COMPAT(fileReadByteBudget): old daemons stream despite maxBytes.
                    if read.max_bytes.is_some_and(|m| begin.size > m) {
                        return;
                    }
                    read.chunks.extend_from_slice(&payload);
                    None
                }
                FileFrame::End { .. } => {
                    let Some(begin) = read.begin.take() else {
                        return;
                    };
                    let (cwd, path) = (read.cwd.clone(), read.path.clone());
                    let too_large = read.max_bytes.is_some_and(|m| begin.size > m);
                    let bytes = std::mem::take(&mut read.chunks);
                    if !too_large {
                        let kind = if begin.encoding == "utf-8" {
                            "text"
                        } else if begin.mime.starts_with("image/") {
                            "image"
                        } else {
                            "binary"
                        };
                        inner.completed_reads.insert(
                            rid.clone(),
                            FileReadResult {
                                bytes,
                                mime: begin.mime.clone(),
                                size: begin.size,
                                path: path.clone(),
                                kind: kind.into(),
                                modified_at: Some(begin.modified_at.clone()),
                                revision: begin.revision.clone(),
                            },
                        );
                    }
                    Some(serde_json::json!({
                        "type": "session",
                        "message": {
                            "type": "file_explorer_response",
                            "payload": {
                                "cwd": cwd, "path": path, "mode": "file",
                                "directory": null, "file": null,
                                "error": if too_large { Value::from("File is too large to display") } else { Value::Null },
                                "requestId": rid,
                            }
                        }
                    }))
                }
            }
        };
        if let Some(msg) = synthesized {
            if let Some(IncomingFrame::Session(s)) = frame::parse(&msg.to_string()) {
                self.handle_session(s);
            }
        }
    }

    fn handle_session(&self, frame: SessionFrame) {
        if frame.kind == "status" {
            let info = ServerInfo::parse(&frame.json()["payload"]);
            if let Some(info) = info {
                if self.reject_unexpected_server(&info.server_id) {
                    return;
                }
                let was_connecting = {
                    let mut inner = self.inner.borrow_mut();
                    inner.server_info = Some(info);
                    inner.state == ConnectionState::Connecting
                };
                if was_connecting {
                    self.on_connected();
                }
            }
        }
        if frame.kind == "terminal_stream_exit" {
            if let Some(id) = frame.json()["payload"]["terminalId"].as_str() {
                self.inner.borrow_mut().terminals.remove_terminal(id);
            }
        }

        self.emit(&Event::Session(frame.clone()));
        self.resolve_waiters(&frame);
    }

    fn on_connected(&self) {
        self.clear_connect_timer();
        {
            let mut inner = self.inner.borrow_mut();
            inner.reconnect_attempt = 0;
            inner.last_error_info = None;
        }
        self.set_state(ConnectionState::Connected);
        self.start_heartbeat();
        self.resubscribe();
        let queue = std::mem::take(&mut self.inner.borrow_mut().send_queue);
        for (waiter_id, text) in queue {
            let alive = self
                .inner
                .borrow()
                .waiters
                .iter()
                .any(|w| w.id == waiter_id);
            if alive {
                if let Err(e) = self.send_text(text) {
                    self.finish_waiter(waiter_id, Err(e));
                }
            }
        }
        let ready = std::mem::take(&mut self.inner.borrow_mut().ready);
        for tx in ready {
            let _ = tx.send(Ok(()));
        }
    }

    fn resubscribe(&self) {
        let (diffs, terminals) = {
            let inner = self.inner.borrow();
            (
                inner.checkout_diff_subs.clone(),
                inner.terminal_dir_subs.clone(),
            )
        };
        for (subscription_id, (cwd, compare)) in diffs {
            let request_id = self.new_request_id();
            let _ = self.send_session(serde_json::json!({
                "type": "subscribe_checkout_diff_request",
                "subscriptionId": subscription_id,
                "cwd": cwd,
                "compare": compare,
                "requestId": request_id,
            }));
        }
        for (_, (cwd, workspace_id)) in terminals {
            let mut msg = serde_json::json!({ "type": "subscribe_terminals_request", "cwd": cwd });
            if let Some(w) = workspace_id {
                msg["workspaceId"] = w.into();
            }
            let _ = self.send_session(msg);
        }
    }

    fn reject_unexpected_server(&self, server_id: &str) -> bool {
        let expected = self.inner.borrow().options.expected_server_id.clone();
        let Some(expected) = expected.filter(|e| e != server_id) else {
            return false;
        };
        let reason = format!(
            "This address is now answered by a different daemon ({server_id}), not this host ({expected}). Stop the other daemon or check the address; reconnecting keeps trying."
        );
        {
            let mut inner = self.inner.borrow_mut();
            inner.last_error = Some(reason.clone());
            inner.last_error_info = Some(ErrorInfo::ServerIdentityMismatch {
                expected_server_id: expected,
                actual_server_id: server_id.to_owned(),
            });
        }
        self.dispose_transport(1008, "Unexpected server identity");
        self.schedule_reconnect(&reason);
        true
    }

    fn resolve_waiters(&self, frame: &SessionFrame) {
        let rpc_error = (frame.kind == "rpc_error").then(|| {
            let p = &frame.json()["payload"];
            Error::Rpc {
                request_id: p["requestId"].as_str().unwrap_or_default().to_owned(),
                error: p["error"].as_str().unwrap_or("Request failed").to_owned(),
                code: p["code"].as_str().map(str::to_owned),
                request_type: p["requestType"].as_str().map(str::to_owned),
            }
        });
        let done: Vec<Waiter> = {
            let mut inner = self.inner.borrow_mut();
            let mut done = Vec::new();
            let mut i = 0;
            while i < inner.waiters.len() {
                let w = &inner.waiters[i];
                let hit = match &rpc_error {
                    Some(_) => w.request_id.is_some() && w.request_id == frame.request_id,
                    None => (w.matches)(frame),
                };
                if hit {
                    done.push(inner.waiters.remove(i));
                } else {
                    i += 1;
                }
            }
            done
        };
        let scheduler = self.scheduler();
        for w in done {
            if let Some(t) = w.timer {
                scheduler.clear_timeout(t);
            }
            let _ = w.tx.send(match &rpc_error {
                Some(e) => Err(e.clone()),
                None => Ok(frame.clone()),
            });
        }
    }

    fn finish_waiter(&self, id: u64, result: Result<SessionFrame>) {
        let w = {
            let mut inner = self.inner.borrow_mut();
            let pos = inner.waiters.iter().position(|w| w.id == id);
            pos.map(|p| inner.waiters.remove(p))
        };
        if let Some(w) = w {
            if let Some(t) = w.timer {
                self.scheduler().clear_timeout(t);
            }
            let _ = w.tx.send(result);
        }
    }

    // ---- liveness ---------------------------------------------------------------------------

    fn start_heartbeat(&self) {
        self.stop_heartbeat();
        self.inner.borrow_mut().last_rtt_ms = None;
        self.schedule_heartbeat();
    }

    fn stop_heartbeat(&self) {
        let mut inner = self.inner.borrow_mut();
        if let Some(t) = inner.heartbeat_timer.take() {
            inner.options.scheduler.clear_timeout(t);
        }
    }

    fn schedule_heartbeat(&self) {
        let mut inner = self.inner.borrow_mut();
        if inner.state != ConnectionState::Connected
            || inner.heartbeat_timer.is_some()
            || !inner.options.heartbeat
        {
            return;
        }
        let weak = Rc::downgrade(&self.inner);
        let timer = inner.options.scheduler.set_timeout(
            LIVENESS_HEARTBEAT_INTERVAL_MS,
            Box::new(move || {
                let Some(inner) = weak.upgrade() else { return };
                let c = DaemonClient { inner };
                c.inner.borrow_mut().heartbeat_timer = None;
                let c2 = c.clone();
                c.start_ping(
                    LIVENESS_HEARTBEAT_TIMEOUT_MS,
                    true,
                    Box::new(move |result| {
                        if let Ok(rtt) = result {
                            c2.inner.borrow_mut().last_rtt_ms = Some(rtt);
                        }
                        c2.schedule_heartbeat();
                    }),
                );
            }),
        );
        inner.heartbeat_timer = Some(timer);
    }

    /// Sends an envelope-level `ping` and resolves with the round trip in ms.
    fn start_ping(&self, timeout_ms: u64, drives_liveness: bool, done: PingCallback) {
        if self.state() != ConnectionState::Connected {
            done(Err(Error::NotConnected));
            return;
        }
        {
            let mut inner = self.inner.borrow_mut();
            if let Some(p) = inner.ping.as_mut() {
                p.waiters.push(done);
                return;
            }
        }
        let scheduler = self.scheduler();
        let weak = Rc::downgrade(&self.inner);
        let timer = scheduler.set_timeout(
            timeout_ms,
            Box::new(move || {
                let Some(inner) = weak.upgrade() else { return };
                let c = DaemonClient { inner };
                let probe = c.inner.borrow_mut().ping.take();
                if let Some(p) = probe {
                    for tx in p.waiters {
                        tx(Err(Error::Timeout(timeout_ms)));
                    }
                    if p.drives_liveness {
                        c.record_liveness_failure(&format!(
                            "Liveness check timed out after {timeout_ms}ms"
                        ));
                    }
                }
            }),
        );
        self.inner.borrow_mut().ping = Some(PingProbe {
            started: scheduler.now_ms(),
            timer,
            drives_liveness,
            waiters: vec![done],
        });
        if let Err(e) = self.send_text(r#"{"type":"ping"}"#.to_owned()) {
            let probe = self.inner.borrow_mut().ping.take();
            if let Some(p) = probe {
                scheduler.clear_timeout(p.timer);
                for tx in p.waiters {
                    tx(Err(e.clone()));
                }
            }
            if drives_liveness {
                self.record_liveness_failure(&e.to_string());
            }
        }
    }

    fn resolve_ping(&self) {
        let probe = self.inner.borrow_mut().ping.take();
        if let Some(p) = probe {
            let scheduler = self.scheduler();
            scheduler.clear_timeout(p.timer);
            let rtt = scheduler.now_ms() - p.started;
            for tx in p.waiters {
                tx(Ok(rtt));
            }
        }
    }

    fn record_liveness_failure(&self, reason: &str) {
        let reconnect = {
            let mut inner = self.inner.borrow_mut();
            inner.liveness_failures += 1;
            if inner.liveness_failures < LIVENESS_FAILURE_RECONNECT_THRESHOLD {
                false
            } else {
                inner.liveness_failures = 0;
                inner.last_error = Some(reason.to_owned());
                true
            }
        };
        if reconnect {
            self.dispose_transport(1001, "Liveness check timed out");
            self.schedule_reconnect(reason);
        }
    }

    /// Round trip to the daemon in ms over an envelope `ping` (default 5 s timeout).
    pub async fn measure_latency(&self, timeout_ms: Option<u64>) -> Result<f64> {
        let (tx, rx) = oneshot::channel();
        self.start_ping(
            timeout_ms.unwrap_or(DEFAULT_LIVENESS_TIMEOUT_MS).max(1),
            false,
            Box::new(move |r| {
                let _ = tx.send(r);
            }),
        );
        rx.await.unwrap_or(Err(Error::Closed))
    }

    // ---- legacy manual transport API (tests, custom transports) -----------------------------

    /// Attaches a transport for a new attempt without a connector (no reconnect). Prefer
    /// [`DaemonClient::set_connector`] + [`DaemonClient::connect`].
    pub fn attach(&self, transport: Rc<dyn Transport>) {
        self.dispose_transport(1001, "Reconnecting");
        {
            let mut inner = self.inner.borrow_mut();
            inner.generation += 1;
            inner.transport = Some(transport);
            inner.server_info = None;
        }
        self.set_state(ConnectionState::Connecting);
    }

    /// The link for the current attempt (what a connector receives).
    pub fn current_link(&self) -> Link {
        Link {
            client: Rc::downgrade(&self.inner),
            generation: self.inner.borrow().generation,
        }
    }

    pub fn handle_open(&self) {
        self.current_link().open();
    }

    pub fn handle_frame(&self, text: &str) {
        self.current_link().text(text);
    }

    pub fn handle_binary(&self, bytes: &[u8]) {
        self.current_link().binary(bytes);
    }

    /// The socket closed; requests in flight fail with `Closed`.
    pub fn handle_close(&self) {
        self.current_link().close(None, "");
    }

    // ---- sending ----------------------------------------------------------------------------

    pub(crate) fn next_id(&self) -> u64 {
        let mut inner = self.inner.borrow_mut();
        inner.next_id += 1;
        inner.next_id
    }

    /// A fresh request id (UUID v4, like `crypto.randomUUID()`).
    pub fn new_request_id(&self) -> String {
        crate::util::uuid_v4().unwrap_or_else(|_| {
            let n = self.next_id();
            format!("rs-{}-{n}", self.client_id())
        })
    }

    /// Kept for callers of the skeleton API.
    pub fn next_request_id(&self) -> String {
        self.new_request_id()
    }

    fn send_hello(&self) -> Result<()> {
        let (config, relay_token) = {
            let inner = self.inner.borrow();
            let token = if inner.relay {
                inner.password.clone()
            } else {
                None
            };
            (inner.config.clone(), token)
        };
        let capabilities: serde_json::Map<String, Value> = HELLO_CAPABILITIES
            .iter()
            .map(|c| ((*c).to_owned(), Value::Bool(true)))
            .collect();
        // Built as JSON rather than `inbound::Hello`: the capability map is open-ended on the
        // wire and the generated struct only models the keys the schema names.
        let mut hello = serde_json::json!({
            "type": "hello",
            "clientId": config.client_id,
            "clientType": config.client_type,
            "protocolVersion": 1,
            "capabilities": capabilities,
            "appVersion": config.app_version,
            "deviceName": config.device_name,
        });
        // A relay socket reaches the daemon through a tunnel, so the bearer a direct
        // connection puts in the handshake travels in the hello.
        if let Some(token) = relay_token {
            hello["auth"] = serde_json::json!({ "token": token });
        }
        if let Some(obj) = hello.as_object_mut() {
            obj.retain(|_, v| !v.is_null());
        }
        self.send_text(hello.to_string())
    }

    pub(crate) fn send_text(&self, text: String) -> Result<()> {
        let transport = self.inner.borrow().transport.clone();
        transport
            .ok_or(Error::NotConnected)?
            .send(text)
            .map_err(Error::Send)
    }

    pub(crate) fn send_binary_frame(&self, bytes: Vec<u8>) -> Result<()> {
        if self.state() != ConnectionState::Connected {
            return Err(Error::NotConnected);
        }
        let transport = self.inner.borrow().transport.clone();
        transport
            .ok_or(Error::NotConnected)?
            .send_binary(bytes)
            .map_err(Error::Send)
    }

    pub(crate) fn buffered_amount(&self) -> u64 {
        self.inner
            .borrow()
            .transport
            .as_ref()
            .map_or(0, |t| t.buffered_amount())
    }

    /// Fire-and-forget session message; needs a live connection.
    pub(crate) fn send_session(&self, message: Value) -> Result<()> {
        if self.state() != ConnectionState::Connected {
            return Err(Error::NotConnected);
        }
        self.send_text(serde_json::json!({ "type": "session", "message": message }).to_string())
    }

    /// Sends a session message and waits for the first frame `matches` accepts (or an
    /// `rpc_error` carrying `request_id`). While connecting, the message is queued and sent
    /// once connected; the timeout covers the wait.
    pub(crate) async fn request_frame(
        &self,
        message: Value,
        request_id: Option<String>,
        matches: Matcher,
        timeout_ms: Option<u64>,
    ) -> Result<SessionFrame> {
        let (tx, rx) = oneshot::channel();
        let id = self.next_id();
        let text = serde_json::json!({ "type": "session", "message": message }).to_string();
        let state = {
            let inner = self.inner.borrow();
            if inner.disposed {
                return Err(Error::Disposed);
            }
            inner.state
        };
        let timeout = timeout_ms.unwrap_or(self.inner.borrow().options.request_timeout_ms);
        let timer = (timeout > 0).then(|| {
            let weak = Rc::downgrade(&self.inner);
            self.scheduler().set_timeout(
                timeout,
                Box::new(move || {
                    if let Some(inner) = weak.upgrade() {
                        DaemonClient { inner }.finish_waiter(id, Err(Error::Timeout(timeout)));
                    }
                }),
            )
        });
        self.inner.borrow_mut().waiters.push(Waiter {
            id,
            request_id,
            matches,
            tx,
            timer,
        });
        match state {
            ConnectionState::Connected => {
                if let Err(e) = self.send_text(text) {
                    self.finish_waiter(id, Err(e));
                }
            }
            ConnectionState::Connecting => self.inner.borrow_mut().send_queue.push((id, text)),
            _ => self.finish_waiter(id, Err(Error::NotConnected)),
        }
        rx.await.unwrap_or(Err(Error::Closed))
    }

    /// Kept from the skeleton: sends a typed message and waits for its `requestId`.
    pub async fn request(
        &self,
        request_id: &str,
        message: &inbound::SessionMessage,
    ) -> Result<SessionFrame> {
        let value = serde_json::to_value(message).map_err(|e| Error::Send(e.to_string()))?;
        let rid = request_id.to_owned();
        self.request_frame(
            value,
            Some(rid.clone()),
            Box::new(move |f| f.request_id.as_deref() == Some(rid.as_str())),
            None,
        )
        .await
    }

    fn set_state(&self, state: ConnectionState) {
        let (changed, listeners) = {
            let mut inner = self.inner.borrow_mut();
            let changed = inner.state != state;
            inner.state = state;
            (
                changed,
                inner
                    .state_listeners
                    .iter()
                    .map(|(_, l)| l.clone())
                    .collect::<Vec<_>>(),
            )
        };
        if changed {
            for l in listeners {
                l(state);
            }
            self.emit(&Event::State(state));
        }
    }

    fn emit(&self, event: &Event) {
        // Snapshot so a listener can (un)subscribe while being called.
        let listeners: Vec<Listener> = self
            .inner
            .borrow()
            .listeners
            .iter()
            .map(|(_, l)| l.clone())
            .collect();
        for l in listeners {
            l(event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unauthorized_handshake_errors() {
        assert!(is_http_unauthorized_handshake_error(
            "Unexpected server response: 401"
        ));
        assert!(is_http_unauthorized_handshake_error(
            "Expected HTTP 101 response but was '401 Unauthorized'"
        ));
        assert!(!is_http_unauthorized_handshake_error(
            "Unexpected server response: 429"
        ));
        assert!(!is_http_unauthorized_handshake_error(
            "Unexpected server response: 4010"
        ));
    }

    #[test]
    fn server_info_features() {
        let info = ServerInfo::parse(&serde_json::json!({
            "status": "server_info", "serverId": " srv ", "features": { "plugins": true, "x": false }
        }))
        .unwrap();
        assert_eq!(info.server_id, "srv");
        assert!(info.feature("plugins"));
        assert!(!info.feature("x"));
        assert!(!info.feature("missing"));
        assert!(ServerInfo::parse(&serde_json::json!({"status":"agent_created"})).is_none());
    }
}
