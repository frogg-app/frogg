//! Launch options for a new agent beyond provider, model and mode (ui-next
//! `sessions/LaunchFields.tsx`, `launch.ts`): the provider's feature toggles and selects, extra
//! flags seeded from the picked account's launch args merged with the project's frogg.json
//! `agentDefaults`, and "Save for project" to keep the current flags and features as defaults.

use std::collections::BTreeMap;

use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Map, Value};

use super::parse_flags;
use crate::components::{Select, SelectOption};
use crate::views::sessions::menus::Toggle;

pub type ExtraArgs = BTreeMap<String, Option<String>>;

// ----- flags -----

/// Splits typed flags on whitespace, keeping "quoted values" together.
pub fn tokenize(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
            continue;
        }
        if c == '"' || c == '\'' {
            chars.next();
            let mut tok = String::new();
            for n in chars.by_ref() {
                if n == c {
                    break;
                }
                tok.push(n);
            }
            out.push(tok);
            continue;
        }
        let mut tok = String::new();
        while let Some(&n) = chars.peek() {
            if n.is_whitespace() {
                break;
            }
            tok.push(n);
            chars.next();
        }
        out.push(tok);
    }
    out
}

/// Tokens back to text; tokens with spaces are quoted.
pub fn flags_text(tokens: &[String]) -> String {
    tokens
        .iter()
        .map(|t| {
            if t.is_empty() || t.contains(char::is_whitespace) {
                format!("\"{t}\"")
            } else {
                t.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Undoes the OS's smart punctuation in a flags field (em dash for `--`, curly quotes).
pub fn plain_flags(text: &str) -> String {
    text.replace(['\u{2014}', '\u{2013}'], "--")
        .replace(['\u{201c}', '\u{201d}'], "\"")
        .replace(['\u{2018}', '\u{2019}'], "'")
}

/// SDK extraArgs back to flag tokens.
pub fn args_tokens(args: &ExtraArgs) -> Vec<String> {
    args.iter()
        .flat_map(|(k, v)| match v {
            None => vec![format!("--{k}")],
            Some(v) => vec![format!("--{k}"), v.clone()],
        })
        .collect()
}

fn parse_tokens(t: &[String]) -> ExtraArgs {
    parse_flags(&flags_text(t)).unwrap_or_default()
}

/// The account's flags, then the project's on top (a flag both set takes the project's value).
pub fn merge_flags(account: &[String], project: &[String]) -> Vec<String> {
    let mut a = parse_tokens(account);
    a.extend(parse_tokens(project));
    args_tokens(&a)
}

/// Typed flags minus the ones the account already supplies with the same value.
pub fn without_account_flags(typed: &str, account: &[String]) -> Vec<String> {
    let Ok(args) = parse_flags(typed) else {
        return tokenize(typed);
    };
    let mine = parse_tokens(account);
    let kept: ExtraArgs = args
        .into_iter()
        .filter(|(k, v)| mine.get(k) != Some(v))
        .collect();
    args_tokens(&kept)
}

// ----- project defaults -----

fn agent_defaults_of(config: &Value) -> Map<String, Value> {
    config
        .get("agentDefaults")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn str_list(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn read_err(v: &Value) -> String {
    v.pointer("/error/code")
        .and_then(Value::as_str)
        .map(|c| c.replace('_', " "))
        .unwrap_or_else(|| "could not read frogg.json".into())
}

/// Writes one provider's defaults into the project's frogg.json, keeping everything else.
async fn save_defaults(
    c: &DaemonClient,
    root: &str,
    provider: &str,
    args: Vec<String>,
    features: Map<String, Value>,
) -> Result<(), String> {
    let read = c
        .read_project_config(root)
        .await
        .map_err(|e| e.to_string())?;
    if read.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(read_err(&read));
    }
    let mut config = read.get("config").cloned().unwrap_or_else(|| json!({}));
    let mut all = agent_defaults_of(&config);
    let mut entry = all
        .get(provider)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    entry.remove("args");
    entry.remove("featureValues");
    if !args.is_empty() {
        entry.insert("args".into(), json!(args));
    }
    if !features.is_empty() {
        entry.insert("featureValues".into(), Value::Object(features));
    }
    if entry.is_empty() {
        all.remove(provider);
    } else {
        all.insert(provider.into(), Value::Object(entry));
    }
    if let Some(o) = config.as_object_mut() {
        if all.is_empty() {
            o.remove("agentDefaults");
        } else {
            o.insert("agentDefaults".into(), Value::Object(all));
        }
    }
    let res = c
        .write_project_config(root, config, read.get("revision").cloned())
        .await
        .map_err(|e| e.to_string())?;
    if res.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(read_err(&res));
    }
    Ok(())
}

// ----- state -----

/// A provider feature for a new agent: a toggle or a select.
#[derive(Debug, Clone, PartialEq)]
pub struct Feature {
    pub id: String,
    pub label: String,
    pub toggle: bool,
    pub options: Vec<(String, String)>,
    pub value: Value,
}

fn feature_of(v: &Value) -> Option<Feature> {
    Some(Feature {
        id: v.get("id")?.as_str()?.to_owned(),
        label: v
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        toggle: v.get("type").and_then(Value::as_str) == Some("toggle"),
        options: v
            .get("options")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|o| {
                        Some((
                            o.get("id")?.as_str()?.to_owned(),
                            o.get("label")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_owned(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        value: v.get("value").cloned().unwrap_or(Value::Null),
    })
}

/// Launch state shared by the form and its submit.
#[derive(Clone, Copy)]
pub struct Launch {
    pub inputs: Inputs,
    /// The provider's `agentDefaults` entry from frogg.json; `None` until read (or unreadable).
    defaults: RwSignal<Option<Map<String, Value>>>,
    readable: RwSignal<bool>,
    reload: RwSignal<u32>,
    pub features: RwSignal<Vec<Feature>>,
    edits: RwSignal<Map<String, Value>>,
    seed: RwSignal<String>,
    saving: RwSignal<bool>,
    saved: RwSignal<bool>,
    save_err: RwSignal<Option<String>>,
}

/// What the form gives the launch fields to work from (all reactive).
#[derive(Clone, Copy)]
pub struct Inputs {
    /// The chosen host (None: the active one) and whether it is online.
    pub host: Memo<(Option<String>, bool)>,
    pub provider: Memo<Option<String>>,
    pub root: Memo<Option<String>>,
    /// Launch args stored with the picked account.
    pub account_args: Signal<Vec<String>>,
    pub flags: RwSignal<String>,
    pub flags_on: Signal<bool>,
}

impl Inputs {
    fn client(&self) -> Option<DaemonClient> {
        let (host, online) = self.host.get();
        if !online {
            return None;
        }
        let conn = crate::state::get().conn;
        untrack(|| match host {
            Some(h) => conn.client_of(&h),
            None => conn.client(),
        })
    }

    fn client_untracked(&self) -> Option<DaemonClient> {
        untrack(|| self.client())
    }
}

impl Launch {
    pub fn new(i: Inputs) -> Self {
        let l = Self {
            inputs: i,
            defaults: RwSignal::new(None),
            readable: RwSignal::new(false),
            reload: RwSignal::new(0),
            features: RwSignal::new(Vec::new()),
            edits: RwSignal::new(Map::new()),
            seed: RwSignal::new(String::new()),
            saving: RwSignal::new(false),
            saved: RwSignal::new(false),
            save_err: RwSignal::new(None),
        };
        // frogg.json agentDefaults for (root, provider).
        Effect::new(move |_| {
            l.reload.track();
            let (client, root, provider) = (i.client(), i.root.get(), i.provider.get());
            l.defaults.set(None);
            l.readable.set(false);
            l.saved.set(false);
            let (Some(c), Some(root), Some(provider)) = (client, root, provider) else {
                return;
            };
            spawn_local(async move {
                let Ok(r) = c.read_project_config(&root).await else {
                    return;
                };
                if r.get("ok").and_then(Value::as_bool) != Some(true) {
                    return;
                }
                if i.root.get_untracked().as_deref() != Some(root.as_str()) {
                    return;
                }
                let all = agent_defaults_of(r.get("config").unwrap_or(&Value::Null));
                let mine = all
                    .get(&provider)
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                l.readable.set(true);
                l.defaults.set(Some(mine));
            });
        });
        // Seed the flags field: account args, then the project's on top.
        Effect::new(move |_| {
            let project = l
                .defaults
                .with(|d| str_list(d.as_ref().and_then(|d| d.get("args"))));
            let seed = flags_text(&merge_flags(&i.account_args.get(), &project));
            i.provider.track();
            i.root.track();
            l.seed.set(seed.clone());
            i.flags.set(seed);
            l.edits.set(Map::new());
        });
        // The provider's features valued as they would launch with the project defaults.
        Effect::new(move |_| {
            let (client, root, provider) = (i.client(), i.root.get(), i.provider.get());
            let seed = l.defaults.with(|d| {
                d.as_ref()
                    .and_then(|d| d.get("featureValues"))
                    .cloned()
                    .unwrap_or_else(|| json!({}))
            });
            l.features.set(Vec::new());
            let (Some(c), Some(root), Some(provider)) = (client, root, provider) else {
                return;
            };
            spawn_local(async move {
                let draft = json!({ "provider": provider, "cwd": root, "featureValues": seed });
                if let Ok(r) = c.list_provider_features(draft).await {
                    let list = serde_json::to_value(r.features.unwrap_or_default())
                        .ok()
                        .and_then(|v| v.as_array().cloned())
                        .unwrap_or_default();
                    if i.root.get_untracked().as_deref() == Some(root.as_str()) {
                        l.features.set(list.iter().filter_map(feature_of).collect());
                    }
                }
            });
        });
        l
    }

    fn value(&self, f: &Feature) -> Value {
        self.edits
            .with(|e| e.get(&f.id).cloned())
            .unwrap_or_else(|| f.value.clone())
    }

    fn set_value(&self, id: &str, v: Value) {
        self.edits.update(|e| {
            e.insert(id.to_owned(), v);
        });
    }

    /// Feature values to launch with: project defaults, then edits.
    pub fn feature_values(&self) -> Map<String, Value> {
        let mut out = self.defaults.with(|d| {
            d.as_ref()
                .and_then(|d| d.get("featureValues"))
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default()
        });
        out.extend(self.edits.get());
        out
    }

    fn dirty(&self, flags: &str) -> bool {
        let defaults = self.defaults.with(|d| {
            d.as_ref()
                .and_then(|d| d.get("featureValues"))
                .cloned()
                .unwrap_or(Value::Null)
        });
        flags.trim() != self.seed.get().trim()
            || self
                .edits
                .with(|e| e.iter().any(|(k, v)| defaults.get(k) != Some(v)))
    }

    fn save(&self) {
        let i = self.inputs;
        let (Some(c), Some(root), Some(provider)) = (
            i.client_untracked(),
            i.root.get_untracked(),
            i.provider.get_untracked(),
        ) else {
            return;
        };
        let flags = i.flags.get_untracked();
        if i.flags_on.get_untracked() && parse_flags(&flags).is_err() {
            return;
        }
        let args = if i.flags_on.get_untracked() {
            without_account_flags(&flags, &i.account_args.get_untracked())
        } else {
            self.defaults
                .with_untracked(|d| str_list(d.as_ref().and_then(|d| d.get("args"))))
        };
        let features = untrack(|| self.feature_values());
        let l = *self;
        l.saving.set(true);
        l.save_err.set(None);
        spawn_local(async move {
            let res = save_defaults(&c, &root, &provider, args, features).await;
            l.saving.set(false);
            match res {
                Ok(()) => {
                    l.reload.update(|n| *n += 1);
                    // The reload clears `saved`; mark it once the read lands.
                    set_timeout(
                        move || l.saved.set(true),
                        std::time::Duration::from_millis(300),
                    );
                }
                Err(e) => l.save_err.set(Some(e)),
            }
        });
    }
}

/// Feature rows and the "Save for project" link. `Row` is the form's field shell.
#[component]
pub fn LaunchFeatures(
    launch: Launch,
    phone: bool,
    row: fn(String, bool, AnyView) -> AnyView,
) -> impl IntoView {
    let l = launch;
    let inputs = l.inputs;
    let save_link = move || {
        let flags = inputs.flags.get();
        let can = l.readable.get();
        let dirty = l.dirty(&flags);
        if !can {
            return ().into_any();
        }
        if l.saved.get() && !dirty {
            return view! { <span class="ns-save-note">"Project default"</span> }.into_any();
        }
        if !dirty {
            return ().into_any();
        }
        let off = l.saving.get() || (inputs.flags_on.get() && parse_flags(&flags).is_err());
        view! {
            <button
                class="ns-save-link"
                class:off=off
                disabled=off
                aria-label="Save as project default"
                on:click=move |_| l.save()
            >
                {move || if l.saving.get() { "Saving…" } else { "Save for project" }}
            </button>
        }
        .into_any()
    };
    view! {
        <For
            each=move || l.features.get()
            key=|x| x.id.clone()
            children=move |x| {
                let x = StoredValue::new(x);
                let body = if x.with_value(|x| x.toggle) {
                    view! {
                        <Toggle
                            value=Signal::derive(move || l.value(&x.get_value()) == Value::Bool(true))
                            on_change=Callback::new(move |on: bool| l.set_value(&x.with_value(|x| x.id.clone()), Value::Bool(on)))
                        />
                    }
                    .into_any()
                } else {
                    let options: Vec<SelectOption> = x.with_value(|x| {
                        x.options.iter().map(|(v, l)| SelectOption::new(v.clone(), l.clone())).collect()
                    });
                    let value = Signal::derive(move || l.value(&x.get_value()).as_str().unwrap_or_default().to_owned());
                    view! {
                        <div class="ns-select" style=if phone { "width:100%" } else { "width:240px" }>
                            <Select
                                options=options
                                value=value
                                on_change=Callback::new(move |v: String| l.set_value(&x.with_value(|x| x.id.clone()), Value::String(v)))
                            />
                        </div>
                    }
                    .into_any()
                };
                row(x.with_value(|x| x.label.clone()), phone, body)
            }
        />
        <div class="ns-save">{save_link}</div>
        {move || l.save_err.get().map(|e| view! { <span class="field-err">{e}</span> })}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| (*x).to_owned()).collect()
    }

    #[test]
    fn tokens_round_trip() {
        assert_eq!(tokenize("--a \"b c\" --d"), v(&["--a", "b c", "--d"]));
        assert_eq!(flags_text(&v(&["--a", "b c"])), "--a \"b c\"");
        assert_eq!(plain_flags("\u{2014}chrome"), "--chrome");
    }

    #[test]
    fn merges_and_strips_account_flags() {
        let m = merge_flags(&v(&["--x", "1", "--y"]), &v(&["--x", "2"]));
        assert_eq!(m, v(&["--x", "2", "--y"]));
        assert_eq!(
            without_account_flags("--x 2 --y", &v(&["--y"])),
            v(&["--x", "2"])
        );
    }
}
