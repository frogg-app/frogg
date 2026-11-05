//! Saved hosts (ui-next `daemon/hosts.ts`): every daemon this device can reach, the alternate
//! routes to each, and which one is active. Persisted under ui-next's key and shape, so a
//! WebView that already ran Frogg Next keeps its hosts.

use leptos::prelude::*;
use serde::{Deserialize, Serialize};

use super::storage;

const KEY: &str = "frogg-next.hosts.v1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Relay {
    #[serde(rename = "daemonPublicKeyB64")]
    pub daemon_public_key_b64: String,
}

/// One saved way to reach a daemon: a direct listener or a relay.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostRoute {
    pub id: String,
    pub endpoint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay: Option<Relay>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Host {
    pub id: String,
    pub name: String,
    /// host:port of the daemon's WebSocket listener, or of the relay for a relay host.
    pub endpoint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls: Option<bool>,
    /// Daemon password or the device credential minted by pairing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// The daemon's stable id; a handshake from any other daemon is refused.
    #[serde(rename = "serverId", default, skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay: Option<Relay>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(
        rename = "lastOnlineAt",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub last_online_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub routes: Option<Vec<HostRoute>>,
}

impl Host {
    pub fn new(name: impl Into<String>, endpoint: impl Into<String>) -> Self {
        Self {
            id: new_host_id(),
            name: name.into(),
            endpoint: endpoint.into(),
            tls: None,
            password: None,
            server_id: None,
            relay: None,
            fingerprint: None,
            role: None,
            last_online_at: None,
            routes: None,
        }
    }

    pub fn is_relay(&self) -> bool {
        self.relay.is_some()
    }

    /// The route this host currently connects through.
    pub fn primary_route(&self) -> HostRoute {
        HostRoute {
            id: "primary".into(),
            endpoint: self.endpoint.clone(),
            tls: self.tls,
            relay: self.relay.clone(),
        }
    }

    /// The WebSocket URL of a direct host. Relay hosts need the relay transport (client core).
    pub fn url(&self) -> String {
        let scheme = if self.tls.unwrap_or(false) {
            "wss"
        } else {
            "ws"
        };
        format!("{scheme}://{}/ws", self.endpoint)
    }

    /// Everything a live connection depends on; a change means reconnecting.
    pub fn route_key(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.url(),
            self.password.as_deref().unwrap_or(""),
            self.server_id.as_deref().unwrap_or(""),
            self.relay
                .as_ref()
                .map(|r| r.daemon_public_key_b64.as_str())
                .unwrap_or("")
        )
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    hosts: Vec<Host>,
    #[serde(rename = "activeId", default)]
    active_id: Option<String>,
}

pub fn new_host_id() -> String {
    let now = js_sys::Date::now() as u64;
    let rand = (js_sys::Math::random() * 2f64.powi(40)) as u64;
    format!("h_{}_{}", radix36(now), radix36(rand))
}

fn radix36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// A direct LAN/tailnet listener `host:port` (bracketed IPv6 allowed); returns (endpoint, name).
pub fn parse_host_address(input: &str) -> Option<(String, String)> {
    let raw = input
        .trim()
        .trim_start_matches("ws://")
        .trim_start_matches("wss://")
        .trim_end_matches("/ws");
    let colon = raw.rfind(':')?;
    let (host, port) = (&raw[..colon], &raw[colon + 1..]);
    if port.is_empty() || port.len() > 5 || !port.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let port: u32 = port.parse().ok()?;
    if !(1..=65535).contains(&port) {
        return None;
    }
    let ok_host = if host.starts_with('[') && host.ends_with(']') {
        host.len() > 2
            && host[1..host.len() - 1]
                .chars()
                .all(|c| c.is_ascii_hexdigit() || c == ':')
    } else {
        !host.is_empty()
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    };
    if !ok_host {
        return None;
    }
    let host = host.to_lowercase();
    Some((format!("{host}:{port}"), host))
}

fn same_route(a: &HostRoute, b: &HostRoute) -> bool {
    a.endpoint == b.endpoint && a.relay.is_some() == b.relay.is_some()
}

#[derive(Clone, Copy)]
pub struct Hosts {
    pub hosts: RwSignal<Vec<Host>>,
    pub active_id: RwSignal<Option<String>>,
}

impl Hosts {
    pub fn init() -> Self {
        let saved: Saved = storage::get_json(KEY).unwrap_or_default();
        let hosts = RwSignal::new(saved.hosts);
        let active_id = RwSignal::new(saved.active_id);
        Effect::new(move |_| {
            let saved = Saved {
                hosts: hosts.get(),
                active_id: active_id.get(),
            };
            storage::set_json(KEY, &saved);
        });
        Self { hosts, active_id }
    }

    pub fn find(&self, id: &str) -> Option<Host> {
        self.hosts
            .with(|hs| hs.iter().find(|h| h.id == id).cloned())
    }

    pub fn find_untracked(&self, id: &str) -> Option<Host> {
        self.hosts
            .with_untracked(|hs| hs.iter().find(|h| h.id == id).cloned())
    }

    /// The active host (reactive).
    pub fn active(&self) -> Option<Host> {
        let id = self.active_id.get()?;
        self.find(&id)
    }

    /// The host to connect to: the saved active one, else the first, else a new entry for
    /// `fallback_endpoint`.
    pub fn active_or_default(&self, fallback_endpoint: &str) -> Host {
        let active = self.active_id.get_untracked();
        let found = self.hosts.with_untracked(|hs| {
            active
                .as_ref()
                .and_then(|id| hs.iter().find(|h| &h.id == id))
                .or_else(|| hs.first())
                .cloned()
        });
        if let Some(h) = found {
            return h;
        }
        let name = fallback_endpoint.split(':').next().unwrap_or("host");
        let host = Host::new(name, fallback_endpoint);
        self.hosts.set(vec![host.clone()]);
        self.active_id.set(Some(host.id.clone()));
        host
    }

    pub fn add(&self, host: Host) -> Host {
        self.hosts.update(|hs| hs.push(host.clone()));
        host
    }

    /// Adds a host, or refreshes the saved one it is: the same serverId, else an address-only
    /// entry at the same direct endpoint. A new route to a known daemon keeps the old as an alternate.
    pub fn upsert(&self, input: Host) -> Host {
        let existing = self.hosts.with_untracked(|hs| {
            input
                .server_id
                .as_ref()
                .and_then(|sid| hs.iter().find(|h| h.server_id.as_ref() == Some(sid)))
                .or_else(|| {
                    if input.relay.is_some() {
                        None
                    } else {
                        hs.iter().find(|h| {
                            h.server_id.is_none()
                                && h.relay.is_none()
                                && h.endpoint == input.endpoint
                        })
                    }
                })
                .cloned()
        });
        let Some(existing) = existing else {
            return self.add(input);
        };
        let prev = existing.primary_route();
        let next_route = input.primary_route();
        let mut routes: Vec<HostRoute> = existing
            .routes
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter(|r| !same_route(r, &next_route))
            .collect();
        if !same_route(&prev, &next_route) {
            routes.insert(
                0,
                HostRoute {
                    id: new_host_id(),
                    ..prev
                },
            );
        }
        let host = Host {
            id: existing.id.clone(),
            name: input.name,
            endpoint: input.endpoint,
            tls: input.tls,
            password: input.password.or(existing.password),
            server_id: input.server_id.or(existing.server_id),
            relay: input.relay,
            fingerprint: input.fingerprint.or(existing.fingerprint),
            role: input.role.or(existing.role),
            last_online_at: existing.last_online_at,
            routes: (!routes.is_empty()).then_some(routes),
        };
        self.replace(host.clone());
        host
    }

    fn replace(&self, host: Host) {
        self.hosts.update(|hs| {
            if let Some(h) = hs.iter_mut().find(|h| h.id == host.id) {
                *h = host;
            }
        });
    }

    pub fn remove(&self, id: &str) {
        self.hosts.update(|hs| hs.retain(|h| h.id != id));
        if self.active_id.get_untracked().as_deref() == Some(id) {
            self.active_id.set(None);
        }
    }

    pub fn rename(&self, id: &str, name: &str) {
        self.update(id, |h| h.name = name.to_owned());
    }

    /// Updates a saved host in place; returns the new entry, or None if it is gone.
    pub fn update(&self, id: &str, patch: impl FnOnce(&mut Host)) -> Option<Host> {
        let mut host = self.find_untracked(id)?;
        patch(&mut host);
        if host.password.as_deref() == Some("") {
            host.password = None;
        }
        self.replace(host.clone());
        Some(host)
    }

    pub fn mark_online(&self, id: &str) {
        let now: String = js_sys::Date::new_0().to_iso_string().into();
        self.update(id, |h| h.last_online_at = Some(now));
    }

    /// Makes a saved alternate the route in use; the previous one becomes an alternate.
    pub fn promote_route(&self, host_id: &str, route_id: &str) -> Option<Host> {
        let h = self.find_untracked(host_id)?;
        let routes = h.routes.clone().unwrap_or_default();
        let next = routes.iter().find(|r| r.id == route_id)?.clone();
        let mut rest = vec![HostRoute {
            id: new_host_id(),
            ..h.primary_route()
        }];
        rest.extend(routes.into_iter().filter(|r| r.id != route_id));
        self.update(host_id, |host| {
            host.endpoint = next.endpoint;
            host.tls = next.tls;
            host.relay = next.relay;
            host.routes = Some(rest);
        })
    }

    pub fn remove_route(&self, host_id: &str, route_id: &str) {
        self.update(host_id, |h| {
            if let Some(rs) = h.routes.as_mut() {
                rs.retain(|r| r.id != route_id);
                if rs.is_empty() {
                    h.routes = None;
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_addresses() {
        assert_eq!(
            parse_host_address(" 192.168.1.4:6767 "),
            Some(("192.168.1.4:6767".into(), "192.168.1.4".into()))
        );
        assert_eq!(
            parse_host_address("ws://Box.local:9969/ws"),
            Some(("box.local:9969".into(), "box.local".into()))
        );
        assert!(parse_host_address("[::1]:80").is_some());
        assert!(parse_host_address("host").is_none());
        assert!(parse_host_address("host:0").is_none());
        assert!(parse_host_address("host:99999").is_none());
        assert!(parse_host_address("a/b:80").is_none());
    }

    #[test]
    fn reads_ui_next_shape() {
        let raw = r#"{"hosts":[{"id":"h_1","name":"box","endpoint":"box:6767","serverId":"s1","routes":[{"id":"r","endpoint":"relay:443","relay":{"daemonPublicKeyB64":"k"}}]}],"activeId":"h_1"}"#;
        let s: Saved = serde_json::from_str(raw).unwrap();
        assert_eq!(s.hosts[0].server_id.as_deref(), Some("s1"));
        assert!(s.hosts[0].routes.as_ref().unwrap()[0].relay.is_some());
        assert_eq!(s.hosts[0].url(), "ws://box:6767/ws");
    }
}
