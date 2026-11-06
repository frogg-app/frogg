//! Project-scoped settings (ui-next `ProjectSettings.tsx`, the project half of `hostkit.tsx`):
//! pick one of the host's git projects, read its `frogg.json`, and write the edited file back
//! guarded by the revision it was read at. Each editor page lives in its own module.

use std::cell::RefCell;

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{Map, Value};

use crate::components::{Button, ButtonKind, Select, SelectOption};
use crate::state::config::need;
use crate::state::{projects, Conn};
use crate::views::settings::kit::*;

thread_local! {
    /// The picked project, shared by every project page (ui-next module-level `picked`).
    static PICKED: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// One project's `frogg.json`, as loaded from the host.
#[derive(Clone, Copy)]
pub struct ProjectCfg {
    pub config: RwSignal<Option<Value>>,
    revision: RwSignal<Value>,
    pub loading: RwSignal<bool>,
    pub saving: RwSignal<bool>,
    pub error: RwSignal<Option<String>>,
    root: StoredValue<String>,
    tick: RwSignal<u64>,
}

fn rpc_error(code: &str) -> String {
    match code {
        "project_not_found" => "Project not found on this host",
        "invalid_project_config" => "frogg.json is not valid; fix it in the editor",
        "stale_project_config" => {
            "frogg.json changed on disk. Reload configuration before saving again."
        }
        _ => "Couldn’t write frogg.json",
    }
    .to_owned()
}

/// `{ ok: false, error: { code } }` as the page's error text.
fn failure(v: &Value) -> Option<String> {
    if v.get("ok") == Some(&Value::Bool(false)) {
        return Some(rpc_error(
            v.pointer("/error/code")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ));
    }
    None
}

impl ProjectCfg {
    fn new(root: String) -> Self {
        let p = Self {
            config: RwSignal::new(None),
            revision: RwSignal::new(Value::Null),
            loading: RwSignal::new(false),
            saving: RwSignal::new(false),
            error: RwSignal::new(None),
            root: StoredValue::new(root),
            tick: RwSignal::new(0),
        };
        let alive = StoredValue::new(true);
        on_cleanup(move || alive.set_value(false));
        Effect::new(move |_| {
            p.tick.track();
            p.config.set(None);
            p.revision.set(Value::Null);
            p.error.set(None);
            let Ok(c) = need() else { return };
            p.loading.set(true);
            let root = p.root.get_value();
            spawn_local(async move {
                let res = c.read_project_config(&root).await;
                if !alive.get_value() {
                    return;
                }
                p.loading.set(false);
                match res {
                    Ok(v) => {
                        if let Some(e) = failure(&v) {
                            p.error.set(Some(e));
                            return;
                        }
                        let cfg = v
                            .get("config")
                            .filter(|c| c.is_object())
                            .cloned()
                            .unwrap_or_else(|| Value::Object(Map::new()));
                        p.revision
                            .set(v.get("revision").cloned().unwrap_or(Value::Null));
                        p.config.set(Some(cfg));
                    }
                    Err(e) => p.error.set(Some(e.to_string())),
                }
            });
        });
        p
    }

    pub fn reload(&self) {
        self.tick.update(|t| *t += 1);
    }

    /// Writes `next` as the whole file; `done` hears whether it landed.
    pub fn save(&self, next: Value, done: impl FnOnce(bool) + 'static) {
        if self.saving.get_untracked() || self.config.get_untracked().is_none() {
            return;
        }
        let c = match need() {
            Ok(c) => c,
            Err(e) => {
                self.error.set(Some(e));
                return done(false);
            }
        };
        let p = *self;
        let root = self.root.get_value();
        let rev = self.revision.get_untracked();
        let rev = (!rev.is_null()).then_some(rev);
        self.saving.set(true);
        spawn_local(async move {
            let res = c.write_project_config(&root, next.clone(), rev).await;
            p.saving.set(false);
            let ok = match res {
                Ok(v) => match failure(&v) {
                    Some(e) => {
                        p.error.set(Some(e));
                        false
                    }
                    None => {
                        p.config.set(Some(
                            v.get("config")
                                .filter(|c| c.is_object())
                                .cloned()
                                .unwrap_or(next),
                        ));
                        p.revision
                            .set(v.get("revision").cloned().unwrap_or(Value::Null));
                        p.error.set(None);
                        true
                    }
                },
                Err(e) => {
                    p.error.set(Some(e.to_string()));
                    false
                }
            };
            done(ok);
        });
    }

    /// The loaded config (reactive), `{}` before it loads.
    pub fn current(&self) -> Value {
        self.config
            .get()
            .unwrap_or_else(|| Value::Object(Map::new()))
    }
}

/// Picks a project and renders `editor` for its `frogg.json`; a host or project switch
/// remounts the editor, so drafts never cross that boundary.
#[component]
pub fn ProjectSettings(editor: fn(ProjectCfg) -> AnyView) -> impl IntoView {
    let app = crate::state::get();
    let dir = projects::get();
    let picked = RwSignal::new(PICKED.with(|p| p.borrow().clone()));
    let list = Memo::new(move |_| {
        dir.projects
            .get()
            .into_iter()
            .filter(|p| p.is_git())
            .map(|p| (p.project_id.clone(), p.name(), p.project_root_path.clone()))
            .collect::<Vec<_>>()
    });
    let current = Memo::new(move |_| {
        let l = list.get();
        let id = picked.get();
        l.iter()
            .find(|p| Some(&p.0) == id.as_ref())
            .or(l.first())
            .cloned()
    });
    let pick = Callback::new(move |id: String| {
        PICKED.with(|p| *p.borrow_mut() = Some(id.clone()));
        picked.set(Some(id));
    });
    let online = Memo::new(move |_| app.conn.active_link().conn == Conn::Online);
    let host = Memo::new(move |_| app.hosts.active_id.get());
    let root = Memo::new(move |_| current.get().map(|c| c.2));
    move || {
        if !online.get() {
            return view! { <Note>"Host offline. Connect to load its projects."</Note> }.into_any();
        }
        if let Some(e) = dir.error.get() {
            return view! { <ErrorLine text=Some(e) /> }.into_any();
        }
        if !dir.loaded.get() {
            return view! { <Note>"Loading projects…"</Note> }.into_any();
        }
        let _host = host.get();
        let Some(root) = root.get() else {
            return view! { <Note>"No Git projects on this host. Add a project to configure its frogg.json."</Note> }
                .into_any();
        };
        let picker = move || {
            let l = list.get();
            let cur = current.get()?;
            Some(if l.len() > 1 {
                let options = l
                    .iter()
                    .map(|(id, name, _)| SelectOption::new(id.clone(), name.clone()))
                    .collect::<Vec<_>>();
                view! {
                    <div class="set-picker-sel">
                        <Select options=options value=cur.0 on_change=pick />
                    </div>
                }
                .into_any()
            } else {
                view! { <span class="t-mono">{cur.1}</span> }.into_any()
            })
        };
        view! {
            <div class="set-picker">
                <span class="t-label">"project"</span>
                {picker}
            </div>
            <ProjectBody root=root editor=editor />
        }
        .into_any()
    }
}

#[component]
fn ProjectBody(root: String, editor: fn(ProjectCfg) -> AnyView) -> impl IntoView {
    let p = ProjectCfg::new(root.clone());
    let has = Memo::new(move |_| p.config.with(|c| c.is_some()));
    view! {
        <Note>{format!("{root}/frogg.json · Changes edit this project’s configuration file.")}</Note>
        <ErrorLine text=p.error />
        {move || p.error.get().is_some().then(|| view! {
            <div class="set-acts set-gap">
                <Button label="Reload configuration" on_press=Callback::new(move |_| p.reload()) />
            </div>
        })}
        {move || {
            if has.get() {
                editor(p)
            } else {
                view! {
                    <span class="t-label">
                        {move || if p.loading.get() { "Loading configuration…" } else { "Configuration unavailable" }}
                    </span>
                }
                .into_any()
            }
        }}
    }
}

/// The save bar under a project editor: the first problem, then Save (enabled once dirty).
#[component]
pub fn SaveProject(
    p: ProjectCfg,
    #[prop(into)] next: Signal<Value>,
    #[prop(optional, into)] error: Signal<Option<String>>,
) -> impl IntoView {
    let saved = RwSignal::new(false);
    let dirty = Memo::new(move |_| p.config.get().as_ref() != Some(&next.get()));
    let blocked = move || p.saving.get() || error.get().is_some() || !dirty.get();
    let submit = move |_| {
        p.save(next.get_untracked(), move |ok| saved.set(ok));
    };
    view! {
        <ErrorLine text=error />
        <div class="set-acts set-gap">
            <Button
                kind=ButtonKind::Primary
                label=Signal::derive(move || if p.saving.get() { "Saving…".to_owned() } else { "Save changes".to_owned() })
                disabled=Signal::derive(blocked)
                on_press=Callback::new(submit)
            />
            {move || (saved.get() && !dirty.get()).then(|| view! { <span class="t-label">"Saved"</span> })}
        </div>
    }
}

/// A multi-line text box (ui-next `Area`).
#[component]
pub fn Area(value: RwSignal<String>, #[prop(optional, into)] placeholder: String) -> impl IntoView {
    view! {
        <textarea
            class="set-area"
            spellcheck="false"
            placeholder=placeholder
            prop:value=move || value.get()
            on:input=move |ev| value.set(event_target_value(&ev))
        ></textarea>
    }
}

/// `frogg.json` commands arrive as a string or a list; edit them as lines.
pub fn lines_of(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(Value::as_str)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub fn list_of(text: &str) -> Value {
    Value::Array(
        text.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| Value::String(l.to_owned()))
            .collect(),
    )
}

/// Text at `key` in an object, or "".
pub fn text_at(v: &Value, pointer: &str) -> String {
    v.pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// Sets `key` on an object, or removes it for `None` (JS `undefined`).
pub fn put(obj: &mut Map<String, Value>, key: &str, v: Option<Value>) {
    match v {
        Some(v) => {
            obj.insert(key.to_owned(), v);
        }
        None => {
            obj.remove(key);
        }
    }
}

/// The object at `key`, or an empty one.
pub fn obj_at(v: &Value, key: &str) -> Map<String, Value> {
    v.get(key)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lines_round_trip() {
        assert_eq!(lines_of(Some(&json!("npm ci"))), "npm ci");
        assert_eq!(lines_of(Some(&json!(["a", "", "b"]))), "a\nb");
        assert_eq!(list_of(" a \n\n b"), json!(["a", "b"]));
    }

    #[test]
    fn maps_error_codes() {
        assert_eq!(
            failure(&json!({ "ok": false, "error": { "code": "stale_project_config" } })),
            Some(rpc_error("stale_project_config"))
        );
        assert_eq!(failure(&json!({ "ok": true })), None);
    }
}
