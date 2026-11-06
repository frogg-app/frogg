//! Desktop updates (parity with `apps/ui-next/desktop/updater.cjs` + `update-feed.cjs`).
//!
//! Releases live on GitHub (`frogg-app/frogg`). A prerelease build follows prereleases and a
//! stable build follows stable releases; the newest matching release that carries the
//! `frogg-next-rs-latest.json` feed (Tauri's updater manifest, signed with the updater key) wins.
//! The feed is then handed to `tauri-plugin-updater`, which verifies and installs in place.
//!
//! The shell checks on start and every [`CHECK_EVERY`]. In `auto` mode a found update downloads
//! in the background (progress on the [`STATE_EVENT`] event) and waits as `ready` for a restart;
//! in `download` mode (a Linux package install the updater can't replace) the UI offers the
//! release page instead.

use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const REPOSITORY: &str = "frogg-app/frogg";
pub const FEED: &str = "frogg-next-rs-latest.json";
/// Event carrying every [`UpdateState`] change to the UI.
pub const STATE_EVENT: &str = "frogg://update-state";
/// Background check interval (ui-next: "on start and every few hours").
const CHECK_EVERY: Duration = Duration::from_secs(4 * 60 * 60);
/// First background check, once the window has settled.
const FIRST_CHECK: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    /// The downloaded package of `pending`, verified on install.
    bytes: Mutex<Option<Vec<u8>>>,
    state: Mutex<Option<UpdateState>>,
    busy: Mutex<bool>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub percent: f64,
    pub transferred: u64,
    pub total: Option<u64>,
}

/// What the shell reports to the UI (mirrors ui-next's `DesktopUpdateState`).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    /// "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error"
    pub status: &'static str,
    /// "auto" (downloads itself) | "download" (the user installs from the release page)
    pub mode: &'static str,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: String,
    pub notes: Option<String>,
    pub progress: Option<Progress>,
    pub error: Option<String>,
}

/// Whether the updater can replace this install: everything but a Linux package (deb/rpm)
/// install, which only an AppImage escapes.
fn mode() -> &'static str {
    if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() {
        "download"
    } else {
        "auto"
    }
}

fn base_state<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    UpdateState {
        status: "idle",
        mode: mode(),
        current_version: app.package_info().version.to_string(),
        latest_version: None,
        release_url: format!("https://github.com/{REPOSITORY}/releases"),
        notes: None,
        progress: None,
        error: None,
    }
}

/// The last state (idle before the first check).
pub fn current<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    app.state::<Updates>()
        .state
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| base_state(app))
}

fn publish<R: Runtime>(app: &AppHandle<R>, state: &UpdateState) {
    *app.state::<Updates>().state.lock().unwrap() = Some(state.clone());
    let _ = app.emit(STATE_EVENT, state);
}

/// Checks on start and then periodically, downloading in `auto` mode.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio_sleep(FIRST_CHECK).await;
        loop {
            let s = check(&app).await;
            if s.status == "available" && s.mode == "auto" {
                let _ = download(&app).await;
            }
            tokio_sleep(CHECK_EVERY).await;
        }
    });
}

async fn tokio_sleep(d: Duration) {
    tokio::time::sleep(d).await;
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

/// Checks for an update and publishes the result. A download in flight or a ready update is
/// left alone (its state is returned).
pub async fn check<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    let now = current(app);
    if matches!(now.status, "downloading" | "ready" | "checking") {
        return now;
    }
    let mut checking = base_state(app);
    checking.status = "checking";
    publish(app, &checking);
    let s = check_inner(app).await;
    publish(app, &s);
    s
}

async fn check_inner<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    let mut state = base_state(app);
    state.status = "up-to-date";
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
            let u = app.state::<Updates>();
            *u.pending.lock().unwrap() = Some(update);
            *u.bytes.lock().unwrap() = None;
            state
        }
        Ok(None) => state,
        Err(e) => fail(state, e.to_string()),
    }
}

/// Percent of `total` done, for the progress line.
pub fn percent(transferred: u64, total: Option<u64>) -> f64 {
    match total {
        Some(t) if t > 0 => (transferred as f64 / t as f64 * 100.0).min(100.0),
        _ => 0.0,
    }
}

/// Downloads the update the last check found, publishing progress; ends `ready`.
pub async fn download<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let u = app.state::<Updates>();
    {
        let mut busy = u.busy.lock().unwrap();
        if *busy {
            return Ok(());
        }
        *busy = true;
    }
    let result = download_inner(app).await;
    *app.state::<Updates>().busy.lock().unwrap() = false;
    if let Err(e) = &result {
        let mut s = current(app);
        s.status = "error";
        s.progress = None;
        s.error = Some(e.clone());
        publish(app, &s);
    }
    result
}

async fn download_inner<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let update = app
        .state::<Updates>()
        .pending
        .lock()
        .unwrap()
        // Keep it stored: a failed download can then be retried without checking again.
        .clone()
        .ok_or("no update to download; check first")?;
    let mut s = current(app);
    s.status = "downloading";
    s.error = None;
    s.progress = Some(Progress {
        percent: 0.0,
        transferred: 0,
        total: None,
    });
    publish(app, &s);
    let mut transferred = 0u64;
    let mut shown = -1.0f64;
    let progress_app = app.clone();
    let progress_state = s.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                transferred += chunk as u64;
                let pct = percent(transferred, total);
                // One event per whole percent is plenty.
                if pct.floor() > shown {
                    shown = pct.floor();
                    let mut p = progress_state.clone();
                    p.progress = Some(Progress {
                        percent: pct,
                        transferred,
                        total,
                    });
                    publish(&progress_app, &p);
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    *app.state::<Updates>().bytes.lock().unwrap() = Some(bytes);
    let mut ready = s;
    ready.status = "ready";
    ready.progress = None;
    publish(app, &ready);
    Ok(())
}

/// Installs the update (downloading it first if needed), then restarts.
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if app.state::<Updates>().bytes.lock().unwrap().is_none() {
        download(app).await?;
    }
    let update = app
        .state::<Updates>()
        .pending
        .lock()
        .unwrap()
        .clone()
        .ok_or("no update to install; check first")?;
    let bytes = app
        .state::<Updates>()
        .bytes
        .lock()
        .unwrap()
        .clone()
        .ok_or("the update didn't download")?;
    update.install(bytes).map_err(|e| e.to_string())?;
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

    #[test]
    fn progress_percent() {
        assert_eq!(percent(50, Some(200)), 25.0);
        assert_eq!(percent(50, None), 0.0);
        assert_eq!(percent(300, Some(200)), 100.0);
    }
}
