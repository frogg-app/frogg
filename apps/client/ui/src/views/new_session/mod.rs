//! New session (ui-next `NewSession.tsx` + `sessions/create.ts` + `sessions/LaunchFields.tsx`):
//! host, agent or terminal, project (with an inline folder browser that adds the picked folder
//! as a project), worktree isolation and its base branch, provider / model / mode / thinking,
//! provider account and extra CLI flags, the first prompt with attachments, and an optional
//! title. Desktop: a centred cut card; phone: a full-screen sheet.

use std::collections::BTreeMap;

use frogg_client_core::protocol::inbound;
use frogg_client_core::{CreateTerminalOptions, DaemonClient, FileUploadInput};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::components::{use_presence, Button, ButtonKind, Ico, Icon, Seg, Select, SelectOption};
use crate::native::{self, PickedFile};
use crate::state::projects::{self, build, conv, err, Project};
use crate::state::sessions::{paths, provider_label};
use crate::state::{Conn, Tool};
use crate::theme::OVERLAY_OUT_MS;
use crate::views::sessions::folder::FolderBrowser;

// ---- provider snapshot (local decode of GetProvidersSnapshotResponsePayload) ----

#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Choice {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub is_default: Option<bool>,
    pub thinking_options: Option<Vec<Choice>>,
    pub default_thinking_option_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub authenticated: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderEntry {
    pub provider: String,
    pub status: String,
    pub enabled: bool,
    pub label: Option<String>,
    pub models: Option<Vec<ModelInfo>>,
    pub modes: Option<Vec<Choice>>,
    pub default_mode_id: Option<String>,
    pub accounts: Option<Vec<Account>>,
    pub default_account_id: Option<String>,
}

impl ProviderEntry {
    fn models(&self) -> Vec<ModelInfo> {
        self.models.clone().unwrap_or_default()
    }
    fn modes(&self) -> Vec<Choice> {
        self.modes.clone().unwrap_or_default()
    }
    fn name(&self) -> String {
        self.label
            .clone()
            .unwrap_or_else(|| provider_label(&self.provider))
    }
}

async fn ready_providers(c: &DaemonClient) -> Result<Vec<ProviderEntry>, String> {
    let snap = c.get_providers_snapshot(None, None).await.map_err(err)?;
    let v: Value = conv(&snap)?;
    Ok(v["entries"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|e| serde_json::from_value::<ProviderEntry>(e.clone()).ok())
                .filter(|p| p.status == "ready" && p.enabled)
                .collect()
        })
        .unwrap_or_default())
}

/// Every local and published branch of a checkout, local and remote marked.
async fn load_branches(c: &DaemonClient, cwd: &str) -> Result<Vec<SelectOption>, String> {
    let r = c
        .get_branch_suggestions(cwd, None, Some(200))
        .await
        .map_err(err)?;
    let v: Value = conv(&r)?;
    if let Some(e) = v.get("error").and_then(Value::as_str) {
        return Err(e.to_owned());
    }
    let details = v["branchDetails"].as_array().cloned().unwrap_or_default();
    if details.is_empty() {
        return Ok(v["branches"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(|b| SelectOption::new(b, b))
                    .collect()
            })
            .unwrap_or_default());
    }
    Ok(details
        .iter()
        .filter_map(|b| {
            let name = b["name"].as_str()?;
            let ahead = b["localAhead"].as_u64().unwrap_or(0);
            let behind = b["localBehind"].as_u64().unwrap_or(0);
            let parts: Vec<String> = [
                (b["hasLocal"].as_bool() == Some(true)).then(|| "local".to_string()),
                (b["hasRemote"].as_bool() == Some(true)).then(|| "published".to_string()),
                (ahead > 0 || behind > 0).then(|| format!("↑{ahead} ↓{behind}")),
            ]
            .into_iter()
            .flatten()
            .collect();
            let mut o = SelectOption::new(name, name);
            o.hint = (!parts.is_empty()).then(|| parts.join(" · "));
            Some(o)
        })
        .collect())
}

/// A branch name from the title or prompt: lowercase words joined by dashes, at most five.
pub fn slug(text: &str) -> String {
    let s: String = text
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let words: Vec<&str> = s.split('-').filter(|w| !w.is_empty()).take(5).collect();
    if words.is_empty() {
        "session".into()
    } else {
        words.join("-")
    }
}

/// Typed flags as SDK extraArgs (ui-next `launch.ts` `parseFlags`): `--x` is a switch,
/// `--x v` and `--x=v` carry a value.
pub fn parse_flags(text: &str) -> Result<BTreeMap<String, Option<String>>, String> {
    let text = text
        .replace(['\u{2014}', '\u{2013}'], "--")
        .replace(['\u{201c}', '\u{201d}'], "\"")
        .replace(['\u{2018}', '\u{2019}'], "'");
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for c in text.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                started = true;
            }
            None if c.is_whitespace() => {
                if started || !cur.is_empty() {
                    tokens.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            None => cur.push(c),
        }
    }
    if started || !cur.is_empty() {
        tokens.push(cur);
    }
    let mut out = BTreeMap::new();
    let mut i = 0;
    while i < tokens.len() {
        let tok = &tokens[i];
        if !tok.starts_with("--") || tok.len() < 3 {
            return Err(format!(
                "“{tok}” is not a long flag; write flags as --name or --name value"
            ));
        }
        let (name, val) = match tok.find('=') {
            Some(eq) => (tok[2..eq].to_lowercase(), Some(tok[eq + 1..].to_owned())),
            None => (tok[2..].to_lowercase(), None),
        };
        let ok = name.chars().next().is_some_and(|c| c.is_ascii_lowercase())
            && name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !ok {
            return Err(format!("“{tok}” is not a flag name"));
        }
        if val.is_some() {
            out.insert(name, val);
            i += 1;
            continue;
        }
        match tokens.get(i + 1) {
            Some(next) if !next.starts_with("--") => {
                out.insert(name, Some(next.clone()));
                i += 2;
            }
            _ => {
                out.insert(name, None);
                i += 1;
            }
        }
    }
    Ok(out)
}

// ---- attachments ----

#[derive(Clone, Debug, PartialEq)]
struct Draft {
    id: u32,
    file: PickedFile,
}

impl Draft {
    /// Small images go to the model inline; everything else is uploaded as a file.
    fn inline_image(&self) -> bool {
        self.file.mime.starts_with("image/") && self.file.size <= 5 * 1024 * 1024
    }
}

fn base64(bytes: &[u8]) -> String {
    let bin: String = bytes.iter().map(|b| *b as char).collect();
    web_sys::window()
        .and_then(|w| w.btoa(&bin).ok())
        .unwrap_or_default()
}

/// Images ride inline; other files stream to the chosen host first.
async fn prepare(c: &DaemonClient, drafts: &[Draft]) -> Result<(Vec<Value>, Vec<Value>), String> {
    let mut images = Vec::new();
    let mut attachments = Vec::new();
    for d in drafts {
        if d.inline_image() {
            images.push(json!({ "data": base64(&d.file.bytes), "mimeType": d.file.mime }));
            continue;
        }
        let bytes = d.file.bytes.clone();
        let read = move |start: u64, end: u64| {
            let s = (start as usize).min(bytes.len());
            let e = (end as usize).min(bytes.len());
            bytes[s..e].to_vec()
        };
        let res = c
            .upload_file_stream(FileUploadInput {
                file_name: d.file.name.clone(),
                mime_type: if d.file.mime.is_empty() {
                    "application/octet-stream".into()
                } else {
                    d.file.mime.clone()
                },
                size: d.file.size,
                modified_at: None,
                chunk_size: None,
                read: &read,
                on_progress: None,
            })
            .await
            .map_err(err)?;
        if let Some(e) = res.error.filter(|e| !e.is_empty()) {
            return Err(e);
        }
        if res.file.is_null() {
            return Err(format!("Could not upload {}", d.file.name));
        }
        attachments.push(res.file);
    }
    Ok((images, attachments))
}

// ---- the sheet ----

#[derive(Clone, Copy)]
struct Form {
    host_id: RwSignal<Option<String>>,
    kind: RwSignal<String>,
    isolation: RwSignal<String>,
    base: RwSignal<String>,
    prompt: RwSignal<String>,
    title: RwSignal<String>,
    busy: RwSignal<bool>,
    error: RwSignal<Option<String>>,
    browsing: RwSignal<bool>,
    projects: RwSignal<Option<Vec<Project>>>,
    project_id: RwSignal<Option<String>>,
    providers: RwSignal<Option<Vec<ProviderEntry>>>,
    provider: RwSignal<Option<String>>,
    model: RwSignal<Option<String>>,
    mode: RwSignal<Option<String>>,
    thinking: RwSignal<Option<String>>,
    account: RwSignal<Option<String>>,
    flags: RwSignal<String>,
    branches: RwSignal<Option<Vec<SelectOption>>>,
    drafts: RwSignal<Vec<Draft>>,
}

impl Form {
    fn new() -> Self {
        Self {
            host_id: RwSignal::new(None),
            kind: RwSignal::new("agent".into()),
            isolation: RwSignal::new("worktree".into()),
            base: RwSignal::new("main".into()),
            prompt: RwSignal::new(String::new()),
            title: RwSignal::new(String::new()),
            busy: RwSignal::new(false),
            error: RwSignal::new(None),
            browsing: RwSignal::new(false),
            projects: RwSignal::new(None),
            project_id: RwSignal::new(None),
            providers: RwSignal::new(None),
            provider: RwSignal::new(None),
            model: RwSignal::new(None),
            mode: RwSignal::new(None),
            thinking: RwSignal::new(None),
            account: RwSignal::new(None),
            flags: RwSignal::new(String::new()),
            branches: RwSignal::new(None),
            drafts: RwSignal::new(Vec::new()),
        }
    }

    fn client(&self) -> Option<DaemonClient> {
        let app = crate::state::get();
        match self.host_id.get_untracked() {
            Some(h) => app.conn.client_of(&h),
            None => app.conn.client(),
        }
    }

    fn host_conn(&self) -> Conn {
        let app = crate::state::get();
        match self.host_id.get() {
            Some(h) => app.conn.link(&h).conn,
            None => app.conn.active_link().conn,
        }
    }

    fn project(&self) -> Option<Project> {
        let id = self.project_id.get()?;
        self.projects
            .with(|p| p.as_ref()?.iter().find(|x| x.project_id == id).cloned())
    }

    fn entry(&self) -> Option<ProviderEntry> {
        let p = self.provider.get();
        self.providers.with(|ps| {
            let ps = ps.as_ref()?;
            ps.iter()
                .find(|x| Some(&x.provider) == p.as_ref())
                .or_else(|| ps.first())
                .cloned()
        })
    }

    fn model_info(&self) -> Option<ModelInfo> {
        let m = self.model.get();
        self.entry()?
            .models()
            .into_iter()
            .find(|x| Some(&x.id) == m.as_ref())
    }

    fn agent(&self) -> bool {
        self.kind.get() == "agent"
    }

    fn is_git(&self) -> bool {
        self.project().is_some_and(|p| p.is_git())
    }

    fn worktree(&self) -> bool {
        self.agent() && self.is_git() && self.isolation.get() == "worktree"
    }

    fn branch(&self) -> String {
        let t = self.title.get();
        let p = self.prompt.get();
        slug(if t.trim().is_empty() { &p } else { &t })
    }

    fn flags_supported(&self) -> bool {
        self.entry().is_some_and(|e| e.provider == "claude")
            && self
                .client()
                .is_some_and(|c| c.has_feature("claudeExtraArgs"))
    }

    fn flags_error(&self) -> Option<String> {
        if !self.flags_supported() || self.flags.get().trim().is_empty() {
            return None;
        }
        parse_flags(&self.flags.get()).err()
    }

    fn can_create(&self) -> bool {
        !self.busy.get()
            && self.project().is_some()
            && self.host_conn() == Conn::Online
            && (!self.agent()
                || (!self.prompt.get().trim().is_empty()
                    && self.entry().is_some()
                    && self.flags_error().is_none()))
    }

    fn reset(&self) {
        self.prompt.set(String::new());
        self.title.set(String::new());
        self.drafts.set(Vec::new());
        self.flags.set(String::new());
        self.error.set(None);
    }
}

/// Keeps provider, model, mode, thinking and account valid as the snapshot and choices change.
fn keep_choices_valid(f: Form) {
    Effect::new(move |_| {
        let Some(e) = f.entry() else { return };
        if f.provider.get_untracked().as_ref() != Some(&e.provider) {
            f.provider.set(Some(e.provider.clone()));
        }
        let models = e.models();
        let m = f.model.get_untracked();
        if !models.iter().any(|x| Some(&x.id) == m.as_ref()) {
            f.model.set(
                models
                    .iter()
                    .find(|x| x.is_default == Some(true))
                    .or(models.first())
                    .map(|x| x.id.clone()),
            );
        }
        let modes = e.modes();
        let md = f.mode.get_untracked();
        if !modes.iter().any(|x| Some(&x.id) == md.as_ref()) {
            f.mode.set(
                e.default_mode_id
                    .clone()
                    .filter(|d| modes.iter().any(|x| &x.id == d))
                    .or_else(|| modes.first().map(|x| x.id.clone())),
            );
        }
        let accounts = e.accounts.clone().unwrap_or_default();
        let a = f.account.get_untracked();
        if !accounts.iter().any(|x| Some(&x.id) == a.as_ref()) {
            f.account.set(
                e.default_account_id
                    .clone()
                    .filter(|d| accounts.iter().any(|x| &x.id == d)),
            );
        }
    });
    Effect::new(move |_| {
        let opts = f
            .model_info()
            .and_then(|m| m.thinking_options.clone().map(|o| (m, o)));
        match opts {
            Some((m, o)) if !o.is_empty() => {
                let t = f.thinking.get_untracked();
                if !o.iter().any(|x| Some(&x.id) == t.as_ref()) {
                    f.thinking.set(
                        m.default_thinking_option_id
                            .clone()
                            .or_else(|| {
                                o.iter()
                                    .find(|x| x.is_default == Some(true))
                                    .map(|x| x.id.clone())
                            })
                            .or_else(|| o.first().map(|x| x.id.clone())),
                    );
                }
            }
            _ => f.thinking.set(None),
        }
    });
}

async fn submit(f: Form) {
    let app = crate::state::get();
    let Some(c) = f.client() else { return };
    let Some(project) = untrack(|| f.project()) else {
        return;
    };
    let agent = untrack(|| f.agent());
    let entry = untrack(|| f.entry());
    let prompt = f.prompt.get_untracked().trim().to_owned();
    if agent && (entry.is_none() || prompt.is_empty()) {
        return;
    }
    f.busy.set(true);
    f.error.set(None);
    let cwd = project.project_root_path.clone();
    let title = Some(f.title.get_untracked().trim().to_owned()).filter(|t| !t.is_empty());
    let host = f.host_id.get_untracked();
    let res: Result<(), String> = async {
        // A folder listed on this device only: the daemon learns of it now.
        if projects::local::is_local(&project) {
            projects::add_project(&c, &cwd).await?;
        }
        if !agent {
            let r = c
                .create_terminal(
                    &cwd,
                    CreateTerminalOptions {
                        name: title.clone(),
                        ..Default::default()
                    },
                )
                .await
                .map_err(err)?;
            let v: Value = conv(&r)?;
            if let Some(e) = v.get("error").and_then(Value::as_str) {
                return Err(e.to_owned());
            }
            let id = v["terminal"]["id"]
                .as_str()
                .ok_or("Could not start a terminal")?
                .to_owned();
            focus_host(host.as_deref());
            app.ui.set_tool(Tool::Terminals);
            app.ui.open_terminal(Some(id));
            return Ok(());
        }
        let entry = entry.ok_or("No ready agents")?;
        let drafts = f.drafts.get_untracked();
        let (images, attachments) = prepare(&c, &drafts).await?;
        let mut config = json!({
            "provider": entry.provider,
            "cwd": cwd,
        });
        if let Some(m) = f.model.get_untracked() {
            config["model"] = m.into();
        }
        if let Some(m) = f.mode.get_untracked() {
            config["modeId"] = m.into();
        }
        if let Some(t) = f.thinking.get_untracked() {
            config["thinkingOptionId"] = t.into();
        }
        if let Some(a) = f.account.get_untracked() {
            config["providerAccountId"] = a.into();
        }
        if let Some(t) = &title {
            config["title"] = t.clone().into();
        }
        let flags = f.flags.get_untracked();
        if untrack(|| f.flags_supported()) && !flags.trim().is_empty() {
            let args = parse_flags(&flags)?;
            config["providerOptions"] = json!({ "extraArgs": args });
        }
        let mut req = json!({
            "requestId": "",
            "config": config,
            "initialPrompt": prompt,
        });
        if !images.is_empty() {
            req["images"] = images.into();
        }
        if !attachments.is_empty() {
            req["attachments"] = attachments.into();
        }
        if untrack(|| f.worktree()) {
            req["worktree"] = json!({
                "mode": "branch-off",
                "newBranch": untrack(|| f.branch()),
                "base": f.base.get_untracked(),
            });
        }
        let req: inbound::CreateAgentRequest = build(req)?;
        let agent = c.create_agent(&req).await.map_err(err)?;
        focus_host(host.as_deref());
        let id = agent["id"].as_str().unwrap_or_default().to_owned();
        if let (Some(h), Some(s)) = (
            app.hosts.active_id.get_untracked(),
            crate::state::Session::from_entry(&agent, None),
        ) {
            app.agents.by_host.update(|m| {
                let list = m.entry(h).or_default();
                let project = list.get(&id).and_then(|x| x.project.clone());
                list.insert(id.clone(), crate::state::Session { project, ..s });
            });
        }
        app.ui.set_tool(Tool::Sessions);
        app.ui.select(Some(id));
        Ok(())
    }
    .await;
    f.busy.set(false);
    match res {
        Ok(()) => {
            f.reset();
            app.ui.set_new_session(false, None);
        }
        Err(e) => f.error.set(Some(e)),
    }
}

/// Makes `host` the active host when it is not already.
fn focus_host(host: Option<&str>) {
    let app = crate::state::get();
    if let Some(h) = host {
        if app.hosts.active_id.get_untracked().as_deref() != Some(h) {
            app.conn.activate(h);
        }
    }
}

#[component]
pub fn NewSession() -> impl IntoView {
    let app = crate::state::get();
    let ui = app.ui;
    let open = Signal::derive(move || ui.new_session_open.get());
    let p = use_presence(open, OVERLAY_OUT_MS + 30);
    let f = Form::new();
    let close = move || {
        ui.set_new_session(false, None);
        f.error.set(None);
    };
    // Each opening starts on the active host and takes any prompt handed to the sheet.
    Effect::new(move |_| {
        if !open.get() {
            return;
        }
        f.host_id.set(app.hosts.active_id.get_untracked());
        let seed = ui.new_session_prompt.get_untracked();
        if !seed.is_empty() {
            f.prompt.set(seed);
            ui.new_session_prompt.set(String::new());
        }
    });
    // The chosen host's projects and providers; switching hosts starts the pick over. Keyed on a
    // memo: the host's link changes on every status tick, which would close the folder browser.
    let host_key = Memo::new(move |_| (f.host_id.get(), f.host_conn() == Conn::Online));
    Effect::new(move |_| {
        if !open.get() {
            return;
        }
        let (_, online) = host_key.get();
        f.projects.set(None);
        f.providers.set(None);
        f.browsing.set(false);
        let Some(c) = untrack(|| f.client()).filter(|_| online) else {
            return;
        };
        let c2 = c.clone();
        spawn_local(async move {
            match projects::list_projects_on(&c).await {
                Ok(ps) => {
                    let ps: Vec<Project> =
                        ps.into_iter().filter(|p| p.chats != Some(true)).collect();
                    // As this device shows the host: pins first, hidden out, local folders in.
                    let host = f.host_id.get_untracked();
                    let ps = untrack(|| projects::local::visible(host.as_deref(), &ps));
                    let cur = f.project_id.get_untracked();
                    if !ps.iter().any(|p| Some(&p.project_id) == cur.as_ref()) {
                        f.project_id.set(ps.first().map(|p| p.project_id.clone()));
                    }
                    f.projects.set(Some(ps));
                }
                Err(e) => f.error.set(Some(e)),
            }
        });
        spawn_local(async move {
            match ready_providers(&c2).await {
                Ok(ps) => f.providers.set(Some(ps)),
                Err(e) => {
                    f.providers.set(Some(Vec::new()));
                    f.error.set(Some(format!("Could not load providers: {e}")));
                }
            }
        });
    });
    // Start from: the picked checkout's branches.
    Effect::new(move |_| {
        f.branches.set(None);
        if !open.get() {
            return;
        }
        let Some(p) = f.project().filter(|p| p.is_git()) else {
            return;
        };
        let Some(c) = f.client() else { return };
        spawn_local(async move {
            match load_branches(&c, &p.project_root_path).await {
                Ok(list) => {
                    let b = f.base.get_untracked();
                    if !list.iter().any(|x| x.value == b) {
                        if let Some(first) = list.first() {
                            f.base.set(first.value.clone());
                        }
                    }
                    f.branches.set(Some(list));
                }
                Err(e) => {
                    f.branches.set(Some(Vec::new()));
                    f.error.set(Some(format!("Could not list branches: {e}")));
                }
            }
        });
    });
    keep_choices_valid(f);
    let create = move || {
        if untrack(|| f.can_create()) {
            spawn_local(submit(f));
        }
    };
    crate::shell::modal_stack::use_modal_layer(open, Callback::new(move |_| close()));
    let keys = window_event_listener(leptos::ev::keydown, move |ev| {
        if !open.get_untracked() {
            return;
        }
        // Escape is the modal stack's (shell/modal_stack.rs): it closes the top layer only.
        if ev.key() == "Enter" && (ev.meta_key() || ev.ctrl_key()) {
            ev.prevent_default();
            create();
        }
    });
    on_cleanup(move || keys.remove());
    let foot = move || {
        let mut parts = Vec::new();
        if app.hosts.hosts.with(Vec::len) > 1 {
            if let Some(h) = f.host_id.get().and_then(|h| app.hosts.find(&h)) {
                parts.push(h.name);
            }
        }
        if f.worktree() {
            parts.push(format!("worktree · {} from {}", f.branch(), f.base.get()));
        } else if let Some(p) = f.project() {
            parts.push(format!("in {}", p.project_root_path));
        }
        parts.join(" · ")
    };
    let label = move || {
        match (f.agent(), f.busy.get()) {
            (true, false) => "Create session",
            (true, true) => "Creating…",
            (false, false) => "Start terminal",
            (false, true) => "Starting…",
        }
        .to_string()
    };
    view! {
        <Show when=move || p.mounted.get()>
            {move || {
                let phone = app.viewport.phone();
                let closing = p.closing.get();
                if phone {
                    view! {
                        <div class="ns-phone" class:m-sheet-in=!closing class:m-sheet-out=closing>
                            <div class="ns-phone-head">
                                <button class="icon-btn" aria-label="Close" on:click=move |_| close()>
                                    <Icon ico=Ico::X size=20.0 />
                                </button>
                                <span class="t-display ns-heading">"New session"</span>
                            </div>
                            <div class="ns-phone-content">
                                <Fields f=f phone=true />
                            </div>
                            <div class="ns-phone-foot">
                                <Show when=move || !foot().is_empty()>
                                    <span class="t-mono ns-foot-text">{foot}</span>
                                </Show>
                                <Button
                                    label=Signal::derive(label)
                                    kind=ButtonKind::Primary
                                    grow=true
                                    disabled=Signal::derive(move || !f.can_create())
                                    on_press=Callback::new(move |_| create())
                                />
                            </div>
                        </div>
                    }
                    .into_any()
                } else {
                    view! {
                        <div class="layer ns-layer" class:closing=closing>
                            <div
                                class=move || format!("scrim blur {}", if closing { "m-fade-out" } else { "m-fade-in" })
                                on:click=move |_| close()
                            ></div>
                            <div class=format!("ns-box cut flip {}", if closing { "m-pop-out" } else { "m-rise" }) style="--c:16px" role="dialog" aria-modal="true">
                                <div class="ns-content">
                                    <div class="ns-head-row">
                                        <div class="grow1">
                                            <span class="t-mono ns-kbd">{crate::state::kbd::kbd("⌘N")}</span>
                                            <span class="t-display ns-heading">"New session"</span>
                                        </div>
                                        <button class="icon-btn" aria-label="Close" on:click=move |_| close()>
                                            <Icon ico=Ico::X size=16.0 />
                                        </button>
                                    </div>
                                    <Fields f=f phone=false />
                                </div>
                                <div class="ns-foot">
                                    <span class="t-mono ns-foot-text">{foot}</span>
                                    <Button label="Cancel" on_press=Callback::new(move |_| close()) />
                                    <Button
                                        label=Signal::derive(label)
                                        kind=ButtonKind::Primary
                                        kbd="⌘↵"
                                        disabled=Signal::derive(move || !f.can_create())
                                        on_press=Callback::new(move |_| create())
                                    />
                                </div>
                            </div>
                        </div>
                    }
                    .into_any()
                }
            }}
        </Show>
    }
}

/// A labelled row: label left and control right on wide layouts, stacked on phones.
#[component]
fn Row(#[prop(into)] label: Signal<String>, phone: bool, children: Children) -> impl IntoView {
    view! {
        <div class=if phone { "ns-field phone" } else { "ns-field" }>
            <span class="ns-label">{move || label.get()}</span>
            <div class="ns-body">{children()}</div>
        </div>
    }
}

fn opts(list: Vec<(String, String, Option<String>)>) -> Vec<SelectOption> {
    list.into_iter()
        .map(|(v, l, h)| {
            let mut o = SelectOption::new(v, l);
            o.hint = h;
            o
        })
        .collect()
}

fn opt_signal(s: RwSignal<Option<String>>) -> Signal<String> {
    Signal::derive(move || s.get().unwrap_or_default())
}

fn opt_set(s: RwSignal<Option<String>>) -> Callback<String> {
    Callback::new(move |v: String| s.set(Some(v)))
}

#[component]
fn Fields(f: Form, phone: bool) -> impl IntoView {
    let app = crate::state::get();
    let host_options = move || {
        let active = app.hosts.active_id.get();
        app.hosts
            .hosts
            .get()
            .into_iter()
            .map(|h| {
                let link = if Some(&h.id) == active.as_ref() {
                    app.conn.active_link()
                } else {
                    app.conn.link(&h.id)
                };
                let state = match link.conn {
                    Conn::Online => "connected",
                    Conn::Connecting => "connecting…",
                    Conn::Offline => "offline",
                };
                (
                    h.id.clone(),
                    h.name.clone(),
                    Some(format!("{} · {state}", h.endpoint)),
                )
            })
            .collect::<Vec<_>>()
    };
    let kinds = vec![
        ("agent".to_string(), "Agent".to_string()),
        ("terminal".to_string(), "Terminal".to_string()),
    ];
    let isolations = StoredValue::new(vec![
        ("worktree".to_string(), "New worktree".to_string()),
        ("local".to_string(), "Local checkout".to_string()),
    ]);
    let host_signal = Signal::derive(move || f.host_id.get().unwrap_or_default());
    let project_paths = Signal::derive(move || {
        f.projects
            .get()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.project_root_path)
            .collect::<Vec<_>>()
    });
    let pick = RwSignal::new(None::<String>);
    let pick_cwd = RwSignal::new(None::<String>);
    let adding = RwSignal::new(false);
    let pick_err = RwSignal::new(None::<String>);
    let use_folder = move || {
        let Some(folder) = pick.get_untracked().or_else(|| pick_cwd.get_untracked()) else {
            return;
        };
        let Some(c) = f.client() else { return };
        adding.set(true);
        pick_err.set(None);
        spawn_local(async move {
            let res = async {
                projects::add_project(&c, &folder).await?;
                projects::list_projects_on(&c).await
            }
            .await;
            adding.set(false);
            match res {
                Ok(ps) => {
                    let ps: Vec<Project> =
                        ps.into_iter().filter(|p| p.chats != Some(true)).collect();
                    if let Some(hit) = ps.iter().find(|p| p.project_root_path == folder) {
                        f.project_id.set(Some(hit.project_id.clone()));
                    }
                    f.projects.set(Some(ps));
                    f.browsing.set(false);
                }
                Err(e) => pick_err.set(Some(e)),
            }
        });
    };
    let attach = move || {
        spawn_local(async move {
            match native::pick_files(true).await {
                Ok(files) => f.drafts.update(|d| {
                    let base = d.iter().map(|x| x.id).max().unwrap_or(0);
                    for (next, file) in (base + 1..).zip(files) {
                        d.push(Draft { id: next, file });
                    }
                }),
                Err(e) => f.error.set(Some(e)),
            }
        });
    };
    let width = move |w: u32| {
        if phone {
            "100%".to_string()
        } else {
            format!("{w}px")
        }
    };
    view! {
        <Show when=move || app.hosts.hosts.with(|h| h.len() > 1)>
            <Row label="Host" phone=phone>
                <div class="ns-select" style=format!("width:{}", width(240))>
                    {move || view! {
                        <Select options=opts(host_options()) value=host_signal on_change=opt_set(f.host_id) />
                    }}
                </div>
            </Row>
        </Show>
        <Row label="Type" phone=phone>
            <Seg options=kinds value=f.kind on_change=Callback::new(move |v| f.kind.set(v)) />
        </Row>
        <Row label="Project" phone=phone>
            <div class="ns-project-row" class:phone=phone>
                <div class="ns-select" style=format!("width:{}", width(260))>
                    {move || {
                        let o = opts(
                            f.projects
                                .get()
                                .unwrap_or_default()
                                .into_iter()
                                .map(|p| (p.project_id.clone(), p.name(), Some(p.project_root_path.clone())))
                                .collect(),
                        );
                        let placeholder = if f.host_conn() != Conn::Online {
                            "Host offline"
                        } else if f.projects.with(Option::is_some) {
                            "No projects yet"
                        } else {
                            "Loading projects…"
                        };
                        view! { <Select options=o value=opt_signal(f.project_id) on_change=opt_set(f.project_id) placeholder=placeholder /> }
                    }}
                </div>
                <Show when=move || !f.browsing.get() && f.host_conn() == Conn::Online>
                    <Button label="Choose folder…" on_press=Callback::new(move |_| {
                        pick.set(None);
                        pick_err.set(None);
                        f.browsing.set(true);
                    }) />
                </Show>
            </div>
        </Row>
        <Show when=move || f.browsing.get()>
            {move || {
                let host = f.host_id.get();
                let from = untrack(|| f.project()).map(|p| p.project_root_path);
                view! {
                    <div class="ns-browse">
                        <div class="ns-browse-list">
                            {match from {
                                Some(from) => view! { <FolderBrowser picked=pick cwd=pick_cwd host_id=host from=from project_paths=project_paths /> }.into_any(),
                                None => view! { <FolderBrowser picked=pick cwd=pick_cwd host_id=host project_paths=project_paths /> }.into_any(),
                            }}
                        </div>
                        {move || pick_err.get().map(|e| view! { <span class="t-mono sheet-err">{e}</span> })}
                        <div class="ns-browse-acts">
                            <Button label="Cancel" on_press=Callback::new(move |_| f.browsing.set(false)) />
                            <Button
                                label=Signal::derive(move || {
                                    if adding.get() {
                                        "Adding…".to_string()
                                    } else {
                                        match pick.get().or_else(|| pick_cwd.get()) {
                                            Some(p) => format!("Use {}", Some(paths::base_name(&p)).filter(|b| !b.is_empty()).unwrap_or(p)),
                                            None => "Pick a folder".into(),
                                        }
                                    }
                                })
                                kind=ButtonKind::Primary
                                disabled=Signal::derive(move || adding.get() || (pick.get().is_none() && pick_cwd.get().is_none()))
                                on_press=Callback::new(move |_| use_folder())
                            />
                        </div>
                    </div>
                }
            }}
        </Show>
        <Show when=move || f.agent() && f.is_git()>
            <Row label="Isolation" phone=phone>
                <Seg options=isolations.get_value() value=f.isolation on_change=Callback::new(move |v| f.isolation.set(v)) />
            </Row>
        </Show>
        <Show when=move || f.worktree()>
            <Row label="Start from" phone=phone>
                <div class="ns-branch-row">
                    <Icon ico=Ico::GitBranch size=13.0 class="faint" />
                    <div class="ns-select" style=format!("width:{}", width(240))>
                        {move || {
                            let mut list = f.branches.get().unwrap_or_default();
                            let base = f.base.get();
                            if !list.iter().any(|b| b.value == base) {
                                list.insert(0, SelectOption::new(base.clone(), base));
                            }
                            let placeholder = if f.branches.with(Option::is_some) { "No branches" } else { "Loading branches…" };
                            view! { <Select options=list value=f.base on_change=Callback::new(move |v| f.base.set(v)) mono=true placeholder=placeholder /> }
                        }}
                    </div>
                </div>
            </Row>
        </Show>
        <Show when=move || f.agent()>
            <AgentFields f=f phone=phone />
        </Show>
        <Show when=move || f.agent()>
            <div class="ns-prompt">
                <Show when=move || f.drafts.with(|d| !d.is_empty())>
                    <div class="ns-chips">
                        <For
                            each=move || f.drafts.get()
                            key=|d| d.id
                            children=move |d| {
                                let id = d.id;
                                let ico = if d.file.mime.starts_with("image/") { Ico::Image } else { Ico::FileText };
                                view! {
                                    <span class="ns-chip">
                                        <Icon ico=ico size=12.0 class="muted" />
                                        <span class="t-mono ns-chip-name">{d.file.name.clone()}</span>
                                        <button class="icon-btn" aria-label=format!("Remove {}", d.file.name) on:click=move |_| f.drafts.update(|x| x.retain(|y| y.id != id))>
                                            <Icon ico=Ico::X size=11.0 />
                                        </button>
                                    </span>
                                }
                            }
                        />
                    </div>
                </Show>
                <textarea
                    class="ns-prompt-in"
                    class:phone=phone
                    autofocus=!phone
                    placeholder="What should the agent do?"
                    prop:value=move || f.prompt.get()
                    on:input=move |ev| f.prompt.set(event_target_value(&ev))
                ></textarea>
                <div class="ns-prompt-foot">
                    <button class="ns-attach" aria-label="Attach files" on:click=move |_| attach()>
                        <Icon ico=Ico::Paperclip size=14.0 />
                        <span>"Attach"</span>
                    </button>
                    {(!phone).then(|| view! {
                        <input
                            class="ns-title"
                            placeholder="Title (optional)"
                            prop:value=move || f.title.get()
                            on:input=move |ev| f.title.set(event_target_value(&ev))
                        />
                    })}
                </div>
            </div>
        </Show>
        <Show when=move || phone || !f.agent()>
            <Row label=Signal::derive(move || if f.agent() { "Title" } else { "Name" }.to_string()) phone=phone>
                <input
                    class="input ns-name"
                    class:wide=!phone
                    placeholder=move || if f.agent() { "Optional — named from the prompt otherwise" } else { "Optional" }
                    prop:value=move || f.title.get()
                    on:input=move |ev| f.title.set(event_target_value(&ev))
                />
            </Row>
        </Show>
        {move || f.error.get().map(|e| view! {
            <div class="ns-error">
                <span class="ns-error-head">{if f.agent() { "Could not create the session" } else { "Could not start the terminal" }}</span>
                <span class="t-mono ns-error-text">{e}</span>
            </div>
        })}
    }
}

#[component]
fn AgentFields(f: Form, phone: bool) -> impl IntoView {
    let width = move |w: u32| {
        if phone {
            "100%".to_string()
        } else {
            format!("{w}px")
        }
    };
    let provider_options = move || {
        opts(
            f.providers
                .get()
                .unwrap_or_default()
                .into_iter()
                .map(|p| (p.provider.clone(), p.name(), None))
                .collect(),
        )
    };
    let model_options = move || {
        opts(
            f.entry()
                .map(|e| e.models())
                .unwrap_or_default()
                .into_iter()
                .map(|m| (m.id, m.label, None))
                .collect(),
        )
    };
    let mode_options = move || {
        opts(
            f.entry()
                .map(|e| e.modes())
                .unwrap_or_default()
                .into_iter()
                .map(|m| (m.id, m.label, m.description))
                .collect(),
        )
    };
    let thinking_options = move || {
        opts(
            f.model_info()
                .and_then(|m| m.thinking_options)
                .unwrap_or_default()
                .into_iter()
                .map(|m| (m.id, m.label, m.description))
                .collect(),
        )
    };
    let account_options = move || {
        opts(
            f.entry()
                .and_then(|e| e.accounts)
                .unwrap_or_default()
                .into_iter()
                .map(|a| {
                    let hint = (!a.authenticated).then(|| "signed out".to_string());
                    (a.id, a.name, hint)
                })
                .collect(),
        )
    };
    let provider_select = move || {
        view! {
            <div class="ns-select" style=format!("width:{}", width(150))>
                {move || {
                    let placeholder = if f.providers.with(Option::is_some) {
                        "No ready agents"
                    } else {
                        "Loading agents…"
                    };
                    view! { <Select options=provider_options() value=opt_signal(f.provider) on_change=opt_set(f.provider) placeholder=placeholder /> }
                }}
            </div>
        }
    };
    let model_select = move || {
        view! {
            <Show when=move || !model_options().is_empty()>
                <div class="ns-select" style=format!("width:{}", width(170))>
                    {move || view! { <Select options=model_options() value=opt_signal(f.model) on_change=opt_set(f.model) mono=true /> }}
                </div>
            </Show>
        }
    };
    let mode_select = move || {
        view! {
            <Show when=move || !mode_options().is_empty()>
                <div class="ns-select" style=format!("width:{}", width(150))>
                    {move || view! { <Select options=mode_options() value=opt_signal(f.mode) on_change=opt_set(f.mode) /> }}
                </div>
            </Show>
        }
    };
    view! {
        {if phone {
            view! {
                <Row label="Agent" phone=true>{provider_select()}</Row>
                <Show when=move || !model_options().is_empty()>
                    <Row label="Model" phone=true>{model_select()}</Row>
                </Show>
                <Show when=move || !mode_options().is_empty()>
                    <Row label="Mode" phone=true>{mode_select()}</Row>
                </Show>
            }
            .into_any()
        } else {
            view! {
                <Row label="Agent" phone=false>
                    <div class="ns-agent-row">
                        {provider_select()}
                        {model_select()}
                        {mode_select()}
                    </div>
                </Row>
            }
            .into_any()
        }}
        <Show when=move || !thinking_options().is_empty()>
            <Row label="Thinking" phone=phone>
                <div class="ns-select" style=format!("width:{}", width(170))>
                    {move || view! { <Select options=thinking_options() value=opt_signal(f.thinking) on_change=opt_set(f.thinking) /> }}
                </div>
            </Row>
        </Show>
        <Show when=move || { account_options().len() > 1 }>
            <Row label="Account" phone=phone>
                <div class="ns-select" style=format!("width:{}", width(220))>
                    {move || view! { <Select options=account_options() value=opt_signal(f.account) on_change=opt_set(f.account) /> }}
                </div>
            </Row>
        </Show>
        <Show when=move || f.flags_supported()>
            <Row label="Extra flags" phone=phone>
                <div class="ns-flags" style=format!("width:{}", width(330))>
                    <input
                        class="input t-mono"
                        placeholder="--add-dir /path --chrome"
                        spellcheck="false"
                        autocomplete="off"
                        prop:value=move || f.flags.get()
                        on:input=move |ev| f.flags.set(event_target_value(&ev))
                    />
                    {move || f.flags_error().map(|e| view! { <span class="field-err">{e}</span> })}
                </div>
            </Row>
        </Show>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        assert_eq!(
            slug("Fix the login bug, please now ok"),
            "fix-the-login-bug-please"
        );
        assert_eq!(slug("  !! "), "session");
    }

    #[test]
    fn flags() {
        let a = parse_flags("--chrome --add-dir /x --model=opus").unwrap();
        assert_eq!(a.get("chrome"), Some(&None));
        assert_eq!(a.get("add-dir"), Some(&Some("/x".into())));
        assert_eq!(a.get("model"), Some(&Some("opus".into())));
        assert!(parse_flags("-x").is_err());
        let q = parse_flags("--append \"a b\"").unwrap();
        assert_eq!(q.get("append"), Some(&Some("a b".into())));
    }
}
