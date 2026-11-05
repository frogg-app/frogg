//! Frogg daemon client: the Rust port of `@frogg/client`'s `DaemonClient`, its transports,
//! the relay E2EE channel, device identity and pairing-link parsing.
//!
//! The client is single-threaded (it runs inside the WebView as WASM on every target) and
//! transport-agnostic: a transport reports socket events to a [`Link`]; the client correlates
//! responses to requests by `requestId`, fans pushes out as [`Event`]s, reconnects with
//! backoff and keeps the connection alive with a heartbeat. Timers go through a
//! [`timer::Scheduler`] (`setTimeout` in the browser, a manual clock in native tests).

pub mod binary;
mod client;
pub mod crypto;
pub mod e2ee;
mod frame;
pub mod identity;
mod normalize;
pub mod pairing;
pub mod relay;
mod rpc;
pub mod storage;
pub mod terminal;
pub mod timer;
mod util;
#[cfg(target_arch = "wasm32")]
pub mod ws;

pub use client::{
    is_http_unauthorized_handshake_error, ClientConfig, ClientOptions, ConnectionState, Connector,
    DaemonClient, ErrorInfo, Event, FileReadResult, Link, ServerInfo, Transport, TransportSink,
    AUTH_FAILED_CLOSE_CODE, DEFAULT_REQUEST_TIMEOUT_MS,
};
pub use frame::{IncomingFrame, SessionFrame};
pub use frogg_protocol as protocol;
pub use rpc::*;
pub use terminal::{TerminalInput, TerminalStreamEvent};
pub use util::uuid_v4;

/// How to authenticate a direct connection.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConnectOptions {
    /// Daemon password or a paired device credential. Browsers cannot set headers on a
    /// WebSocket, so it travels as the `frogg.bearer.<password>` subprotocol (direct) or in
    /// `hello.auth.token` (relay), as the TS client does.
    pub password: Option<String>,
    /// Alias of `password` for device tokens; used when `password` is unset.
    pub token: Option<String>,
}

impl ConnectOptions {
    pub fn credential(&self) -> Option<String> {
        self.password
            .clone()
            .or_else(|| self.token.clone())
            .map(|p| p.trim().to_owned())
            .filter(|p| !p.is_empty())
    }
}

#[derive(Debug, Clone, thiserror::Error, PartialEq)]
pub enum Error {
    #[error("not connected to the daemon")]
    NotConnected,
    #[error("connection closed before the daemon answered")]
    Closed,
    #[error("could not send: {0}")]
    Send(String),
    #[error("unexpected response: {0}")]
    Decode(String),
    /// The daemon answered but refused (an `error` field, `accepted: false`, ...).
    #[error("{0}")]
    Daemon(String),
    #[error("timed out after {0} ms")]
    Timeout(u64),
    /// An `rpc_error` frame for this request.
    #[error("{error}")]
    Rpc {
        request_id: String,
        error: String,
        code: Option<String>,
        request_type: Option<String>,
    },
    /// The connected daemon lacks the `server_info.features` flag this call needs.
    #[error("{0}")]
    Unsupported(String),
    #[error("the client was closed")]
    Disposed,
}

pub type Result<T> = std::result::Result<T, Error>;

/// Resolves after `ms` on the client's scheduler.
pub async fn sleep(client: &DaemonClient, ms: u64) {
    let (tx, rx) = futures::channel::oneshot::channel::<()>();
    client.scheduler().set_timeout(
        ms,
        Box::new(move || {
            let _ = tx.send(());
        }),
    );
    let _ = rx.await;
}
