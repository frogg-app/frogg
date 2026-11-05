//! Frogg daemon client: the Rust port of `@frogg/client`'s `DaemonClient`.
//!
//! The client is transport-agnostic and single-threaded (it runs inside the WebView as WASM on
//! every target). A transport delivers frames with [`DaemonClient::handle_frame`] and lifecycle
//! changes with [`DaemonClient::handle_open`] / [`DaemonClient::handle_close`]; the client
//! correlates responses to requests by `requestId` and fans everything else out as events.

mod client;
mod frame;
#[cfg(target_arch = "wasm32")]
pub mod ws;

pub use client::{ClientConfig, ConnectionState, DaemonClient, Event, Transport};
pub use frame::{IncomingFrame, SessionFrame};
pub use frogg_protocol as protocol;

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
    #[error("{0}")]
    Daemon(String),
}

pub type Result<T> = std::result::Result<T, Error>;
