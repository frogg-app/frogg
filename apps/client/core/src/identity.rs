//! This install's identity, and proving a daemon's (port of `device-identity.ts`).
//!
//! - [`DeviceIdentity`]: the hello `clientId` (a daemon binds sessions to it, so it must
//!   survive restarts) and a Curve25519 key pair, both persisted through [`Storage`].
//! - [`IdentityChallenge`]: two-way authorisation for a pairing link. We send a random
//!   challenge and an ephemeral public key to `POST /api/identity/proof`; the daemon seals the
//!   challenge with its long-term key. Only the holder of the key behind the link's
//!   fingerprint can produce it. HTTP is left to the caller (`fetch` in the UI).

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::crypto::{self, KeyPair};
use crate::storage::Storage;

pub const CLIENT_ID_KEY: &str = "frogg-next-rs.client-id.v1";
pub const DEVICE_KEY_KEY: &str = "frogg-next-rs.device-key.v1";
pub const DEFAULT_IDENTITY_PROOF_TIMEOUT_MS: u64 = 8_000;

#[derive(Debug, Clone)]
pub struct DeviceIdentity {
    /// `cid_<32 hex>`, like ui-next's `client-id.ts`.
    pub client_id: String,
    pub keypair: KeyPair,
}

pub fn new_client_id() -> String {
    let bytes = crypto::random_bytes::<16>().unwrap_or([0; 16]);
    format!(
        "cid_{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    )
}

impl DeviceIdentity {
    /// Loads the saved identity, creating and saving whatever is missing.
    pub fn load_or_create(storage: &dyn Storage) -> Result<Self, crypto::CryptoError> {
        let client_id = match storage.get(CLIENT_ID_KEY).map(|s| s.trim().to_owned()) {
            Some(id) if !id.is_empty() => id,
            _ => {
                let id = new_client_id();
                storage.set(CLIENT_ID_KEY, &id);
                id
            }
        };
        let keypair = match storage
            .get(DEVICE_KEY_KEY)
            .and_then(|s| crypto::import_secret_key(&s).ok())
        {
            Some(secret) => KeyPair::from_secret(secret),
            None => {
                let kp = KeyPair::generate()?;
                storage.set(DEVICE_KEY_KEY, &crypto::export_key(&kp.secret_key));
                kp
            }
        };
        Ok(Self { client_id, keypair })
    }

    pub fn public_key_b64(&self) -> String {
        crypto::export_key(&self.keypair.public_key)
    }

    /// `sha256:` fingerprint of this device's public key.
    pub fn fingerprint(&self) -> String {
        crypto::daemon_key_fingerprint(&self.public_key_b64()).unwrap_or_default()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityErrorCode {
    /// Nothing answered, or the answer was not an identity proof.
    Unreachable,
    /// The daemon's key hashes to something other than the link's `fp`.
    FingerprintMismatch,
    /// The fingerprint matched but the daemon could not seal our challenge.
    ProofInvalid,
    /// We already know this `serverId` under a different key.
    ServerKeyChanged,
}

impl IdentityErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unreachable => "unreachable",
            Self::FingerprintMismatch => "fingerprint_mismatch",
            Self::ProofInvalid => "proof_invalid",
            Self::ServerKeyChanged => "server_key_changed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct IdentityError {
    pub code: IdentityErrorCode,
    pub message: String,
    pub actual_fingerprint: Option<String>,
}

impl IdentityError {
    fn new(code: IdentityErrorCode, message: &str, actual: Option<&str>) -> Self {
        Self {
            code,
            message: message.into(),
            actual_fingerprint: actual.map(str::to_owned),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedDaemonIdentity {
    pub server_id: String,
    pub fingerprint: String,
    pub daemon_public_key_b64: String,
}

/// One identity check: build it, POST [`IdentityChallenge::request_body`] to
/// [`identity_proof_url`], then [`IdentityChallenge::verify`] the JSON answer.
pub struct IdentityChallenge {
    challenge_b64: String,
    keypair: KeyPair,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProofResponse {
    server_id: String,
    daemon_public_key_b64: String,
    proof_b64: String,
}

pub fn identity_proof_url(endpoint: &str, use_tls: bool) -> String {
    format!(
        "{}://{endpoint}/api/identity/proof",
        if use_tls { "https" } else { "http" }
    )
}

impl IdentityChallenge {
    pub fn new() -> Result<Self, IdentityError> {
        let random = |e: crypto::CryptoError| {
            IdentityError::new(IdentityErrorCode::ProofInvalid, &e.to_string(), None)
        };
        Ok(Self {
            challenge_b64: STANDARD.encode(crypto::random_bytes::<32>().map_err(random)?),
            keypair: KeyPair::generate().map_err(random)?,
        })
    }

    pub fn request_body(&self) -> Value {
        json!({
            "challengeB64": self.challenge_b64,
            "clientPublicKeyB64": crypto::export_key(&self.keypair.public_key),
        })
    }

    /// Checks the daemon's answer. `expected_fingerprint` is the link's `fp` (omit for a
    /// hand-typed code); `known_fingerprint` is what we stored for that server before.
    pub fn verify(
        &self,
        response: &Value,
        expected_fingerprint: Option<&str>,
        known_fingerprint: Option<&str>,
    ) -> Result<VerifiedDaemonIdentity, IdentityError> {
        use IdentityErrorCode::*;
        let proof: ProofResponse = serde_json::from_value(response.clone()).map_err(|_| {
            IdentityError::new(
                Unreachable,
                "The identity check answer was not understood",
                None,
            )
        })?;
        // Recompute: the fingerprint is a hash of the key, never trust the daemon's own.
        let actual =
            crypto::daemon_key_fingerprint(&proof.daemon_public_key_b64).map_err(|_| {
                IdentityError::new(
                    ProofInvalid,
                    "The daemon sent an unreadable public key",
                    None,
                )
            })?;
        if let Some(fp) = expected_fingerprint {
            if !crypto::fingerprints_match(&actual, fp) {
                return Err(IdentityError::new(
                    FingerprintMismatch,
                    "This daemon's key does not match the pairing link",
                    Some(&actual),
                ));
            }
        }
        if let Some(fp) = known_fingerprint {
            if !crypto::fingerprints_match(&actual, fp) {
                return Err(IdentityError::new(
                    ServerKeyChanged,
                    "This host is already known under a different key",
                    Some(&actual),
                ));
            }
        }
        let invalid = || {
            IdentityError::new(
                ProofInvalid,
                "The daemon could not prove it holds its key",
                Some(&actual),
            )
        };
        let daemon_key =
            crypto::import_public_key(&proof.daemon_public_key_b64).map_err(|_| invalid())?;
        let shared = crypto::derive_shared_key(&self.keypair.secret_key, &daemon_key)
            .map_err(|_| invalid())?;
        let bundle = STANDARD.decode(&proof.proof_b64).map_err(|_| invalid())?;
        let opened = crypto::decrypt(&shared, &bundle).map_err(|_| invalid())?;
        if opened != self.challenge_b64.as_bytes() {
            return Err(IdentityError::new(
                ProofInvalid,
                "The daemon signed the wrong challenge",
                Some(&actual),
            ));
        }
        Ok(VerifiedDaemonIdentity {
            server_id: proof.server_id,
            fingerprint: actual,
            daemon_public_key_b64: proof.daemon_public_key_b64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::MemoryStorage;

    #[test]
    fn identity_persists() {
        let s = MemoryStorage::new();
        let a = DeviceIdentity::load_or_create(&s).unwrap();
        let b = DeviceIdentity::load_or_create(&s).unwrap();
        assert_eq!(a.client_id, b.client_id);
        assert_eq!(a.keypair.public_key, b.keypair.public_key);
        assert!(a.client_id.starts_with("cid_") && a.client_id.len() == 36);
        assert!(a.fingerprint().starts_with("sha256:"));
    }

    /// Plays the daemon side of `/api/identity/proof`.
    fn daemon_answer(
        ch: &IdentityChallenge,
        daemon: &KeyPair,
        challenge_override: Option<&str>,
    ) -> Value {
        let body = ch.request_body();
        let client_pub =
            crypto::import_public_key(body["clientPublicKeyB64"].as_str().unwrap()).unwrap();
        let shared = crypto::derive_shared_key(&daemon.secret_key, &client_pub).unwrap();
        let challenge = challenge_override.unwrap_or(body["challengeB64"].as_str().unwrap());
        let sealed = crypto::encrypt(&shared, challenge.as_bytes()).unwrap();
        json!({
            "serverId": "srv",
            "daemonPublicKeyB64": crypto::export_key(&daemon.public_key),
            "proofB64": STANDARD.encode(sealed),
        })
    }

    #[test]
    fn verifies_a_daemon_proof() {
        let daemon = KeyPair::generate().unwrap();
        let fp = crypto::daemon_key_fingerprint(&crypto::export_key(&daemon.public_key)).unwrap();
        let ch = IdentityChallenge::new().unwrap();
        let answer = daemon_answer(&ch, &daemon, None);
        let ok = ch.verify(&answer, Some(&fp), Some(&fp)).unwrap();
        assert_eq!(ok.server_id, "srv");
        assert_eq!(ok.fingerprint, fp);

        let err = ch.verify(&answer, Some("sha256:other"), None).unwrap_err();
        assert_eq!(err.code, IdentityErrorCode::FingerprintMismatch);
        let err = ch.verify(&answer, None, Some("sha256:other")).unwrap_err();
        assert_eq!(err.code, IdentityErrorCode::ServerKeyChanged);
        let wrong = daemon_answer(&ch, &daemon, Some("nope"));
        assert_eq!(
            ch.verify(&wrong, None, None).unwrap_err().code,
            IdentityErrorCode::ProofInvalid
        );
        assert_eq!(
            ch.verify(&json!({}), None, None).unwrap_err().code,
            IdentityErrorCode::Unreachable
        );
    }
}
