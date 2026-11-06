//! App › Plugins (ui-next `Plugins.tsx`, `ClaudePlugins.tsx`): a pointer to the Plugins tool,
//! each installed plugin's settings form, and the host's Claude Code plugins with updates due.

use std::collections::HashMap;

use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use serde_json::{json, Map, Value};

use crate::components::{Button, ButtonKind, Ico, Select, SelectOption};
use crate::state::config::{self, ago, need, ns, s, Action};
use crate::state::ui::Tool;
use crate::views::settings::kit::*;

/// Per-plugin settings revisions, bumped by `plugins.changed` (reason `settings`).
#[derive(Clone, Copy)]
struct Revs(RwSignal<HashMap<String, u64>>);

#[component]
pub fn Plugins() -> impl IntoView {
    let app = crate::state::get();
    let supported = config::feature("plugins");
    let installed = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "plugins.list.request", json!({})).await },
        Signal::derive(move || supported == Some(true)),
        None,
    );
    let revs = Revs(RwSignal::new(HashMap::new()));
    // Installs, updates and settings saved elsewhere show here at once.
    if let Some(c) = app.conn.client().filter(|_| supported == Some(true)) {
        let id = c.subscribe(move |e| {
            if let frogg_client_core::Event::Session(f) = e {
                if f.kind != "plugins.changed" {
                    return;
                }
                let p = f.json()["payload"].clone();
                match p["reason"].as_str().unwrap_or_default() {
                    "contributions" | "repos" => {}
                    "settings" => {
                        if let Some(id) = p["pluginId"].as_str() {
                            revs.0.update(|r| *r.entry(id.to_owned()).or_default() += 1);
                        }
                    }
                    _ => installed.reload(),
                }
            }
        });
        let c = leptos::__reexports::send_wrapper::SendWrapper::new(c);
        on_cleanup(move || c.unsubscribe(id));
    }
    let list = move || {
        installed
            .data
            .get()
            .and_then(|d| d.get("plugins").and_then(Value::as_array).cloned())
            .unwrap_or_default()
    };
    view! {
        <Banner
            ico=Ico::Puzzle
            title="Manage plugins in the Plugins tool"
            body="Install, update, sources and permissions live in the rail. Settings for each installed plugin are listed here too."
        >
            <Button label="Open Plugins" on_press=Callback::new(move |_| app.ui.set_tool(Tool::Plugins)) />
        </Banner>
        {if supported == Some(false) {
            view! { <span class="set-muted">"Update this daemon to manage plugins."</span> }.into_any()
        } else {
            view! {
                <RpcStatus rpc=installed what="plugins">
                    {move || {
                        let l = list();
                        if l.is_empty() {
                            view! {
                                <Section title="Installed plugins">
                                    <Block><span class="set-muted">"No plugins installed on this host."</span></Block>
                                </Section>
                            }.into_any()
                        } else {
                            l.into_iter()
                                .map(|p| view! { <PluginSettings id=s(&p, "id") name=s(&p, "name") revs=revs /> })
                                .collect_view()
                                .into_any()
                        }
                    }}
                </RpcStatus>
            }.into_any()
        }}
        <ClaudePlugins />
    }
}

#[component]
fn PluginSettings(id: String, name: String, revs: Revs) -> impl IntoView {
    let pid = id.clone();
    let rpc = config::use_rpc(
        move |c: DaemonClient| {
            let id = pid.clone();
            async move { ns(&c, "plugins.settings.get.request", json!({ "id": id })).await }
        },
        Signal::derive(|| true),
        None,
    );
    let rid = id.clone();
    Effect::new(move |prev: Option<u64>| {
        let rev = revs.0.with(|r| r.get(&rid).copied().unwrap_or(0));
        if prev.is_some_and(|p| p != rev) {
            rpc.reload();
        }
        rev
    });
    let id = StoredValue::new(id);
    view! {
        <Section title=name.clone()>
            <RpcStatus rpc=rpc what=format!("{name} settings")>
                {move || rpc.data.get().map(|d| view! { <PluginForm id=id.get_value() data=d reload=Callback::new(move |_| rpc.reload()) /> })}
            </RpcStatus>
        </Section>
    }
}

fn fields_of(data: &Value) -> Vec<Value> {
    data.get("fields")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// A field's shown value: the draft, else the saved value, else its default.
fn shown(field: &Value, data: &Value, draft: &Map<String, Value>) -> Value {
    let key = s(field, "key");
    draft
        .get(&key)
        .or_else(|| {
            data.pointer(&format!("/values/{key}"))
                .filter(|v| !v.is_null())
        })
        .or_else(|| field.get("default"))
        .cloned()
        .unwrap_or(Value::Null)
}

/// Whether the draft can't be saved: a number that doesn't parse, or a required field empty
/// (an untouched saved secret counts as set).
fn invalid(fields: &[Value], data: &Value, draft: &Map<String, Value>) -> bool {
    fields.iter().any(|f| {
        let key = s(f, "key");
        let ty = s(f, "type");
        let value = shown(f, data, draft);
        let text = as_text(&value);
        if ty == "number" && draft.contains_key(&key) && text.trim().parse::<f64>().is_err() {
            return true;
        }
        let empty = value.is_null() || value == json!("");
        if f.get("required") == Some(&Value::Bool(true)) && empty {
            let saved = data
                .get("values")
                .and_then(Value::as_object)
                .is_some_and(|v| v.contains_key(&key));
            return !(ty == "secret" && saved && !draft.contains_key(&key));
        }
        false
    })
}

fn as_text(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

#[component]
fn PluginForm(id: String, data: Value, reload: Callback<()>) -> impl IntoView {
    // Only touched keys are sent: an untouched redacted secret must never be cleared.
    let draft = RwSignal::new(Map::<String, Value>::new());
    let act = Action::new();
    let fields = StoredValue::new(fields_of(&data));
    let data = StoredValue::new(data);
    let bad = Memo::new(move |_| {
        draft.with(|d| fields.with_value(|f| data.with_value(|v| invalid(f, v, d))))
    });
    let id = StoredValue::new(id);
    let save = move |_| {
        let mut values = draft.get_untracked();
        fields.with_value(|fs| {
            for f in fs.iter().filter(|f| s(f, "type") == "number") {
                let key = s(f, "key");
                if let Some(v) = values.get(&key) {
                    if let Ok(n) = as_text(v).trim().parse::<f64>() {
                        values.insert(key, json!(n));
                    }
                }
            }
        });
        let id = id.get_value();
        act.run(
            "save",
            async move {
                let v = ns(
                    &need()?,
                    "plugins.settings.set.request",
                    json!({ "id": id, "values": values }),
                )
                .await?;
                if v.get("success") == Some(&Value::Bool(true)) {
                    Ok(v)
                } else {
                    Err("Plugin settings were not saved".to_owned())
                }
            },
            move |_| reload.run(()),
        );
    };
    let empty = fields.with_value(Vec::is_empty);
    view! {
        {fields.get_value().into_iter().map(|f| view! { <SettingRow field=f data=data draft=draft /> }).collect_view()}
        <Block>
            {if empty {
                view! { <span class="set-muted">"This plugin has no settings."</span> }.into_any()
            } else {
                view! {
                    <Acts>
                        <Button
                            kind=ButtonKind::Primary
                            label=Signal::derive(move || if act.busy() { "Saving…".to_owned() } else { "Save".to_owned() })
                            disabled=Signal::derive(move || act.busy() || draft.with(Map::is_empty) || bad.get())
                            on_press=Callback::new(save)
                        />
                    </Acts>
                }.into_any()
            }}
            <ErrorLine text=act.error />
            {move || bad.get().then(|| view! { <span class="set-muted">"Complete required fields and enter valid numbers."</span> })}
        </Block>
    }
}

#[component]
fn SettingRow(
    field: Value,
    data: StoredValue<Value>,
    draft: RwSignal<Map<String, Value>>,
) -> impl IntoView {
    let key = s(&field, "key");
    let title = s(&field, "title");
    let ty = s(&field, "type");
    let f = StoredValue::new(field.clone());
    let value = Signal::derive(move || {
        draft.with(|d| f.with_value(|f| data.with_value(|v| shown(f, v, d))))
    });
    let k = key.clone();
    let set = move |v: Value| {
        let k = k.clone();
        draft.update(|d| {
            d.insert(k, v);
        });
    };
    let control = match ty.as_str() {
        "boolean" => view! {
            <Toggle
                value=Signal::derive(move || value.get() == Value::Bool(true))
                on_change=Callback::new(move |b: bool| set(json!(b)))
                label=title.clone()
            />
        }
        .into_any(),
        "select" => {
            let options = field
                .get("options")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .map(|o| SelectOption::new(s(o, "value"), s(o, "label")))
                        .collect()
                })
                .unwrap_or_default();
            view! {
                <div class="set-select-200">
                    <Select
                        options=options
                        value=Signal::derive(move || as_text(&value.get()))
                        on_change=Callback::new(move |v: String| set(json!(v)))
                    />
                </div>
            }
            .into_any()
        }
        _ => {
            let secret = ty == "secret";
            let saved = data.with_value(|d| {
                d.get("values")
                    .and_then(Value::as_object)
                    .is_some_and(|v| v.contains_key(&key))
            });
            let placeholder = if secret && saved {
                "Saved · enter to replace".to_owned()
            } else {
                title.clone()
            };
            view! {
                <input
                    class="set-input"
                    type=if secret { "password" } else { "text" }
                    spellcheck="false"
                    autocomplete="off"
                    aria-label=title.clone()
                    placeholder=placeholder
                    prop:value=move || as_text(&value.get())
                    on:input=move |ev| set(json!(event_target_value(&ev)))
                />
            }
            .into_any()
        }
    };
    view! {
        <Row label=title.clone() hint=s(&field, "description")>
            {control}
        </Row>
    }
}

// ----- Claude Code plugins ---------------------------------------------------------------------

#[component]
fn ClaudePlugins() -> impl IntoView {
    if config::feature("claudePluginUpdates") != Some(true) {
        return ().into_any();
    }
    let rpc = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "provider.claude_plugins.list.request", json!({})).await },
        Signal::derive(|| true),
        None,
    );
    view! {
        <RpcStatus rpc=rpc what="Claude Code plugins">
            {move || {
                let sources: Vec<Value> = rpc
                    .data
                    .get()
                    .and_then(|d| d.get("sources").and_then(Value::as_array).cloned())
                    .unwrap_or_default();
                let many = sources.len() > 1;
                let used: Vec<Value> = sources.into_iter().filter(|s| !plugins_of(s).is_empty()).collect();
                if used.is_empty() {
                    view! {
                        <Section title="Claude Code plugins">
                            <Block><span class="set-muted">"No Claude Code plugins installed on this host."</span></Block>
                        </Section>
                    }.into_any()
                } else {
                    used.into_iter().map(|src| source_section(src, many)).collect_view().into_any()
                }
            }}
        </RpcStatus>
    }
    .into_any()
}

fn plugins_of(src: &Value) -> Vec<Value> {
    src.get("plugins")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn flag(v: &Value, k: &str) -> bool {
    v.get(k) == Some(&Value::Bool(true))
}

fn source_section(src: Value, named: bool) -> impl IntoView {
    let accounts: Vec<String> = src
        .get("accountNames")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let title = if named && !accounts.is_empty() {
        format!("Claude Code plugins · {}", accounts.join(", "))
    } else {
        "Claude Code plugins".to_owned()
    };
    let plugins = plugins_of(&src);
    let due: Vec<&Value> = plugins.iter().filter(|p| flag(p, "updateDue")).collect();
    let unknown = plugins
        .iter()
        .filter(|p| p.get("latestVersion").is_none_or(Value::is_null))
        .count();
    let used: Vec<String> = plugins.iter().map(|p| s(p, "marketplace")).collect();
    let refreshed: Vec<String> = src
        .get("marketplaces")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|m| used.contains(&s(m, "name")))
                .map(refreshed_line)
                .collect()
        })
        .unwrap_or_default();
    let due_note = (!due.is_empty()).then(|| due_note(&due));
    let unknown_note = (unknown > 0).then(|| {
        format!(
            "{} no version in its marketplace, so updates can’t be detected.",
            if unknown == 1 {
                "1 plugin declares".to_owned()
            } else {
                format!("{unknown} plugins declare")
            }
        )
    });
    view! {
        <Section title=title>
            {plugins.into_iter().map(plugin_item).collect_view()}
        </Section>
        {refreshed.into_iter().map(|l| view! { <Note>{l}</Note> }).collect_view()}
        {due_note.map(|n| view! { <Note>{n}</Note> })}
        {unknown_note.map(|n| view! { <Note>{n}</Note> })}
    }
}

/// Semver gets a v; git-sha installs show as they are.
fn ver(v: Option<&str>) -> String {
    match v {
        Some(v) if v.starts_with(|c: char| c.is_ascii_digit()) => format!("v{v}"),
        Some(v) => v.to_owned(),
        None => String::new(),
    }
}

fn plugin_item(p: Value) -> impl IntoView {
    let scope = s(&p, "scope");
    let market = s(&p, "marketplace");
    let where_ = if scope == "user" {
        market
    } else {
        let path = p
            .get("projectPath")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or(scope);
        format!("{market} · {path}")
    };
    let installed = p.get("installedVersion").and_then(Value::as_str);
    let latest = p.get("latestVersion").and_then(Value::as_str);
    let version = if flag(&p, "updateDue") {
        format!("{} → {}", ver(installed), ver(latest))
    } else if installed.is_some() {
        ver(installed)
    } else {
        "no version".to_owned()
    };
    let pill = if flag(&p, "updateDue") {
        Some((
            if flag(&p, "autoUpdate") {
                "update on restart"
            } else {
                "update due"
            },
            "amber",
        ))
    } else {
        latest.map(|_| ("up to date", ""))
    };
    view! {
        <Item ico=Ico::Blocks title=s(&p, "name") sub=format!("{where_} · {version}")>
            {pill.map(|(t, tint)| view! { <Pill text=t tint=tint /> })}
        </Item>
    }
}

fn refreshed_line(m: &Value) -> String {
    let when = match m.get("lastUpdated").and_then(Value::as_str) {
        Some(at) => format!("last refreshed {}", ago(at)),
        None => "never refreshed".to_owned(),
    };
    format!(
        "{}: marketplace {when}{}",
        s(m, "name"),
        if flag(m, "autoUpdate") {
            " · auto-updates"
        } else {
            ""
        }
    )
}

fn due_note(due: &[&Value]) -> String {
    let auto = due.iter().filter(|p| flag(p, "autoUpdate")).count();
    if auto == due.len() {
        "Claude Code installs these updates itself when a Claude agent starts. Restart running Claude agents to pick them up.".into()
    } else if auto == 0 {
        "Their marketplaces don’t auto-update. Run /plugin in Claude Code to update them.".into()
    } else {
        "Plugins marked “update on restart” update when a Claude agent starts; for the rest, run /plugin in Claude Code.".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_settings() {
        let fields = vec![
            json!({ "key": "n", "type": "number" }),
            json!({ "key": "k", "type": "secret", "required": true }),
        ];
        let data = json!({ "values": { "k": "***" } });
        let mut d = Map::new();
        assert!(!invalid(&fields, &data, &d));
        d.insert("n".into(), json!("abc"));
        assert!(invalid(&fields, &data, &d));
        d.insert("n".into(), json!("3"));
        d.insert("k".into(), json!(""));
        assert!(invalid(&fields, &data, &d));
    }

    #[test]
    fn versions() {
        assert_eq!(ver(Some("1.2.0")), "v1.2.0");
        assert_eq!(ver(Some("abc123")), "abc123");
    }
}
