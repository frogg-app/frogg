//! "Security" (ui-next `settings/pages/Security.tsx`): posture findings with their fixes, the
//! daemon password, and the LAN trust and claim mode switches.

use frogg_client_core::DaemonClient;
use leptos::prelude::*;
use serde_json::{json, Value};

use crate::components::{Button, ButtonKind, Ico, Icon};
use crate::state::config::{self, need, ns, s, Action};
use crate::views::settings::kit::*;

fn copy(id: &str, listen: &str) -> (String, String) {
    let (t, b) = match id {
        "unclaimed" => (
            "Nobody owns this host yet",
            "The first device to pair becomes its owner. Pair one of yours now.".to_owned(),
        ),
        "exposed_without_password" => (
            "Listening on all interfaces without a password",
            format!("This host binds {listen}. Anyone on this network can request pairing."),
        ),
        "trust_lan_diverges" => (
            "Trusting the local network",
            "Clients on the LAN connect without pairing or a password.".to_owned(),
        ),
        "bind_diverges" => (
            "Listen address differs from the default",
            format!("This host binds {listen}."),
        ),
        "claim_mode_diverges" => (
            "Claim mode is off",
            "New devices can connect without the owner approving them.".to_owned(),
        ),
        other => return (other.replace('_', " "), String::new()),
    };
    (t.to_owned(), b)
}

fn flag(v: &Value, key: &str) -> bool {
    v.get(key) == Some(&Value::Bool(true))
}

/// A `daemon.auth.<key>` setting pinned by the daemon's environment (`overrideControlledPaths`).
/// The daemon refuses changes to it, so the page shows the lock instead of a live control.
fn pinned(set: &Value, key: &str) -> bool {
    let path = format!("daemon.auth.{key}");
    set.get("overrideControlledPaths")
        .and_then(Value::as_array)
        .is_some_and(|ps| ps.iter().filter_map(Value::as_str).any(|p| p == path))
}

/// Hint for an access toggle: the env lock wins, then a failed update, then the default.
fn toggle_hint(locked_by: Option<&str>, error: Option<String>, default: &str) -> String {
    match (locked_by, error) {
        (Some(var), _) => format!("Locked: set by {var} in the daemon’s environment"),
        (None, Some(e)) => e,
        (None, None) => default.to_owned(),
    }
}

/// One finding line: tone icon, title, body and actions (ui-next `hostkit` `Finding`).
#[component]
fn Finding(
    tone: &'static str,
    #[prop(into)] title: String,
    #[prop(optional, into)] body: Signal<String>,
    #[prop(optional)] children: Option<Children>,
) -> impl IntoView {
    let (ico, tint) = match tone {
        "warn" => (Ico::ShieldAlert, "amber"),
        "bad" => (Ico::AlertTriangle, "coral"),
        _ => (Ico::Check, "mint"),
    };
    view! {
        <div class="set-find">
            <Icon ico=ico size=16.0 class=tint />
            <div class="set-find-text">
                <span class="set-find-t">{title}</span>
                {move || {
                    let b = body.get();
                    (!b.is_empty()).then(|| view! { <span class="set-find-b">{b}</span> })
                }}
                {children.map(|c| view! { <div class="set-find-acts">{c()}</div> })}
            </div>
        </div>
    }
}

#[component]
pub fn Security() -> impl IntoView {
    let supported = config::feature_untracked("deviceAccess");
    let auth = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "auth.settings.get.request", json!({})).await },
        Signal::derive(move || supported != Some(false)),
        None,
    );
    let status = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "daemon.get_status.request", json!({})).await },
        Signal::derive(|| true),
        None,
    );
    if supported == Some(false) {
        return view! {
            <span class="set-muted">"This daemon is too old for security settings. Update it first."</span>
        }
        .into_any();
    }
    let settings = Memo::new(move |_| {
        auth.data
            .get()
            .and_then(|d| d.get("settings").cloned())
            .filter(Value::is_object)
    });
    let listen = Signal::derive(move || {
        status
            .data
            .get()
            .and_then(|d| d.get("listen").and_then(Value::as_str).map(str::to_owned))
            .unwrap_or_else(|| "—".to_owned())
    });
    let reload = Callback::new(move |_| auth.reload());
    view! {
        <Section title="Findings">
            <RpcStatus rpc=auth what="security settings">
                {move || settings.get().map(|set| view! { <Findings settings=set listen=listen on_change=reload /> })}
            </RpcStatus>
        </Section>
        <Section title="Password">
            {move || settings.get().map(|set| view! {
                <PasswordForm enabled=flag(&set, "passwordEnabled") pinned=pinned(&set, "password") on_change=reload />
            })}
        </Section>
        <Section title="Network">
            <Row label="Listen address" hint="Set in config.json; takes effect after a restart">
                <Value text=listen />
            </Row>
            {move || settings.get().map(|set| view! { <AuthToggles settings=set on_change=reload /> })}
        </Section>
    }
    .into_any()
}

#[component]
fn Findings(settings: Value, listen: Signal<String>, on_change: Callback<()>) -> impl IntoView {
    let has_posture = config::feature_untracked("securityPosture");
    // Remounted on every settings change, so the posture re-reads with it.
    let posture = config::use_rpc(
        |c: DaemonClient| async move { ns(&c, "daemon.get_security_posture.request", json!({})).await },
        Signal::derive(move || has_posture == Some(true)),
        None,
    );
    let mut oks: Vec<&'static str> = Vec::new();
    if flag(&settings, "claimMode") && flag(&settings, "claimed") {
        oks.push("Claim mode on, owner set");
    }
    if !flag(&settings, "lanTrustEffective") {
        oks.push("Not trusting the local network");
    }
    if flag(&settings, "passwordEnabled") {
        oks.push("Password set");
    }
    let reload = Callback::new(move |_| {
        posture.reload();
        on_change.run(());
    });
    view! {
        <ErrorLine text=posture.error />
        {move || {
            posture
                .data
                .get()
                .and_then(|d| d.pointer("/posture/findings").and_then(Value::as_array).cloned())
                .unwrap_or_default()
                .into_iter()
                .map(|f| view! { <FindingRow finding=f listen=listen on_change=reload /> })
                .collect_view()
        }}
        {oks.into_iter().map(|t| view! { <Finding tone="ok" title=t /> }).collect_view()}
    }
}

#[component]
fn FindingRow(finding: Value, listen: Signal<String>, on_change: Callback<()>) -> impl IntoView {
    let app = crate::state::get();
    let act = Action::new();
    let can_ack = config::feature_untracked("securityAcknowledge") == Some(true);
    let id = s(&finding, "id");
    let critical = s(&finding, "severity") == "critical";
    let fix = s(&finding, "fixAction");
    let (title, _) = copy(&id, "");
    let id = StoredValue::new(id);
    let body = Signal::derive(move || {
        act.error
            .get()
            .unwrap_or_else(|| copy(&id.get_value(), &listen.get()).1)
    });
    let run = move |key: &'static str, req: &'static str, fields: Value| {
        act.run(
            key,
            async move { ns(&need()?, req, fields).await },
            move |_| on_change.run(()),
        );
    };
    let busy = Signal::derive(move || act.busy());
    let fix_view = match fix.as_str() {
        "set_password" => view! { <span class="set-hint-inline">"Set a password below"</span> }.into_any(),
        "claim" => view! {
            <Button kind=ButtonKind::Primary label="Pair a device" on_press=Callback::new(move |_| app.ui.open_settings(Some("devices".to_owned()))) />
        }
        .into_any(),
        "disable_trust_lan" => view! {
            <Button kind=ButtonKind::Primary label="Stop trusting the LAN" disabled=busy
                on_press=Callback::new(move |_| run("fix", "auth.settings.update.request", json!({ "trustLan": false }))) />
        }
        .into_any(),
        "enable_claim_mode" => view! {
            <Button kind=ButtonKind::Primary label="Turn on claim mode" disabled=busy
                on_press=Callback::new(move |_| run("fix", "auth.settings.update.request", json!({ "claimMode": true }))) />
        }
        .into_any(),
        "bind_loopback" => view! { <span class="set-hint-inline">"Bind to 127.0.0.1 in config.json, then restart"</span> }.into_any(),
        _ => ().into_any(),
    };
    view! {
        <Finding tone=if critical { "bad" } else { "warn" } title=title body=body>
            {fix_view}
            {(can_ack && !critical).then(|| view! {
                <Button label="This is intended" disabled=busy on_press=Callback::new(move |_| {
                    run("ack", "daemon.set_security_finding_acknowledged.request", json!({ "findingId": id.get_value(), "acknowledged": true }))
                }) />
            })}
        </Finding>
    }
}

#[component]
fn PasswordForm(enabled: bool, pinned: bool, on_change: Callback<()>) -> impl IntoView {
    if pinned {
        return view! { <Row label="Daemon password" hint="Set by FROGG_PASSWORD in the daemon’s environment" /> }
            .into_any();
    }
    let pw = RwSignal::new(String::new());
    let again = RwSignal::new(String::new());
    let done = RwSignal::new(None::<&'static str>);
    let act = Action::new();
    let problem = Signal::derive(move || {
        let (p, a) = (pw.get(), again.get());
        if !p.is_empty() && p.chars().count() < 8 {
            Some("At least 8 characters")
        } else if !a.is_empty() && a != p {
            Some("Passwords don’t match")
        } else {
            None
        }
    });
    let hint = Signal::derive(move || {
        problem
            .get()
            .unwrap_or(if enabled {
                "Set · change it here"
            } else {
                "At least 8 characters"
            })
            .to_owned()
    });
    let save = move |_| {
        let p = pw.get_untracked();
        act.run(
            "set",
            async move {
                ns(
                    &need()?,
                    "auth.password.set.request",
                    json!({ "password": p }),
                )
                .await
            },
            move |_| {
                pw.set(String::new());
                again.set(String::new());
                done.set(Some("Password set. New connections need it."));
                on_change.run(());
            },
        );
    };
    let clear = move |_| {
        act.run(
            "clear",
            async move {
                ns(
                    &need()?,
                    "auth.password.set.request",
                    json!({ "password": null }),
                )
                .await
            },
            move |_| {
                done.set(Some("Password turned off."));
                on_change.run(());
            },
        );
    };
    view! {
        <Row label="Daemon password" hint=hint bad=Signal::derive(move || problem.get().is_some())>
            <div class="set-fields">
                <Input value=pw placeholder="New password" password=true />
                <Input value=again placeholder="Confirm" password=true />
            </div>
        </Row>
        <Block>
            <div class="set-end">
                {move || done.get().map(|d| view! { <span class="set-ok">{d}</span> })}
                <ErrorLine text=act.error />
                {enabled.then(|| view! {
                    <Button label="Turn off" kind=ButtonKind::Danger disabled=Signal::derive(move || act.busy()) on_press=Callback::new(clear) />
                })}
                <Button
                    kind=ButtonKind::Primary
                    label=Signal::derive(move || if act.pending.get() == Some("set") { "Setting…".to_owned() } else { "Set password".to_owned() })
                    disabled=Signal::derive(move || {
                        let p = pw.get();
                        p.chars().count() < 8 || p != again.get() || act.busy()
                    })
                    on_press=Callback::new(save)
                />
            </div>
        </Block>
    }
    .into_any()
}

#[component]
fn AuthToggles(settings: Value, on_change: Callback<()>) -> impl IntoView {
    let act = Action::new();
    // One action drives both toggles; its error belongs to the row that ran last.
    let last = RwSignal::new("");
    let update = move |row: &'static str, patch: Value| {
        last.set(row);
        act.run(
            "u",
            async move { ns(&need()?, "auth.settings.update.request", patch).await },
            move |_| on_change.run(()),
        );
    };
    let row_error = move |row: &'static str| {
        Signal::derive(move || act.error.get().filter(|_| last.get() == row))
    };
    let (lan_err, claim_err) = (row_error("lan"), row_error("claim"));
    let claim = flag(&settings, "claimMode");
    let lan_pinned = pinned(&settings, "trustLan");
    let claim_pinned = pinned(&settings, "claimMode");
    view! {
        <Row
            label="Trust local network"
            hint=Signal::derive(move || toggle_hint(
                lan_pinned.then_some("FROGG_TRUST_LAN"),
                lan_err.get(),
                if claim { "Ignored while claim mode is on" } else { "Skip pairing for LAN clients" },
            ))
            bad=Signal::derive(move || !lan_pinned && lan_err.get().is_some())
        >
            <Toggle
                value=flag(&settings, "trustLan")
                disabled=Signal::derive(move || act.busy() || lan_pinned)
                on_change=Callback::new(move |v: bool| update("lan", json!({ "trustLan": v })))
                label="Trust local network"
            />
        </Row>
        <Row
            label="Claim mode"
            hint=Signal::derive(move || toggle_hint(
                claim_pinned.then_some("FROGG_CLAIM_MODE"),
                claim_err.get(),
                "First device to pair becomes owner",
            ))
            bad=Signal::derive(move || !claim_pinned && claim_err.get().is_some())
        >
            <Toggle
                value=claim
                disabled=Signal::derive(move || act.busy() || claim_pinned)
                on_change=Callback::new(move |v: bool| update("claim", json!({ "claimMode": v })))
                label="Claim mode"
            />
        </Row>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_and_pins() {
        assert_eq!(
            copy("bind_diverges", "0.0.0.0:6767").1,
            "This host binds 0.0.0.0:6767."
        );
        assert_eq!(copy("odd_thing", "").0, "odd thing");
        let set = json!({
            "overrideControlledPaths": ["daemon.auth.trustLan", "daemon.auth.claimScope"]
        });
        assert!(pinned(&set, "trustLan"));
        assert!(!pinned(&set, "password"));
        // An env claimScope must not read as a claim mode lock.
        assert!(!pinned(&set, "claimMode"));
    }

    #[test]
    fn toggle_hints_show_the_lock_first() {
        assert_eq!(
            toggle_hint(Some("FROGG_TRUST_LAN"), Some("refused".into()), "d"),
            "Locked: set by FROGG_TRUST_LAN in the daemon’s environment"
        );
        assert_eq!(toggle_hint(None, Some("refused".into()), "d"), "refused");
        assert_eq!(toggle_hint(None, None, "d"), "d");
    }
}
