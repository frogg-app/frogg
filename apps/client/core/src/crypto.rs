//! Relay E2EE primitives, byte-compatible with `packages/relay/src/crypto.ts` (tweetnacl).
//!
//! - Key exchange: X25519, then HSalsa20 over the shared point (`nacl.box.before`).
//! - Encryption: XSalsa20-Poly1305 (`nacl.box.after` / `nacl.box.open.after`).
//! - Bundle: `[nonce (24)] [ciphertext (16-byte tag ‖ body)]`.

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use sha2::{Digest, Sha256};
use xsalsa20poly1305::aead::{Aead, KeyInit};
use xsalsa20poly1305::XSalsa20Poly1305;

pub const KEY_LENGTH: usize = 32;
pub const NONCE_LENGTH: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CryptoError {
    #[error("Invalid public key encoding")]
    InvalidEncoding,
    #[error("Invalid key length (expected 32)")]
    InvalidLength,
    #[error("Invalid peer public key")]
    InvalidPeerKey,
    #[error("Ciphertext bundle too short")]
    TooShort,
    #[error("Decryption failed")]
    DecryptFailed,
    #[error("No secure random source: {0}")]
    Random(String),
}

#[derive(Clone)]
pub struct KeyPair {
    pub public_key: [u8; 32],
    pub secret_key: [u8; 32],
}

impl std::fmt::Debug for KeyPair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KeyPair")
            .field("public_key", &export_key(&self.public_key))
            .finish_non_exhaustive()
    }
}

/// `nacl.box.before` output.
#[derive(Clone, PartialEq, Eq)]
pub struct SharedKey(pub [u8; 32]);

impl std::fmt::Debug for SharedKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SharedKey(..)")
    }
}

pub fn random_bytes<const N: usize>() -> Result<[u8; N], CryptoError> {
    let mut out = [0u8; N];
    getrandom::getrandom(&mut out).map_err(|e| CryptoError::Random(e.to_string()))?;
    Ok(out)
}

impl KeyPair {
    pub fn generate() -> Result<Self, CryptoError> {
        Ok(Self::from_secret(random_bytes::<32>()?))
    }

    /// `nacl.box.keyPair.fromSecretKey`.
    pub fn from_secret(secret_key: [u8; 32]) -> Self {
        let secret = x25519_dalek::StaticSecret::from(secret_key);
        let public = x25519_dalek::PublicKey::from(&secret);
        Self {
            public_key: public.to_bytes(),
            secret_key,
        }
    }
}

pub fn export_key(key: &[u8; 32]) -> String {
    STANDARD.encode(key)
}

/// Strict standard base64 (canonical, padded), as `importPublicKey` requires.
pub fn import_public_key(b64: &str) -> Result<[u8; 32], CryptoError> {
    if b64.len() % 4 != 0 {
        return Err(CryptoError::InvalidEncoding);
    }
    let bytes = STANDARD
        .decode(b64)
        .map_err(|_| CryptoError::InvalidEncoding)?;
    if STANDARD.encode(&bytes) != b64 {
        return Err(CryptoError::InvalidEncoding);
    }
    bytes.try_into().map_err(|_| CryptoError::InvalidLength)
}

pub fn import_secret_key(b64: &str) -> Result<[u8; 32], CryptoError> {
    let bytes = STANDARD
        .decode(b64.trim())
        .map_err(|_| CryptoError::InvalidEncoding)?;
    bytes.try_into().map_err(|_| CryptoError::InvalidLength)
}

/// `nacl.box.before(peerPublic, ourSecret)`, refusing low-order peer keys like the TS port.
pub fn derive_shared_key(
    our_secret: &[u8; 32],
    peer_public: &[u8; 32],
) -> Result<SharedKey, CryptoError> {
    let secret = x25519_dalek::StaticSecret::from(*our_secret);
    let point = secret.diffie_hellman(&x25519_dalek::PublicKey::from(*peer_public));
    if !point.was_contributory() {
        return Err(CryptoError::InvalidPeerKey);
    }
    let key =
        salsa20::hsalsa::<salsa20::cipher::consts::U10>(point.as_bytes().into(), &[0u8; 16].into());
    Ok(SharedKey(key.into()))
}

pub fn encrypt_with_nonce(
    key: &SharedKey,
    nonce: &[u8; NONCE_LENGTH],
    plaintext: &[u8],
) -> Vec<u8> {
    let cipher = XSalsa20Poly1305::new((&key.0).into());
    let ct = cipher
        .encrypt(nonce.into(), plaintext)
        .expect("xsalsa20poly1305 encryption is infallible for in-memory buffers");
    let mut out = Vec::with_capacity(NONCE_LENGTH + ct.len());
    out.extend_from_slice(nonce);
    out.extend_from_slice(&ct);
    out
}

/// Encrypts with a fresh random nonce and returns the bundle.
pub fn encrypt(key: &SharedKey, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    Ok(encrypt_with_nonce(key, &random_bytes()?, plaintext))
}

pub fn decrypt(key: &SharedKey, bundle: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if bundle.len() < NONCE_LENGTH {
        return Err(CryptoError::TooShort);
    }
    let (nonce, ct) = bundle.split_at(NONCE_LENGTH);
    XSalsa20Poly1305::new((&key.0).into())
        .decrypt(nonce.into(), ct)
        .map_err(|_| CryptoError::DecryptFailed)
}

pub const FINGERPRINT_PREFIX: &str = "sha256:";

/// `daemonKeyFingerprint`: `sha256:` + url-safe unpadded base64 of SHA-256 over the key bytes.
/// Accepts standard or url-safe base64 input.
pub fn daemon_key_fingerprint(public_key_b64: &str) -> Result<String, CryptoError> {
    let normalized: String = public_key_b64
        .trim()
        .chars()
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            c => c,
        })
        .filter(|c| *c != '=')
        .collect();
    let bytes = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(normalized)
        .map_err(|_| CryptoError::InvalidEncoding)?;
    Ok(format!(
        "{FINGERPRINT_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(Sha256::digest(&bytes))
    ))
}

/// `fingerprintsMatch`: compares with or without the `sha256:` prefix.
pub fn fingerprints_match(a: &str, b: &str) -> bool {
    let strip = |v: &str| v.trim().trim_start_matches(FINGERPRINT_PREFIX).to_owned();
    let (a, b) = (strip(a), strip(b));
    !a.is_empty() && a == b
}

/// `formatFingerprint`: body in groups of four, space separated.
pub fn format_fingerprint(fingerprint: &str) -> String {
    let body = fingerprint
        .strip_prefix(FINGERPRINT_PREFIX)
        .unwrap_or(fingerprint);
    body.chars()
        .collect::<Vec<_>>()
        .chunks(4)
        .map(|c| c.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Sealed {
        plaintext: String,
        bundle_b64: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        a_secret_b64: String,
        a_public_b64: String,
        b_secret_b64: String,
        b_public_b64: String,
        shared_b64: String,
        fingerprint: String,
        sealed: Vec<Sealed>,
    }
    #[derive(Deserialize)]
    struct Vectors {
        cases: Vec<Case>,
    }

    fn vectors() -> Vectors {
        serde_json::from_str(include_str!("../tests/vectors/relay-crypto.json")).unwrap()
    }

    #[test]
    fn matches_tweetnacl_vectors() {
        for case in vectors().cases {
            let a = KeyPair::from_secret(import_secret_key(&case.a_secret_b64).unwrap());
            let b = KeyPair::from_secret(import_secret_key(&case.b_secret_b64).unwrap());
            assert_eq!(export_key(&a.public_key), case.a_public_b64);
            assert_eq!(export_key(&b.public_key), case.b_public_b64);
            let shared = derive_shared_key(&a.secret_key, &b.public_key).unwrap();
            assert_eq!(STANDARD.encode(shared.0), case.shared_b64);
            // Both sides agree.
            assert_eq!(
                derive_shared_key(&b.secret_key, &a.public_key).unwrap(),
                shared
            );
            assert_eq!(
                daemon_key_fingerprint(&case.a_public_b64).unwrap(),
                case.fingerprint
            );
            for s in case.sealed {
                let bundle = STANDARD.decode(&s.bundle_b64).unwrap();
                let opened = decrypt(&shared, &bundle).unwrap();
                assert_eq!(String::from_utf8(opened).unwrap(), s.plaintext);
                let nonce: [u8; 24] = bundle[..24].try_into().unwrap();
                assert_eq!(
                    encrypt_with_nonce(&shared, &nonce, s.plaintext.as_bytes()),
                    bundle
                );
            }
        }
    }

    #[test]
    fn round_trip_and_tamper() {
        let a = KeyPair::generate().unwrap();
        let b = KeyPair::generate().unwrap();
        let k = derive_shared_key(&a.secret_key, &b.public_key).unwrap();
        let mut bundle = encrypt(&k, b"hello").unwrap();
        assert_eq!(decrypt(&k, &bundle).unwrap(), b"hello");
        let last = bundle.len() - 1;
        bundle[last] ^= 1;
        assert_eq!(decrypt(&k, &bundle), Err(CryptoError::DecryptFailed));
        assert_eq!(decrypt(&k, &[0; 10]), Err(CryptoError::TooShort));
    }

    #[test]
    fn rejects_bad_keys() {
        assert_eq!(
            import_public_key("not base64!"),
            Err(CryptoError::InvalidEncoding)
        );
        assert_eq!(import_public_key("AAAA"), Err(CryptoError::InvalidLength));
        let a = KeyPair::generate().unwrap();
        assert_eq!(
            derive_shared_key(&a.secret_key, &[0u8; 32]),
            Err(CryptoError::InvalidPeerKey)
        );
    }

    #[test]
    fn fingerprint_helpers() {
        assert!(fingerprints_match("sha256:abcd", "abcd"));
        assert!(!fingerprints_match("sha256:", ""));
        assert_eq!(format_fingerprint("sha256:abcdefghij"), "abcd efgh ij");
    }
}
