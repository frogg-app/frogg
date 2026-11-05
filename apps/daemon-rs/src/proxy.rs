//! Strangler-fig fallback: forward session messages we do not implement natively
//! to the Node daemon over its own WS endpoint, and pump its replies back.
//!
//! One upstream connection per downstream client, so per-connection state in the
//! Node daemon (session identity, subscriptions) keeps working unchanged.

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

/// A frame moving between the client and the Node daemon. Binary frames carry
/// terminal I/O and file transfers and must be relayed intact.
#[derive(Debug)]
pub enum Frame {
    Text(String),
    Binary(Vec<u8>),
}

/// The upstream socket, owned by the client's connection loop. No pump tasks or channels sit
/// between the two sockets: each forwarded frame is one write, and each reply one read, on the
/// task that already holds the client socket. A task hop costs a cross-thread wake-up per frame,
/// which is most of what a forwarded RPC would otherwise add.
pub struct Upstream {
    stream: WebSocketStream<MaybeTlsStream<TcpStream>>,
}

/// Distinguishes "we have no upstream configured" from "the upstream we had has
/// gone away", which the connection loop must treat differently.
#[derive(Debug, PartialEq)]
pub enum SendOutcome {
    Delivered,
    /// The upstream connection is gone. The client should be disconnected so it
    /// reconnects rather than talking into a void.
    Disconnected,
}

impl Upstream {
    /// Dials the Node daemon.
    ///
    /// `bearer` is the credential the client authenticated with, forwarded so the
    /// Node daemon resolves the same device and role rather than treating this
    /// loopback connection as trusted. `client_ip` travels as X-Forwarded-For,
    /// which Node honours when this front is one of its trusted proxies.
    pub async fn connect(url: &str, bearer: Option<&str>, client_ip: &str) -> Result<Self> {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let mut request = url
            .into_client_request()
            .with_context(|| format!("building upstream request for {url}"))?;
        let headers = request.headers_mut();
        // Node never treats a forwarded loopback address as loopback (the header is
        // caller-controlled), so a loopback client is sent as what it is: a loopback
        // connection from this front. Anyone else travels as X-Forwarded-For.
        if crate::netclass::classify(Some(client_ip)) != crate::netclass::Locality::Loopback {
            headers.insert("x-forwarded-for", client_ip.parse()?);
        }
        if let Some(token) = bearer {
            headers.insert(
                "sec-websocket-protocol",
                format!("frogg.bearer.{token}").parse()?,
            );
        }
        // disable_nagle: request/response frames must not wait on delayed ACKs.
        let (stream, _) = tokio_tungstenite::connect_async_with_config(request, None, true)
            .await
            .with_context(|| format!("dialing upstream daemon at {url}"))?;
        Ok(Self { stream })
    }

    pub async fn send(&mut self, frame: Frame) -> SendOutcome {
        let message = match frame {
            Frame::Text(text) => WsMessage::Text(text),
            Frame::Binary(bytes) => WsMessage::Binary(bytes),
        };
        match self.stream.send(message).await {
            Ok(()) => SendOutcome::Delivered,
            Err(_) => SendOutcome::Disconnected,
        }
    }

    /// The next data frame from the Node daemon. Ping/Pong are answered by the transport
    /// itself.
    pub async fn recv(&mut self) -> Received {
        loop {
            match self.stream.next().await {
                Some(Ok(WsMessage::Text(text))) => return Received::Frame(Frame::Text(text)),
                Some(Ok(WsMessage::Binary(bytes))) => return Received::Frame(Frame::Binary(bytes)),
                Some(Ok(WsMessage::Close(frame))) => {
                    return Received::Closed(
                        frame.map(|f| (u16::from(f.code), f.reason.into_owned())),
                    )
                }
                Some(Err(_)) | None => return Received::Closed(None),
                Some(Ok(_)) => continue,
            }
        }
    }
}

pub enum Received {
    Frame(Frame),
    /// The Node daemon closed the socket, with its close code and reason when it sent one
    /// (4401 "Password required" and the like, which clients show and classify).
    Closed(Option<(u16, String)>),
}
