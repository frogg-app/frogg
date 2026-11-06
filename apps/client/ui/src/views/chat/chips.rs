//! The composer's provider and account chips (ui-next `chat/ProviderChip.tsx`,
//! `chat/AccountChip.tsx`, `chat/cleanCut.ts`): switching provider is a clean cut onto it; an
//! account is locked once started, so switching moves the conversation or clean-cuts to it.
//!
//! Both render a whole chip with its menu; the composer (slice 7b) places them.

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{Map, Value};

use super::provider_label;
use super::session_state::{self as ops, ends_at_clean_cut, has_feature, OpText};
use crate::components::{
    Button, ButtonKind, Floating, Ico, Icon, Select, SelectOption, Sheet as Dialog,
};
use crate::state::timeline::Entry;
use crate::state::Session;

const CUT_HINT: &str = "A provider can't read another provider's history, so a cheap model summarises this conversation and a fresh one starts there. Workspace changes are kept; the old conversation stays visible to you.";
const REUSE_HINT: &str = "Already a clean cut: nothing new has been said since the last summary, so it carries over as is. No re-summary, no extra cost.";

/// A provider a live session can clean-cut onto.
#[derive(Debug, Clone, PartialEq)]
pub struct SwitchTarget {
    pub provider: String,
    pub label: String,
    pub models: Vec<SelectOption>,
    pub default_model: Option<String>,
}

/// Providers a live session can clean-cut onto: enabled, ready, with models, not its own.
pub fn switch_targets(snapshot: Option<&Value>, current: &str) -> Vec<SwitchTarget> {
    let entries = snapshot
        .and_then(|s| s.get("entries"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    entries
        .iter()
        .filter_map(|e| {
            let provider = e.get("provider")?.as_str()?;
            let ok = provider != current
                && e.get("enabled").and_then(Value::as_bool) == Some(true)
                && e.get("status").and_then(Value::as_str) == Some("ready");
            let raw = e.get("models")?.as_array().filter(|m| !m.is_empty())?;
            if !ok {
                return None;
            }
            let models: Vec<SelectOption> = raw
                .iter()
                .filter_map(|m| {
                    let id = m.get("id")?.as_str()?;
                    let mut o =
                        SelectOption::new(id, m.get("label").and_then(Value::as_str).unwrap_or(id));
                    o.hint = m
                        .get("description")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    Some(o)
                })
                .collect();
            let default_model = raw
                .iter()
                .find(|m| m.get("isDefault").and_then(Value::as_bool) == Some(true))
                .and_then(|m| m.get("id")?.as_str().map(str::to_owned))
                .or_else(|| models.first().map(|m| m.value.clone()));
            Some(SwitchTarget {
                provider: provider.to_owned(),
                label: e
                    .get("label")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(|| provider_label(provider)),
                models,
                default_model,
            })
        })
        .collect()
}

/// One row of a chip menu.
#[derive(Clone)]
enum Row {
    Head(String),
    Item {
        label: String,
        hint: Option<String>,
        on: bool,
        disabled: bool,
        run: Option<Callback<()>>,
    },
    Sep,
}

fn chip_menu(open: RwSignal<bool>, rows: Signal<Vec<Row>>, width: u32) -> impl IntoView {
    view! {
        <Floating open=open on_close=Callback::new(move |_| open.set(false)) up=true class="menu chip-menu">
            <div style=format!("width:{width}px")>
                {move || rows.get().into_iter().map(|r| match r {
                    Row::Head(t) => view! { <div class="t-label chip-menu-head">{t}</div> }.into_any(),
                    Row::Sep => view! { <div class="chip-menu-sep"></div> }.into_any(),
                    Row::Item { label, hint, on, disabled, run } => view! {
                        <button
                            class="menu-item"
                            class:on=on
                            class:disabled=disabled
                            disabled=disabled
                            on:click=move |_| {
                                open.set(false);
                                if let Some(r) = run { r.run(()) }
                            }
                        >
                            <span class="chip-check">{on.then(|| view! { <Icon ico=Ico::Check size=12.0 /> })}</span>
                            <span class="menu-label">{label}</span>
                            {hint.map(|h| view! { <span class="t-mono menu-hint">{h}</span> })}
                        </button>
                    }.into_any(),
                }).collect_view()}
            </div>
        </Floating>
    }
}

/// The provider chip: another provider opens a confirm with its models; confirming makes a clean
/// cut onto it. Straight after a cut the summary carries over.
#[component]
pub fn ProviderChip(
    session: Memo<Option<Session>>,
    rows: Signal<Vec<Entry>>,
    #[prop(optional)] compact: bool,
) -> impl IntoView {
    let cfg = crate::state::config::get();
    Effect::new(move |_| {
        if cfg.providers.with(Option::is_none)
            && crate::state::config::feature("agentCleanCut").is_some()
        {
            cfg.load_providers();
        }
    });
    let agent_provider = Memo::new(move |_| {
        session.with(|s| {
            s.as_ref()
                .map(|s| s.agent.provider.clone())
                .unwrap_or_default()
        })
    });
    let targets = Memo::new(move |_| {
        cfg.providers
            .with(|p| switch_targets(p.as_ref(), &agent_provider.get()))
    });
    let current = Memo::new(move |_| {
        let p = agent_provider.get();
        cfg.providers
            .with(|s| {
                s.as_ref()?
                    .get("entries")?
                    .as_array()?
                    .iter()
                    .find(|e| e.get("provider").and_then(Value::as_str) == Some(p.as_str()))?
                    .get("label")?
                    .as_str()
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| provider_label(&p))
    });
    let reuses = Memo::new(move |_| rows.with(|r| ends_at_clean_cut(r)));
    let open = RwSignal::new(false);
    let target = RwSignal::new(None::<SwitchTarget>);
    let menu_rows = Signal::derive(move || {
        let Some(s) = session.get() else {
            return vec![];
        };
        let op = ops::op_of(&s.agent.id);
        let can_cut = s.agent.status != "running";
        let hint = if !can_cut {
            "Wait for the turn to finish".to_owned()
        } else if let Some(o) = &op {
            format!("{}…", o.label)
        } else if reuses.get() {
            "Summary carries over: no new cost".into()
        } else {
            "Clean cut: summarise, then continue there".into()
        };
        let mut out = vec![
            Row::Head("Provider".into()),
            Row::Item {
                label: current.get(),
                hint: None,
                on: true,
                disabled: true,
                run: None,
            },
            Row::Sep,
        ];
        for t in targets.get() {
            let label = format!("Switch to {}…", t.label);
            out.push(Row::Item {
                label,
                hint: Some(hint.clone()),
                on: false,
                disabled: !can_cut || op.is_some(),
                run: Some(Callback::new(move |_| target.set(Some(t.clone())))),
            });
        }
        out
    });
    let active = move || !targets.with(Vec::is_empty) && has_feature("agentCleanCut");
    view! {
        {move || if active() {
            view! {
                <div class="chip-anchor">
                    <button class="chip t-mono chip-btn" aria-label="Provider" on:click=move |_| open.update(|o| *o = !*o)>
                        <span class="chip-dot"></span>
                        <span class="chip-t">{move || current.get()}</span>
                        <Icon ico=Ico::ChevronDown size=11.0 />
                    </button>
                    {chip_menu(open, menu_rows, 300)}
                </div>
            }
            .into_any()
        } else if compact {
            ().into_any()
        } else {
            view! {
                <span class="chip t-mono"><span class="chip-dot"></span><span class="chip-t">{move || current.get()}</span></span>
            }
            .into_any()
        }}
        <SwitchDialog session=session from=current target=target reuses=reuses />
    }
}

#[component]
fn SwitchDialog(
    session: Memo<Option<Session>>,
    from: Memo<String>,
    target: RwSignal<Option<SwitchTarget>>,
    reuses: Memo<bool>,
) -> impl IntoView {
    let model = RwSignal::new(String::new());
    Effect::new(move |_| {
        model.set(
            target
                .with(|t| t.as_ref().and_then(|t| t.default_model.clone()))
                .unwrap_or_default(),
        );
    });
    let close = Callback::new(move |_| target.set(None));
    let confirm = move || {
        let (Some(t), Some(s)) = (target.get_untracked(), session.get_untracked()) else {
            return;
        };
        let to = t.label.clone();
        let text = if reuses.get_untracked() {
            OpText {
                label: format!("Moving the conversation to {to}"),
                done: format!("Moved to {to}"),
                done_detail: Some("The last summary carried over: no new cost".into()),
                failed: "Could not switch provider".into(),
            }
        } else {
            OpText {
                label: format!("Clean cut to {to}: summarising"),
                done: format!("Clean cut to {to} done"),
                done_detail: Some("The next message starts from the summary".into()),
                failed: "Clean cut failed".into(),
            }
        };
        let m = model.get_untracked();
        let mut req = Map::new();
        req.insert("provider".into(), t.provider.clone().into());
        req.insert(
            "model".into(),
            if m.is_empty() { Value::Null } else { m.into() },
        );
        let id = s.agent.id.clone();
        if ops::run_session_op(&id, text, ops::clean_cut(id.clone(), req)) {
            target.set(None);
        }
    };
    let title = move || {
        target.with(|t| {
            t.as_ref()
                .map(|t| format!("Switch to {}", t.label))
                .unwrap_or_default()
        })
    };
    view! {
        <Dialog open=Signal::derive(move || target.with(Option::is_some)) on_close=close title="Clean cut".to_string()>
            <span class="t-display sheet-sub">{title}</span>
            <span>{move || target.with(|t| t.as_ref().map(|t| {
                let ml = t.models.iter().find(|m| m.value == model.get()).map(|m| format!(" ({})", m.label)).unwrap_or_default();
                format!("Move this conversation from {} to {}{ml} with a clean cut?", from.get(), t.label)
            }))}</span>
            <span class=move || if reuses.get() { "chip-reuse" } else { "sheet-muted" }>
                {move || if reuses.get() { REUSE_HINT } else { CUT_HINT }}
            </span>
            <div class="chip-field">
                <span class="t-label">"Model"</span>
                {move || target.get().map(|t| view! {
                    <Select options=t.models value=model on_change=Callback::new(move |v| model.set(v)) mono=true />
                })}
            </div>
            <div class="sheet-actions">
                <Button label="Cancel" on_press=close />
                <Button
                    label=Signal::derive(move || if reuses.get() { "Switch".to_string() } else { "Clean cut and switch".to_string() })
                    kind=ButtonKind::Primary
                    disabled=Signal::derive(move || model.get().is_empty())
                    on_press=Callback::new(move |_| confirm())
                />
            </div>
        </Dialog>
    }
}

/// A provider account, as `provider.account.list` reports it.
#[derive(Debug, Clone, PartialEq)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub authenticated: bool,
    pub is_active: bool,
    pub hint: Option<String>,
}

impl Account {
    fn from_value(v: &Value) -> Option<Self> {
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        let b = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
        Some(Self {
            id: s("id")?,
            name: s("name").unwrap_or_default(),
            provider: s("provider").unwrap_or_default(),
            authenticated: b("authenticated"),
            is_active: b("isActive"),
            hint: s("email").or_else(|| s("plan")),
        })
    }
}

/// The account the session runs on; others offer a move or a clean cut.
#[component]
pub fn AccountChip(session: Memo<Option<Session>>) -> impl IntoView {
    let accounts = RwSignal::new(None::<Vec<Account>>);
    let provider =
        Memo::new(move |_| session.with(|s| s.as_ref().map(|s| s.agent.provider.clone())));
    Effect::new(move |_| {
        let Some(p) = provider.get() else { return };
        let Some(c) = crate::state::get().conn.client() else {
            return;
        };
        spawn_local(async move {
            let list = match c.list_provider_accounts(Some(&p)).await {
                Ok(r) => serde_json::to_value(&r.accounts)
                    .ok()
                    .and_then(|v| {
                        v.as_array()
                            .map(|a| a.iter().filter_map(Account::from_value).collect())
                    })
                    .unwrap_or_default(),
                Err(_) => Vec::new(),
            };
            let _ = accounts.try_set(Some(list));
        });
    });
    let current = Memo::new(move |_| {
        let s = session.get()?;
        let pinned = s.agent.raw.get("providerAccountId");
        accounts.with(|a| {
            let a = a.as_ref()?;
            match pinned {
                None => a.iter().find(|x| x.is_active).cloned(),
                Some(v) => a
                    .iter()
                    .find(|x| Some(x.id.as_str()) == v.as_str())
                    .cloned(),
            }
        })
    });
    let open = RwSignal::new(false);
    let rows = Signal::derive(move || {
        let (Some(s), Some(list)) = (session.get(), accounts.get()) else {
            return vec![];
        };
        let a = s.agent;
        let cur = current.get().map(|c| c.id);
        let op = ops::op_of(&a.id);
        let idle = a.status != "running";
        let can_move = idle && has_feature("agentProviderAccountTransfer");
        let can_cut = idle && has_feature("agentCleanCut");
        let busy = op.map(|o| format!("{}…", o.label));
        let mine: Vec<Account> = list
            .into_iter()
            .filter(|x| x.provider == a.provider)
            .collect();
        let mut out = vec![Row::Head("Account · locked once the agent started".into())];
        for x in &mine {
            let on = Some(&x.id) == cur.as_ref();
            out.push(Row::Item {
                label: x.name.clone(),
                hint: x.hint.clone(),
                on,
                disabled: !on,
                run: None,
            });
        }
        let others: Vec<&Account> = mine
            .iter()
            .filter(|x| x.authenticated && Some(&x.id) != cur.as_ref())
            .collect();
        if !others.is_empty() && (can_move || can_cut) {
            out.push(Row::Sep);
        }
        for o in others {
            if can_move {
                let (aid, oid, name) = (a.id.clone(), o.id.clone(), o.name.clone());
                out.push(Row::Item {
                    label: format!("Move conversation to {}…", o.name),
                    hint: Some(busy.clone().unwrap_or_else(|| {
                        "Full history; re-sends the context on the next turn".into()
                    })),
                    on: false,
                    disabled: busy.is_some(),
                    run: Some(Callback::new(move |_| {
                        let (aid2, oid) = (aid.clone(), oid.clone());
                        ops::run_session_op(
                            &aid,
                            OpText {
                                label: format!("Moving the conversation to {name}"),
                                done: format!("Moved to {name}"),
                                done_detail: Some("The next turn re-sends the full history".into()),
                                failed: "Could not move the conversation".into(),
                            },
                            async move {
                                let c = crate::state::get()
                                    .conn
                                    .client()
                                    .ok_or("Not connected to a host")?;
                                c.transfer_agent_provider_account(&aid2, Some(&oid))
                                    .await
                                    .map(|_| ())
                                    .map_err(|e| e.to_string())
                            },
                        );
                    })),
                });
            }
            if can_cut {
                let (aid, oid, name) = (a.id.clone(), o.id.clone(), o.name.clone());
                out.push(Row::Item {
                    label: format!("Clean cut to {}", o.name),
                    hint: Some(
                        busy.clone()
                            .unwrap_or_else(|| "Summarise, then continue there".into()),
                    ),
                    on: false,
                    disabled: busy.is_some(),
                    run: Some(Callback::new(move |_| {
                        let mut req = Map::new();
                        req.insert("providerAccountId".into(), oid.clone().into());
                        ops::run_session_op(
                            &aid,
                            OpText {
                                label: format!("Clean cut to {name}: summarising"),
                                done: format!("Clean cut to {name} done"),
                                done_detail: Some(
                                    "The next message starts from the summary".into(),
                                ),
                                failed: "Clean cut failed".into(),
                            },
                            ops::clean_cut(aid.clone(), req),
                        );
                    })),
                });
            }
        }
        out
    });
    move || {
        current.get().map(|c| view! {
            <div class="chip-anchor">
                <button class="chip t-mono chip-btn" aria-label="Account" on:click=move |_| open.update(|o| *o = !*o)>
                    <span class="chip-t">{c.name}</span>
                    <Icon ico=Ico::ChevronDown size=11.0 />
                </button>
                {chip_menu(open, rows, 300)}
            </div>
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn targets_skip_own_and_unready() {
        let snap = json!({"entries": [
            {"provider":"claude","enabled":true,"status":"ready","models":[{"id":"o","label":"Opus"}]},
            {"provider":"codex","enabled":true,"status":"ready","label":"Codex","models":[{"id":"a","label":"A"},{"id":"b","label":"B","isDefault":true}]},
            {"provider":"gemini","enabled":false,"status":"ready","models":[{"id":"g","label":"G"}]},
            {"provider":"amp","enabled":true,"status":"ready","models":[]}
        ]});
        let t = switch_targets(Some(&snap), "claude");
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].label, "Codex");
        assert_eq!(t[0].default_model.as_deref(), Some("b"));
    }
}
