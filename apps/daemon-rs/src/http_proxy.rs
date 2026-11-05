//! Reverse proxy for HTTP routes we do not serve natively.
//!
//! Without this the SPA fallback swallows unmatched paths and answers 200 with
//! index.html - so `/api/files/download` returns HTML instead of a file. Paths
//! under these prefixes belong to the daemon, never to the client-side router.

use axum::body::Body;
use axum::http::{Request, Response, StatusCode, Uri};
use http_body_util::BodyExt;
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use hyper_util::rt::TokioExecutor;

/// Prefixes owned by the daemon. Anything else is a client-side route and
/// correctly falls through to the SPA.
const DAEMON_PREFIXES: [&str; 3] = ["/api/", "/mcp/", "/public/"];

pub fn is_daemon_path(path: &str) -> bool {
    DAEMON_PREFIXES
        .iter()
        .any(|prefix| path.starts_with(prefix))
        || DAEMON_PREFIXES
            .iter()
            .any(|prefix| path == prefix.trim_end_matches('/'))
}

#[derive(Clone)]
pub struct HttpProxy {
    client: Client<HttpConnector, Body>,
}

impl HttpProxy {
    pub fn new() -> Self {
        Self {
            client: Client::builder(TokioExecutor::new()).build(HttpConnector::new()),
        }
    }

    /// Forwards to the upstream named by its WS url (`ws://host/ws` -> `http://host`), so
    /// one setting configures both; the url can change when a supervised worker restarts.
    ///
    /// `client_ip` replaces any client-supplied X-Forwarded-For, so the Node
    /// daemon (with this front as a trusted proxy) sees the real caller.
    pub async fn forward(
        &self,
        upstream_ws_url: &str,
        request: Request<Body>,
        client_ip: &str,
    ) -> Response<Body> {
        self.forward_with(upstream_ws_url, request, client_ip, false)
            .await
    }

    /// Forwards a request addressed to a host the front does not serve itself: a workspace
    /// service (`<script>.<project>.localhost:<daemon port>`, routed by Host inside Node) or
    /// anything Node's own Host allowlist decides on. The Host header is kept, and upgrades
    /// (a dev server's HMR socket) are spliced through.
    pub async fn forward_host(
        &self,
        upstream_ws_url: &str,
        request: Request<Body>,
        client_ip: &str,
    ) -> Response<Body> {
        self.forward_with(upstream_ws_url, request, client_ip, true)
            .await
    }

    async fn forward_with(
        &self,
        upstream_ws_url: &str,
        mut request: Request<Body>,
        client_ip: &str,
        keep_host: bool,
    ) -> Response<Body> {
        let Some(base) = http_base_from_ws(upstream_ws_url) else {
            return status(StatusCode::BAD_GATEWAY);
        };
        let path_and_query = request
            .uri()
            .path_and_query()
            .map(|p| p.as_str())
            .unwrap_or("/");
        let Ok(uri) = format!("{base}{path_and_query}").parse::<Uri>() else {
            return status(StatusCode::BAD_GATEWAY);
        };
        *request.uri_mut() = uri;
        if !keep_host {
            // Host must match the upstream, or its origin checks reject us.
            request.headers_mut().remove(axum::http::header::HOST);
        }
        request.headers_mut().remove("x-forwarded-for");
        // See `proxy::Upstream::connect`: a loopback client goes as a plain loopback request.
        if crate::netclass::classify(Some(client_ip)) != crate::netclass::Locality::Loopback {
            if let Ok(value) = client_ip.parse() {
                request.headers_mut().insert("x-forwarded-for", value);
            }
        }

        let client_upgrade = request
            .headers()
            .contains_key(axum::http::header::UPGRADE)
            .then(|| hyper::upgrade::on(&mut request));
        match self.client.request(request).await {
            Ok(mut response) => {
                if response.status() == StatusCode::SWITCHING_PROTOCOLS {
                    if let Some(client_upgrade) = client_upgrade {
                        let upstream_upgrade = hyper::upgrade::on(&mut response);
                        tokio::spawn(splice(client_upgrade, upstream_upgrade));
                    }
                }
                let (parts, body) = response.into_parts();
                Response::from_parts(parts, Body::new(body.map_err(axum::Error::new)))
            }
            Err(err) => {
                tracing::warn!(error = %err, "upstream HTTP request failed");
                status(StatusCode::BAD_GATEWAY)
            }
        }
    }
}

/// Copies bytes both ways between an upgraded client connection and the upstream's.
async fn splice(client: hyper::upgrade::OnUpgrade, upstream: hyper::upgrade::OnUpgrade) {
    let (Ok(client), Ok(upstream)) = (client.await, upstream.await) else {
        return;
    };
    let mut client = hyper_util::rt::TokioIo::new(client);
    let mut upstream = hyper_util::rt::TokioIo::new(upstream);
    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
}

fn status(code: StatusCode) -> Response<Body> {
    Response::builder()
        .status(code)
        .body(Body::empty())
        .unwrap_or_default()
}

fn http_base_from_ws(ws_url: &str) -> Option<String> {
    let (scheme, rest) = ws_url.split_once("://")?;
    let scheme = match scheme {
        "ws" => "http",
        "wss" => "https",
        other => other,
    };
    let authority = rest.split('/').next()?;
    if authority.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{authority}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_daemon_owned_paths() {
        assert!(is_daemon_path("/api/files/download"));
        assert!(is_daemon_path("/api/health"));
        assert!(is_daemon_path("/mcp/agents"));
        assert!(is_daemon_path("/public/logo.png"));
        // Client-side routes must still reach the SPA.
        assert!(!is_daemon_path("/"));
        assert!(!is_daemon_path("/workspace/abc"));
        assert!(
            !is_daemon_path("/apidocs"),
            "a prefix match must not be a substring match"
        );
    }

    #[test]
    fn derives_the_http_base_from_the_ws_url() {
        assert_eq!(
            http_base_from_ws("ws://127.0.0.1:9999/ws").as_deref(),
            Some("http://127.0.0.1:9999")
        );
        assert_eq!(
            http_base_from_ws("wss://box:443/ws").as_deref(),
            Some("https://box:443")
        );
        assert_eq!(
            http_base_from_ws("ws://host").as_deref(),
            Some("http://host")
        );
        assert_eq!(http_base_from_ws("not-a-url"), None);
        assert_eq!(http_base_from_ws("ws://"), None);
    }
}
