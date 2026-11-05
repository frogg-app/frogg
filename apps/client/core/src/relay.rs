//! Connectors: a direct WebSocket (bearer as a subprotocol) and the relay v2 transport with
//! E2EE. Both are generic over a [`SocketOpener`], so the browser (`ws.rs`) and native code
//! (tests, the live example) share one path.

use std::rc::Rc;

use crate::e2ee::ClientChannel;
use crate::pairing::{parse_host_port, HostPort};
use crate::util::encode_query_value;
use crate::{ConnectOptions, Connector, DaemonClient, Link, Transport, TransportSink};

/// Opens a socket to `url` with WebSocket `protocols`, reporting to `sink`.
pub type SocketOpener =
    Rc<dyn Fn(&str, &[String], Rc<dyn TransportSink>) -> Result<Rc<dyn Transport>, String>>;

/// The subprotocols a direct connection offers: browsers cannot set an `Authorization`
/// header on a WebSocket, so the credential travels as `frogg.bearer.<password>`.
pub fn bearer_protocols(options: &ConnectOptions) -> Vec<String> {
    options
        .credential()
        .map(|p| vec![format!("frogg.bearer.{p}")])
        .unwrap_or_default()
}

pub fn direct_connector(url: &str, options: &ConnectOptions, open: SocketOpener) -> Connector {
    let url = url.to_owned();
    let protocols = bearer_protocols(options);
    Rc::new(move |link: Link| open(&url, &protocols, Rc::new(link)))
}

/// Connects `client` straight to a daemon URL (`ws://host:port/ws`) and keeps it connected.
pub fn connect_direct(
    client: &DaemonClient,
    url: &str,
    options: ConnectOptions,
    open: SocketOpener,
) {
    client.disconnect();
    client.set_connector(
        direct_connector(url, &options, open),
        options.credential(),
        false,
    );
    client.connect();
}

/// A daemon reached through the relay: the v2 offer's fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayTarget {
    /// Relay `host:port`.
    pub endpoint: String,
    pub use_tls: bool,
    pub server_id: String,
    pub daemon_public_key_b64: String,
}

/// `buildRelayWebSocketUrl({ role: "client", version: 2 })`.
pub fn relay_client_url(endpoint: &str, use_tls: bool, server_id: &str) -> Result<String, String> {
    let HostPort {
        host,
        port,
        is_ipv6,
    } = parse_host_port(endpoint)?;
    let host = if is_ipv6 { format!("[{host}]") } else { host };
    Ok(format!(
        "{}://{host}:{port}/ws?serverId={}&role=client&v=2",
        if use_tls { "wss" } else { "ws" },
        encode_query_value(server_id)
    ))
}

/// True for relay client URLs (`role=client` with a `serverId`).
pub fn is_relay_client_url(url: &str) -> bool {
    let Some((_, query)) = url.split_once('?') else {
        return false;
    };
    let query = query.split('#').next().unwrap_or_default();
    let params = crate::util::parse_query(query);
    crate::util::query_get(&params, "role") == Some("client")
        && crate::util::query_get(&params, "serverId").is_some()
}

pub fn relay_connector(target: &RelayTarget, open: SocketOpener) -> Result<Connector, String> {
    let url = relay_client_url(&target.endpoint, target.use_tls, &target.server_id)?;
    crate::crypto::import_public_key(&target.daemon_public_key_b64).map_err(|e| e.to_string())?;
    let key = target.daemon_public_key_b64.clone();
    Ok(Rc::new(move |link: Link| {
        let scheduler = link.scheduler().ok_or("client dropped")?;
        let channel =
            ClientChannel::new(&key, Rc::new(link), scheduler).map_err(|e| e.to_string())?;
        let base = open(&url, &[], channel.clone())?;
        channel.set_base(base);
        Ok(channel as Rc<dyn Transport>)
    }))
}

/// Connects `client` to a daemon through the relay with E2EE. The credential, if any,
/// travels in `hello.auth.token` inside the encrypted channel.
pub fn connect_relay(
    client: &DaemonClient,
    target: &RelayTarget,
    options: ConnectOptions,
    open: SocketOpener,
) -> Result<(), String> {
    let connector = relay_connector(target, open)?;
    client.disconnect();
    client.set_expected_server_id(Some(target.server_id.clone()));
    client.set_connector(connector, options.credential(), true);
    client.connect();
    Ok(())
}

/// Browser relay connect (WebView on desktop/Android, plain browser on the web).
#[cfg(target_arch = "wasm32")]
pub fn connect(
    client: &DaemonClient,
    target: &RelayTarget,
    options: ConnectOptions,
) -> Result<(), String> {
    connect_relay(client, target, options, crate::ws::opener())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_urls() {
        let u = relay_client_url("relay.frogg.dev:443", true, "srv a").unwrap();
        assert_eq!(
            u,
            "wss://relay.frogg.dev:443/ws?serverId=srv+a&role=client&v=2"
        );
        assert!(is_relay_client_url(&u));
        assert!(!is_relay_client_url("ws://127.0.0.1:6767/ws"));
        assert_eq!(
            relay_client_url("[::1]:80", false, "s").unwrap(),
            "ws://[::1]:80/ws?serverId=s&role=client&v=2"
        );
    }

    #[test]
    fn bearer() {
        let o = ConnectOptions {
            password: Some(" pw ".into()),
            token: None,
        };
        assert_eq!(bearer_protocols(&o), vec!["frogg.bearer.pw".to_string()]);
        assert!(bearer_protocols(&ConnectOptions::default()).is_empty());
    }
}
