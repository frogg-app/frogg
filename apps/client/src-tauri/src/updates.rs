//! Desktop updates (parity with `apps/ui-next/desktop/updater.cjs` + `update-feed.cjs`).
//!
//! Releases live on GitHub (`frogg-app/frogg`). A prerelease build follows prereleases and a
//! stable build follows stable releases; the newest matching release that carries the
//! `frogg-next-rs-latest.json` feed (Tauri's updater manifest, signed with the updater key) wins.
//! The feed is then handed to `tauri-plugin-updater`, which verifies and installs in place.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const REPOSITORY: &str = "frogg-app/frogg";
pub const FEED: &str = "frogg-next-rs-latest.json";

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
}

/// What `update_check` reports to the UI (mirrors ui-next's `DesktopUpdateState` subset).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    /// "up-to-date" | "available" | "error"
    pub status: &'static str,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: String,
    pub notes: Option<String>,
    pub error: Option<String>,
}

#[derive(serde::Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    html_url: Option<String>,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(serde::Deserialize)]
struct Asset {
    name: String,
}

struct Selected {
    tag: String,
    release_url: Option<String>,
}

/// The newest release this install can move to that carries the feed.
fn select(releases: &[Release], current: &semver::Version) -> Option<Selected> {
    let want_pre = !current.pre.is_empty();
    releases
        .iter()
        .filter(|r| !r.draft)
        .filter_map(|r| {
            let v = semver::Version::parse(r.tag_name.trim_start_matches(['v', 'V'])).ok()?;
            let pre = r.prerelease || !v.pre.is_empty();
            (pre == want_pre && r.assets.iter().any(|a| a.name == FEED)).then_some((v, r))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, r)| Selected {
            tag: r.tag_name.clone(),
            release_url: r.html_url.clone(),
        })
}

async fn latest(current: &semver::Version) -> Result<Option<Selected>, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let releases: Vec<Release> = reqwest::Client::builder()
        .user_agent("frogg-next-rs-updater")
        .build()
        .map_err(|e| e.to_string())?
        .get(format!(
            "https://api.github.com/repos/{REPOSITORY}/releases?per_page=30"
        ))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(select(&releases, current))
}

pub async fn check<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    let current_version = app.package_info().version.to_string();
    let mut state = UpdateState {
        status: "up-to-date",
        current_version: current_version.clone(),
        latest_version: None,
        release_url: format!("https://github.com/{REPOSITORY}/releases"),
        notes: None,
        error: None,
    };
    let fail = |mut s: UpdateState, e: String| {
        s.status = "error";
        s.error = Some(e);
        s
    };
    let current = app.package_info().version.clone();
    let selected = match latest(&current).await {
        Ok(Some(s)) => s,
        Ok(None) => return state,
        Err(e) => return fail(state, e),
    };
    if let Some(url) = selected.release_url {
        state.release_url = url;
    }
    let feed = format!(
        "https://github.com/{REPOSITORY}/releases/download/{}/{FEED}",
        selected.tag
    );
    let updater = match tauri::Url::parse(&feed)
        .map_err(|e| e.to_string())
        .and_then(|u| {
            app.updater_builder()
                .endpoints(vec![u])
                .and_then(|b| b.build())
                .map_err(|e| e.to_string())
        }) {
        Ok(u) => u,
        Err(e) => return fail(state, e),
    };
    match updater.check().await {
        Ok(Some(update)) => {
            state.status = "available";
            state.latest_version = Some(update.version.clone());
            state.notes = update.body.clone();
            *app.state::<Updates>().pending.lock().unwrap() = Some(update);
            state
        }
        Ok(None) => state,
        Err(e) => fail(state, e.to_string()),
    }
}

/// Downloads and installs the update found by the last `check`, then restarts.
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let update = app
        .state::<Updates>()
        .pending
        .lock()
        .unwrap()
        // Keep it stored: a failed download can then be retried without checking again.
        .clone()
        .ok_or("no update to install; check first")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rel(tag: &str, pre: bool, feed: bool) -> Release {
        Release {
            tag_name: tag.into(),
            draft: false,
            prerelease: pre,
            html_url: None,
            assets: if feed {
                vec![Asset { name: FEED.into() }]
            } else {
                vec![]
            },
        }
    }

    #[test]
    fn follows_the_release_channel_and_needs_the_feed() {
        let releases = vec![
            rel("v1.6.14-next.5", true, false),
            rel("v1.6.14-next.4", true, true),
            rel("v1.6.13", false, true),
        ];
        let pre = semver::Version::parse("1.6.14-next.3").unwrap();
        assert_eq!(select(&releases, &pre).unwrap().tag, "v1.6.14-next.4");
        let stable = semver::Version::parse("1.6.12").unwrap();
        assert_eq!(select(&releases, &stable).unwrap().tag, "v1.6.13");
    }
}
