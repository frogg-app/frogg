//! "Tools, skills & prompts" (ui-next `settings/pages/Orchestration.tsx`): Frogg's agent tools,
//! the host-wide appended system prompt, skills and the agent definitions providers load.

use std::collections::HashMap;

use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use serde_json::{json, Value};

use crate::components::{Button, ButtonKind};
use crate::state::config::{self, need, ns, s, Action};
use crate::views::settings::kit::*;

#[component]
pub fn ToolsPrompts() -> impl IntoView {
    let cfg = config::get();
    let prompt = RwSignal::new(None::<String>);
    let draft = move || {
        prompt.get().unwrap_or_else(|| {
            cfg.at("/appendSystemPrompt")
                .map(|v| v.as_str().unwrap_or_default().to_owned())
                .unwrap_or_default()
        })
    };
    let flag = move |p: &'static str| Signal::derive(move || cfg.flag(p).unwrap_or(false));
    let saving = Signal::derive(move || cfg.saving.get());
    let save = move |_| {
        if let Some(p) = prompt.get_untracked() {
            cfg.patch(json!({ "appendSystemPrompt": p }));
            prompt.set(None);
        }
    };
    let loaded = Memo::new(move |_| cfg.config.with(Option::is_some));
    move || {
        if !loaded.get() {
            return view! { <Note>"Connect to a host to load its tools and prompts."</Note> }
                .into_any();
        }
        view! {
            <Section title="Frogg tools for agents">
                <Row label="Enable Frogg tools" hint="Lets agents create worktrees, start agents and schedule work (MCP)">
                    <Toggle
                        value=flag("/mcp/injectIntoAgents")
                        disabled=saving
                        on_change=Callback::new(move |v: bool| cfg.patch(json!({ "mcp": { "injectIntoAgents": v } })))
                    />
                </Row>
                <Row label="Browser tools" hint="Agents can drive browser tabs. Exposes page content to the model">
                    <Toggle
                        value=flag("/browserTools/enabled")
                        disabled=saving
                        on_change=Callback::new(move |v: bool| cfg.patch(json!({ "browserTools": { "enabled": v } })))
                    />
                </Row>
                <Row label="Terminal agent hooks" hint="Installs hooks so terminal agents report status">
                    <Toggle
                        value=flag("/enableTerminalAgentHooks")
                        disabled=saving
                        on_change=Callback::new(move |v: bool| cfg.patch(json!({ "enableTerminalAgentHooks": v })))
                    />
                </Row>
            </Section>
            <Section title="System prompt for every agent">
                <Block>
                    <textarea
                        class="set-area"
                        placeholder="Instructions appended to new agents on this host"
                        prop:value=draft
                        on:input=move |ev| prompt.set(Some(event_target_value(&ev)))
                    ></textarea>
                    <Acts>
                        <Button
                            label="Save"
                            kind=ButtonKind::Primary
                            disabled=Signal::derive(move || saving.get() || prompt.get().is_none())
                            on_press=Callback::new(save)
                        />
                        <Button
                            label="Revert"
                            disabled=Signal::derive(move || prompt.get().is_none())
                            on_press=Callback::new(move |_| prompt.set(None))
                        />
                    </Acts>
                </Block>
            </Section>
            <Skills />
            <Definitions />
        }
        .into_any()
    }
}

#[component]
fn Skills() -> impl IntoView {
    let supported = config::feature("skillsManagement");
    let rpc = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "daemon.skills.list.request", json!({})).await },
        Signal::derive(move || supported == Some(true)),
        None,
    );
    // Open skill contents by id; lives here so a list reload (which remounts rows) keeps them.
    let open = RwSignal::new(HashMap::<String, String>::new());
    let list = move || {
        rpc.data
            .get()
            .and_then(|d| d.get("skills").and_then(Value::as_array).cloned())
            .unwrap_or_default()
    };
    view! {
        <Section title="Skills">
            {if supported == Some(false) {
                view! { <Block><span>"Update this daemon to manage skills."</span></Block> }.into_any()
            } else {
                view! {
                    <RpcStatus rpc=rpc what="skills">
                        {move || {
                            let skills = list();
                            if skills.is_empty() {
                                view! { <Block><span>"No skills found."</span></Block> }.into_any()
                            } else {
                                skills
                                    .into_iter()
                                    .map(|sk| view! { <SkillRow skill=sk open=open reload=Callback::new(move |_| rpc.reload()) /> })
                                    .collect_view()
                                    .into_any()
                            }
                        }}
                    </RpcStatus>
                }.into_any()
            }}
        </Section>
    }
}

#[component]
fn SkillRow(
    skill: Value,
    open: RwSignal<HashMap<String, String>>,
    reload: Callback<()>,
) -> impl IntoView {
    let act = Action::new();
    let id = StoredValue::new(s(&skill, "id"));
    let content = Memo::new(move |_| open.with(|o| id.with_value(|i| o.get(i).cloned())));
    let enabled = skill.get("enabled") == Some(&Value::Bool(true));
    let busy = Signal::derive(move || act.busy());
    let toggle = Callback::new(move |v: bool| {
        let id = id.get_value();
        act.run(
            "toggle",
            async move {
                ns(
                    &need()?,
                    "daemon.skills.set_enabled.request",
                    json!({ "skillId": id, "enabled": v }),
                )
                .await
            },
            move |_| reload.run(()),
        );
    });
    let view_content = Callback::new(move |_| {
        if content.get_untracked().is_some() {
            open.update(|o| {
                o.remove(&id.get_value());
            });
            return;
        }
        let id = id.get_value();
        let key = id.clone();
        act.run(
            "view",
            async move {
                ns(
                    &need()?,
                    "daemon.skills.get_content.request",
                    json!({ "skillId": id }),
                )
                .await
            },
            move |v| {
                open.update(|o| {
                    o.insert(key, s(&v, "content"));
                })
            },
        );
    });
    view! {
        <Item title=s(&skill, "name") sub=s(&skill, "description")>
            <Button
                label=Signal::derive(move || if content.get().is_none() { "View".to_owned() } else { "Hide".to_owned() })
                disabled=busy
                on_press=view_content
            />
            <Toggle value=enabled disabled=busy on_change=toggle />
        </Item>
        <ErrorLine text=act.error />
        {move || content.get().map(|c| view! {
            <Block><pre class="set-pre t-mono">{c}</pre></Block>
        })}
    }
}

#[component]
fn Definitions() -> impl IntoView {
    let supported = config::feature("providerAgentDefinitions");
    let rpc = config::use_rpc(
        |c: DaemonClient| async move {
            ns(&c, "agent.provider_definitions.list.request", json!({})).await
        },
        Signal::derive(move || supported == Some(true)),
        None,
    );
    view! {
        <Section title="Agent definitions on disk">
            {if supported == Some(false) {
                view! { <Block><span>"Update this daemon to list agent definitions."</span></Block> }.into_any()
            } else {
                view! {
                    <RpcStatus rpc=rpc what="agent definitions">
                        {move || {
                            let defs = rpc
                                .data
                                .get()
                                .and_then(|d| d.get("definitions").and_then(Value::as_array).cloned())
                                .unwrap_or_default();
                            if defs.is_empty() {
                                view! { <Block><span>"No user-level agent definitions found."</span></Block> }.into_any()
                            } else {
                                defs.into_iter()
                                    .map(|d| view! {
                                        <Item
                                            title=s(&d, "name")
                                            sub=format!("{} · {}", s(&d, "provider"), s(&d, "path"))
                                            mono=true
                                        />
                                    })
                                    .collect_view()
                                    .into_any()
                            }
                        }}
                    </RpcStatus>
                }.into_any()
            }}
        </Section>
    }
}
