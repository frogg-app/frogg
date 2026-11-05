//! Pairing inputs and endpoints: ports of `apps/ui-next/src/daemon/pairing.ts` (parsing and
//! describing), `@frogg/protocol` `connection-offer.ts`, `device-access.ts` (codes, direct
//! links) and `daemon-endpoints.ts` (host:port, URLs). Nothing here touches the network.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::crypto::{daemon_key_fingerprint, FINGERPRINT_PREFIX};
use crate::util::{encode_query_value, parse_query, query_get};

// ---- endpoints ------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostPort {
    pub host: String,
    pub port: u16,
    pub is_ipv6: bool,
}

fn parse_port(s: &str) -> Result<u16, String> {
    match s.parse::<u32>() {
        Ok(p) if (1..=65535).contains(&p) && s.len() <= 5 => Ok(p as u16),
        _ => Err("Invalid host:port: port must be between 1 and 65535".into()),
    }
}

/// `localhost:9999` or `[::1]:9999`.
pub fn parse_host_port(input: &str) -> Result<HostPort, String> {
    let t = input.trim();
    if t.is_empty() {
        return Err("Host is required".into());
    }
    if let Some(rest) = t.strip_prefix('[') {
        let (host, port) = rest
            .split_once("]:")
            .ok_or("Invalid host:port (expected [::1]:9999)")?;
        let host = host.trim();
        if host.is_empty() || host.contains(']') {
            return Err("Invalid host:port (expected [::1]:9999)".into());
        }
        return Ok(HostPort {
            host: host.into(),
            port: parse_port(port)?,
            is_ipv6: true,
        });
    }
    let (host, port) = t
        .rsplit_once(':')
        .filter(|(_, p)| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        .ok_or("Invalid host:port (expected localhost:9999)")?;
    let host = host.trim();
    if host.is_empty() {
        return Err("Host is required".into());
    }
    Ok(HostPort {
        host: host.into(),
        port: parse_port(port)?,
        is_ipv6: false,
    })
}

pub fn normalize_host_port(input: &str) -> Result<String, String> {
    let HostPort {
        host,
        port,
        is_ipv6,
    } = parse_host_port(input)?;
    Ok(if is_ipv6 {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    })
}

/// `ws(s)://host:port/ws`.
pub fn daemon_ws_url(endpoint: &str, use_tls: bool) -> Result<String, String> {
    Ok(format!(
        "{}://{}/ws",
        if use_tls { "wss" } else { "ws" },
        normalize_host_port(endpoint)?
    ))
}

/// `http(s)://host:port`.
pub fn daemon_http_base(endpoint: &str, use_tls: bool) -> Result<String, String> {
    Ok(format!(
        "{}://{}",
        if use_tls { "https" } else { "http" },
        normalize_host_port(endpoint)?
    ))
}

// ---- pairing codes --------------------------------------------------------------------------

/// Crockford base32, no I L O U.
pub const PAIRING_CODE_ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub const PAIRING_CODE_LENGTH: usize = 8;

/// Uppercases, strips spaces/dashes and maps I/L→1, O→0. `None` if not a code.
pub fn normalize_pairing_code(input: &str) -> Option<String> {
    let cleaned: String = input
        .trim()
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c {
            'I' | 'L' => '1',
            'O' => '0',
            c => c,
        })
        .collect();
    (cleaned.chars().count() == PAIRING_CODE_LENGTH
        && cleaned.chars().all(|c| PAIRING_CODE_ALPHABET.contains(c)))
    .then_some(cleaned)
}

/// `XXXX-XXXX`.
pub fn format_pairing_code(code: &str) -> String {
    let n = normalize_pairing_code(code).unwrap_or_else(|| code.to_owned());
    let split = n.char_indices().nth(4).map_or(n.len(), |(i, _)| i);
    format!("{}-{}", &n[..split], &n[split..])
}

// ---- connection offers ----------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayEndpoint {
    pub endpoint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_tls: Option<bool>,
}

/// Relay-only offer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionOfferV2 {
    pub server_id: String,
    pub daemon_public_key_b64: String,
    pub relay: RelayEndpoint,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectEndpoints {
    pub endpoints: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_tls: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimToken {
    pub token: String,
    pub expires_at: String,
}

/// Direct (LAN) claim offer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionOfferV3 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
    pub server_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    pub daemon_public_key_b64: String,
    pub direct: DirectEndpoints,
    pub claim: ClaimToken,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay: Option<RelayEndpoint>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionOffer {
    V2(ConnectionOfferV2),
    V3(ConnectionOfferV3),
}

impl ConnectionOffer {
    pub fn server_id(&self) -> &str {
        match self {
            Self::V2(o) => &o.server_id,
            Self::V3(o) => &o.server_id,
        }
    }
    pub fn daemon_public_key_b64(&self) -> &str {
        match self {
            Self::V2(o) => &o.daemon_public_key_b64,
            Self::V3(o) => &o.daemon_public_key_b64,
        }
    }
}

fn nonempty(s: &str) -> bool {
    !s.is_empty()
}

fn validate_offer(value: serde_json::Value) -> Result<ConnectionOffer, String> {
    let v = value.get("v").and_then(serde_json::Value::as_i64);
    let offer = match v {
        Some(2) => ConnectionOffer::V2(serde_json::from_value(value).map_err(|e| e.to_string())?),
        Some(3) => {
            if value.get("product").is_some_and(|p| p != "frogg") {
                return Err("Unknown offer product".into());
            }
            ConnectionOffer::V3(serde_json::from_value(value).map_err(|e| e.to_string())?)
        }
        _ => return Err("Unsupported offer version".into()),
    };
    let ok = match &offer {
        ConnectionOffer::V2(o) => {
            nonempty(&o.server_id)
                && nonempty(&o.daemon_public_key_b64)
                && nonempty(&o.relay.endpoint)
        }
        ConnectionOffer::V3(o) => {
            nonempty(&o.server_id)
                && nonempty(&o.daemon_public_key_b64)
                && !o.direct.endpoints.is_empty()
                && o.direct.endpoints.iter().all(|e| nonempty(e))
                && nonempty(&o.claim.token)
                && nonempty(&o.claim.expires_at)
                && o.relay.as_ref().is_none_or(|r| nonempty(&r.endpoint))
        }
    };
    ok.then_some(offer).ok_or_else(|| "Invalid offer".into())
}

const OFFER_FRAGMENT_PREFIX: &str = "#offer=";
const PAIRING_CODE_PATH: &str = "/code/";
pub const DEFAULT_PAIRING_BASE_URL: &str = "https://pair.frogg.app";

/// The encoded offer from `…/code/<code>`, `…#offer=<code>` or `…?code=<code>`.
pub fn extract_pairing_code(input: &str) -> Option<String> {
    let t = input.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(i) = t.find(OFFER_FRAGMENT_PREFIX) {
        let enc = t[i + OFFER_FRAGMENT_PREFIX.len()..].trim();
        if !enc.is_empty() {
            return Some(enc.to_owned());
        }
    }
    if let Some(q) = t.find('?') {
        let rest = &t[q + 1..];
        let query = rest.split('#').next().unwrap_or_default();
        let params = parse_query(query);
        if let Some(code) = query_get(&params, "code")
            .map(str::trim)
            .filter(|c| !c.is_empty())
        {
            return Some(code.to_owned());
        }
    }
    let base = t.split('#').next().unwrap_or_default();
    let base = base.split('?').next().unwrap_or_default();
    let i = base.rfind(PAIRING_CODE_PATH)?;
    let code = base[i + PAIRING_CODE_PATH.len()..]
        .trim_end_matches('/')
        .trim();
    (!code.is_empty()
        && code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
    .then(|| code.to_owned())
}

pub fn decode_offer_payload(encoded: &str) -> Result<serde_json::Value, String> {
    let normalized: String = encoded
        .trim()
        .chars()
        .map(|c| match c {
            '+' => '-',
            '/' => '_',
            c => c,
        })
        .filter(|c| *c != '=')
        .collect();
    let bytes = URL_SAFE_NO_PAD
        .decode(normalized)
        .map_err(|_| "Invalid offer encoding".to_owned())?;
    let text = String::from_utf8(bytes).map_err(|_| "Invalid offer encoding".to_owned())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub fn encode_offer_payload(offer: &ConnectionOffer) -> String {
    let mut v = match offer {
        ConnectionOffer::V2(o) => serde_json::to_value(o),
        ConnectionOffer::V3(o) => serde_json::to_value(o),
    }
    .unwrap_or_default();
    v["v"] = match offer {
        ConnectionOffer::V2(_) => 2,
        ConnectionOffer::V3(_) => 3,
    }
    .into();
    URL_SAFE_NO_PAD.encode(v.to_string())
}

/// `Ok(None)` when the input carries no pairing code; `Err` when it carries a malformed one.
pub fn parse_connection_offer(input: &str) -> Result<Option<ConnectionOffer>, String> {
    let Some(encoded) = extract_pairing_code(input) else {
        return Ok(None);
    };
    validate_offer(decode_offer_payload(&encoded)?).map(Some)
}

// ---- direct pairing links -------------------------------------------------------------------

pub const DEVICE_ROLES: [&str; 3] = ["owner", "operator", "viewer"];

/// `<scheme>://pair/direct?v=1&host=&port=&fp=[&pairingCode=][&claim=1][&tls=1][&sid=][&name=][&role=]`
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DirectPairingLink {
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    pub pairing_code: Option<String>,
    pub claim: bool,
    pub use_tls: bool,
    pub server_id: Option<String>,
    pub label: Option<String>,
    pub role: Option<String>,
}

impl DirectPairingLink {
    /// `host:port`, bracketing IPv6.
    pub fn endpoint(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }

    pub fn to_url(&self, scheme: &str) -> String {
        let mut q = vec![
            ("v", "1".to_owned()),
            ("host", self.host.clone()),
            ("port", self.port.to_string()),
            ("fp", self.fingerprint.clone()),
        ];
        if let Some(c) = &self.pairing_code {
            q.push(("pairingCode", format_pairing_code(c)));
        }
        if self.claim {
            q.push(("claim", "1".into()));
        }
        if self.use_tls {
            q.push(("tls", "1".into()));
        }
        if let Some(s) = &self.server_id {
            q.push(("sid", s.clone()));
        }
        if let Some(n) = &self.label {
            q.push(("name", n.clone()));
        }
        if let Some(r) = &self.role {
            q.push(("role", r.clone()));
        }
        let query: Vec<String> = q
            .into_iter()
            .map(|(k, v)| format!("{k}={}", encode_query_value(&v)))
            .collect();
        format!("{scheme}://pair/direct?{}", query.join("&"))
    }
}

pub fn parse_direct_pairing_link(input: &str, scheme: &str) -> Option<DirectPairingLink> {
    let prefix = format!("{scheme}://pair/direct?");
    let rest = input.trim().strip_prefix(&prefix)?;
    let params = parse_query(rest.split('#').next().unwrap_or_default());
    let get = |k: &str| query_get(&params, k).filter(|v| !v.is_empty());
    let flag = |k: &str| matches!(query_get(&params, k), Some("1") | Some("true"));
    if get("v")?.parse::<f64>().ok()? != 1.0 {
        return None;
    }
    let host = get("host")?.to_owned();
    let port = get("port")?
        .parse::<u32>()
        .ok()
        .filter(|p| (1..=65535).contains(p))? as u16;
    let fingerprint = get("fp")?.to_owned();
    if !fingerprint.starts_with(FINGERPRINT_PREFIX) {
        return None;
    }
    let pairing_code = match get("pairingCode") {
        Some(raw) => Some(normalize_pairing_code(raw)?),
        None => None,
    };
    let role = get("role").map(str::to_owned);
    if role.as_deref().is_some_and(|r| !DEVICE_ROLES.contains(&r)) {
        return None;
    }
    Some(DirectPairingLink {
        host,
        port,
        fingerprint,
        pairing_code,
        claim: flag("claim"),
        use_tls: flag("tls"),
        server_id: get("sid").or_else(|| get("serverId")).map(str::to_owned),
        label: get("name").map(str::to_owned),
        role,
    })
}

// ---- pair targets (ui-next pairing.ts) ------------------------------------------------------

/// Schemes this app pairs from: its own, the stable app's, Frogg Next's and `frogg-beta`.
pub const PAIR_SCHEMES: [&str; 4] = ["frogg-next-rs", "frogg", "frogg-next", "frogg-beta"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairTarget {
    Offer {
        offer: ConnectionOffer,
        raw: String,
    },
    Direct {
        link: DirectPairingLink,
        raw: String,
    },
    Code {
        code: String,
        endpoint: Option<String>,
        tls: bool,
    },
}

/// Whatever the user pasted or a deep link carried; `None` when it is not a pairing input.
pub fn parse_pair_input(input: &str, endpoint: Option<&str>, tls: bool) -> Option<PairTarget> {
    let raw = input.trim();
    if raw.is_empty() {
        return None;
    }
    for scheme in PAIR_SCHEMES {
        if let Some(link) = parse_direct_pairing_link(raw, scheme) {
            return Some(PairTarget::Direct {
                link,
                raw: raw.into(),
            });
        }
    }
    let rewritten = PAIR_SCHEMES
        .iter()
        .filter(|s| **s != "frogg")
        .find_map(|s| {
            raw.strip_prefix(&format!("{s}:"))
                .map(|r| format!("frogg:{r}"))
        })
        .unwrap_or_else(|| raw.to_owned());
    match parse_connection_offer(&rewritten) {
        Ok(Some(offer)) => {
            return Some(PairTarget::Offer {
                offer,
                raw: raw.into(),
            })
        }
        Ok(None) => {}
        Err(_) => return None,
    }
    let code = normalize_pairing_code(raw)?;
    Some(PairTarget::Code {
        code,
        endpoint: endpoint
            .map(str::trim)
            .filter(|e| !e.is_empty())
            .map(str::to_owned),
        tls,
    })
}

/// True for URLs this app should treat as pairing links.
pub fn is_pair_url(url: &str) -> bool {
    PAIR_SCHEMES
        .iter()
        .any(|s| url.starts_with(&format!("{s}://pair")))
        || url.contains("#offer=")
        || url.find("/code/").is_some_and(|i| {
            url[i + 6..]
                .chars()
                .next()
                .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-')
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairDetails {
    /// What the device will connect to, e.g. `relay.frogg.dev:443 → devbox`.
    pub address: String,
    pub name: String,
    pub fingerprint: Option<String>,
    pub role: Option<String>,
    pub expires_at: Option<String>,
    pub server_id: Option<String>,
    /// A claim (first owner) rather than joining with a role.
    pub claim: bool,
    /// The target can be claimed instead of paired.
    pub can_claim: bool,
    pub relay: bool,
}

pub fn describe_pair_target(t: &PairTarget) -> PairDetails {
    match t {
        PairTarget::Offer {
            offer: ConnectionOffer::V2(o),
            ..
        } => PairDetails {
            address: format!("{} → {}", o.relay.endpoint, o.server_id),
            name: o.server_id.clone(),
            fingerprint: daemon_key_fingerprint(&o.daemon_public_key_b64).ok(),
            role: None,
            expires_at: None,
            server_id: Some(o.server_id.clone()),
            claim: false,
            can_claim: false,
            relay: true,
        },
        PairTarget::Offer {
            offer: ConnectionOffer::V3(o),
            ..
        } => PairDetails {
            address: o.direct.endpoints.first().cloned().unwrap_or_default(),
            name: o.hostname.clone().unwrap_or_else(|| o.server_id.clone()),
            fingerprint: daemon_key_fingerprint(&o.daemon_public_key_b64).ok(),
            role: Some("owner".into()),
            expires_at: Some(o.claim.expires_at.clone()),
            server_id: Some(o.server_id.clone()),
            claim: true,
            can_claim: false,
            relay: false,
        },
        PairTarget::Direct { link: l, .. } => PairDetails {
            address: format!("{}:{}", l.host, l.port),
            name: l.label.clone().unwrap_or_else(|| l.host.clone()),
            fingerprint: Some(l.fingerprint.clone()),
            role: l.role.clone().or_else(|| l.claim.then(|| "owner".into())),
            expires_at: None,
            server_id: l.server_id.clone(),
            claim: l.claim && l.pairing_code.is_none(),
            can_claim: false,
            relay: false,
        },
        PairTarget::Code { endpoint, .. } => PairDetails {
            address: endpoint.clone().unwrap_or_default(),
            name: endpoint
                .as_deref()
                .and_then(|e| e.split(':').next())
                .unwrap_or("host")
                .to_owned(),
            fingerprint: None,
            role: None,
            expires_at: None,
            server_id: None,
            claim: false,
            can_claim: true,
            relay: false,
        },
    }
}

/// `sha256:abcd…` → `ABCD·EFGH·…`, first `groups` groups; `—` without one.
pub fn short_fingerprint(fp: Option<&str>, groups: usize) -> String {
    match fp {
        Some(fp) => crate::crypto::format_fingerprint(fp)
            .to_uppercase()
            .split(' ')
            .take(groups)
            .collect::<Vec<_>>()
            .join("·"),
        None => "—".into(),
    }
}

/// Body for `POST /api/setup/claim`.
pub fn claim_request_body(
    token: Option<&str>,
    pairing_code: Option<&str>,
    claim: bool,
    label: &str,
) -> serde_json::Value {
    let mut v = serde_json::json!({ "label": label });
    if let Some(t) = token {
        v["token"] = t.into();
    }
    if let Some(c) = pairing_code {
        v["pairingCode"] = c.into();
    }
    if claim {
        v["claim"] = true.into();
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "5XxpXrLGE8G+VOthU0PoK2qVT4hAmqOtH6c50AQfGiY=";

    #[test]
    fn host_ports() {
        assert_eq!(
            normalize_host_port(" localhost:6767 ").unwrap(),
            "localhost:6767"
        );
        assert_eq!(normalize_host_port("[::1]:80").unwrap(), "[::1]:80");
        assert!(parse_host_port("nohost").is_err());
        assert!(parse_host_port("h:0").is_err());
        assert!(parse_host_port("h:70000").is_err());
        assert_eq!(
            daemon_ws_url("127.0.0.1:6791", false).unwrap(),
            "ws://127.0.0.1:6791/ws"
        );
    }

    #[test]
    fn codes() {
        assert_eq!(
            normalize_pairing_code("abcd-efgh").as_deref(),
            Some("ABCDEFGH")
        );
        assert_eq!(
            normalize_pairing_code("oil0 1234").as_deref(),
            Some("01101234")
        );
        assert_eq!(normalize_pairing_code("ABCDEFGU"), None);
        assert_eq!(normalize_pairing_code("ABC"), None);
        assert_eq!(format_pairing_code("abcdefgh"), "ABCD-EFGH");
    }

    #[test]
    fn offers_in_every_form() {
        let offer = ConnectionOffer::V2(ConnectionOfferV2 {
            server_id: "devbox".into(),
            daemon_public_key_b64: KEY.into(),
            relay: RelayEndpoint {
                endpoint: "relay.frogg.dev:443".into(),
                use_tls: Some(true),
            },
        });
        let enc = encode_offer_payload(&offer);
        for input in [
            format!("https://pair.frogg.app/code/{enc}"),
            format!("https://pair.frogg.app/code/{enc}/"),
            format!("frogg://pair#offer={enc}"),
            format!("frogg-next://pair#offer={enc}"),
            format!("https://x.test/?code={enc}"),
        ] {
            match parse_pair_input(&input, None, false) {
                Some(PairTarget::Offer { offer: o, .. }) => assert_eq!(o, offer, "{input}"),
                other => panic!("{input}: {other:?}"),
            }
        }
        let d = describe_pair_target(
            &parse_pair_input(&format!("frogg://pair#offer={enc}"), None, false).unwrap(),
        );
        assert!(d.relay);
        assert_eq!(d.address, "relay.frogg.dev:443 → devbox");
        assert!(d.fingerprint.unwrap().starts_with("sha256:"));
        // A code that decodes to junk is not a pairing input.
        assert!(parse_pair_input("https://pair.frogg.app/code/abc", None, false).is_none());
    }

    #[test]
    fn offer_matches_ts_encoding() {
        // `encodeOfferFragmentPayload` of {v:3,...} from the TS side.
        let json = serde_json::json!({
            "v": 3, "serverId": "srv", "hostname": "box", "daemonPublicKeyB64": KEY,
            "direct": { "endpoints": ["192.168.1.2:6767"] },
            "claim": { "token": "tok", "expiresAt": "2030-01-01T00:00:00Z" }
        });
        let enc = URL_SAFE_NO_PAD.encode(json.to_string());
        let Some(PairTarget::Offer {
            offer: ConnectionOffer::V3(o),
            ..
        }) = parse_pair_input(&format!("https://pair.frogg.app/code/{enc}"), None, false)
        else {
            panic!()
        };
        assert_eq!(o.direct.endpoints, vec!["192.168.1.2:6767".to_string()]);
        let d = describe_pair_target(&PairTarget::Offer {
            offer: ConnectionOffer::V3(o),
            raw: String::new(),
        });
        assert!(d.claim);
        assert_eq!(d.name, "box");
    }

    #[test]
    fn direct_links() {
        let link = DirectPairingLink {
            host: "10.0.0.5".into(),
            port: 6767,
            fingerprint: "sha256:abc".into(),
            pairing_code: Some("ABCDEFGH".into()),
            server_id: Some("srv".into()),
            label: Some("My Box".into()),
            role: Some("viewer".into()),
            ..Default::default()
        };
        let url = link.to_url("frogg-next");
        assert!(url.contains("pairingCode=ABCD-EFGH"));
        assert!(url.contains("name=My+Box"));
        let Some(PairTarget::Direct { link: parsed, .. }) = parse_pair_input(&url, None, false)
        else {
            panic!("{url}")
        };
        assert_eq!(parsed, link);
        assert!(
            parse_direct_pairing_link(&url.replace("fp=sha256", "fp=md5"), "frogg-next").is_none()
        );
        assert!(
            parse_direct_pairing_link(&url.replace("role=viewer", "role=god"), "frogg-next")
                .is_none()
        );
        let d = describe_pair_target(&PairTarget::Direct {
            link: parsed,
            raw: url,
        });
        assert_eq!((d.address.as_str(), d.claim), ("10.0.0.5:6767", false));
    }

    #[test]
    fn bare_codes_and_urls() {
        let t = parse_pair_input("abcd-efgh", Some("box:6767"), true).unwrap();
        assert_eq!(
            t,
            PairTarget::Code {
                code: "ABCDEFGH".into(),
                endpoint: Some("box:6767".into()),
                tls: true
            }
        );
        assert_eq!(describe_pair_target(&t).name, "box");
        assert!(parse_pair_input("hello", None, false).is_none());
        assert!(is_pair_url("frogg://pair#offer=x"));
        assert!(is_pair_url("https://pair.frogg.app/code/abc"));
        assert!(!is_pair_url("https://frogg.app"));
        assert_eq!(
            short_fingerprint(Some("sha256:abcdefghijklmnopqrst"), 4),
            "ABCD·EFGH·IJKL·MNOP"
        );
    }
}
