//! Daemon versions (ui-next `hosts/daemonVersions.ts`): channel defaults and semver order.

use std::cmp::Ordering;

/// A `-next.N` daemon is Frogg Next's own (port 9969).
pub fn is_next_daemon_version(version: Option<&str>) -> bool {
    version.is_some_and(|v| {
        let l = v.to_lowercase();
        l.contains("-next.") || l.ends_with("-next")
    })
}

/// A beta build stays on the beta channel unless the user picks otherwise.
pub fn channel_of(version: Option<&str>) -> &'static str {
    if version.is_some_and(|v| v.to_lowercase().contains("-beta")) {
        "beta"
    } else {
        "stable"
    }
}

/// Semver order, a prerelease below its release; numeric prerelease parts compare as numbers.
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let a = a.trim_start_matches('v');
    let b = b.trim_start_matches('v');
    let (ma, pa) = a
        .split_once('-')
        .map(|(m, p)| (m, Some(p)))
        .unwrap_or((a, None));
    let (mb, pb) = b
        .split_once('-')
        .map(|(m, p)| (m, Some(p)))
        .unwrap_or((b, None));
    let nums = |m: &str| -> Vec<u64> { m.split('.').map(|x| x.parse().unwrap_or(0)).collect() };
    let (na, nb) = (nums(ma), nums(mb));
    for i in 0..3 {
        let d = na.get(i).unwrap_or(&0).cmp(nb.get(i).unwrap_or(&0));
        if d != Ordering::Equal {
            return d;
        }
    }
    match (pa, pb) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(pa), Some(pb)) => {
            let xa: Vec<&str> = pa.split('.').collect();
            let xb: Vec<&str> = pb.split('.').collect();
            for i in 0..xa.len().max(xb.len()) {
                let (Some(sa), Some(sb)) = (xa.get(i), xb.get(i)) else {
                    return xa.len().cmp(&xb.len());
                };
                let d = match (sa.parse::<u64>(), sb.parse::<u64>()) {
                    (Ok(x), Ok(y)) => x.cmp(&y),
                    _ => sa.cmp(sb),
                };
                if d != Ordering::Equal {
                    return d;
                }
            }
            Ordering::Equal
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders() {
        assert_eq!(
            compare_versions("1.6.14", "1.6.14-beta.10"),
            Ordering::Greater
        );
        assert_eq!(
            compare_versions("1.6.14-beta.10", "1.6.14-beta.9"),
            Ordering::Greater
        );
        assert_eq!(compare_versions("v1.2.0", "1.10.0"), Ordering::Less);
        assert_eq!(
            compare_versions("1.0.0-next.1", "1.0.0-next.1"),
            Ordering::Equal
        );
        assert_eq!(channel_of(Some("1.6.14-beta.3")), "beta");
        assert_eq!(channel_of(None), "stable");
        assert!(is_next_daemon_version(Some("0.1.0-next.4")));
        assert!(!is_next_daemon_version(Some("1.6.14")));
    }
}
