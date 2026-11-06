//! App › Developer (ui-next `Developer.tsx`): this app's channel and the host's development
//! daemon builds, with launch, rebuild-and-restart and stop.

use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use serde_json::{json, Value};

use crate::components::Button;
use crate::state::config::{self, call, need, ns, s, Action};
use crate::views::settings::kit::*;

#[component]
pub fn Developer() -> impl IntoView {
    view! {
        <Section title="Channels">
            <Row label="This app" hint=format!("Frogg Next · {}", env!("CARGO_PKG_VERSION")) />
        </Section>
        <Note>"Development daemons run separately from the selected host."</Note>
        <DevBuilds />
    }
}

fn flag(v: &Value, k: &str) -> bool {
    v.get(k) == Some(&Value::Bool(true))
}

#[component]
fn DevBuilds() -> impl IntoView {
    let supported = config::feature_untracked("daemonChannelControl");
    let rpc = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "daemon.dev_daemon.get_status.request", json!({})).await },
        Signal::derive(move || supported == Some(true)),
        Some(10_000),
    );
    view! {
        <Section title="Dev builds">
            {if supported == Some(false) {
                view! { <Block><span class="set-muted">"Update this daemon to manage development builds."</span></Block> }.into_any()
            } else {
                view! {
                    <RpcStatus rpc=rpc what="development builds">
                        {move || rpc.data.get().map(|st| {
                            let checkouts = st.get("checkouts").and_then(Value::as_array).cloned().unwrap_or_default();
                            let ok = flag(&st, "supported");
                            let note = if !ok {
                                Some(st.get("reason").and_then(Value::as_str).unwrap_or("Development builds unavailable on this host.").to_owned())
                            } else if checkouts.is_empty() {
                                Some("No source checkouts found on this host.".to_owned())
                            } else {
                                None
                            };
                            let status = StoredValue::new(st.clone());
                            view! {
                                {note.map(|n| view! { <Block><span class="set-muted">{n}</span></Block> })}
                                {checkouts.into_iter().map(|c| view! {
                                    <DevRow checkout=c status=status reload=Callback::new(move |_| rpc.reload()) />
                                }).collect_view()}
                            }
                        })}
                    </RpcStatus>
                }.into_any()
            }}
        </Section>
    }
}

#[component]
fn DevRow(checkout: Value, status: StoredValue<Value>, reload: Callback<()>) -> impl IntoView {
    let act = Action::new();
    let can_rebuild = config::feature_untracked("devDaemonRebuild") == Some(true);
    let cwd = s(&checkout, "cwd");
    let st = status.get_value();
    let instance = st
        .get("instances")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().find(|i| s(i, "cwd") == cwd).cloned());
    let running = instance.is_some() || (flag(&st, "running") && s(&st, "cwd") == cwd);
    let inst_busy = instance.as_ref().is_some_and(|i| flag(i, "busy"));
    let rebuildable = instance
        .as_ref()
        .and_then(|i| i.get("canRebuild").and_then(Value::as_bool))
        .unwrap_or_else(|| flag(&st, "canRebuild"));
    let is_self = s(&st, "selfCwd") == cwd || (flag(&st, "isSelf") && s(&st, "cwd") == cwd);
    let last_error = instance.as_ref().and_then(|i| {
        i.get("lastError")
            .and_then(Value::as_str)
            .map(str::to_owned)
    });
    let supported = flag(&st, "supported");
    let branch = checkout
        .get("branch")
        .and_then(Value::as_str)
        .unwrap_or("Unknown branch")
        .to_owned();
    let hint = format!(
        "{cwd} · {branch} · {}",
        if running { "running" } else { "stopped" }
    );
    let cwd = StoredValue::new(cwd);
    let run = move |key: &'static str, req: &'static str, fields: Value| {
        act.run(
            key,
            async move {
                let resp = req.replace(".request", ".response");
                // Start and stop wait on the build; match the core's daemon-control timeout.
                call(&need()?, req, fields, &resp, Some(90_000)).await
            },
            move |_| reload.run(()),
        );
    };
    let busy = move || act.busy() || inst_busy;
    view! {
        <Row label=s(&checkout, "name") hint=hint>
            {(!running).then(|| view! {
                <Button
                    label="Launch"
                    disabled=Signal::derive(move || busy() || !supported)
                    on_press=Callback::new(move |_| run("launch", "daemon.dev_daemon.start.request", json!({ "cwd": cwd.get_value() })))
                />
            })}
            {(running && can_rebuild).then(|| view! {
                <Confirm
                    label="Rebuild & restart…"
                    confirm="Rebuild daemon"
                    disabled=Signal::derive(move || busy() || !rebuildable)
                    on_confirm=Callback::new(move |_| run("rebuild", "daemon.dev_daemon.rebuild.request", json!({ "target": "daemon", "cwd": cwd.get_value() })))
                />
            })}
            {(running && !is_self).then(|| view! {
                <Confirm
                    label="Stop…"
                    confirm="Stop dev build"
                    disabled=Signal::derive(busy)
                    on_confirm=Callback::new(move |_| run("stop", "daemon.dev_daemon.stop.request", json!({ "cwd": cwd.get_value() })))
                />
            })}
        </Row>
        <ErrorLine text=Signal::derive(move || act.error.get().or_else(|| last_error.clone())) />
    }
}
