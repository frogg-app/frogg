//! Frogg daemon, Rust front half.
//!
//! Terminates HTTP + WebSocket, answers the message types it implements natively,
//! and forwards the rest to the Node daemon (see `proxy`). The point is to migrate
//! the protocol surface incrementally while staying a drop-in replacement.

#[path = "../../../packages/branding/native/runtime.rs"]
pub mod branding;

mod auth;
mod cli;
mod config;
mod daemon_config;
mod envelope;
mod frames;
mod generated;
mod generated_tests;
mod hostnames;
mod http_proxy;
mod http_routes;
#[cfg(unix)]
mod local_token;
mod netclass;
#[cfg(unix)]
mod pidlock;
mod proxy;
mod pty;
mod search;
#[cfg(unix)]
mod supervisor;
mod terminals;
mod web_ui;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use tokio::sync::{mpsc, oneshot, watch};

const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

struct AppState {
    server_id: String,
    started: Instant,
    /// Where the Node daemon is. Fixed when `FROGG_RS_UPSTREAM` names one; `None` while a
    /// supervised worker is starting or restarting.
    upstream: watch::Receiver<Option<String>>,
    /// Whether a Node daemon is expected at all. Without one (standalone), only the native
    /// message types are served; with one, client frames wait for it.
    expects_upstream: bool,
    auth: daemon_config::AuthStore,
    allowed_origins: Vec<String>,
    /// `Host` allowlist. Checked on every request: `Origin` alone cannot stop
    /// DNS rebinding, because the same-origin fallback compares `Origin` to
    /// `Host` and an attacker's page supplies both.
    hostnames: hostnames::Hostnames,
    allow_pairing_hostname: bool,
    hostname: String,
    listen: String,
    web_ui_dist: Option<std::path::PathBuf>,
    native_terminals: bool,
    http_proxy: http_proxy::HttpProxy,
    validate_protocol: bool,
}

impl AppState {
    /// The locality of a request, honouring the same inputs the Node daemon uses.
    /// X-Forwarded-For is deliberately *not* trusted here: the Node daemon only
    /// honours it for configured trusted proxies, and until we port that setting
    /// the safe direction is to gate more, never less.
    fn locality(&self, peer: SocketAddr) -> netclass::Locality {
        netclass::classify(Some(&peer.ip().to_string()))
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let boot = Instant::now();
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cli = cli::Cli::parse(std::env::args().skip(1))?;
    let home = daemon_config::resolve_home();
    let persisted = daemon_config::load(home.as_deref());
    let config = config::Config::from_env(persisted.listen.as_deref())?;

    #[cfg(unix)]
    let supervised = match cli.supervise {
        Some(spec) => Some(prepare_supervision(spec, home.as_deref(), &config)?),
        None => None,
    };
    #[cfg(not(unix))]
    if cli.supervise.is_some() {
        anyhow::bail!("--supervise is not supported on this platform yet");
    }

    // A fixed upstream keeps its sender alive for the life of the process.
    let (fixed_upstream, mut upstream) = watch::channel(config.upstream.clone());
    let mut expects_upstream = config.upstream.is_some();
    #[cfg(unix)]
    if let Some(prep) = supervised.as_ref() {
        upstream = prep.upstream.clone();
        expects_upstream = true;
    }

    // Re-read so a token the supervisor just created is honoured.
    let persisted = daemon_config::load(home.as_deref());
    let auth_required = persisted.auth.password_hash.is_some() || persisted.auth.is_claimed();
    let state = Arc::new(AppState {
        server_id: persisted.server_id.clone(),
        started: Instant::now(),
        upstream,
        expects_upstream,
        auth: daemon_config::AuthStore::new(home.clone(), persisted.auth),
        allowed_origins: persisted.allowed_origins,
        hostnames: persisted.hostnames,
        allow_pairing_hostname: persisted.allow_pairing_hostname,
        hostname: hostname(),
        listen: config.listen.to_string(),
        http_proxy: http_proxy::HttpProxy::new(),
        web_ui_dist: config.web_ui_dist.clone(),
        native_terminals: config.native_terminals,
        validate_protocol: config.validate_protocol,
    });

    let app = build_router(state.clone());

    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    let bound = listener.local_addr()?;
    tracing::info!(
        elapsed_ms = boot.elapsed().as_millis() as u64,
        host = %bound.ip(),
        port = bound.port(),
        upstream = config.upstream.as_deref().unwrap_or(if expects_upstream { "<supervised>" } else { "<none>" }),
        auth_required,
        native_terminals = config.native_terminals,
        validate_protocol = config.validate_protocol,
        web_ui = state.web_ui_dist.as_ref().map(|d| d.display().to_string()).unwrap_or_default(),
        home = home.as_ref().map(|h| h.display().to_string()).unwrap_or_default(),
        "Server listening"
    );

    // Opt-in for harnesses that spawn the front: leave when the parent is gone.
    #[cfg(unix)]
    if std::env::var("FROGG_RS_EXIT_WITH_PARENT").is_ok_and(|v| v == "1") {
        let parent = unsafe { libc::getppid() };
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                tick.tick().await;
                if unsafe { libc::getppid() } != parent {
                    std::process::exit(0);
                }
            }
        });
    }

    // Clients can connect from here on; the worker starts behind the listener.
    let (done_tx, done_rx) = oneshot::channel::<i32>();
    #[cfg(unix)]
    let stop = match supervised {
        Some(prep) => Some(prep.start(done_tx)),
        None => {
            drop(done_tx);
            None
        }
    };
    #[cfg(not(unix))]
    drop(done_tx);

    let shutdown = async move {
        #[cfg(unix)]
        {
            let mut sigterm =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("SIGTERM handler");
            let reason = tokio::select! {
                _ = tokio::signal::ctrl_c() => "supervisor_received_SIGINT",
                _ = sigterm.recv() => "supervisor_received_SIGTERM",
                // Only a supervised run sends; standalone drops the sender and this disables.
                Ok(code) = done_rx => return code,
            };
            match stop {
                // Supervised: stop the worker first, then exit with the supervisor.
                Some((handle, done)) => {
                    handle.request(reason);
                    done.await.unwrap_or(0)
                }
                None => 0,
            }
        }
        #[cfg(not(unix))]
        {
            let _ = done_rx;
            let _ = tokio::signal::ctrl_c().await;
            0
        }
    };
    let (code_tx, code_rx) = oneshot::channel::<i32>();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    // Small request/response frames: never hold one back waiting for an ACK.
    .tcp_nodelay(true)
    .with_graceful_shutdown(async move {
        let code = shutdown.await;
        let _ = code_tx.send(code);
        // Open client sockets would hold a graceful shutdown open; their upstream is gone,
        // so they get a moment to see the close and then the process leaves.
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            std::process::exit(code);
        });
    })
    .await?;
    drop(fixed_upstream);
    std::process::exit(code_rx.await.unwrap_or(0));
}

#[cfg(unix)]
struct Supervision {
    supervisor: supervisor::Supervisor,
    upstream: supervisor::UpstreamUrl,
    stop: supervisor::StopHandle,
    lock: pidlock::PidLock,
}

/// Takes the PID lock and the local token before the listener opens, as the Node supervisor
/// does before it forks, so a second daemon fails fast and loopback clients can authenticate
/// from the first connection.
#[cfg(unix)]
fn prepare_supervision(
    spec: cli::SuperviseArgs,
    home: Option<&std::path::Path>,
    config: &config::Config,
) -> anyhow::Result<Supervision> {
    let home = home.ok_or_else(|| anyhow::anyhow!("cannot resolve the daemon home"))?;
    std::fs::create_dir_all(home)?;
    let listen = config.listen.to_string();
    let lock = match pidlock::PidLock::acquire(home, &listen) {
        Ok(lock) => lock,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    };
    local_token::ensure(home)?;
    let log = supervisor::LogFile::open(
        log_path(home),
        std::env::var("FROGG_LOG_ROTATE_SIZE")
            .ok()
            .and_then(|v| supervisor::parse_size(&v))
            .unwrap_or(10 << 20),
        std::env::var("FROGG_LOG_ROTATE_COUNT")
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .filter(|n| *n > 0)
            .unwrap_or(3),
    );
    let (supervisor, upstream, stop) = supervisor::Supervisor::new(
        supervisor::WorkerSpec {
            node: spec.node,
            node_args: spec.node_args,
            entry: spec.worker,
            args: spec.worker_args,
            public_listen: listen,
        },
        log,
    );
    Ok(Supervision {
        supervisor,
        upstream,
        stop,
        lock,
    })
}

#[cfg(unix)]
impl Supervision {
    /// Starts the worker and the lock heartbeat. `done` receives the exit code once the
    /// supervisor has stopped and the lock is released.
    fn start(self, done: oneshot::Sender<i32>) -> (supervisor::StopHandle, oneshot::Receiver<i32>) {
        let lock = Arc::new(self.lock);
        let (finished_tx, finished_rx) = oneshot::channel::<i32>();
        let heartbeat_lock = lock.clone();
        let heartbeat_stop = self.stop.clone();
        let heartbeat = tokio::spawn(async move {
            let mut tick = tokio::time::interval(pidlock::HEARTBEAT_INTERVAL);
            tick.tick().await;
            loop {
                tick.tick().await;
                if let Err(err) = heartbeat_lock.heartbeat() {
                    eprintln!("PID lock heartbeat failed: {err}");
                    heartbeat_stop.request("pid_lock_ownership_lost");
                    return;
                }
            }
        });
        let supervisor = self.supervisor;
        tokio::spawn(async move {
            let exit = supervisor.run().await;
            heartbeat.abort();
            lock.release();
            let code = match exit {
                supervisor::Exit::Requested => 0,
                supervisor::Exit::WorkerExited(code) => code,
            };
            let _ = finished_tx.send(code);
            let _ = done.send(code);
        });
        (self.stop, finished_rx)
    }
}

#[cfg(unix)]
fn log_path(home: &std::path::Path) -> std::path::PathBuf {
    let configured = std::fs::read_to_string(home.join("config.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|v| {
            v.pointer("/log/file/path")
                .and_then(|p| p.as_str())
                .map(str::to_owned)
        });
    match configured {
        Some(path) if std::path::Path::new(&path).is_absolute() => path.into(),
        Some(path) => home.join(path),
        None => home.join("daemon.log"),
    }
}

/// Serves the bundled browser UI. Returns 404 when no dist directory is
/// configured, which is the Node behaviour when the web UI is disabled.
async fn web_ui_handler(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: axum::extract::Request,
) -> Response {
    let uri = request.uri().clone();
    let headers = request.headers().clone();

    // Daemon-owned paths must never fall through to the SPA: answering 200 with
    // index.html turns a missing route into a silently corrupt response (a file
    // download that yields HTML). Proxy them, or fail loudly.
    if http_proxy::is_daemon_path(uri.path()) {
        // The Node daemon sees this proxy as a loopback caller, so the bearer
        // gate and route roles `createRequireBearerMiddleware` applies must be
        // applied here, in front of it.
        if let Some(response) =
            gate_daemon_route(&state, peer, request.method(), uri.path(), &headers)
        {
            return response;
        }
        let upstream = state.upstream.borrow().clone();
        return match upstream {
            Some(url) => {
                state
                    .http_proxy
                    .forward(&url, request, &peer.ip().to_string())
                    .await
            }
            // A supervised worker that is (re)starting: tell the client to retry.
            None if state.expects_upstream => StatusCode::SERVICE_UNAVAILABLE.into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        };
    }

    if request.method() != axum::http::Method::GET && request.method() != axum::http::Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let Some(dist) = state.web_ui_dist.as_deref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let accept_encoding = header(&headers, "accept-encoding");
    let Some(resolved) = web_ui::resolve(dist, uri.path(), accept_encoding) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(body) = tokio::fs::read(&resolved.file).await else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let mut response = Response::builder()
        .header("Content-Type", resolved.content_type)
        .header("Cache-Control", resolved.cache_control);
    if let Some(encoding) = resolved.content_encoding {
        response = response.header("Content-Encoding", encoding);
        // Content-Encoding varies by request, so caches must not share entries.
        response = response.header("Vary", "Accept-Encoding");
    }
    if resolved.is_index_html {
        response = response.header("Pragma", "no-cache").header("Expires", "0");
    }
    response
        .body(body.into())
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Mirrors `createRequireBearerMiddleware` + `requiredRoleForHttpRoute` for the
/// routes proxied to Node. Returns a rejection, or None to let the request on.
fn gate_daemon_route(
    state: &AppState,
    peer: SocketAddr,
    method: &axum::http::Method,
    path: &str,
    headers: &HeaderMap,
) -> Option<Response> {
    if !path.starts_with("/api/") || http_routes::bypasses_bearer(method.as_str(), path) {
        return None;
    }
    let token = auth::extract_http_bearer_token(header(headers, "authorization"));
    match state
        .auth
        .current()
        .authorize(state.locality(peer), token.as_deref())
    {
        auth::Decision::Ok(role) if role >= http_routes::required_role(path) => None,
        auth::Decision::Ok(_) => {
            Some((StatusCode::FORBIDDEN, Json(json!({ "error": "Forbidden" }))).into_response())
        }
        decision => {
            tracing::warn!(?decision, %peer, path, "rejected proxied daemon route");
            Some(
                (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({ "error": "Unauthorized" })),
                )
                    .into_response(),
            )
        }
    }
}

async fn health() -> impl IntoResponse {
    Json(json!({ "status": "ok", "timestamp": now_iso8601() }))
}

/// Discovery CORS: any origin may read identity, and Chromium's Private Network
/// Access preflight is answered, exactly as `identity-route.ts` does. LAN
/// scanners fetch this cross-origin before pairing, so it must not depend on
/// the CORS allowlist.
fn discovery_headers(response: Response) -> Response {
    let mut response = response;
    let headers = response.headers_mut();
    headers.insert("Access-Control-Allow-Origin", "*".parse().unwrap());
    headers.insert(
        "Access-Control-Allow-Methods",
        "GET, OPTIONS".parse().unwrap(),
    );
    headers.insert(
        "Access-Control-Allow-Private-Network",
        "true".parse().unwrap(),
    );
    headers.insert("Cache-Control", "no-store".parse().unwrap());
    response
}

async fn identity_preflight() -> Response {
    let mut response = discovery_headers(StatusCode::NO_CONTENT.into_response());
    response
        .headers_mut()
        .insert("Access-Control-Max-Age", "600".parse().unwrap());
    response
}

async fn identity(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Response {
    let locality = state.locality(peer);
    let auth = state.auth.current();
    let trusted = netclass::is_client_trusted(locality, auth.trust_lan && !auth.claim_mode);
    let claimed = auth.is_claimed();
    discovery_headers(
        Json(json!({
            "product": "frogg",
            "brand": crate::branding::identity(),
            "serverId": state.server_id,
            "hostname": state.hostname,
            "version": DAEMON_VERSION,
            "listen": state.listen,
            "pairingRequired": !claimed && !trusted,
            "lanTrusted": auth.trust_lan && !auth.claim_mode,
        }))
        .into_response(),
    )
}

pub(crate) fn hostname() -> String {
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .ok()
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
        .or_else(|| std::env::var("HOSTNAME").ok())
        .unwrap_or_else(|| "unknown".to_string())
}

async fn status(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let token = auth::extract_http_bearer_token(header(&headers, "authorization"));
    match state
        .auth
        .current()
        .authorize(state.locality(peer), token.as_deref())
    {
        auth::Decision::Ok(_) => Json(json!({
            "status": "ok",
            "uptimeMs": state.started.elapsed().as_millis() as u64,
            "runtime": "rust",
        }))
        .into_response(),
        decision => {
            tracing::warn!(?decision, %peer, "rejected /api/status");
            StatusCode::UNAUTHORIZED.into_response()
        }
    }
}

fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        // Unauthenticated by design, matching the Node daemon: health for probes,
        // identity for LAN scanners and the pairing flow.
        .route("/api/health", get(health))
        .route("/api/identity", get(identity).options(identity_preflight))
        .route("/api/status", get(status))
        .route("/ws", get(ws_upgrade))
        // Everything else is the SPA. Registered last so it never shadows /api.
        // Any method: daemon paths are proxied whatever their verb, and the
        // SPA half answers 405 to anything but GET itself.
        .fallback(web_ui_handler)
        // Host allowlist in front of every route, including /ws and the health
        // and identity routes that are otherwise unauthenticated. Mirrors where
        // the Node daemon mounts it.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            enforce_host_allowlist,
        ))
        .with_state(state)
}

/// Rejects any request whose `Host` is not allow-listed, which is what stops
/// DNS rebinding: a page on an attacker's domain that resolves to 127.0.0.1 or
/// a LAN address still sends that domain in `Host`.
async fn enforce_host_allowlist(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let host = request
        .headers()
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let allowed = hostnames::is_hostname_allowed(
        host.as_deref(),
        &state.hostnames,
        state.allow_pairing_hostname,
    );
    // Workspace services are `<label>.localhost` (and any public base host) on this port,
    // routed by Host inside Node. Those, and hosts the front would refuse, are Node's to
    // decide when it is up: it applies the same allowlist and owns the service routes.
    if !allowed
        || host
            .as_deref()
            .is_some_and(hostnames::is_localhost_subdomain)
    {
        let upstream = state.upstream.borrow().clone();
        if let (Some(url), Some(_)) = (upstream, host.as_deref()) {
            return state
                .http_proxy
                .forward_host(&url, request, &peer.ip().to_string())
                .await;
        }
    }
    if !allowed {
        tracing::warn!(?host, %peer, "rejected request with a disallowed Host header");
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Invalid Host header" })),
        )
            .into_response();
    }
    next.run(request).await
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let origin = header(&headers, "origin");
    let host = header(&headers, "host");

    if !auth::origin_allowed(origin, host, &state.allowed_origins) {
        tracing::warn!(?origin, %peer, "rejected connection from origin");
        return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
    }

    let protocol_header = header(&headers, "sec-websocket-protocol").map(str::to_owned);
    let token = auth::extract_ws_bearer_token(protocol_header.as_deref());
    // Refusals follow Node: the upgrade completes and the socket closes with 4401 and a
    // reason clients show ("Password required", "Pairing required"). Behind a Node daemon the
    // front does not refuse at all; the connection becomes passthrough-only (nothing served
    // natively) and Node decides, so a credential the front cannot check (a password set
    // since it read config.json) behaves exactly as it would without the front.
    let role = match state
        .auth
        .current()
        .authorize(state.locality(peer), token.as_deref())
    {
        auth::Decision::Ok(role) => Some(role),
        decision if state.expects_upstream => {
            tracing::debug!(?decision, %peer, "unauthorized here; Node decides");
            None
        }
        decision => {
            tracing::warn!(?decision, %peer, "rejected websocket upgrade");
            let reason = auth_close_reason(&decision);
            return select_protocol(ws, protocol_header.as_deref()).on_upgrade(
                move |mut socket| async move {
                    let _ = socket
                        .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                            code: WS_CLOSE_DAEMON_AUTH_FAILED,
                            reason: reason.into(),
                        })))
                        .await;
                },
            );
        }
    };

    let ws = select_protocol(ws, protocol_header.as_deref());
    let client = Client {
        role,
        bearer: token,
        ip: peer.ip().to_string(),
    };
    ws.on_upgrade(move |socket| handle_socket(socket, state, client))
}

/// `WS_CLOSE_DAEMON_AUTH_FAILED` in websocket-server.ts.
const WS_CLOSE_DAEMON_AUTH_FAILED: u16 = 4401;

/// `describeAuthCloseReason`: stable strings the CLI and apps classify.
fn auth_close_reason(decision: &auth::Decision) -> &'static str {
    match decision {
        auth::Decision::Unclaimed => "Pairing required",
        auth::Decision::MissingToken => "Password required",
        _ => "Incorrect password",
    }
}

/// Echo back the exact subprotocol the client offered, or the upgrade fails.
fn select_protocol(ws: WebSocketUpgrade, header: Option<&str>) -> WebSocketUpgrade {
    let selected = header.and_then(|h| {
        h.split(',')
            .map(str::trim)
            .find(|p| !p.is_empty())
            .map(str::to_owned)
    });
    match selected {
        Some(protocol) => ws.protocols([protocol]),
        None => ws,
    }
}

/// Who a connection is: the role it acts with, and what to forward upstream.
struct Client {
    /// `None`: the front could not authorize it and Node decides. Nothing is served
    /// natively on such a connection.
    role: Option<auth::Role>,
    bearer: Option<String>,
    ip: String,
}

/// How long a client's frames wait for a supervised worker that is still starting before the
/// client is disconnected to retry. Node's own cold start is well inside this.
const UPSTREAM_WAIT: std::time::Duration = std::time::Duration::from_secs(60);
/// Frames held for a starting worker, per client. A client that keeps sending past this
/// without any reply is disconnected rather than buffered without bound.
const MAX_PENDING_FRAMES: usize = 1024;

/// The client's path to the Node daemon.
enum Link {
    /// Dialling, or waiting for a supervised worker; frames queue in order.
    Pending(Vec<proxy::Frame>),
    Up(proxy::Upstream),
    /// No Node daemon (standalone, or the configured one was unreachable): native only.
    Absent,
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>, client: Client) {
    // Frames produced locally (native terminal output) rather than by upstream.
    let (local_tx, mut local_rx) = mpsc::channel::<Vec<u8>>(256);
    let mut terminals = (state.native_terminals && client.role.is_some())
        .then(|| terminals::Terminals::new(local_tx));

    // Dial in the background, so ping and other native types are answered while the Node
    // daemon is still starting behind us.
    let (connected_tx, mut connected_rx) = oneshot::channel::<anyhow::Result<proxy::Upstream>>();
    let mut link = if state.expects_upstream {
        let mut upstream = state.upstream.clone();
        let bearer = client.bearer.clone();
        let ip = client.ip.clone();
        tokio::spawn(async move {
            let result = async {
                let url = tokio::time::timeout(UPSTREAM_WAIT, upstream.wait_for(Option::is_some))
                    .await
                    .map_err(|_| anyhow::anyhow!("daemon worker did not become ready"))?
                    .map_err(|_| anyhow::anyhow!("daemon worker supervisor stopped"))?
                    .clone()
                    .unwrap_or_default();
                proxy::Upstream::connect(&url, bearer.as_deref(), &ip).await
            }
            .await;
            let _ = connected_tx.send(result);
        });
        Link::Pending(Vec::new())
    } else {
        drop(connected_tx);
        Link::Absent
    };

    loop {
        tokio::select! {
            connected = &mut connected_rx, if matches!(link, Link::Pending(_)) => {
                match connected {
                    Ok(Ok(upstream)) => {
                        let Link::Pending(queued) = std::mem::replace(&mut link, Link::Up(upstream)) else {
                            unreachable!()
                        };
                        let mut ok = true;
                        for frame in queued {
                            if !deliver(&mut link, frame).await {
                                ok = false;
                                break;
                            }
                        }
                        if !ok {
                            break;
                        }
                    }
                    // The configured daemon is unreachable. We still serve the message
                    // types we implement natively rather than dropping the client.
                    // A connection only Node could admit has nothing left to talk to.
                    Ok(Err(_)) | Err(_) if client.role.is_none() => break,
                    Ok(Err(err)) => {
                        tracing::warn!(error = %err, "no upstream; serving native message types only");
                        link = Link::Absent;
                    }
                    Err(_) => link = Link::Absent,
                }
            }
            // Frames from natively-owned terminals.
            Some(bytes) = local_rx.recv() => {
                if socket.send(Message::Binary(bytes)).await.is_err() {
                    break;
                }
            }
            // Replies from the Node daemon, relayed verbatim. When the upstream
            // closes, drop the client too so it reconnects rather than talking
            // into a void.
            received = recv_upstream(&mut link), if matches!(link, Link::Up(_)) => {
                let frame = match received {
                    proxy::Received::Frame(frame) => frame,
                    proxy::Received::Closed(close) => {
                        // Pass Node's close code and reason on: an auth refusal (4401) or a
                        // restart must reach the client as Node sent it.
                        if let Some((code, reason)) = close {
                            let _ = socket
                                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                                    code,
                                    reason: reason.into(),
                                })))
                                .await;
                        } else {
                            tracing::warn!("upstream daemon closed; disconnecting client so it reconnects");
                        }
                        break;
                    }
                };
                let message = match frame {
                    proxy::Frame::Text(text) => Message::Text(text),
                    proxy::Frame::Binary(bytes) => Message::Binary(bytes),
                };
                if socket.send(message).await.is_err() {
                    break;
                }
            }
            incoming = socket.recv() => {
                let Some(Ok(msg)) = incoming else { break };
                let keep = match msg {
                    Message::Text(text) => {
                        if state.validate_protocol {
                            validate_against_schema(&text);
                        }
                        handle_text(&text, &mut socket, &mut link, terminals.as_mut(), client.role).await
                    }
                    Message::Binary(bytes) => {
                        handle_binary(bytes, &mut link, terminals.as_mut(), client.role).await
                    }
                    Message::Close(_) => false,
                    _ => true,
                };
                if !keep {
                    break;
                }
            }
        }
    }
}

/// Shadow-parses real traffic with the generated protocol types and logs any
/// mismatch. Observational only: the message is handled exactly as before, so
/// this can run against live traffic to prove the generated types before
/// anything depends on them.
fn validate_against_schema(text: &str) {
    match serde_json::from_str::<generated::inbound::WsInboundMessage>(text) {
        Ok(parsed) => {
            // A silent shape difference is the failure mode that matters, so
            // check the round trip rather than just that parsing succeeded.
            let (Ok(original), Ok(round_tripped)) = (
                serde_json::from_str::<serde_json::Value>(text),
                serde_json::to_value(&parsed),
            ) else {
                return;
            };
            if original != round_tripped {
                tracing::warn!(
                    message_type = original.get("type").and_then(|t| t.as_str()),
                    "protocol round trip changed the message"
                );
            }
        }
        Err(error) => {
            let message_type = serde_json::from_str::<serde_json::Value>(text)
                .ok()
                .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(str::to_owned));
            tracing::warn!(?message_type, %error, "generated types rejected a real message");
        }
    }
}

/// Returns false when the connection should close.
async fn handle_text(
    text: &str,
    socket: &mut WebSocket,
    upstream: &mut Link,
    terminals: Option<&mut terminals::Terminals>,
    role: Option<auth::Role>,
) -> bool {
    let Some(peeked) = envelope::peek(text) else {
        // Unknown envelope shapes are forwarded rather than rejected: the Node
        // daemon stays the authority on the protocol while we are partial.
        tracing::debug!("unparsed envelope, forwarding upstream");
        return forward(text, upstream).await;
    };

    match peeked.kind.as_ref() {
        // Natively handled: a pong needs no Node daemon round trip.
        // WSPongMessageSchema is `{ type: "pong" }` and nothing else.
        "ping" if role.is_some() => {
            let pong = json!({ "type": "pong" });
            socket.send(Message::Text(pong.to_string())).await.is_ok()
        }
        // Only parsed further when a native handler might claim it.
        "session" => {
            if let (Some(terminals), Some(raw)) = (terminals, peeked.message) {
                if let Ok(message) = serde_json::from_str::<serde_json::Value>(raw.get()) {
                    let role = role.unwrap_or(auth::Role::Viewer);
                    if let Some(reply) = native_terminal_reply(&message, terminals, role) {
                        return socket.send(Message::Text(reply.to_string())).await.is_ok();
                    }
                }
            }
            forward(text, upstream).await
        }
        _ => forward(text, upstream).await,
    }
}

/// Serves terminal create/subscribe natively when native terminals are on.
/// Returns None for anything we do not own, which then goes upstream.
fn native_terminal_reply(
    message: &serde_json::Value,
    terminals: &mut terminals::Terminals,
    role: auth::Role,
) -> Option<serde_json::Value> {
    let request_id = message.get("requestId")?.as_str()?.to_string();
    match message.get("type")?.as_str()? {
        // `create_terminal_request` is an operator RPC in `authorization/roles.ts`.
        "create_terminal_request" if role < auth::Role::Operator => Some(json!({
            "type": "session",
            "message": {
                "type": "create_terminal_response",
                "payload": {
                    "terminal": null,
                    "error": "This device's role does not allow creating terminals.",
                    "requestId": request_id,
                }
            }
        })),
        "create_terminal_request" => {
            let cwd = message.get("cwd").and_then(|c| c.as_str());
            let size = message.get("size");
            let rows = size.and_then(|s| s.get("rows")?.as_u64()).unwrap_or(24) as u16;
            let cols = size.and_then(|s| s.get("cols")?.as_u64()).unwrap_or(80) as u16;

            let payload = match terminals.create(cwd, rows, cols) {
                Ok((id, _slot)) => json!({
                    "terminal": {
                        "id": id,
                        "name": "terminal",
                        "cwd": cwd.unwrap_or("/"),
                        "workspaceId": message.get("workspaceId").and_then(|w| w.as_str()),
                    },
                    "error": null,
                    "requestId": request_id,
                }),
                Err(err) => json!({
                    "terminal": null,
                    "error": err.to_string(),
                    "requestId": request_id,
                }),
            };
            Some(json!({ "type": "session", "message": {
                "type": "create_terminal_response", "payload": payload } }))
        }
        "subscribe_terminal_request" => {
            let terminal_id = message.get("terminalId")?.as_str()?;
            // Only ours: ids the Node daemon issued must go upstream.
            let slot = terminals.slot_for(terminal_id)?;
            Some(json!({ "type": "session", "message": {
                "type": "subscribe_terminal_response",
                "payload": {
                    "terminalId": terminal_id,
                    "slot": slot,
                    "error": null,
                    "requestId": request_id,
                }
            } }))
        }
        _ => None,
    }
}

/// Terminal I/O and file transfers. Decoded only far enough to log the route;
/// the payload is relayed intact.
async fn handle_binary(
    bytes: Vec<u8>,
    upstream: &mut Link,
    terminals: Option<&mut terminals::Terminals>,
    role: Option<auth::Role>,
) -> bool {
    match frames::decode(&bytes) {
        Some(frames::Frame::Terminal {
            opcode,
            slot,
            payload,
        }) => {
            // Natively-owned slots are served here; everything else falls
            // through to the Node daemon, which still owns the registry.
            if let Some(terminals) = terminals {
                // A viewer reads terminal output but never types into it.
                let writes = matches!(
                    opcode,
                    frames::TerminalOpcode::Input | frames::TerminalOpcode::Resize
                );
                if writes
                    && !matches!(role, Some(r) if r >= auth::Role::Operator)
                    && terminals.owns_slot(slot)
                {
                    tracing::debug!(slot, "dropping terminal input from a viewer");
                    return true;
                }
                let payload = payload.to_vec();
                if terminals.handle(opcode, slot, &payload).await {
                    return true;
                }
            }
            tracing::trace!(?opcode, slot, "forwarding terminal frame upstream");
        }
        Some(frame) => tracing::trace!(?frame, "forwarding binary frame upstream"),
        None => {
            tracing::debug!(len = bytes.len(), "dropping undecodable binary frame");
            return true;
        }
    }
    deliver(upstream, proxy::Frame::Binary(bytes)).await
}

async fn recv_upstream(link: &mut Link) -> proxy::Received {
    match link {
        Link::Up(upstream) => upstream.recv().await,
        _ => std::future::pending().await,
    }
}

async fn forward(text: &str, upstream: &mut Link) -> bool {
    deliver(upstream, proxy::Frame::Text(text.to_string())).await
}

/// Returns false when the client connection should close. Losing the upstream
/// mid-connection closes the client too: the alternative is silently swallowing
/// its messages, which looks like a hung UI rather than a dropped connection.
async fn deliver(link: &mut Link, frame: proxy::Frame) -> bool {
    match link {
        Link::Absent => true,
        Link::Pending(queued) => {
            if queued.len() >= MAX_PENDING_FRAMES {
                tracing::warn!(
                    "client sent too much while the daemon worker started; disconnecting"
                );
                return false;
            }
            queued.push(frame);
            true
        }
        Link::Up(upstream) => match upstream.send(frame).await {
            proxy::SendOutcome::Delivered => true,
            proxy::SendOutcome::Disconnected => {
                tracing::warn!("upstream daemon closed; disconnecting client so it reconnects");
                false
            }
        },
    }
}

pub(crate) fn now_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    // Avoids a chrono dependency; the Node daemon only needs a valid ISO-8601 string.
    let secs = now.as_secs();
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let (hh, mm, ss) = (secs % 86_400 / 3600, secs % 3600 / 60, secs % 60);
    format!(
        "{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.{:03}Z",
        now.subsec_millis()
    )
}

/// Howard Hinnant's days-from-civil, inverted.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;

    fn test_state(hostnames: hostnames::Hostnames) -> Arc<AppState> {
        Arc::new(AppState {
            server_id: "test".into(),
            started: Instant::now(),
            upstream: watch::channel(None).1,
            expects_upstream: false,
            auth: daemon_config::AuthStore::fixed(auth::AuthConfig {
                trust_lan: true,
                ..Default::default()
            }),
            allowed_origins: Vec::new(),
            hostnames,
            allow_pairing_hostname: true,
            hostname: "test-host".into(),
            listen: "127.0.0.1:0".into(),
            web_ui_dist: None,
            native_terminals: false,
            http_proxy: http_proxy::HttpProxy::new(),
            validate_protocol: false,
        })
    }

    async fn status_for(host: Option<&str>, hostnames: hostnames::Hostnames) -> StatusCode {
        let mut builder = axum::http::Request::builder().uri("/api/health");
        if let Some(host) = host {
            builder = builder.header("host", host);
        }
        let request = builder.body(axum::body::Body::empty()).unwrap();
        build_router(test_state(hostnames))
            .into_make_service_with_connect_info::<SocketAddr>()
            .oneshot(SocketAddr::from(([127, 0, 0, 1], 40000)))
            .await
            .unwrap()
            .oneshot(request)
            .await
            .unwrap()
            .status()
    }

    /// The rebinding case: an attacker's page resolves evil.com to 127.0.0.1,
    /// so it reaches the daemon, but the browser still sends `Host: evil.com`.
    #[tokio::test]
    async fn rejects_a_rebound_host_on_an_otherwise_unauthenticated_route() {
        assert_eq!(
            status_for(Some("evil.com:9999"), hostnames::Hostnames::default()).await,
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn allows_the_hosts_a_real_client_sends() {
        for host in ["localhost:9999", "127.0.0.1:9999", "192.168.1.10:9999"] {
            assert_eq!(
                status_for(Some(host), hostnames::Hostnames::default()).await,
                StatusCode::OK,
                "{host}"
            );
        }
    }

    #[tokio::test]
    async fn allows_a_configured_host_and_still_rejects_the_rest() {
        let hostnames = hostnames::Hostnames::List(vec![".example.com".into()]);
        assert_eq!(
            status_for(Some("frogg.example.com"), hostnames.clone()).await,
            StatusCode::OK
        );
        assert_eq!(
            status_for(Some("evil.com"), hostnames).await,
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn rejects_a_request_with_no_host_header_at_all() {
        assert_eq!(
            status_for(None, hostnames::Hostnames::default()).await,
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn an_any_allowlist_opts_back_into_the_old_behaviour() {
        assert_eq!(
            status_for(Some("evil.com"), hostnames::Hostnames::Any).await,
            StatusCode::OK
        );
    }

    /// A stand-in Node daemon that answers every request with the Host it was sent.
    async fn host_echo_upstream() -> (String, watch::Sender<Option<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new().fallback(|headers: HeaderMap| async move {
            header(&headers, "host").unwrap_or("").to_string()
        });
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let url = format!("ws://{addr}/ws");
        let (tx, _) = watch::channel(Some(url.clone()));
        (url, tx)
    }

    async fn via_front(
        host: &str,
        upstream: Option<watch::Receiver<Option<String>>>,
    ) -> (StatusCode, String) {
        let mut state = test_state(hostnames::Hostnames::default());
        if let Some(upstream) = upstream {
            let state = Arc::get_mut(&mut state).unwrap();
            state.upstream = upstream;
            state.expects_upstream = true;
        }
        let request = axum::http::Request::builder()
            .uri("/anything")
            .header("host", host)
            .body(axum::body::Body::empty())
            .unwrap();
        let response = build_router(state)
            .into_make_service_with_connect_info::<SocketAddr>()
            .oneshot(SocketAddr::from(([127, 0, 0, 1], 40000)))
            .await
            .unwrap()
            .oneshot(request)
            .await
            .unwrap();
        let status = response.status();
        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        (status, String::from_utf8_lossy(&body).into_owned())
    }

    #[tokio::test]
    async fn service_hosts_and_unknown_hosts_go_to_node_with_their_host() {
        let (_url, tx) = host_echo_upstream().await;
        for host in ["web--app.localhost:9999", "evil.com"] {
            let (status, body) = via_front(host, Some(tx.subscribe())).await;
            assert_eq!(status, StatusCode::OK, "{host}");
            assert_eq!(body, host, "Node must see the original Host");
        }
    }

    #[tokio::test]
    async fn without_a_node_daemon_unknown_hosts_are_still_refused() {
        let (status, _) = via_front("evil.com", None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn refusals_close_with_nodes_reasons() {
        assert_eq!(
            auth_close_reason(&auth::Decision::Unclaimed),
            "Pairing required"
        );
        assert_eq!(
            auth_close_reason(&auth::Decision::MissingToken),
            "Password required"
        );
        assert_eq!(
            auth_close_reason(&auth::Decision::InvalidToken),
            "Incorrect password"
        );
    }

    #[test]
    fn converts_epoch_days_to_civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(19_783), (2024, 3, 1)); // leap year boundary
    }
}
