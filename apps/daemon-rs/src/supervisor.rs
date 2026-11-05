//! Supervises the Node daemon worker in place of `packages/server/scripts/supervisor.ts`.
//!
//! The Rust front owns the public listener; the worker binds a private loopback port and is
//! reached through the proxy. The worker contract is the one the Node supervisor speaks:
//!
//! - Node IPC on fd 3 (`NODE_CHANNEL_FD`, JSON lines). The worker sends `frogg:ready`,
//!   `frogg:restart`, `frogg:shutdown` and `frogg:listen-failed`; we send
//!   `frogg:supervisor-heartbeat` every second and `frogg:graceful-shutdown` to stop it. The
//!   worker exits by itself when the channel closes or its parent changes.
//! - Crash restarts back off from 1 s, doubling to 30 s; a worker that stayed up 60 s resets it.
//! - A stop asks for a graceful shutdown and kills the worker after 10 s.
//! - Worker stdout/stderr go to ours and to the daemon log file (`daemon.log`, size-rotated).
//!
//! Unix only: Node's IPC channel on Windows is a named pipe, which this does not open yet.

use std::os::fd::{AsRawFd, OwnedFd};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, watch};

const HEARTBEAT: Duration = Duration::from_secs(1);
const TERMINATION_GRACE: Duration = Duration::from_secs(10);
const BACKOFF_INITIAL: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
const BACKOFF_RESET_AFTER: Duration = Duration::from_secs(60);

pub struct WorkerSpec {
    /// The Node executable.
    pub node: PathBuf,
    /// Arguments before the entry (`--import tsx`, `--disable-warning`, ...).
    pub node_args: Vec<String>,
    /// `packages/server/dist/server/server/daemon-worker.js`.
    pub entry: PathBuf,
    /// Arguments after the entry (`--relay`, `--no-mcp`, ...), passed through from the CLI.
    pub args: Vec<String>,
    /// The address clients reach, which the worker reports as its own.
    pub public_listen: String,
}

/// Where the supervised worker is, for the proxy. `None` while it is starting or restarting.
pub type UpstreamUrl = watch::Receiver<Option<String>>;

/// Why the supervisor stopped, which decides the process exit code.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Exit {
    /// A signal or the worker's own shutdown request.
    Requested,
    /// The worker exited cleanly without a request (the Node supervisor exits with it).
    WorkerExited(i32),
}

#[derive(Debug)]
enum Lifecycle {
    Ready(String),
    Restart(String),
    Shutdown(String),
    ListenFailed(String),
}

fn parse_lifecycle(line: &str) -> Option<Lifecycle> {
    let value: Value = serde_json::from_str(line).ok()?;
    let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
    match value.get("type")?.as_str()? {
        "frogg:ready" => text("listen")
            .filter(|l| !l.trim().is_empty())
            .map(Lifecycle::Ready),
        "frogg:restart" => Some(Lifecycle::Restart(
            text("reason").unwrap_or_else(|| "worker_requested_restart".into()),
        )),
        "frogg:shutdown" => Some(Lifecycle::Shutdown(
            text("reason").unwrap_or_else(|| "worker_requested_shutdown".into()),
        )),
        "frogg:listen-failed" => text("message").map(Lifecycle::ListenFailed),
        _ => None,
    }
}

pub fn crash_delay(consecutive_crashes: u32) -> Duration {
    if consecutive_crashes == 0 {
        return Duration::ZERO;
    }
    let factor = 2u32.saturating_pow(consecutive_crashes - 1);
    BACKOFF_INITIAL.saturating_mul(factor).min(BACKOFF_MAX)
}

/// A free loopback port for the worker. There is a window between closing this probe and the
/// worker binding; a lost race shows up as `frogg:listen-failed` and a restart on a new port.
fn free_loopback_port() -> std::io::Result<u16> {
    let probe = std::net::TcpListener::bind("127.0.0.1:0")?;
    Ok(probe.local_addr()?.port())
}

/// `daemon.log`, appended to and rotated by size, as the Node supervisor's rotating stream does.
#[derive(Clone)]
pub struct LogFile(Arc<Mutex<LogState>>);

struct LogState {
    path: PathBuf,
    max_bytes: u64,
    max_files: u32,
    file: Option<std::fs::File>,
}

impl LogFile {
    pub fn open(path: PathBuf, max_bytes: u64, max_files: u32) -> Self {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let file = open_append(&path);
        Self(Arc::new(Mutex::new(LogState {
            path,
            max_bytes,
            max_files,
            file,
        })))
    }

    pub fn write(&self, chunk: &[u8]) {
        use std::io::Write;
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let len = state
            .file
            .as_ref()
            .and_then(|f| f.metadata().ok())
            .map_or(0, |m| m.len());
        if state.max_bytes > 0 && len + chunk.len() as u64 > state.max_bytes {
            state.rotate();
        }
        if let Some(file) = state.file.as_mut() {
            let _ = file.write_all(chunk);
        }
    }

    pub fn lifecycle(&self, message: &str, fields: Value) {
        let mut line = json!({
            "level": "info",
            "time": crate::now_iso8601(),
            "pid": std::process::id(),
            "name": "DaemonRunner",
            "runtime": "rust",
            "msg": message,
        });
        if let (Some(line), Value::Object(fields)) = (line.as_object_mut(), fields) {
            line.extend(fields);
        }
        self.write(format!("{line}\n").as_bytes());
    }
}

impl LogState {
    fn rotate(&mut self) {
        self.file = None;
        for index in (1..self.max_files.max(1)).rev() {
            let from = numbered(&self.path, index);
            if from.exists() {
                let _ = std::fs::rename(&from, numbered(&self.path, index + 1));
            }
        }
        let _ = std::fs::rename(&self.path, numbered(&self.path, 1));
        self.file = open_append(&self.path);
    }
}

fn numbered(path: &Path, index: u32) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{index}"));
    PathBuf::from(name)
}

fn open_append(path: &Path) -> Option<std::fs::File> {
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()
}

/// Parses `10m`, `512k`, `1g` or bytes, as `toRotatingFileStreamSize` accepts (bare = MiB).
pub fn parse_size(value: &str) -> Option<u64> {
    let value = value.trim();
    let (digits, unit) = match value.char_indices().find(|(_, c)| !c.is_ascii_digit()) {
        Some((i, _)) => (&value[..i], value[i..].trim()),
        None => (value, "m"),
    };
    let n: u64 = digits.parse().ok()?;
    let scale = match unit.to_ascii_lowercase().as_str() {
        "b" => 1,
        "k" => 1 << 10,
        "m" | "" => 1 << 20,
        "g" => 1 << 30,
        _ => return None,
    };
    Some(n * scale)
}

pub struct Supervisor {
    upstream: watch::Sender<Option<String>>,
    log: LogFile,
    spec: WorkerSpec,
    /// Signals and the worker's shutdown request both arrive here.
    stop: mpsc::Receiver<String>,
}

/// Lets the rest of the process ask the supervisor to stop.
#[derive(Clone)]
pub struct StopHandle(mpsc::Sender<String>);

impl StopHandle {
    pub fn request(&self, reason: &str) {
        let _ = self.0.try_send(reason.to_string());
    }
}

struct Running {
    child: Child,
    to_worker: mpsc::Sender<Value>,
    events: mpsc::Receiver<Lifecycle>,
    started: Instant,
}

impl Supervisor {
    pub fn new(spec: WorkerSpec, log: LogFile) -> (Self, UpstreamUrl, StopHandle) {
        let (upstream, upstream_rx) = watch::channel(None);
        let (stop_tx, stop) = mpsc::channel(4);
        (
            Self {
                upstream,
                log,
                spec,
                stop,
            },
            upstream_rx,
            StopHandle(stop_tx),
        )
    }

    fn say(&self, message: &str) {
        eprintln!("[DaemonRunner] {message}");
        self.log.lifecycle(message, json!({}));
    }

    /// Runs workers until a stop is requested or a worker exits for good.
    pub async fn run(mut self) -> Exit {
        self.say("Starting daemon worker (IPC restart and crash restart enabled)");
        let mut consecutive_crashes = 0u32;
        let mut last_listen_failure: Option<String> = None;
        loop {
            let mut running = match self.spawn() {
                Ok(running) => running,
                Err(err) => {
                    self.say(&format!("Failed to spawn worker: {err}"));
                    return Exit::WorkerExited(1);
                }
            };
            let mut restart_requested = false;
            let mut stop_reason: Option<String> = None;
            // Set when a stop or restart is requested; the worker is killed if still up then.
            let mut kill_at: Option<tokio::time::Instant> = None;

            // Phase 1: the worker is up; wait for it to exit or for a request.
            let status = loop {
                tokio::select! {
                    status = running.child.wait() => break status,
                    Some(event) = running.events.recv() => match event {
                        Lifecycle::Ready(listen) => {
                            consecutive_crashes = 0;
                            self.log.lifecycle("Worker ready", json!({ "listen": listen }));
                            let _ = self.upstream.send(Some(ws_url(&listen)));
                        }
                        Lifecycle::ListenFailed(message) => {
                            self.log.lifecycle("Worker could not listen", json!({ "detail": message }));
                            last_listen_failure = Some(message);
                        }
                        Lifecycle::Restart(reason) => {
                            if !restart_requested && stop_reason.is_none() {
                                restart_requested = true;
                                self.say(&format!("{reason}. Stopping worker for restart..."));
                                begin_stop(&running, &reason).await;
                                kill_at = Some(tokio::time::Instant::now() + TERMINATION_GRACE);
                            }
                        }
                        Lifecycle::Shutdown(reason) => {
                            if stop_reason.is_none() {
                                self.say(&format!("{reason}. Stopping worker..."));
                                begin_stop(&running, &reason).await;
                                stop_reason = Some(reason);
                                kill_at.get_or_insert(tokio::time::Instant::now() + TERMINATION_GRACE);
                            }
                        }
                    },
                    Some(reason) = self.stop.recv(), if stop_reason.is_none() => {
                        self.say(&format!("{reason}. Stopping worker..."));
                        begin_stop(&running, &reason).await;
                        stop_reason = Some(reason);
                        kill_at.get_or_insert(tokio::time::Instant::now() + TERMINATION_GRACE);
                    }
                    // Grace period expired after a stop or restart request.
                    _ = sleep_until(kill_at), if kill_at.is_some() => {
                        kill_at = None;
                        self.log.lifecycle(
                            "Worker did not exit after graceful shutdown request; forcing kill",
                            json!({ "workerPid": running.child.id() }),
                        );
                        let _ = running.child.start_kill();
                    }
                }
            };
            let _ = self.upstream.send(None);
            let (code, signal) = describe(&status);
            self.log
                .lifecycle("Worker exited", json!({ "code": code, "signal": signal }));
            let exit = signal
                .map(|s| format!("signal {s}"))
                .unwrap_or_else(|| format!("code {}", code.unwrap_or(-1)));

            if stop_reason.is_some() {
                self.say(&format!(
                    "Worker exited ({exit}). Supervisor shutting down."
                ));
                return Exit::Requested;
            }
            if restart_requested {
                self.say(&format!("Worker exited ({exit}). Restarting worker..."));
                continue;
            }
            let crashed = matches!(code, Some(c) if c != 0)
                || matches!(signal, Some(s) if s != libc::SIGTERM);
            if !crashed {
                self.say(&format!("Worker exited ({exit}). Supervisor exiting."));
                return Exit::WorkerExited(code.unwrap_or(1));
            }
            if running.started.elapsed() >= BACKOFF_RESET_AFTER {
                consecutive_crashes = 0;
            }
            consecutive_crashes += 1;
            let delay = crash_delay(consecutive_crashes);
            let cause = last_listen_failure
                .take()
                .map(|m| format!(": {m}"))
                .unwrap_or_default();
            self.say(&format!(
                "Worker crashed ({exit}){cause}. Restarting worker in {:.1}s (attempt {consecutive_crashes})...",
                delay.as_secs_f64()
            ));
            tokio::select! {
                _ = tokio::time::sleep(delay) => {}
                Some(reason) = self.stop.recv() => {
                    self.say(&format!("{reason}. Supervisor shutting down."));
                    return Exit::Requested;
                }
            }
        }
    }

    fn spawn(&self) -> std::io::Result<Running> {
        let port = free_loopback_port()?;
        let listen = format!("127.0.0.1:{port}");
        let (parent_end, child_end) = std::os::unix::net::UnixStream::pair()?;
        let child_fd: OwnedFd = child_end.into();
        let raw_child_fd = child_fd.as_raw_fd();

        let mut command = Command::new(&self.spec.node);
        command
            .args(&self.spec.node_args)
            .arg(&self.spec.entry)
            .args(&self.spec.args)
            .env("NODE_CHANNEL_FD", "3")
            .env("NODE_CHANNEL_SERIALIZATION_MODE", "json")
            // The worker binds loopback only; the front is the public listener. Brand-prefixed,
            // because the worker drops unprefixed keys for a branded build.
            .env(crate::branding::env_key("LISTEN"), &listen)
            .env(
                crate::branding::env_key("PUBLIC_LISTEN"),
                &self.spec.public_listen,
            )
            // The front is the worker's only caller and it sets X-Forwarded-For to the real
            // peer. Trust exactly loopback, so a configured reverse-proxy list cannot make the
            // worker walk past that header into anything a client wrote.
            .env(crate::branding::env_key("TRUSTED_PROXIES"), "loopback")
            .env(crate::branding::env_key("RS_FRONT"), "1")
            .stdin(Stdio::inherit())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // SAFETY: only async-signal-safe calls (dup2/fcntl) between fork and exec.
        unsafe {
            command.pre_exec(move || {
                if raw_child_fd == 3 {
                    let flags = libc::fcntl(3, libc::F_GETFD);
                    if flags < 0 || libc::fcntl(3, libc::F_SETFD, flags & !libc::FD_CLOEXEC) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                } else if libc::dup2(raw_child_fd, 3) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        self.log.lifecycle(
            "Spawning worker",
            json!({ "workerEntry": self.spec.entry.display().to_string(), "listen": listen }),
        );
        let mut child = command.spawn()?;
        drop(child_fd);

        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(pump_output(stdout, self.log.clone(), false));
        }
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(pump_output(stderr, self.log.clone(), true));
        }

        parent_end.set_nonblocking(true)?;
        let channel = tokio::net::UnixStream::from_std(parent_end)?;
        let (read, mut write) = channel.into_split();
        let (event_tx, events) = mpsc::channel(16);
        let (to_worker, mut outbound) = mpsc::channel::<Value>(16);

        tokio::spawn(async move {
            let mut lines = BufReader::new(read).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(event) = parse_lifecycle(&line) {
                    if event_tx.send(event).await.is_err() {
                        break;
                    }
                }
            }
        });
        tokio::spawn(async move {
            let mut heartbeat = tokio::time::interval(HEARTBEAT);
            loop {
                let message = tokio::select! {
                    _ = heartbeat.tick() => json!({ "type": "frogg:supervisor-heartbeat" }),
                    message = outbound.recv() => match message {
                        Some(message) => message,
                        None => break,
                    },
                };
                let line = format!("{message}\n");
                if write.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
            }
        });

        Ok(Running {
            child,
            to_worker,
            events,
            started: Instant::now(),
        })
    }
}

async fn sleep_until(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

async fn begin_stop(running: &Running, reason: &str) {
    let _ = running
        .to_worker
        .send(json!({ "type": "frogg:graceful-shutdown", "reason": reason }))
        .await;
}

fn ws_url(listen: &str) -> String {
    format!("ws://{listen}/ws")
}

fn describe(status: &std::io::Result<std::process::ExitStatus>) -> (Option<i32>, Option<i32>) {
    use std::os::unix::process::ExitStatusExt;
    match status {
        Ok(status) => (status.code(), status.signal()),
        Err(_) => (None, None),
    }
}

async fn pump_output(mut stream: impl AsyncRead + Unpin, log: LogFile, stderr: bool) {
    use tokio::io::AsyncReadExt;
    let mut buffer = vec![0u8; 16 * 1024];
    loop {
        let n = match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        let chunk = &buffer[..n];
        if stderr {
            let _ = tokio::io::stderr().write_all(chunk).await;
        } else {
            let _ = tokio::io::stdout().write_all(chunk).await;
        }
        log.write(chunk);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_off_like_the_node_supervisor() {
        assert_eq!(crash_delay(0), Duration::ZERO);
        assert_eq!(crash_delay(1), Duration::from_secs(1));
        assert_eq!(crash_delay(2), Duration::from_secs(2));
        assert_eq!(crash_delay(5), Duration::from_secs(16));
        assert_eq!(crash_delay(6), Duration::from_secs(30));
        assert_eq!(crash_delay(40), Duration::from_secs(30));
    }

    #[test]
    fn parses_the_worker_lifecycle_messages() {
        assert!(matches!(
            parse_lifecycle(r#"{"type":"frogg:ready","listen":"127.0.0.1:5"}"#),
            Some(Lifecycle::Ready(l)) if l == "127.0.0.1:5"
        ));
        assert!(parse_lifecycle(r#"{"type":"frogg:ready","listen":" "}"#).is_none());
        assert!(matches!(
            parse_lifecycle(r#"{"type":"frogg:restart"}"#),
            Some(Lifecycle::Restart(r)) if r == "worker_requested_restart"
        ));
        assert!(matches!(
            parse_lifecycle(r#"{"type":"frogg:shutdown","reason":"cli"}"#),
            Some(Lifecycle::Shutdown(r)) if r == "cli"
        ));
        // Node's own internal channel messages are not lifecycle messages.
        assert!(parse_lifecycle(r#"{"cmd":"NODE_HANDLE_ACK"}"#).is_none());
        assert!(parse_lifecycle("not json").is_none());
    }

    #[test]
    fn parses_rotation_sizes() {
        assert_eq!(parse_size("10m"), Some(10 << 20));
        assert_eq!(parse_size("10"), Some(10 << 20));
        assert_eq!(parse_size("512K"), Some(512 << 10));
        assert_eq!(parse_size("1g"), Some(1 << 30));
        assert_eq!(parse_size("x"), None);
    }

    #[test]
    fn rotates_the_log_by_size() {
        let dir = std::env::temp_dir().join(format!("frogg-log-rotate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let log = LogFile::open(dir.join("daemon.log"), 10, 2);
        log.write(b"0123456789");
        log.write(b"abc");
        log.write(b"0123456789");
        assert_eq!(
            std::fs::read(dir.join("daemon.log")).unwrap(),
            b"0123456789"
        );
        assert_eq!(std::fs::read(dir.join("daemon.log.1")).unwrap(), b"abc");
        assert_eq!(
            std::fs::read(dir.join("daemon.log.2")).unwrap(),
            b"0123456789"
        );
    }
}
