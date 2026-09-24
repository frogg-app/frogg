//! Reads the same on-disk state as the Node daemon: `$FROGG_HOME/config.json` for
//! listen/CORS/password, and `$FROGG_HOME/principals.json` for issued credentials.
//!
//! Both are read best-effort — a missing or malformed file yields defaults, which
//! is what the Node daemon does, rather than refusing to boot.

use crate::auth::{AuthConfig, Device, Role};
use crate::hostnames::{merge_hostnames, parse_hostnames_env, Hostnames};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

#[derive(Debug, Default, Deserialize)]
struct PersistedConfig {
    #[serde(default)]
    daemon: Option<DaemonSection>,
}

#[derive(Debug, Default, Deserialize)]
struct DaemonSection {
    #[serde(default)]
    listen: Option<String>,
    #[serde(default)]
    cors: Option<CorsSection>,
    #[serde(default)]
    auth: Option<AuthSection>,
    #[serde(default, rename = "trustLan")]
    trust_lan: Option<bool>,
    #[serde(default)]
    hostnames: Option<HostnamesSection>,
    /// The pre-rename name for `hostnames`; still read, as the Node daemon does.
    #[serde(default, rename = "allowedHosts")]
    allowed_hosts: Option<HostnamesSection>,
    #[serde(default, rename = "allowPairingHostname")]
    allow_pairing_hostname: Option<bool>,
}

/// `daemon.hostnames` is `true` or an array of patterns.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum HostnamesSection {
    Any(bool),
    List(Vec<String>),
}

impl From<HostnamesSection> for Hostnames {
    fn from(value: HostnamesSection) -> Self {
        match value {
            // Only `true` means "any"; `false` is not a documented value and
            // degrades to the defaults rather than opening the daemon up.
            HostnamesSection::Any(true) => Hostnames::Any,
            HostnamesSection::Any(false) => Hostnames::List(Vec::new()),
            HostnamesSection::List(list) => Hostnames::List(list),
        }
    }
}

/// `parseBooleanEnv`: the same accepted spellings the Node daemon takes.
fn parse_boolean_env(value: Option<String>) -> Option<bool> {
    let normalized = value?.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

#[derive(Debug, Default, Deserialize)]
struct CorsSection {
    #[serde(default, rename = "allowedOrigins")]
    allowed_origins: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct AuthSection {
    /// Already a bcrypt hash on disk; never a plaintext password.
    #[serde(default)]
    password: Option<String>,
    #[serde(default, rename = "trustLan")]
    trust_lan: Option<bool>,
    #[serde(default, rename = "claimMode")]
    claim_mode: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
struct PrincipalsFile {
    #[serde(default, rename = "claimedAt")]
    claimed_at: Option<String>,
    #[serde(default)]
    principals: Vec<Principal>,
}

#[derive(Debug, Default, Deserialize)]
struct Principal {
    #[serde(default)]
    credentials: Vec<Credential>,
}

#[derive(Debug, Deserialize)]
struct Credential {
    sha256: String,
    /// Absent reads as owner, matching `claim-store.ts`.
    #[serde(default)]
    role: Option<Role>,
}

pub struct Loaded {
    pub listen: Option<String>,
    /// Stable id shared with the Node daemon via $FROGG_HOME/server-id.
    pub server_id: String,
    pub allowed_origins: Vec<String>,
    pub auth: AuthConfig,
    /// `Host` allowlist: DNS-rebinding protection, shared with the Node daemon.
    pub hostnames: Hostnames,
    /// Whether the brand's pairing hostname is allowed without being listed.
    pub allow_pairing_hostname: bool,
}

/// `$FROGG_HOME`, else `$FROGG_HOME`, else `~/.frogg`.
pub fn resolve_home() -> Option<PathBuf> {
    let base = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(crate::branding::home_path(PathBuf::from(base)))
}

pub fn load(home: Option<&Path>) -> Loaded {
    let config: PersistedConfig = home
        .map(|h| h.join("config.json"))
        .and_then(read_json)
        .unwrap_or_default();
    let daemon = config.daemon.unwrap_or_default();
    let auth = build_auth(
        home,
        daemon.auth.as_ref(),
        daemon.trust_lan,
        env_password_hash(),
    );

    // `mergeHostnames`: config.json and the env append rather than replace, so
    // a launch-time value does not silence a persisted entry.
    let hostnames = merge_hostnames([
        daemon
            .hostnames
            .or(daemon.allowed_hosts)
            .map(Hostnames::from)
            .unwrap_or_default(),
        parse_hostnames_env(
            std::env::var("FROGG_HOSTNAMES")
                .or_else(|_| std::env::var("FROGG_ALLOWED_HOSTS"))
                .ok()
                .as_deref(),
        )
        .unwrap_or_default(),
    ]);
    let allow_pairing_hostname =
        parse_boolean_env(crate::branding::env_value("ALLOW_PAIRING_HOSTNAME"))
            .or(daemon.allow_pairing_hostname)
            .unwrap_or(true);

    Loaded {
        listen: daemon.listen,
        hostnames,
        allow_pairing_hostname,
        server_id: read_or_create_server_id(home),
        allowed_origins: daemon.cors.map(|c| c.allowed_origins).unwrap_or_default(),
        auth,
    }
}

/// FROGG_PASSWORD is plaintext in the env; the Node daemon bcrypts it at load.
/// Hashed once, since the auth store reloads far more often than the env changes.
fn env_password_hash() -> Option<String> {
    let plain = crate::branding::env_value("PASSWORD")?;
    bcrypt::hash(plain, 12).ok()
}

fn build_auth(
    home: Option<&Path>,
    section: Option<&AuthSection>,
    legacy_trust_lan: Option<bool>,
    env_password_hash: Option<String>,
) -> AuthConfig {
    let principals: PrincipalsFile = home
        .map(|h| h.join("principals.json"))
        .and_then(read_json)
        .unwrap_or_default();
    let devices = principals
        .principals
        .into_iter()
        .flat_map(|p| p.credentials)
        .map(|c| Device {
            sha256: c.sha256,
            role: c.role.unwrap_or(Role::Owner),
        })
        .collect();
    let local_token = home
        .and_then(|h| std::fs::read_to_string(h.join("local-token")).ok())
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    AuthConfig {
        password_hash: env_password_hash.or_else(|| section.and_then(|a| a.password.clone())),
        devices,
        claimed_at: principals.claimed_at.is_some(),
        local_token,
        trust_lan: section
            .and_then(|a| a.trust_lan)
            .or(legacy_trust_lan)
            .unwrap_or(crate::branding::DEFAULT_TRUST_LAN),
        claim_mode: section.and_then(|a| a.claim_mode).unwrap_or(false),
    }
}

/// Auth state that follows the files the Node daemon writes: pairing, revoking,
/// re-roling or a password change takes effect on the next request, as it does
/// in Node, instead of waiting for a restart.
pub struct AuthStore {
    home: Option<PathBuf>,
    env_password_hash: Option<String>,
    cache: Mutex<(Vec<Option<SystemTime>>, Arc<AuthConfig>)>,
}

impl AuthStore {
    pub fn new(home: Option<PathBuf>, initial: AuthConfig) -> Self {
        let env_password_hash =
            crate::branding::env_value("PASSWORD").and(initial.password_hash.clone());
        let stamps = Self::stamps(home.as_deref());
        Self {
            home,
            env_password_hash,
            cache: Mutex::new((stamps, Arc::new(initial))),
        }
    }

    /// A fixed config, for tests.
    #[cfg(test)]
    pub fn fixed(config: AuthConfig) -> Self {
        Self {
            home: None,
            env_password_hash: None,
            cache: Mutex::new((Vec::new(), Arc::new(config))),
        }
    }

    fn stamps(home: Option<&Path>) -> Vec<Option<SystemTime>> {
        let Some(home) = home else { return Vec::new() };
        ["config.json", "principals.json", "local-token"]
            .iter()
            .map(|f| {
                std::fs::metadata(home.join(f))
                    .and_then(|m| m.modified())
                    .ok()
            })
            .collect()
    }

    pub fn current(&self) -> Arc<AuthConfig> {
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if self.home.is_none() {
            return cache.1.clone();
        }
        let stamps = Self::stamps(self.home.as_deref());
        if stamps != cache.0 {
            let config: PersistedConfig = self
                .home
                .as_deref()
                .map(|h| h.join("config.json"))
                .and_then(read_json)
                .unwrap_or_default();
            let daemon = config.daemon.unwrap_or_default();
            let auth = build_auth(
                self.home.as_deref(),
                daemon.auth.as_ref(),
                daemon.trust_lan,
                self.env_password_hash.clone(),
            );
            *cache = (stamps, Arc::new(auth));
        }
        cache.1.clone()
    }
}

/// Reuses the Node daemon's server-id so both report the same identity for the
/// same home. Falls back to an ephemeral id when there is no writable home.
fn read_or_create_server_id(home: Option<&Path>) -> String {
    let Some(path) = home.map(|h| h.join("server-id")) else {
        return ephemeral_server_id();
    };
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let generated = ephemeral_server_id();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, &generated);
    generated
}

fn ephemeral_server_id() -> String {
    // Matches the Node daemon's srv_<token> shape.
    format!("srv_{}", uuid::Uuid::new_v4().simple())
}

fn read_json<T: serde::de::DeserializeOwned>(path: PathBuf) -> Option<T> {
    let raw = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str(&raw) {
        Ok(value) => Some(value),
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "ignoring unreadable config file");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("frogg-rs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_listen_origins_and_credentials() {
        let dir = tempdir();
        std::fs::write(
            dir.join("config.json"),
            r#"{"daemon":{"listen":"0.0.0.0:9999","cors":{"allowedOrigins":["http://a"]},
                "auth":{"password":"$2b$12$abc","trustLan":false,"claimMode":true}}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("principals.json"),
            r#"{"version":2,"claimedAt":"t","principals":[{"id":"p","label":"l","createdAt":"t","permissions":[],
                "credentials":[{"id":"c","sha256":"aa","createdAt":"t","name":"n"},
                               {"id":"d","sha256":"bb","createdAt":"t","name":"m","role":"viewer"}]}]}"#,
        )
        .unwrap();

        std::fs::write(dir.join("server-id"), "srv_fromdisk\n").unwrap();
        let loaded = load(Some(&dir));
        assert_eq!(
            loaded.server_id, "srv_fromdisk",
            "must reuse the Node daemon's id"
        );
        assert_eq!(loaded.listen.as_deref(), Some("0.0.0.0:9999"));
        assert_eq!(loaded.allowed_origins, vec!["http://a".to_string()]);
        assert_eq!(loaded.auth.password_hash.as_deref(), Some("$2b$12$abc"));
        assert_eq!(
            loaded.auth.devices,
            vec![
                Device {
                    sha256: "aa".into(),
                    role: Role::Owner
                },
                Device {
                    sha256: "bb".into(),
                    role: Role::Viewer
                },
            ],
            "an absent role reads as owner"
        );
        assert!(loaded.auth.claimed_at);
        assert!(!loaded.auth.trust_lan);
        assert!(loaded.auth.claim_mode);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_store_follows_revocations_without_a_restart() {
        let dir = tempdir();
        let principals = |creds: &str| {
            format!(
                r#"{{"version":2,"principals":[{{"id":"p","label":"l","createdAt":"t","permissions":[],"credentials":[{creds}]}}]}}"#
            )
        };
        std::fs::write(
            dir.join("principals.json"),
            principals(r#"{"id":"c","sha256":"aa","createdAt":"t","name":"n"}"#),
        )
        .unwrap();
        let store = AuthStore::new(Some(dir.clone()), load(Some(&dir)).auth);
        assert_eq!(store.current().devices.len(), 1);
        // Revoke; make sure the mtime moves even on coarse-grained filesystems.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.join("principals.json"), principals("")).unwrap();
        let file = std::fs::File::options()
            .write(true)
            .open(dir.join("principals.json"))
            .unwrap();
        file.set_modified(SystemTime::now() + std::time::Duration::from_secs(5))
            .unwrap();
        assert!(store.current().devices.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generates_and_persists_a_server_id_when_none_exists() {
        let dir = tempdir();
        let first = load(Some(&dir)).server_id;
        assert!(first.starts_with("srv_"));
        assert_eq!(
            load(Some(&dir)).server_id,
            first,
            "must be stable across restarts"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_or_malformed_home_yields_defaults_rather_than_failing() {
        let loaded = load(Some(Path::new("/nonexistent-frogg-home")));
        assert!(loaded.listen.is_none());
        assert!(loaded.auth.password_hash.is_none());
        assert_eq!(
            loaded.auth.trust_lan,
            crate::branding::DEFAULT_TRUST_LAN,
            "trustLan falls back to the brand default like the Node daemon"
        );

        let dir = tempdir();
        std::fs::write(dir.join("config.json"), "{ not json").unwrap();
        assert!(load(Some(&dir)).listen.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
