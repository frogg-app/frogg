//! Host › Terminal profiles (ui-next `TerminalProfiles.tsx`): named shell commands that appear
//! in the terminal's new-tab menu, stored as `terminalProfiles` in the host's config.

use leptos::prelude::*;
use serde_json::{json, Value};

use crate::components::{Button, ButtonKind, Ico};
use crate::state::config::{self, s};
use crate::views::settings::kit::*;

/// JSON keeps quotes, empty arguments and backslashes without a shell.
fn split_args(text: &str) -> Option<Vec<String>> {
    let text = if text.trim().is_empty() { "[]" } else { text };
    serde_json::from_str::<Vec<String>>(text).ok()
}

fn join_args(v: &Value) -> String {
    let args: Vec<String> = v
        .get("args")
        .and_then(|a| serde_json::from_value(a.clone()).ok())
        .unwrap_or_default();
    serde_json::to_string(&args).unwrap_or_else(|_| "[]".into())
}

fn base36(mut n: u64) -> String {
    const D: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(D[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in name.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    out
}

#[derive(Clone)]
struct Draft {
    name: String,
    command: String,
    args: String,
}

fn list() -> Vec<Value> {
    config::get()
        .config
        .with_untracked(|c| {
            c.as_ref()
                .and_then(|c| c.get("terminalProfiles"))
                .and_then(Value::as_array)
                .cloned()
        })
        .unwrap_or_default()
}

fn save(list: Vec<Value>) {
    config::get().patch(json!({ "terminalProfiles": list }));
}

#[component]
pub fn TerminalProfiles() -> impl IntoView {
    let cfg = config::get();
    let adding = RwSignal::new(false);
    let profiles = Memo::new(move |_| {
        cfg.at("/terminalProfiles")
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
    });
    let loaded = Memo::new(move |_| cfg.config.with(|c| c.is_some()));
    let add = Callback::new(move |d: Draft| {
        let id = format!("{}-{}", slug(&d.name), base36(js_sys::Date::now() as u64));
        let mut l = list();
        l.push(json!({ "id": id, "name": d.name, "command": d.command, "args": split_args(&d.args).unwrap_or_default() }));
        save(l);
        adding.set(false);
    });
    move || {
        if !loaded.get() {
            return view! { <span class="t-label">"loading…"</span> }.into_any();
        }
        view! {
            <Lede>"Profiles appear in the terminal’s new-tab menu on every device connected to this host."</Lede>
            <Section title="Profiles">
                {move || (profiles.get().is_empty() && !adding.get()).then(|| view! {
                    <Block><span class="set-muted">"No profiles yet. New terminals open the host’s login shell."</span></Block>
                })}
                <For each=move || profiles.get() key=|p| p.to_string() let:p>
                    <ProfileRow profile=p />
                </For>
                {move || if adding.get() {
                    view! {
                        <Editor
                            initial=Draft { name: String::new(), command: String::new(), args: String::new() }
                            on_save=add
                            on_cancel=Callback::new(move |_| adding.set(false))
                        />
                    }.into_any()
                } else {
                    view! {
                        <Block><Acts><Button label="Add profile" on_press=Callback::new(move |_| adding.set(true)) /></Acts></Block>
                    }.into_any()
                }}
            </Section>
        }
        .into_any()
    }
}

#[component]
fn ProfileRow(profile: Value) -> impl IntoView {
    let editing = RwSignal::new(false);
    let id = s(&profile, "id");
    let id2 = id.clone();
    let initial = Draft {
        name: s(&profile, "name"),
        command: s(&profile, "command"),
        args: join_args(&profile),
    };
    let sub = format!("{} {}", s(&profile, "command"), join_args(&profile))
        .trim()
        .to_owned();
    let update = Callback::new(move |d: Draft| {
        let l = list()
            .into_iter()
            .map(|mut p| {
                if s(&p, "id") == id {
                    p["name"] = json!(d.name);
                    p["command"] = json!(d.command);
                    p["args"] = json!(split_args(&d.args).unwrap_or_default());
                }
                p
            })
            .collect();
        save(l);
        editing.set(false);
    });
    let remove = Callback::new(move |_| {
        save(list().into_iter().filter(|p| s(p, "id") != id2).collect());
    });
    let initial = StoredValue::new(initial);
    let title = s(&profile, "name");
    move || {
        if editing.get() {
            view! {
                <Editor initial=initial.get_value() on_save=update on_cancel=Callback::new(move |_| editing.set(false)) />
            }
            .into_any()
        } else {
            view! {
                <Item ico=Ico::SquareTerminal title=title.clone() sub=sub.clone() mono=true>
                    <Button label="Edit" on_press=Callback::new(move |_| editing.set(true)) />
                    <Confirm label="Remove…" confirm="Remove profile" on_confirm=remove />
                </Item>
            }
            .into_any()
        }
    }
}

#[component]
fn Editor(initial: Draft, on_save: Callback<Draft>, on_cancel: Callback<()>) -> impl IntoView {
    let cfg = config::get();
    let name = RwSignal::new(initial.name);
    let command = RwSignal::new(initial.command);
    let args = RwSignal::new(initial.args);
    let parsed_ok = Memo::new(move |_| split_args(&args.get()).is_some());
    let ok = move || {
        !name.get().trim().is_empty()
            && !command.get().trim().is_empty()
            && parsed_ok.get()
            && !cfg.saving.get()
    };
    let submit = move || {
        if ok() {
            on_save.run(Draft {
                name: name.get_untracked().trim().to_owned(),
                command: command.get_untracked().trim().to_owned(),
                args: args.get_untracked(),
            });
        }
    };
    view! {
        <Block>
            <div class="set-fields">
                <Input value=name placeholder="Name" autofocus=true />
                <Input value=command placeholder="Command, e.g. /bin/zsh" mono=true />
                <Input
                    value=args
                    placeholder="Arguments as JSON, e.g. [\"-l\"]"
                    mono=true
                    grow=true
                    on_enter=Callback::new(move |_| submit())
                />
            </div>
            {move || (!parsed_ok.get()).then(|| view! { <span class="set-muted">"Enter a JSON array of argument strings."</span> })}
            <Acts>
                <Button label="Cancel" on_press=on_cancel />
                <Button
                    kind=ButtonKind::Primary
                    label="Save"
                    disabled=Signal::derive(move || !ok())
                    on_press=Callback::new(move |_| submit())
                />
            </Acts>
        </Block>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_and_ids() {
        assert_eq!(split_args(""), Some(vec![]));
        assert_eq!(
            split_args(r#"["-l", ""]"#),
            Some(vec!["-l".into(), "".into()])
        );
        assert_eq!(split_args("-l"), None);
        assert_eq!(join_args(&json!({ "args": ["-l"] })), r#"["-l"]"#);
        assert_eq!(slug("My Zsh!"), "my-zsh-");
        assert_eq!(base36(35), "z");
        assert_eq!(base36(36), "10");
    }
}
