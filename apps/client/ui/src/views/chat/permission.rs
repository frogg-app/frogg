//! Inline approvals (ui-next `PermissionCard.tsx`, `chat/QuestionCard.tsx`): a tool or command to
//! allow, a plan to review, or a question with options. With the card focused, `a` approves and
//! Esc denies.

use std::collections::HashMap;

use frogg_render::Markdown;
use leptos::prelude::*;
use serde_json::{json, Value};

use super::item::on_link;
use super::{client_or_toast, toast_err};
use crate::components::{Button, ButtonKind, Ico, Icon};
use crate::shell::toast::ToastKind;

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
    kind: ToastKind,
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
                .push(crate::shell::toast::Toast::new(kind, done).detail(detail));
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
    let questions = p.get("input").and_then(parse_questions);
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
            ToastKind::Ok,
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
            ToastKind::Info,
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
            ToastKind::Info,
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

/// One question of an AskUserQuestion-style request.
#[derive(Debug, Clone, PartialEq)]
pub struct Question {
    pub question: String,
    /// The answer's key: the daemon reads `answers[question]` then `answers[header]`.
    pub header: String,
    pub options: Vec<(String, Option<String>)>,
    pub multi: bool,
    /// Offers "Other…" for a typed answer.
    pub other: bool,
    pub placeholder: Option<String>,
}

/// The provider's question input, or `None` when it is not one.
pub fn parse_questions(input: &Value) -> Option<Vec<Question>> {
    let raw = input.get("questions")?.as_array()?;
    let mut out = Vec::new();
    for q in raw {
        let question = s(q, "question")?.to_owned();
        let options: Vec<(String, Option<String>)> = q
            .get("options")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|o| {
                Some((
                    s(o, "label")?.to_owned(),
                    s(o, "description").map(str::to_owned),
                ))
            })
            .collect();
        let flag = |k: &str| q.get(k).and_then(Value::as_bool);
        out.push(Question {
            header: s(q, "header").unwrap_or(&question).to_owned(),
            other: flag("allowOther") != Some(false)
                && (flag("isOther") == Some(true) || !options.is_empty()),
            multi: flag("multiSelect") == Some(true),
            placeholder: s(q, "placeholder").map(str::to_owned),
            question,
            options,
        });
    }
    (!out.is_empty()).then_some(out)
}

/// "Other…": the typed answer.
const OTHER: i32 = -1;

/// The next selection after choosing option `i` (or `OTHER`) on a question.
pub fn choose(prev: &[i32], i: i32, multi: bool) -> Vec<i32> {
    if !multi || i == OTHER {
        return vec![i];
    }
    let base: Vec<i32> = prev.iter().copied().filter(|x| *x != OTHER).collect();
    if base.contains(&i) {
        base.into_iter().filter(|x| *x != i).collect()
    } else {
        let mut b = base;
        b.push(i);
        b
    }
}

/// `answers` keyed by each question's header: picked labels joined, or the typed answer.
pub fn build_answers(
    questions: &[Question],
    picks: &HashMap<usize, Vec<i32>>,
    texts: &HashMap<usize, String>,
) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    for (n, q) in questions.iter().enumerate() {
        let sel = picks.get(&n).cloned().unwrap_or_default();
        let free = q.options.is_empty() || sel.contains(&OTHER);
        let a = if free {
            texts
                .get(&n)
                .map(|t| t.trim().to_owned())
                .unwrap_or_default()
        } else {
            sel.iter()
                .filter_map(|i| q.options.get(*i as usize).map(|o| o.0.clone()))
                .collect::<Vec<_>>()
                .join(", ")
        };
        out.insert(q.header.clone(), Value::String(a));
    }
    out
}

/// An agent question: one at a time, single or multi-select, "Other…" for a typed answer,
/// Back/Next, and Dismiss.
#[component]
fn QuestionCard(agent_id: String, p: Value, questions: Vec<Question>) -> impl IntoView {
    let request = s(&p, "id").unwrap_or("").to_owned();
    let input = p.get("input").cloned().unwrap_or(json!({}));
    let app = crate::state::get();
    let who = app
        .hosts
        .active_id
        .get_untracked()
        .and_then(|h| app.agents.get(&h, &agent_id))
        .map(|s| crate::state::config::provider_label(&s.agent.provider));
    let total = questions.len();
    let questions = StoredValue::new(questions);
    let at = RwSignal::new(0usize);
    let picks = RwSignal::new(HashMap::<usize, Vec<i32>>::new());
    let texts = RwSignal::new(HashMap::<usize, String>::new());
    let busy = RwSignal::new(false);
    let ctx = StoredValue::new((agent_id, request, input));
    let q = Memo::new(move |_| questions.with_value(|q| q[at.get()].clone()));
    let chosen = move || picks.with(|p| p.get(&at.get()).cloned().unwrap_or_default());
    let free_only = move || q.with(|q| q.options.is_empty());
    let other_on = move || free_only() || chosen().contains(&OTHER);
    let answered = move || {
        if other_on() {
            texts.with(|t| t.get(&at.get()).is_some_and(|t| !t.trim().is_empty()))
        } else {
            !chosen().is_empty()
        }
    };
    let last = move || at.get() + 1 == total;
    let pick = move |i: i32| {
        if busy.get_untracked() {
            return;
        }
        let n = at.get_untracked();
        let multi = q.with_untracked(|q| q.multi);
        picks.update(|p| {
            let next = choose(p.get(&n).map(Vec::as_slice).unwrap_or(&[]), i, multi);
            p.insert(n, next);
        });
    };
    let next = move || {
        if busy.get_untracked() || !answered() {
            return;
        }
        if !last() {
            at.update(|n| *n += 1);
            return;
        }
        let answers = questions.with_value(|qs| {
            picks.with_untracked(|p| texts.with_untracked(|t| build_answers(qs, p, t)))
        });
        let (a, r, mut input) = ctx.get_value();
        input["answers"] = Value::Object(answers);
        let Some(c) = client_or_toast() else { return };
        busy.set(true);
        if let Err(e) = c.respond_to_permission(
            &a,
            &r,
            json!({ "behavior": "allow", "updatedInput": input }),
        ) {
            busy.set(false);
            toast_err("Could not send the answer", e);
        }
    };
    let dismiss = move || {
        let (a, r, _) = ctx.get_value();
        let Some(c) = client_or_toast() else { return };
        busy.set(true);
        if let Err(e) = c.respond_to_permission(
            &a,
            &r,
            json!({ "behavior": "deny", "message": "Dismissed by user" }),
        ) {
            busy.set(false);
            toast_err("Could not dismiss", e);
        }
    };
    let option = move |i: i32, label: String, hint: Option<String>| {
        let on = move || chosen().contains(&i) || (i == OTHER && other_on());
        let multi = q.with_untracked(|q| q.multi) && i != OTHER;
        view! {
            <button
                class="q-opt"
                class:on=on
                role=if multi { "checkbox" } else { "radio" }
                aria-checked=move || on().to_string()
                disabled=move || busy.get()
                on:click=move |_| pick(i)
            >
                <span class="q-mark" class:multi=multi></span>
                <span class="q-opt-text">
                    <span class="q-opt-label">{label}</span>
                    {hint.map(|h| view! { <span class="q-opt-hint">{h}</span> })}
                </span>
            </button>
        }
    };
    view! {
        <div class="perm question cut cut-stroke flip m-enter" style="--c:10px">
            <div class="perm-head">
                <Icon ico=Ico::MessageSquare size=13.0 class="perm-ico" />
                <span class="q-kind">
                    {move || if total > 1 { format!("Question {} of {total}", at.get() + 1) } else { "Question".to_owned() }}
                </span>
                <span class="spacer"></span>
                {who.map(|w| view! { <span class="perm-keys t-mono">{w}</span> })}
            </div>
            {move || {
                let cur = q.get();
                let n = at.get();
                let free = cur.options.is_empty();
                view! {
                    <div class="q-text">{cur.question.clone()}</div>
                    <div class="q-opts">
                        {cur.options
                            .iter()
                            .enumerate()
                            .map(|(i, (l, h))| option(i as i32, l.clone(), h.clone()))
                            .collect_view()}
                        {(cur.other && !free).then(|| option(OTHER, "Other…".into(), None))}
                    </div>
                    <Show when=other_on>
                        <input
                            class="input field-box perm-reply q-input"
                            placeholder=cur.placeholder.clone().unwrap_or_else(|| "Type your answer".into())
                            autofocus=!free
                            prop:value=move || texts.with(|t| t.get(&n).cloned().unwrap_or_default())
                            on:input=move |ev| {
                                let v = event_target_value(&ev);
                                texts.update(|t| {
                                    t.insert(n, v);
                                });
                            }
                            on:keydown=move |ev| {
                                if ev.key() == "Enter" {
                                    ev.prevent_default();
                                    next();
                                }
                            }
                        />
                    </Show>
                }
            }}
            <div class="perm-actions q-actions">
                <button class="q-dismiss" disabled=move || busy.get() on:click=move |_| dismiss()>
                    "Dismiss"
                </button>
                <span class="spacer"></span>
                <Show when=move || at.get() != 0>
                    <Button
                        label="Back"
                        disabled=busy
                        on_press=Callback::new(move |_| at.update(|n| *n = n.saturating_sub(1)))
                    />
                </Show>
                <Button
                    kind=ButtonKind::Primary
                    label=Signal::derive(move || if last() { "Send answer".to_owned() } else { "Next".to_owned() })
                    kbd="⏎"
                    disabled=Signal::derive(move || busy.get() || !answered())
                    on_press=Callback::new(move |_| next())
                />
            </div>
        </div>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn qs() -> Vec<Question> {
        parse_questions(&json!({"questions":[
            {"question":"Which db?","header":"DB","options":[{"label":"pg"},{"label":"sqlite","description":"file"}]},
            {"question":"Toppings?","header":"Top","multiSelect":true,"options":[{"label":"a"},{"label":"b"}]},
            {"question":"Name it"}
        ]}))
        .unwrap()
    }

    #[test]
    fn parses_questions() {
        let q = qs();
        assert_eq!(q.len(), 3);
        assert!(q[0].other && !q[0].multi);
        assert!(q[1].multi);
        assert!(!q[2].other && q[2].options.is_empty());
        assert_eq!(q[2].header, "Name it");
        assert!(parse_questions(&json!({"questions":[{"nope":1}]})).is_none());
        assert!(parse_questions(&json!({"questions":[]})).is_none());
    }

    #[test]
    fn multi_select_and_other() {
        assert_eq!(choose(&[], 1, false), vec![1]);
        assert_eq!(choose(&[1], 0, true), vec![1, 0]);
        assert_eq!(choose(&[1, 0], 1, true), vec![0]);
        assert_eq!(choose(&[0], OTHER, true), vec![OTHER]);
        assert_eq!(choose(&[OTHER], 1, true), vec![1]);
    }

    #[test]
    fn answers_keyed_by_header() {
        let q = qs();
        let picks = HashMap::from([(0, vec![OTHER]), (1, vec![1, 0])]);
        let texts = HashMap::from([(0, " mysql ".to_owned()), (2, "Frogg".to_owned())]);
        let a = build_answers(&q, &picks, &texts);
        assert_eq!(a["DB"], "mysql");
        assert_eq!(a["Top"], "b, a");
        assert_eq!(a["Name it"], "Frogg");
    }
}
