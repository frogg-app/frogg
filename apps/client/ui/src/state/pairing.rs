//! Pairing (ui-next `daemon/pairing.ts`): verify a pairing target's daemon, redeem it for a
//! device credential and save the host. Parsing and crypto live in the client core
//! (`pairing`, `identity`); the HTTP calls (`/api/identity`, `/api/identity/proof`,
//! `/api/setup/claim`) are made here with `fetch`.

use frogg_client_core::crypto::daemon_key_fingerprint;
use frogg_client_core::identity::{
    identity_proof_url, IdentityChallenge, IdentityErrorCode, VerifiedDaemonIdentity,
};
use frogg_client_core::pairing::{
    claim_request_body, daemon_http_base, normalize_host_port, parse_pair_input, ConnectionOffer,
    DirectPairingLink, PairTarget,
};
use leptos::prelude::*;
use serde_json::Value;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

use super::hosts::{Host, Hosts, Relay};

pub use frogg_client_core::pairing::{describe_pair_target, short_fingerprint, PairDetails};

/// Outcome of checking a target's daemon before pairing.
#[derive(Debug, Clone, PartialEq)]
pub enum Verify {
    Verified(Option<VerifiedDaemonIdentity>),
    /// Could not check (offline, old daemon); pairing may still go ahead.
    Unverified(String),
    /// The daemon is not who the link says: do not pair.
    Refused(String),
}

pub fn parse(input: &str, endpoint: Option<&str>, tls: bool) -> Option<PairTarget> {
    parse_pair_input(input, endpoint, tls)
}

fn device_label() -> String {
    format!("Frogg Next RS on {:?}", crate::native::platform())
}

// ---- fetch ------------------------------------------------------------------------------------

struct HttpReply {
    status: u16,
    body: Value,
}

async fn http(url: &str, body: Option<&Value>) -> Result<HttpReply, String> {
    let window = web_sys::window().ok_or("no window")?;
    let init = web_sys::RequestInit::new();
    if let Some(body) = body {
        init.set_method("POST");
        let headers = web_sys::Headers::new().map_err(|e| format!("{e:?}"))?;
        let _ = headers.set("Content-Type", "application/json");
        init.set_headers(&headers);
        init.set_body(&wasm_bindgen::JsValue::from_str(&body.to_string()));
    }
    let request =
        web_sys::Request::new_with_str_and_init(url, &init).map_err(|e| format!("{e:?}"))?;
    let response: web_sys::Response = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|_| "did not answer".to_owned())?
        .dyn_into()
        .map_err(|_| "bad response".to_owned())?;
    let status = response.status();
    let text = match response.text() {
        Ok(p) => JsFuture::from(p)
            .await
            .ok()
            .and_then(|t| t.as_string())
            .unwrap_or_default(),
        Err(_) => String::new(),
    };
    Ok(HttpReply {
        status,
        body: serde_json::from_str(&text).unwrap_or(Value::Null),
    })
}

struct Identity {
    endpoint: String,
    server_id: Option<String>,
    hostname: Option<String>,
}

/// The server id a daemon reports at `/api/identity` over the given scheme, if it answers.
pub async fn fetch_server_id(endpoint: &str, tls: bool) -> Option<String> {
    identity(endpoint, tls).await?.server_id
}

async fn identity(endpoint: &str, tls: bool) -> Option<Identity> {
    let base = daemon_http_base(endpoint, tls).ok()?;
    let reply = http(&format!("{base}/api/identity"), None).await.ok()?;
    if !(200..300).contains(&reply.status) {
        return None;
    }
    let text = |k: &str| reply.body.get(k).and_then(Value::as_str).map(str::to_owned);
    Some(Identity {
        endpoint: endpoint.to_owned(),
        server_id: text("serverId"),
        hostname: text("hostname"),
    })
}

struct Claimed {
    credential: String,
    server_id: Option<String>,
    role: Option<String>,
}

async fn claim(
    endpoint: &str,
    tls: bool,
    token: Option<&str>,
    pairing_code: Option<&str>,
    as_owner: bool,
) -> Result<Claimed, String> {
    let base = daemon_http_base(endpoint, tls)?;
    let body = claim_request_body(token, pairing_code, as_owner, &device_label());
    let reply = http(&format!("{base}/api/setup/claim"), Some(&body))
        .await
        .map_err(|_| format!("{endpoint} did not answer"))?;
    if reply.status == 403 {
        return Err("The pairing code was already used or has expired".into());
    }
    let text = |k: &str| reply.body.get(k).and_then(Value::as_str).map(str::to_owned);
    if !(200..300).contains(&reply.status) {
        return Err(
            text("error").unwrap_or_else(|| format!("Pairing failed (HTTP {})", reply.status))
        );
    }
    let credential = text("credential").ok_or("The daemon returned no credential")?;
    Ok(Claimed {
        credential,
        server_id: text("serverId"),
        role: text("role")
            .filter(|r| frogg_client_core::pairing::DEVICE_ROLES.contains(&r.as_str())),
    })
}

// ---- verify -----------------------------------------------------------------------------------

async fn prove(endpoint: &str, tls: bool, expected: Option<&str>, known: Option<&str>) -> Verify {
    let challenge = match IdentityChallenge::new() {
        Ok(c) => c,
        Err(e) => return Verify::Unverified(e.message),
    };
    let reply = match http(
        &identity_proof_url(endpoint, tls),
        Some(&challenge.request_body()),
    )
    .await
    {
        Ok(r) if (200..300).contains(&r.status) => r,
        Ok(r) => return Verify::Unverified(format!("identity check failed (HTTP {})", r.status)),
        Err(e) => return Verify::Unverified(format!("{endpoint} {e}")),
    };
    match challenge.verify(&reply.body, expected, known) {
        Ok(id) => Verify::Verified(Some(id)),
        Err(e) => match e.code {
            IdentityErrorCode::FingerprintMismatch
            | IdentityErrorCode::ProofInvalid
            | IdentityErrorCode::ServerKeyChanged => Verify::Refused(e.message),
            _ => Verify::Unverified(e.message),
        },
    }
}

fn known_fingerprint(hosts: &Hosts, server_id: Option<&str>) -> Option<String> {
    let sid = server_id?;
    hosts.hosts.with_untracked(|hs| {
        hs.iter()
            .find(|h| h.server_id.as_deref() == Some(sid))
            .and_then(|h| h.fingerprint.clone())
    })
}

/// Proves the daemon holds the key the target names, where the target lets us check.
pub async fn verify(hosts: Hosts, t: &PairTarget) -> Verify {
    match t {
        PairTarget::Direct { link, .. } => {
            let known = known_fingerprint(&hosts, link.server_id.as_deref());
            prove(
                &link.endpoint(),
                link.use_tls,
                Some(&link.fingerprint),
                known.as_deref(),
            )
            .await
        }
        PairTarget::Code {
            endpoint: Some(e),
            tls,
            ..
        } => prove(e, *tls, None, None).await,
        // Offers carry the key; the relay's E2EE handshake (v2) or the identity probe (v3) proves it.
        _ => Verify::Verified(None),
    }
}

// ---- redeem -----------------------------------------------------------------------------------

/// Pairs and saves the host; the caller connects. `as_owner` claims a bare code target.
pub async fn pair(
    hosts: Hosts,
    t: &PairTarget,
    as_owner: bool,
    verified: Option<VerifiedDaemonIdentity>,
) -> Result<Host, String> {
    match t {
        PairTarget::Offer { offer, .. } => pair_offer(hosts, offer).await,
        PairTarget::Direct { link, .. } => pair_direct(hosts, link, verified).await,
        PairTarget::Code {
            code,
            endpoint,
            tls,
        } => {
            let endpoint = endpoint
                .as_deref()
                .ok_or("Enter the host's address to use a code")?;
            let endpoint = normalize_host_port(endpoint)?;
            let c = if as_owner {
                claim(&endpoint, *tls, None, None, true).await?
            } else {
                claim(&endpoint, *tls, None, Some(code), false).await?
            };
            let id = identity(&endpoint, *tls).await;
            let mut host = Host::new(
                id.as_ref()
                    .and_then(|i| i.hostname.clone())
                    .unwrap_or_else(|| endpoint.split(':').next().unwrap_or("host").to_owned()),
                endpoint,
            );
            host.tls = Some(*tls);
            host.password = Some(c.credential);
            host.server_id = c.server_id.or(id.and_then(|i| i.server_id));
            host.fingerprint = verified.map(|v| v.fingerprint);
            host.role = c.role;
            Ok(hosts.upsert(host))
        }
    }
}

async fn pair_offer(hosts: Hosts, offer: &ConnectionOffer) -> Result<Host, String> {
    match offer {
        ConnectionOffer::V2(o) => {
            let mut host = Host::new(o.server_id.clone(), normalize_host_port(&o.relay.endpoint)?);
            host.tls = o.relay.use_tls;
            host.server_id = Some(o.server_id.clone());
            host.relay = Some(Relay {
                daemon_public_key_b64: o.daemon_public_key_b64.clone(),
            });
            host.fingerprint = daemon_key_fingerprint(&o.daemon_public_key_b64).ok();
            Ok(hosts.upsert(host))
        }
        ConnectionOffer::V3(o) => {
            let expires = js_sys::Date::parse(&o.claim.expires_at);
            if !expires.is_nan() && expires <= js_sys::Date::now() {
                return Err("This offer has expired".into());
            }
            let tls = o.direct.use_tls.unwrap_or(false);
            let probes =
                futures::future::join_all(o.direct.endpoints.iter().map(|e| identity(e, tls)))
                    .await;
            let hit = probes
                .iter()
                .flatten()
                .find(|p| p.server_id.as_deref() == Some(o.server_id.as_str()));
            let Some(hit) = hit else {
                return Err(
                    match probes.iter().flatten().find(|p| p.server_id.is_some()) {
                        Some(other) => format!(
                            "{} answered as {}, not {}",
                            other.endpoint,
                            other.server_id.as_deref().unwrap_or_default(),
                            o.server_id
                        ),
                        None => format!(
                            "None of the host's addresses answered: {}",
                            o.direct.endpoints.join(", ")
                        ),
                    },
                );
            };
            let c = claim(&hit.endpoint, tls, Some(&o.claim.token), None, false).await?;
            if c.server_id.as_deref().is_some_and(|s| s != o.server_id) {
                return Err("A different daemon answered".into());
            }
            let mut host = Host::new(
                hit.hostname
                    .clone()
                    .or_else(|| o.hostname.clone())
                    .unwrap_or_else(|| o.server_id.clone()),
                normalize_host_port(&hit.endpoint)?,
            );
            host.tls = Some(tls);
            host.password = Some(c.credential);
            host.server_id = Some(o.server_id.clone());
            host.fingerprint = daemon_key_fingerprint(&o.daemon_public_key_b64).ok();
            host.role = c.role;
            Ok(hosts.upsert(host))
        }
    }
}

async fn pair_direct(
    hosts: Hosts,
    l: &DirectPairingLink,
    verified: Option<VerifiedDaemonIdentity>,
) -> Result<Host, String> {
    let endpoint = normalize_host_port(&l.endpoint())?;
    let c = match &l.pairing_code {
        Some(code) => claim(&endpoint, l.use_tls, None, Some(code), false).await?,
        None => claim(&endpoint, l.use_tls, None, None, true).await?,
    };
    if let (Some(a), Some(b)) = (&l.server_id, &c.server_id) {
        if a != b {
            return Err("A different daemon answered".into());
        }
    }
    let mut host = Host::new(l.label.clone().unwrap_or_else(|| l.host.clone()), endpoint);
    host.tls = Some(l.use_tls);
    host.password = Some(c.credential);
    host.server_id = c.server_id.or_else(|| l.server_id.clone());
    host.fingerprint = Some(
        verified
            .map(|v| v.fingerprint)
            .unwrap_or_else(|| l.fingerprint.clone()),
    );
    host.role = c.role;
    Ok(hosts.upsert(host))
}
