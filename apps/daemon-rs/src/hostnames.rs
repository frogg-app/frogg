//! Host-header allowlist, ported from `server/hostnames.ts`.
//!
//! Deliberately mirrors the Node implementation so the two daemons accept and
//! reject exactly the same `Host` headers. Without it the Rust daemon checked
//! only `Origin`, and its same-origin fallback compares `Origin` to `Host` —
//! so a page on an attacker's domain that rebinds DNS to 127.0.0.1 or the LAN
//! address supplies both halves itself and passes.

use std::net::IpAddr;

/// `HostnamesConfig`: `Any` is `hostnames === true`, `List` is the array form
/// (empty behaves like `undefined`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Hostnames {
    Any,
    List(Vec<String>),
}

impl Default for Hostnames {
    fn default() -> Self {
        Hostnames::List(Vec::new())
    }
}

/// `parseHostnamesEnv`: `true` means any host, otherwise a comma-separated list.
pub fn parse_hostnames_env(raw: Option<&str>) -> Option<Hostnames> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.eq_ignore_ascii_case("true") {
        return Some(Hostnames::Any);
    }
    let list: Vec<String> = trimmed
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    Some(Hostnames::List(list))
}

/// `mergeHostnames`: append and de-duplicate, short-circuiting on `true`.
pub fn merge_hostnames(values: impl IntoIterator<Item = Hostnames>) -> Hostnames {
    let mut merged: Vec<String> = Vec::new();
    for value in values {
        match value {
            Hostnames::Any => return Hostnames::Any,
            Hostnames::List(list) => {
                for entry in list {
                    let entry = entry.trim().to_owned();
                    if !entry.is_empty() && !merged.contains(&entry) {
                        merged.push(entry);
                    }
                }
            }
        }
    }
    Hostnames::List(merged)
}

fn normalize_hostname(hostname: &str) -> String {
    hostname.trim().to_ascii_lowercase()
}

/// `parseHostnameFromHostHeader`: strips the port, tolerating a bracketed IPv6
/// literal.
fn parse_hostname_from_host_header(host_header: &str) -> Option<String> {
    let trimmed = host_header.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix('[') {
        let end = rest.find(']')?;
        return Some(normalize_hostname(&rest[..end]));
    }
    match trimmed.find(':') {
        None => Some(normalize_hostname(trimmed)),
        Some(index) => Some(normalize_hostname(&trimmed[..index])),
    }
}

/// `matchesHostnamePattern`: a leading dot matches the base name and any
/// subdomain of it; anything else is an exact match.
fn matches_hostname_pattern(hostname: &str, pattern: &str) -> bool {
    let normalized = normalize_hostname(pattern);
    if normalized.is_empty() {
        return false;
    }
    if let Some(base) = normalized.strip_prefix('.') {
        if base.is_empty() {
            return false;
        }
        return hostname == base || hostname.ends_with(&format!(".{base}"));
    }
    hostname == normalized
}

/// `isDefaultAllowedHostname`: localhost, `*.localhost`, every IP literal, and
/// (unless the owner opted out) the brand's pairing hostname.
fn is_default_allowed_hostname(hostname: &str, allow_pairing_hostname: bool) -> bool {
    if hostname == "localhost" {
        return true;
    }
    if allow_pairing_hostname
        && !crate::branding::PAIRING_HOSTNAME.is_empty()
        && hostname == crate::branding::PAIRING_HOSTNAME
    {
        return true;
    }
    if hostname.ends_with(".localhost") {
        return true;
    }
    // Node uses `net.isIP`, which accepts a bare IPv6 literal as well as IPv4.
    hostname.parse::<IpAddr>().is_ok()
}

/// `isHostnameAllowed`. A missing or unparseable `Host` is rejected, matching
/// Node: every HTTP/1.1 client sends one, and a request without it cannot be
/// checked for rebinding.
pub fn is_hostname_allowed(
    host_header: Option<&str>,
    hostnames: &Hostnames,
    allow_pairing_hostname: bool,
) -> bool {
    let Some(hostname) = host_header.and_then(parse_hostname_from_host_header) else {
        return false;
    };
    if hostname.is_empty() {
        return false;
    }
    match hostnames {
        Hostnames::Any => true,
        Hostnames::List(patterns) => {
            if is_default_allowed_hostname(&hostname, allow_pairing_hostname) {
                return true;
            }
            patterns
                .iter()
                .any(|pattern| matches_hostname_pattern(&hostname, pattern))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULTS: Hostnames = Hostnames::List(Vec::new());

    fn allowed(host: &str) -> bool {
        is_hostname_allowed(Some(host), &DEFAULTS, true)
    }

    #[test]
    fn allows_the_same_defaults_the_node_daemon_does() {
        assert!(allowed("localhost:9999"));
        assert!(allowed("foo.localhost:9999"));
        assert!(allowed("127.0.0.1:9999"));
        assert!(allowed("[::1]:9999"));
        assert!(allowed("192.168.1.10:9999"));
        assert!(allowed("LOCALHOST:9999"));
    }

    #[test]
    fn rejects_a_rebound_attacker_hostname() {
        // The whole point: a page on evil.com that rebinds to 127.0.0.1 still
        // sends `Host: evil.com`, which is not on the allowlist.
        assert!(!allowed("evil.com:9999"));
        assert!(!allowed("evil.com"));
        assert!(!allowed("notlocalhost"));
        // A name merely containing an allowed one is not a subdomain of it.
        assert!(!allowed("evil-localhost.com"));
    }

    #[test]
    fn rejects_a_missing_or_empty_host() {
        assert!(!is_hostname_allowed(None, &DEFAULTS, true));
        assert!(!is_hostname_allowed(Some(""), &DEFAULTS, true));
        assert!(!is_hostname_allowed(Some("   "), &DEFAULTS, true));
        assert!(!is_hostname_allowed(Some(":9999"), &DEFAULTS, true));
    }

    #[test]
    fn honours_the_pairing_hostname_rule_and_its_opt_out() {
        if crate::branding::PAIRING_HOSTNAME.is_empty() {
            return;
        }
        let pairing = crate::branding::PAIRING_HOSTNAME;
        assert!(is_hostname_allowed(Some(pairing), &DEFAULTS, true));
        assert!(!is_hostname_allowed(Some(pairing), &DEFAULTS, false));
        // Listing it explicitly still works with the allowance turned off.
        let listed = Hostnames::List(vec![pairing.to_string()]);
        assert!(is_hostname_allowed(Some(pairing), &listed, false));
        assert!(is_hostname_allowed(Some(pairing), &Hostnames::Any, false));
    }

    #[test]
    fn any_allows_every_host_but_still_needs_one() {
        assert!(is_hostname_allowed(Some("evil.com"), &Hostnames::Any, true));
        assert!(!is_hostname_allowed(None, &Hostnames::Any, true));
    }

    #[test]
    fn supports_leading_dot_patterns() {
        let hostnames = Hostnames::List(vec![".example.com".to_string()]);
        for host in [
            "example.com:9999",
            "foo.example.com:9999",
            "foo.bar.example.com:9999",
        ] {
            assert!(is_hostname_allowed(Some(host), &hostnames, true), "{host}");
        }
        assert!(!is_hostname_allowed(
            Some("notexample.com:9999"),
            &hostnames,
            true
        ));
    }

    #[test]
    fn supports_exact_patterns_case_insensitively() {
        let hostnames = Hostnames::List(vec!["MyHost".to_string()]);
        assert!(is_hostname_allowed(Some("myhost:9999"), &hostnames, true));
        assert!(!is_hostname_allowed(Some("other:9999"), &hostnames, true));
    }

    #[test]
    fn parses_env_values_like_the_node_daemon() {
        assert_eq!(parse_hostnames_env(None), None);
        assert_eq!(parse_hostnames_env(Some("")), None);
        assert_eq!(parse_hostnames_env(Some("true")), Some(Hostnames::Any));
        assert_eq!(
            parse_hostnames_env(Some("localhost, .example.com")),
            Some(Hostnames::List(vec![
                "localhost".to_string(),
                ".example.com".to_string()
            ]))
        );
    }

    #[test]
    fn merges_by_appending_and_short_circuits_on_any() {
        assert_eq!(
            merge_hostnames([
                Hostnames::List(vec!["a".into()]),
                Hostnames::List(vec!["a".into(), "b".into()]),
            ]),
            Hostnames::List(vec!["a".into(), "b".into()])
        );
        assert_eq!(
            merge_hostnames([Hostnames::List(vec!["a".into()]), Hostnames::Any]),
            Hostnames::Any
        );
    }
}
