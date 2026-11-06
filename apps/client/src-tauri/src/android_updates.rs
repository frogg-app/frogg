//! Android APK self-updater (parity with ui-next's `src/updates/android.ts`).
//!
//! Same UI contract as desktop (`updates.rs`): the `update_*` commands and an [`UpdateState`] on
//! [`STATE_EVENT`], with `mode` "apk". A check finds the newest `-next.N` (or stable) release of
//! this install's channel carrying `Frogg-Next-RS-<v>-android-universal.apk` ([`crate::apk`]); the
//! download streams into the cache with progress, is checked against the release's size and
//! sha256 (GitHub's asset digest, else the release's SHA256SUMS) and only then is renamed into
//! place. Installing hands it to the system installer through the app's FileProvider
//! (`UpdaterPlugin.kt`), sending the user to "Install unknown apps" first when needed.
//!
//! Checks run on start and every few hours; downloads only when asked (mobile data).

use crate::apk::{self, ApkUpdate, Verifier};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const REPOSITORY: &str = "frogg-app/frogg";
pub const STATE_EVENT: &str = "frogg://update-state";
const MODE: &str = "apk";
const CHECK_EVERY: Duration = Duration::from_secs(4 * 60 * 60);
const FIRST_CHECK: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub percent: f64,
    pub transferred: u64,
    pub total: Option<u64>,
}

/// Same shape as `updates::UpdateState` (the UI's `native::UpdateState`).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub status: &'static str,
    pub mode: &'static str,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: String,
    pub notes: Option<String>,
    pub progress: Option<Progress>,
    pub error: Option<String>,
}

struct Native<R: Runtime>(PluginHandle<R>);

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<ApkUpdate>>,
    /// The verified APK of `pending`.
    file: Mutex<Option<PathBuf>>,
    state: Mutex<Option<UpdateState>>,
    busy: Mutex<bool>,
}

/// The Kotlin side (`app.frogg.next.rs.UpdaterPlugin`) as a plugin, plus the update state.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("frogg-apk-updater")
        .setup(|app, api| {
            let handle = api.register_android_plugin("app.frogg.next.rs", "UpdaterPlugin")?;
            app.manage(Native(handle));
            app.manage(Updates::default());
            Ok(())
        })
        .build()
}

fn base_state<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    UpdateState {
        status: "idle",
        mode: MODE,
        current_version: app.package_info().version.to_string(),
        latest_version: None,
        release_url: format!("https://github.com/{REPOSITORY}/releases"),
        notes: None,
        progress: None,
        error: None,
    }
}

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

pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            check(&app).await;
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

/// reqwest over rustls with the Mozilla roots: the platform verifier needs JNI set-up that a
/// Tauri app doesn't do, and GitHub's chain is in webpki-roots.
fn http() -> Result<reqwest::Client, String> {
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|e| e.to_string())?
    .with_root_certificates(roots)
    .with_no_client_auth();
    reqwest::Client::builder()
        .user_agent("frogg-next-rs-updater")
        .use_preconfigured_tls(tls)
        .build()
        .map_err(|e| e.to_string())
}

async fn get(client: &reqwest::Client, url: &str) -> Result<reqwest::Response, String> {
    client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())
}

pub async fn check<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    let now = current(app);
    if matches!(now.status, "downloading" | "ready" | "checking") {
        return now;
    }
    let mut checking = base_state(app);
    checking.status = "checking";
    publish(app, &checking);
    let mut s = base_state(app);
    match find(app).await {
        Ok(Some(up)) => {
            s.status = "available";
            s.latest_version = Some(up.version.to_string());
            s.notes = up.notes.clone();
            if let Some(url) = &up.release_url {
                s.release_url = url.clone();
            }
            let u = app.state::<Updates>();
            *u.pending.lock().unwrap() = Some(up);
            *u.file.lock().unwrap() = None;
        }
        Ok(None) => s.status = "up-to-date",
        Err(e) => {
            s.status = "error";
            s.error = Some(e);
        }
    }
    publish(app, &s);
    s
}

async fn find<R: Runtime>(app: &AppHandle<R>) -> Result<Option<ApkUpdate>, String> {
    let releases: Vec<apk::Release> = http()?
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
    Ok(apk::select(&releases, &app.package_info().version))
}

pub fn percent(transferred: u64, total: Option<u64>) -> f64 {
    match total {
        Some(t) if t > 0 => (transferred as f64 / t as f64 * 100.0).min(100.0),
        _ => 0.0,
    }
}

pub async fn download<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    {
        let u = app.state::<Updates>();
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
    let up = app
        .state::<Updates>()
        .pending
        .lock()
        .unwrap()
        .clone()
        .ok_or("no update to download; check first")?;
    let mut s = current(app);
    s.status = "downloading";
    s.error = None;
    s.progress = Some(Progress {
        percent: 0.0,
        transferred: 0,
        total: (up.size > 0).then_some(up.size),
    });
    publish(app, &s);

    let client = http()?;
    let sha256 = match &up.digest {
        Some(d) => d.clone(),
        None => {
            let url = up
                .sums_url
                .as_deref()
                .ok_or("the release publishes no checksum for the APK")?;
            let sums = get(&client, url)
                .await?
                .text()
                .await
                .map_err(|e| e.to_string())?;
            apk::sum_for(&sums, &up.name).ok_or("the release's SHA256SUMS doesn't list the APK")?
        }
    };

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("app-updates");
    // Old and part-downloaded APKs never reach the installer.
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let part = dir.join(format!("{}.part", up.name));
    let target = dir.join(&up.name);

    let mut res = get(&client, &up.url).await?;
    let total = res.content_length().or((up.size > 0).then_some(up.size));
    let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut verifier = Verifier::default();
    let mut shown = -1.0f64;
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        std::io::Write::write_all(&mut out, &chunk).map_err(|e| e.to_string())?;
        verifier.update(&chunk);
        let pct = percent(verifier.len(), total);
        if pct.floor() > shown {
            shown = pct.floor();
            let mut p = s.clone();
            p.progress = Some(Progress {
                percent: pct,
                transferred: verifier.len(),
                total,
            });
            publish(app, &p);
        }
    }
    out.sync_all().map_err(|e| e.to_string())?;
    drop(out);
    if let Err(e) = verifier.finish(up.size, &sha256) {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    std::fs::rename(&part, &target).map_err(|e| e.to_string())?;
    *app.state::<Updates>().file.lock().unwrap() = Some(target);
    let mut ready = s;
    ready.status = "ready";
    ready.progress = None;
    publish(app, &ready);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallerInfo {
    can_request_package_installs: bool,
}

#[derive(Serialize)]
struct InstallArgs {
    path: String,
}

/// Hands the verified APK to the system installer (downloading it first if needed). When the
/// app may not install packages yet, opens that setting and asks the user to press again.
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if app.state::<Updates>().file.lock().unwrap().is_none() {
        download(app).await?;
    }
    let path = app
        .state::<Updates>()
        .file
        .lock()
        .unwrap()
        .clone()
        .ok_or("the update didn't download")?;
    let native = &app.state::<Native<R>>().0;
    let info: InstallerInfo = native
        .run_mobile_plugin("installerInfo", ())
        .map_err(|e| e.to_string())?;
    if !info.can_request_package_installs {
        native
            .run_mobile_plugin::<()>("openInstallSettings", ())
            .map_err(|e| e.to_string())?;
        return Err("Allow Frogg Next RS to install apps, then press Install again.".into());
    }
    native
        .run_mobile_plugin::<()>(
            "install",
            InstallArgs {
                path: path.to_string_lossy().into_owned(),
            },
        )
        .map_err(|e| e.to_string())
}
