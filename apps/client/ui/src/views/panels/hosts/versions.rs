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

/// The GitHub repository whose releases carry the daemon bundles.
pub const RELEASE_REPO: &str = "frogg-app/frogg";

/// A release as the GitHub API lists it (only the fields the picker reads).
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DaemonVersion {
    pub version: String,
    pub prerelease: bool,
    pub published_at: Option<String>,
}

/// The bundle name prefixes (brand, daemon) a host running `version` can install.
pub fn prefixes_for(version: Option<&str>) -> (&'static str, &'static str) {
    if is_next_daemon_version(version) {
        ("frogg-next-daemon", "frogg-next-daemon")
    } else {
        ("frogg", "frogg-daemon")
    }
}

/// Whether `name` is this brand's daemon bundle for `version`.
pub fn is_daemon_bundle(name: &str, version: &str, (brand, daemon): (&str, &str)) -> bool {
    let bundle = name.ends_with(".zip") || name.ends_with(".tar.gz");
    bundle
        && (name.starts_with(&format!("{daemon}-{version}-"))
            || (name.starts_with(&format!("{brand}-{version}-"))
                && (name.ends_with("-daemon.zip") || name.ends_with("-daemon.tar.gz"))))
}

/// Installable daemon versions, newest first (ui-next `daemonVersions`): stable lists stable
/// releases only, beta both; Frogg Next bundles ship on prereleases whatever the channel.
pub fn daemon_versions(
    releases: &[Release],
    channel: &str,
    current: Option<&str>,
) -> Vec<DaemonVersion> {
    let prefixes = prefixes_for(current);
    let next = is_next_daemon_version(current);
    let mut out: Vec<DaemonVersion> = releases
        .iter()
        .filter(|r| !r.draft && (channel == "beta" || !r.prerelease || next))
        .filter_map(|r| {
            let version = r.tag_name.trim_start_matches('v').to_owned();
            let numeric = version
                .split(['.', '-'])
                .take(3)
                .filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
                .count()
                == 3;
            (numeric
                && r.assets
                    .iter()
                    .any(|a| is_daemon_bundle(&a.name, &version, prefixes)))
            .then(|| DaemonVersion {
                version,
                prerelease: r.prerelease,
                published_at: r.published_at.clone(),
            })
        })
        .collect();
    out.sort_by(|a, b| compare_versions(&b.version, &a.version));
    out
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

    fn rel(tag: &str, pre: bool, assets: &[&str]) -> Release {
        Release {
            tag_name: tag.into(),
            prerelease: pre,
            assets: assets
                .iter()
                .map(|a| ReleaseAsset { name: (*a).into() })
                .collect(),
            ..Release::default()
        }
    }

    #[test]
    fn lists_installable_versions() {
        let rs = vec![
            rel(
                "v1.6.10",
                false,
                &["frogg-1.6.10-linux-x86_64-daemon.tar.gz"],
            ),
            rel(
                "v1.6.11-beta.2",
                true,
                &["frogg-daemon-1.6.11-beta.2-linux-x64.tar.gz"],
            ),
            rel("v1.6.12", false, &["frogg-beta-daemon-1.6.12-linux.tar.gz"]),
            rel(
                "v1.7.0-next.3",
                true,
                &["frogg-next-daemon-1.7.0-next.3-linux-x64.tar.gz"],
            ),
        ];
        let v = |c, cur| -> Vec<String> {
            daemon_versions(&rs, c, cur)
                .into_iter()
                .map(|d| d.version)
                .collect()
        };
        assert_eq!(v("stable", Some("1.6.9")), vec!["1.6.10"]);
        assert_eq!(v("beta", None), vec!["1.6.11-beta.2", "1.6.10"]);
        assert_eq!(v("stable", Some("1.7.0-next.1")), vec!["1.7.0-next.3"]);
    }
}
