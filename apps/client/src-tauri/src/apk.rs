//! Android APK updates: which release to move to and how to trust its download. Pure logic, so it
//! is unit-tested on the host; the Android glue lives in `android_updates.rs`.
//!
//! Every `-next.N` release of the Rust client (`.github/workflows/rust-client.yml`,
//! `scripts/release/rust-client-assets.mjs`) carries `Frogg-Next-RS-<version>-android-universal.apk`
//! and `Frogg-Next-RS-<version>-SHA256SUMS` (`<hex>  <name>` lines). GitHub also reports a
//! `sha256:<hex>` digest per asset; either is accepted, and the APK is refused without one.
//! The channel follows the installed build, as on desktop: a prerelease install only takes
//! prereleases, a stable install only stable releases.

use serde::Deserialize;
use sha2::{Digest, Sha256};

pub const PREFIX: &str = "Frogg-Next-RS";
const APK_SUFFIX: &str = "-android-universal.apk";

#[derive(Clone, Debug, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    pub html_url: Option<String>,
    pub body: Option<String>,
    #[serde(default)]
    pub assets: Vec<Asset>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Asset {
    pub name: String,
    #[serde(default)]
    pub browser_download_url: String,
    #[serde(default)]
    pub size: u64,
    /// GitHub's own `sha256:<hex>` digest (absent on older releases).
    pub digest: Option<String>,
}

/// The APK this install should move to.
#[derive(Clone, Debug, PartialEq)]
pub struct ApkUpdate {
    pub version: semver::Version,
    pub release_url: Option<String>,
    pub notes: Option<String>,
    pub name: String,
    pub url: String,
    pub size: u64,
    /// Lowercase hex sha256 from the asset's GitHub digest, if it has one.
    pub digest: Option<String>,
    /// The release's SHA256SUMS asset, read when `digest` is missing.
    pub sums_url: Option<String>,
}

pub fn apk_name(version: &str) -> String {
    format!("{PREFIX}-{version}{APK_SUFFIX}")
}

pub fn sums_name(version: &str) -> String {
    format!("{PREFIX}-{version}-SHA256SUMS")
}

/// The newest release of this install's channel, newer than `current`, that carries the APK.
pub fn select(releases: &[Release], current: &semver::Version) -> Option<ApkUpdate> {
    let want_pre = !current.pre.is_empty();
    releases
        .iter()
        .filter(|r| !r.draft)
        .filter_map(|r| {
            let raw = r.tag_name.trim_start_matches(['v', 'V']);
            let v = semver::Version::parse(raw).ok()?;
            let pre = r.prerelease || !v.pre.is_empty();
            if pre != want_pre || v <= *current {
                return None;
            }
            let apk = r.assets.iter().find(|a| a.name == apk_name(raw))?;
            if apk.browser_download_url.is_empty() {
                return None;
            }
            let sums = r.assets.iter().find(|a| a.name == sums_name(raw));
            Some(ApkUpdate {
                version: v,
                release_url: r.html_url.clone(),
                notes: r.body.clone().filter(|b| !b.trim().is_empty()),
                name: apk.name.clone(),
                url: apk.browser_download_url.clone(),
                size: apk.size,
                digest: apk.digest.as_deref().and_then(parse_digest),
                sums_url: sums
                    .map(|s| s.browser_download_url.clone())
                    .filter(|u| !u.is_empty()),
            })
        })
        .max_by(|a, b| a.version.cmp(&b.version))
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `sha256:<hex>` (GitHub's asset digest) to lowercase hex.
pub fn parse_digest(d: &str) -> Option<String> {
    let hex = d.trim().strip_prefix("sha256:")?;
    is_sha256_hex(hex).then(|| hex.to_ascii_lowercase())
}

/// The sha256 of `name` in a `sha256sum`-style listing (`<hex>  <name>` or `<hex> *<name>`).
pub fn sum_for(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hex, file) = line.trim().split_once(char::is_whitespace)?;
        let file = file.trim_start().trim_start_matches('*');
        (file == name && is_sha256_hex(hex)).then(|| hex.to_ascii_lowercase())
    })
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Streams the download through a hasher and checks it against the expected size and digest.
#[derive(Default)]
pub struct Verifier {
    hasher: Sha256,
    len: u64,
}

impl Verifier {
    pub fn update(&mut self, chunk: &[u8]) {
        self.hasher.update(chunk);
        self.len += chunk.len() as u64;
    }

    pub fn len(&self) -> u64 {
        self.len
    }

    /// `size` 0 means unknown. `sha256` is lowercase hex.
    pub fn finish(self, size: u64, sha256: &str) -> Result<(), String> {
        if size > 0 && self.len != size {
            return Err(format!(
                "the download is {} bytes, the release says {size}",
                self.len
            ));
        }
        let got = hex(&self.hasher.finalize());
        if got != sha256 {
            return Err(format!(
                "the download's checksum doesn't match the release (got {got}, want {sha256})"
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> Asset {
        Asset {
            name: name.into(),
            browser_download_url: format!("https://example.test/{name}"),
            size: 10,
            digest: None,
        }
    }

    fn rel(version: &str, pre: bool, apk: bool) -> Release {
        let mut assets = vec![asset(&sums_name(version))];
        if apk {
            assets.push(asset(&apk_name(version)));
        }
        Release {
            tag_name: format!("v{version}"),
            draft: false,
            prerelease: pre,
            html_url: Some(format!("https://example.test/{version}")),
            body: Some("notes".into()),
            assets,
        }
    }

    fn v(s: &str) -> semver::Version {
        semver::Version::parse(s).unwrap()
    }

    #[test]
    fn picks_the_newest_apk_of_the_channel() {
        let releases = vec![
            rel("1.6.14-next.11", true, false),
            rel("1.6.14-next.10", true, true),
            rel("1.6.14-next.2", true, true),
            rel("1.6.15", false, true),
        ];
        let up = select(&releases, &v("1.6.14-next.9")).unwrap();
        assert_eq!(up.version, v("1.6.14-next.10"));
        assert_eq!(
            up.name,
            "Frogg-Next-RS-1.6.14-next.10-android-universal.apk"
        );
        assert_eq!(
            up.sums_url.as_deref(),
            Some("https://example.test/Frogg-Next-RS-1.6.14-next.10-SHA256SUMS")
        );
        assert_eq!(
            select(&releases, &v("1.6.14")).unwrap().version,
            v("1.6.15")
        );
    }

    #[test]
    fn nothing_when_current_or_older() {
        let releases = vec![
            rel("1.6.14-next.9", true, true),
            rel("1.6.14-next.3", true, true),
        ];
        assert!(select(&releases, &v("1.6.14-next.9")).is_none());
        // Numeric, not lexical: next.10 is newer than next.9.
        assert!(select(&[rel("1.6.14-next.10", true, true)], &v("1.6.14-next.9")).is_some());
    }

    #[test]
    fn skips_drafts_and_other_prefixes() {
        let mut draft = rel("1.6.14-next.12", true, true);
        draft.draft = true;
        let mut other = rel("1.6.14-next.13", true, false);
        other
            .assets
            .push(asset("Frogg-Next-1.6.14-next.13-android-universal.apk"));
        assert!(select(&[draft, other], &v("1.6.14-next.9")).is_none());
    }

    #[test]
    fn reads_github_digest() {
        let h = "AB".repeat(32);
        assert_eq!(parse_digest(&format!("sha256:{h}")), Some("ab".repeat(32)));
        assert_eq!(parse_digest("sha1:abcd"), None);
        assert_eq!(parse_digest("sha256:xyz"), None);
    }

    #[test]
    fn reads_sha256sums() {
        let a = "a".repeat(64);
        let b = "b".repeat(64);
        let sums = format!(
            "{a}  Frogg-Next-RS-1-linux-x64.deb\n{b} *Frogg-Next-RS-1-android-universal.apk\n"
        );
        assert_eq!(
            sum_for(&sums, "Frogg-Next-RS-1-android-universal.apk"),
            Some(b)
        );
        assert_eq!(sum_for(&sums, "Frogg-Next-RS-1-linux-x64.deb"), Some(a));
        assert_eq!(sum_for(&sums, "missing.apk"), None);
    }

    #[test]
    fn verifies_size_and_checksum() {
        // sha256("abc")
        let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let mut ok = Verifier::default();
        ok.update(b"a");
        ok.update(b"bc");
        assert_eq!(ok.len(), 3);
        assert!(ok.finish(3, abc).is_ok());

        let mut short = Verifier::default();
        short.update(b"ab");
        assert!(short.finish(3, abc).unwrap_err().contains("bytes"));

        let mut wrong = Verifier::default();
        wrong.update(b"abd");
        assert!(wrong.finish(0, abc).unwrap_err().contains("checksum"));
    }
}
