//! Strangler-fig fallback: forward session messages we do not implement natively
//! to the Node daemon over its own WS endpoint, and pump its replies back.
//!
//! One upstream connection per downstream client, so per-connection state in the
//! Node daemon (session identity, subscriptions) keeps working unchanged.

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;

/// A frame moving between the client and the Node daemon. Binary frames carry
/// terminal I/O and file transfers and must be relayed intact.
#[derive(Debug)]
pub enum Frame {
    Text(String),
    Binary(Vec<u8>),
}

pub struct Upstream {
    to_upstream: mpsc::Sender<Frame>,
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
    /// Dials the Node daemon and starts both pump tasks. Frames arriving from
    /// upstream are pushed to `from_upstream` for the caller to relay to its client.
    ///
    /// `bearer` is the credential the client authenticated with, forwarded so the
    /// Node daemon resolves the same device and role rather than treating this
    /// loopback connection as trusted. `client_ip` travels as X-Forwarded-For,
    /// which Node honours when this front is one of its trusted proxies.
    pub async fn connect(
        url: &str,
        from_upstream: mpsc::Sender<Frame>,
        bearer: Option<&str>,
        client_ip: &str,
    ) -> Result<Self> {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let mut request = url
            .into_client_request()
            .with_context(|| format!("building upstream request for {url}"))?;
        let headers = request.headers_mut();
        headers.insert("x-forwarded-for", client_ip.parse()?);
        if let Some(token) = bearer {
            headers.insert(
                "sec-websocket-protocol",
                format!("frogg.bearer.{token}").parse()?,
            );
        }
        let (stream, _) = tokio_tungstenite::connect_async(request)
            .await
            .with_context(|| format!("dialing upstream daemon at {url}"))?;
        let (mut write, mut read) = stream.split();
        let (to_upstream, mut rx) = mpsc::channel::<Frame>(256);

        tokio::spawn(async move {
            while let Some(frame) = rx.recv().await {
                let message = match frame {
                    Frame::Text(text) => WsMessage::Text(text),
                    Frame::Binary(bytes) => WsMessage::Binary(bytes),
                };
                if write.send(message).await.is_err() {
                    break;
                }
            }
            let _ = write.close().await;
        });

        tokio::spawn(async move {
            while let Some(Ok(msg)) = read.next().await {
                let frame = match msg {
                    WsMessage::Text(t) => Frame::Text(t),
                    WsMessage::Binary(b) => Frame::Binary(b),
                    WsMessage::Close(_) => break,
                    // Ping/Pong are handled by the transport itself.
                    _ => continue,
                };
                if from_upstream.send(frame).await.is_err() {
                    break;
                }
            }
        });

        Ok(Self { to_upstream })
    }

    pub async fn send(&self, frame: Frame) -> SendOutcome {
        match self.to_upstream.send(frame).await {
            Ok(()) => SendOutcome::Delivered,
            Err(_) => SendOutcome::Disconnected,
        }
    }
}
