//! `$FROGG_HOME/frogg.pid`, held exactly as `packages/server/src/server/pid-lock.ts` holds it,
//! so the CLI (`daemon status`, `stop`, port discovery) and a Node daemon started against the
//! same home see one daemon whichever runtime owns the lock.
//!
//! Format: one JSON object (`brand`, `pid`, `startedAt`, `hostname`, `uid`, `listen`,
//! `heartbeat: true`). Published with link(2) so a crash never leaves an empty file and a
//! racing daemon gets EEXIST. Freshness is the file's mtime, refreshed on a heartbeat.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};

/// Matches `PID_LOCK_HEARTBEAT_INTERVAL_MS`.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug)]
pub enum LockError {
    Held { pid: i64, started_at: String },
    ForeignProduct,
    Io(std::io::Error),
}

impl std::fmt::Display for LockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LockError::Held { pid, started_at } => write!(
                f,
                "Another {} daemon is already running (PID {pid}, started {started_at})",
                crate::branding::NAME
            ),
            LockError::ForeignProduct => {
                write!(f, "This state directory belongs to another product")
            }
            LockError::Io(err) => write!(f, "PID lock: {err}"),
        }
    }
}

impl std::error::Error for LockError {}

impl From<std::io::Error> for LockError {
    fn from(err: std::io::Error) -> Self {
        LockError::Io(err)
    }
}

pub struct PidLock {
    path: PathBuf,
    pid: u32,
}

fn pid_running(pid: i64) -> bool {
    if pid <= 0 || pid > i32::MAX as i64 {
        return false;
    }
    // Signal 0 probes existence; EPERM still means the process exists.
    let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

fn read_lock(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    // The Node schema requires these; anything else is a corrupt lock.
    (value.get("pid")?.is_i64() && value.get("startedAt")?.is_string()).then_some(value)
}

/// The Node side retries reads briefly, since a lock can be mid-rewrite (updatePidLock
/// truncates then writes).
fn read_lock_with_retry(path: &Path) -> Option<Value> {
    for attempt in 0..10 {
        if let Some(lock) = read_lock(path) {
            return Some(lock);
        }
        if !path.exists() {
            return None;
        }
        if attempt < 9 {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    None
}

fn now_iso8601() -> String {
    crate::now_iso8601()
}

impl PidLock {
    pub fn acquire(home: &Path, listen: &str) -> Result<Self, LockError> {
        std::fs::create_dir_all(home)?;
        let path = home.join("frogg.pid");
        let pid = std::process::id();

        let existing = read_lock_with_retry(&path);
        if existing.is_none() && path.exists() {
            let _ = std::fs::remove_file(&path);
        }
        if let Some(lock) = existing {
            if !crate::branding::matches_identity(lock.get("brand")) {
                return Err(LockError::ForeignProduct);
            }
            let owner = lock["pid"].as_i64().unwrap_or(0);
            let running = pid_running(owner);
            if owner == pid as i64 && running {
                let _ = touch(&path);
                return Ok(Self { path, pid });
            }
            if running {
                // Only a desktop-managed lock is ever reclaimed while its owner lives (a
                // COMPAT path the CLI does not use), so a live owner always wins here.
                return Err(LockError::Held {
                    pid: owner,
                    started_at: lock["startedAt"].as_str().unwrap_or("").to_string(),
                });
            }
            let _ = std::fs::remove_file(&path);
        }

        let info = json!({
            "brand": { "id": crate::branding::ID, "applicationId": crate::branding::APPLICATION_ID },
            "pid": pid,
            "startedAt": now_iso8601(),
            "hostname": crate::hostname(),
            "uid": unsafe { libc::getuid() },
            "listen": listen,
            "heartbeat": true,
        });
        let tmp = home.join(format!("frogg.pid.{pid}.tmp"));
        std::fs::write(&tmp, info.to_string())?;
        let linked = std::fs::hard_link(&tmp, &path);
        let _ = std::fs::remove_file(&tmp);
        match linked {
            Ok(()) => Ok(Self { path, pid }),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                match read_lock_with_retry(&path) {
                    Some(lock) => Err(LockError::Held {
                        pid: lock["pid"].as_i64().unwrap_or(0),
                        started_at: lock["startedAt"].as_str().unwrap_or("").to_string(),
                    }),
                    None => Err(LockError::Io(err)),
                }
            }
            Err(err) => Err(err.into()),
        }
    }

    /// Refreshes the mtime if the lock is still ours. Losing it is fatal, as in Node.
    pub fn heartbeat(&self) -> Result<(), LockError> {
        match read_lock_with_retry(&self.path) {
            Some(lock) if lock["pid"].as_i64() == Some(self.pid as i64) => {
                touch(&self.path)?;
                Ok(())
            }
            Some(lock) => Err(LockError::Held {
                pid: lock["pid"].as_i64().unwrap_or(0),
                started_at: lock["startedAt"].as_str().unwrap_or("").to_string(),
            }),
            None => Err(LockError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "lock file is missing",
            ))),
        }
    }

    pub fn release(&self) {
        if read_lock(&self.path).and_then(|l| l["pid"].as_i64()) == Some(self.pid as i64) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn touch(path: &Path) -> std::io::Result<()> {
    let file = std::fs::OpenOptions::new().append(true).open(path)?;
    file.set_modified(SystemTime::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("frogg-pidlock-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_the_node_lock_shape_and_releases_it() {
        let home = temp_home("shape");
        let lock = PidLock::acquire(&home, "127.0.0.1:7777").unwrap();
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(home.join("frogg.pid")).unwrap())
                .unwrap();
        assert_eq!(written["pid"], json!(std::process::id()));
        assert_eq!(written["listen"], json!("127.0.0.1:7777"));
        assert_eq!(written["heartbeat"], json!(true));
        assert!(written["startedAt"].as_str().unwrap().ends_with('Z'));
        assert!(crate::branding::matches_identity(written.get("brand")));
        lock.heartbeat().unwrap();
        lock.release();
        assert!(!home.join("frogg.pid").exists());
    }

    #[test]
    fn a_live_owner_keeps_the_lock_and_a_dead_one_loses_it() {
        let home = temp_home("owner");
        let brand =
            json!({ "id": crate::branding::ID, "applicationId": crate::branding::APPLICATION_ID });
        // PID 1 is always alive.
        let live = json!({ "brand": brand, "pid": 1, "startedAt": "x", "hostname": "h", "uid": 0, "listen": null });
        std::fs::write(home.join("frogg.pid"), live.to_string()).unwrap();
        assert!(matches!(
            PidLock::acquire(&home, "127.0.0.1:1"),
            Err(LockError::Held { pid: 1, .. })
        ));

        let dead = json!({ "brand": brand, "pid": i32::MAX, "startedAt": "x", "hostname": "h", "uid": 0, "listen": null });
        std::fs::write(home.join("frogg.pid"), dead.to_string()).unwrap();
        let lock = PidLock::acquire(&home, "127.0.0.1:1").unwrap();
        lock.release();
    }

    #[test]
    fn an_unreadable_lock_is_replaced() {
        let home = temp_home("corrupt");
        std::fs::write(home.join("frogg.pid"), "").unwrap();
        PidLock::acquire(&home, "127.0.0.1:1").unwrap().release();
    }
}
