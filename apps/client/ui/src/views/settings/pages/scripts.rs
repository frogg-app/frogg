//! Project › Scripts & services (ui-next `Scripts.tsx`): the project's named scripts, each a
//! command and optionally a service, written to `frogg.json`.

use leptos::prelude::*;
use serde_json::{json, Map, Value};

use super::project::{put, Area, ProjectCfg, ProjectSettings, SaveProject};
use crate::components::Button;
use crate::views::settings::kit::*;

#[component]
pub fn Scripts() -> impl IntoView {
    view! { <ProjectSettings editor=editor /> }
}

fn editor(p: ProjectCfg) -> AnyView {
    view! { <Editor p=p /> }.into_any()
}

#[component]
fn Editor(p: ProjectCfg) -> impl IntoView {
    let init = p.config.get_untracked().unwrap_or_default();
    let scripts = RwSignal::new(
        init.get("scripts")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default(),
    );
    let name = RwSignal::new(String::new());
    let duplicate = move || {
        let n = name.get();
        let n = n.trim();
        !n.is_empty() && scripts.with(|s| s.contains_key(n))
    };
    let add = move || {
        let key = name.get_untracked().trim().to_owned();
        if key.is_empty() || scripts.with_untracked(|s| s.contains_key(&key)) {
            return;
        }
        scripts.update(|s| {
            s.insert(key, json!({ "command": "" }));
        });
        name.set(String::new());
    };
    let next = Signal::derive(move || {
        let mut out = p.current().as_object().cloned().unwrap_or_default();
        out.insert("scripts".into(), Value::Object(scripts.get()));
        Value::Object(out)
    });
    let invalid = Signal::derive(move || {
        scripts
            .with(|s| {
                s.values().any(|v| {
                    v.get("command")
                        .and_then(Value::as_str)
                        .is_none_or(|c| c.trim().is_empty())
                })
            })
            .then(|| "Every script needs a command.".to_owned())
    });
    let keys = move || scripts.with(|s| s.keys().cloned().collect::<Vec<_>>());
    view! {
        <Section title="Scripts">
            <For each=keys key=|k| k.clone() let:key>
                <ScriptRow name=key scripts=scripts />
            </For>
            <Block>
                <Acts>
                    <Input value=name placeholder="New script name" on_enter=Callback::new(move |_| add()) />
                    <Button
                        label="Add script"
                        disabled=Signal::derive(move || name.get().trim().is_empty() || duplicate())
                        on_press=Callback::new(move |_| add())
                    />
                </Acts>
                <ErrorLine text=Signal::derive(move || duplicate().then(|| "A script with this name already exists.".to_owned())) />
            </Block>
        </Section>
        <Section title="Service URLs">
            <Row
                label="Port allocation"
                hint="Service scripts receive $FROGG_PORT. Configure the allocation range in Worktrees."
            />
        </Section>
        <Note>"Saving changes configuration only. Run scripts from the Scripts tool."</Note>
        <SaveProject p=p next=next error=invalid />
    }
}

#[component]
fn ScriptRow(name: String, scripts: RwSignal<Map<String, Value>>) -> impl IntoView {
    let key = StoredValue::new(name.clone());
    let entry = move || scripts.with(|s| s.get(&key.get_value()).cloned());
    let edit = move |f: &dyn Fn(&mut Map<String, Value>)| {
        scripts.update(|s| {
            if let Some(Value::Object(o)) = s.get_mut(&key.get_value()) {
                f(o);
            }
        });
    };
    let is_service = Signal::derive(move || {
        entry().and_then(|e| e.get("type").cloned()) == Some(json!("service"))
    });
    let command = RwSignal::new(
        entry()
            .and_then(|e| e.get("command").and_then(Value::as_str).map(str::to_owned))
            .unwrap_or_default(),
    );
    // Only a real edit writes back, so a non-string command is left alone until typed over.
    Effect::new(move |prev: Option<()>| {
        let c = command.get();
        if prev.is_none() {
            return;
        }
        edit(&|o| {
            if o.get("command").and_then(Value::as_str) != Some(c.as_str()) {
                o.insert("command".into(), json!(c));
            }
        });
    });
    view! {
        <Block>
            <Row
                label=name
                hint=Signal::derive(move || if is_service.get() { "Service · $FROGG_PORT".to_owned() } else { "Command".to_owned() })
            >
                <Confirm
                    label="Remove…"
                    confirm="Remove script"
                    on_confirm=Callback::new(move |_| scripts.update(|s| {
                        s.shift_remove(&key.get_value());
                    }))
                />
            </Row>
            <Area value=command placeholder="Command" />
            <Row label="Service" hint="Keep running and expose a port">
                <Toggle
                    value=is_service
                    label="Service"
                    on_change=Callback::new(move |v: bool| edit(&|o| put(o, "type", v.then(|| json!("service")))))
                />
            </Row>
        </Block>
    }
}
