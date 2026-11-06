//! Inline approvals (ui-next `PermissionCard.tsx`, `chat/QuestionCard.tsx`): a tool or command to
//! allow, a plan to review, or a question with options. With the card focused, `a` approves and
//! Esc denies.

use frogg_render::Markdown;
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use super::item::on_link;
use super::{client_or_toast, toast_err};
use crate::components::{Button, ButtonKind, Ico, Icon};
use crate::shell::toast::{toast, ToastKind};

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

/// The shell command a request carries, for the headline.
fn command_of(p: &Value) -> Option<String> {
    let input = p.get("input")?;
    match input.get("command").or_else(|| input.get("cmd"))? {
        Value::String(c) => Some(c.clone()),
        Value::Array(a) => Some(
            a.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
        ),
        _ => None,
    }
}

/// Returns whether the answer was sent, so callers can re-enable their buttons on failure.
fn answer(
    agent_id: &str,
    request_id: &str,
    response: Value,
    done: &'static str,
    detail: String,
) -> bool {
    let Some(c) = client_or_toast() else {
        return false;
    };
    match c.respond_to_permission(agent_id, request_id, response) {
        Ok(()) => {
            crate::state::get()
                .toasts
                .push(crate::shell::toast::Toast::new(ToastKind::Ok, done).detail(detail));
            true
        }
        Err(e) => {
            toast_err("Could not answer", e);
            false
        }
    }
}

#[component]
pub fn PermissionCard(
    agent_id: String,
    p: Value,
    /// The agent's current mode label, shown in the meta line.
    #[prop(optional)]
    mode: Option<String>,
) -> impl IntoView {
    let questions = p
        .get("input")
        .and_then(|i| i.get("questions"))
        .and_then(Value::as_array)
        .filter(|q| !q.is_empty() && q.iter().all(|x| x.get("question").is_some()))
        .cloned();
    if s(&p, "kind") == Some("question") {
        if let Some(q) = questions {
            return view! { <QuestionCard agent_id=agent_id p=p questions=q /> }.into_any();
        }
    }
    let id = s(&p, "id").unwrap_or("").to_owned();
    let plan = s(&p, "kind") == Some("plan");
    let plan_text = plan
        .then(|| p.get("input").and_then(|i| s(i, "plan")).map(str::to_owned))
        .flatten();
    let cmd = command_of(&p);
    let name = s(&p, "name").unwrap_or("tool").to_owned();
    let what = cmd
        .clone()
        .or_else(|| s(&p, "title").map(str::to_owned))
        .unwrap_or_else(|| name.clone());
    let description = s(&p, "description").map(str::to_owned);
    let extra: Vec<(String, String)> = p
        .get("actions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|a| {
            s(a, "behavior") == Some("allow")
                && !matches!(s(a, "id"), Some("implement") | Some("accept"))
        })
        .filter_map(|a| Some((s(a, "id")?.to_owned(), s(a, "label")?.to_owned())))
        .collect();
    let busy = RwSignal::new(false);
    let replying = RwSignal::new(false);
    let reply = RwSignal::new(String::new());
    let ctx = StoredValue::new((agent_id.clone(), id.clone(), what.clone()));
    let allow = move |action: Option<String>| {
        busy.set(true);
        let (a, r, w) = ctx.get_value();
        let selected = action.or_else(|| plan.then(|| "implement".to_owned()));
        let done = if plan {
            "Implementing plan"
        } else {
            "Approved"
        };
        let sent = answer(
            &a,
            &r,
            json!({ "behavior": "allow", "selectedActionId": selected }),
            done,
            w,
        );
        busy.set(sent);
    };
    let deny = move || {
        busy.set(true);
        let (a, r, w) = ctx.get_value();
        let done = if plan { "Plan rejected" } else { "Denied" };
        let sent = answer(
            &a,
            &r,
            json!({ "behavior": "deny", "message": "Denied from Frogg" }),
            done,
            w,
        );
        busy.set(sent);
    };
    let send_reply = move || {
        let t = reply.get_untracked().trim().to_owned();
        if t.is_empty() {
            return;
        }
        busy.set(true);
        let (a, r, w) = ctx.get_value();
        let sent = answer(
            &a,
            &r,
            json!({ "behavior": "deny", "message": t }),
            "Reply sent",
            w,
        );
        busy.set(sent);
    };
    let meta = [Some(if plan { "Plan mode".to_owned() } else { name }), mode]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");
    let on_key = move |ev: leptos::ev::KeyboardEvent| {
        // Bare keys only when the card itself has focus, never while typing a reply.
        let on_card = ev
            .target()
            .zip(ev.current_target())
            .map(|(t, c)| t == c)
            .unwrap_or(false);
        if !on_card || busy.get_untracked() || ev.ctrl_key() || ev.meta_key() || ev.alt_key() {
            return;
        }
        match ev.key().as_str() {
            "a" | "A" => {
                ev.prevent_default();
                allow(None);
            }
            "Escape" => {
                ev.prevent_default();
                deny();
            }
            _ => {}
        }
    };
    view! {
        <div class="perm cut cut-stroke m-enter" style="--c:10px" tabindex="0" on:keydown=on_key>
            <div class="perm-head">
                <Icon ico=if plan { Ico::ListChecks } else { Ico::Lock } size=13.0 class="perm-ico" />
                <span class="perm-tag t-label">{if plan { "PLAN" } else { "PERMISSION" }}</span>
                <span class="perm-meta">{meta}</span>
                <span class="spacer"></span>
                <span class="perm-keys t-mono">"a approve · esc deny"</span>
            </div>
            <div class="perm-title t-display">
                {if plan { "Plan ready for review" } else { "Permission needed" }}
            </div>
            {match (plan_text, cmd) {
                (Some(t), _) => view! {
                    <div class="perm-plan"><Markdown text=t on_link=on_link() /></div>
                }.into_any(),
                (None, Some(c)) => view! {
                    <div class="perm-what">"Run "<span class="perm-cmd t-mono">{c}</span></div>
                }.into_any(),
                (None, None) => view! { <div class="perm-what">{what}</div> }.into_any(),
            }}
            {description.map(|d| view! { <div class="perm-desc">{d}</div> })}
            <Show when=move || replying.get()>
                <input
                    class="input field-box perm-reply"
                    placeholder="Tell the agent what to do instead"
                    autofocus
                    prop:value=move || reply.get()
                    on:input=move |ev| reply.set(event_target_value(&ev))
                    on:keydown=move |ev| {
                        if ev.key() == "Enter" {
                            send_reply();
                        }
                    }
                />
            </Show>
            <div class="perm-actions">
                <Button
                    kind=ButtonKind::Danger
                    label=if plan { "Reject" } else { "Deny" }
                    kbd="Esc"
                    disabled=busy
                    on_press=Callback::new(move |_| deny())
                />
                {extra
                    .into_iter()
                    .map(|(aid, label)| {
                        let aid = StoredValue::new(aid);
                        view! {
                            <Button
                                label=label
                                disabled=busy
                                on_press=Callback::new(move |_| allow(Some(aid.get_value())))
                            />
                        }
                    })
                    .collect_view()}
                {move || {
                    if replying.get() {
                        view! {
                            <Button
                                label="Send reply"
                                disabled=Signal::derive(move || busy.get() || reply.get().trim().is_empty())
                                on_press=Callback::new(move |_| send_reply())
                            />
                        }
                        .into_any()
                    } else {
                        view! {
                            <Button
                                label=if plan { "Edit plan…" } else { "Reply instead…" }
                                disabled=busy
                                on_press=Callback::new(move |_| replying.set(true))
                            />
                        }
                        .into_any()
                    }
                }}
                <Button
                    kind=ButtonKind::Primary
                    label=if plan { "Implement" } else { "Approve" }
                    kbd="a"
                    disabled=busy
                    on_press=Callback::new(move |_| allow(None))
                />
            </div>
        </div>
    }
    .into_any()
}

/// An agent question: one question at a time, options as buttons, or a typed answer.
#[component]
fn QuestionCard(agent_id: String, p: Value, questions: Vec<Value>) -> impl IntoView {
    let id = s(&p, "id").unwrap_or("").to_owned();
    let input = p.get("input").cloned().unwrap_or(json!({}));
    let total = questions.len();
    let questions = StoredValue::new(questions);
    let step = RwSignal::new(0usize);
    let answers = RwSignal::new(serde_json::Map::new());
    let other = RwSignal::new(String::new());
    let busy = RwSignal::new(false);
    let ctx = StoredValue::new((agent_id, id, input));
    let pick = move |label: String| {
        let i = step.get_untracked();
        let q = questions.with_value(|q| s(&q[i], "question").unwrap_or("").to_owned());
        answers.update(|a| {
            a.insert(q, Value::String(label));
        });
        other.set(String::new());
        if i + 1 < total {
            step.set(i + 1);
            return;
        }
        busy.set(true);
        let (a, r, mut input) = ctx.get_value();
        input["answers"] = Value::Object(answers.get_untracked());
        let Some(c) = client_or_toast() else {
            busy.set(false);
            return;
        };
        spawn_local(async move {
            match c.respond_to_permission(
                &a,
                &r,
                json!({ "behavior": "allow", "updatedInput": input }),
            ) {
                Ok(()) => {
                    let _ = toast(ToastKind::Ok, "Answered");
                }
                Err(e) => {
                    busy.set(false);
                    toast_err("Could not answer", e);
                }
            }
        });
    };
    view! {
        <div class="perm question cut cut-stroke m-enter" style="--c:10px">
            {move || {
                let i = step.get();
                let q = questions.with_value(|q| q[i].clone());
                let header = s(&q, "header").or(s(&q, "question")).unwrap_or("").to_owned();
                let text = s(&q, "question").unwrap_or("").to_owned();
                let opts: Vec<(String, Option<String>)> = q
                    .get("options")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|o| Some((s(o, "label")?.to_owned(), s(o, "description").map(str::to_owned))))
                    .collect();
                view! {
                    <div class="perm-head">
                        <Icon ico=Ico::MessageSquare size=13.0 class="perm-ico" />
                        <span class="perm-tag t-label">"QUESTION"</span>
                        <span class="perm-meta">{header}</span>
                        <span class="spacer"></span>
                        {(total > 1).then(|| view! { <span class="perm-keys t-mono">{format!("{} / {total}", i + 1)}</span> })}
                    </div>
                    <div class="perm-title t-display">{text}</div>
                    <div class="q-opts">
                        {opts
                            .into_iter()
                            .map(|(label, hint)| {
                                let l = StoredValue::new(label.clone());
                                view! {
                                    <button
                                        class="q-opt"
                                        disabled=move || busy.get()
                                        on:click=move |_| pick(l.get_value())
                                    >
                                        <span class="q-opt-label">{label}</span>
                                        {hint.map(|h| view! { <span class="q-opt-hint">{h}</span> })}
                                    </button>
                                }
                            })
                            .collect_view()}
                    </div>
                }
            }}
            <input
                class="input field-box perm-reply"
                placeholder="Or type an answer"
                prop:value=move || other.get()
                on:input=move |ev| other.set(event_target_value(&ev))
                on:keydown=move |ev| {
                    let t = other.get_untracked().trim().to_owned();
                    if ev.key() == "Enter" && !t.is_empty() {
                        pick(t);
                    }
                }
            />
        </div>
    }
}
