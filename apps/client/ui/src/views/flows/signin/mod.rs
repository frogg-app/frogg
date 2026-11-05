//! Provider sign-in (ui-next `signin/SignInDialog.tsx`, `session.ts`): runs the provider's login
//! on the host in a hidden terminal under the account's config directory, reads the URL and code
//! out of its output, and kills it when the dialog closes.

use std::cell::RefCell;
use std::rc::Rc;

use frogg_client_core::{CreateTerminalOptions, DaemonClient, TerminalInput, TerminalStreamEvent};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use crate::components::{Button, ButtonKind, Ico, Icon, Sheet};
use crate::native;
use crate::state::config::{ns, provider_label, s};
use crate::state::signin::{
    self, close_sign_in, login_command, parse_login, strip_ansi, LoginState, SignInTarget,
};
use crate::views::settings::kit::Input;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Starting,
    Confirm,
    Waiting,
    Done,
    Failed,
}

const ROWS: u32 = 40;
/// Wide enough that the CLI never wraps its authorize URL.
const COLS: u32 = 2000;

/// Mount once at the app root; opens whenever something calls `open_sign_in`.
#[component]
pub fn SignInDialog() -> impl IntoView {
    let store = signin::get();
    let attempt = RwSignal::new(0u32);
    let open = Signal::derive(move || store.target.with(Option::is_some));
    view! {
        <Sheet open=open on_close=Callback::new(|_| close_sign_in()) width=520.0>
            {move || {
                let _ = attempt.get();
                store.target.get().map(|t| view! { <SignIn target=t on_retry=Callback::new(move |_| attempt.update(|a| *a += 1)) /> })
            }}
        </Sheet>
    }
}

struct Live {
    client: Option<DaemonClient>,
    terminal: Option<String>,
    listener: Option<u64>,
    poll: Option<IntervalHandle>,
    alive: bool,
}

fn pick_account(accounts: &[Value], t: &SignInTarget) -> Option<Value> {
    let mine: Vec<&Value> = accounts
        .iter()
        .filter(|a| s(a, "provider") == t.provider)
        .collect();
    t.account_id
        .as_ref()
        .and_then(|id| mine.iter().find(|a| &s(a, "id") == id))
        .or_else(|| {
            t.account_name
                .as_ref()
                .and_then(|n| mine.iter().find(|a| &s(a, "name") == n))
        })
        .or_else(|| {
            mine.iter()
                .find(|a| a.get("isActive") == Some(&Value::Bool(true)))
        })
        .or(mine.first())
        .map(|a| (*a).clone())
}

#[component]
fn SignIn(target: SignInTarget, on_retry: Callback<()>) -> impl IntoView {
    let app = crate::state::get();
    let phase = RwSignal::new(Phase::Starting);
    let account = RwSignal::new(None::<Value>);
    let state = RwSignal::new(LoginState::default());
    let tail = RwSignal::new(String::new());
    let error = RwSignal::new(None::<String>);
    let confirmed = RwSignal::new(false);
    let headless = login_command(&target.provider).is_some();
    let live = StoredValue::new_local(Live {
        client: None,
        terminal: None,
        listener: None,
        poll: None,
        alive: true,
    });
    let name = provider_label(&target.provider);
    let t = StoredValue::new(target);

    let teardown = {
        move || {
            let _ = live.try_update_value(|l| {
                if let Some(p) = l.poll.take() {
                    p.clear();
                }
                if let Some(c) = l.client.clone() {
                    if let Some(id) = l.listener.take() {
                        c.unsubscribe(id);
                    }
                    if let Some(term) = l.terminal.take() {
                        let _ = c.unsubscribe_terminal(&term);
                        spawn_local(async move {
                            let _ = c.kill_terminal(&term).await;
                        });
                    }
                }
            });
        }
    };
    on_cleanup(move || {
        let _ = live.try_update_value(|l| l.alive = false);
        teardown();
    });

    let fail = move |msg: String| {
        error.set(Some(msg));
        phase.set(Phase::Failed);
    };
    let alive = move || live.try_with_value(|l| l.alive).unwrap_or(false);
    let run = {
        move || {
            let target = t.get_value();
            spawn_local(async move {
                let host = target
                    .host_id
                    .clone()
                    .or_else(|| app.hosts.active_id.get_untracked());
                let Some(client) = host
                    .and_then(|h| app.conn.client_of(&h))
                    .filter(|c| c.is_connected())
                else {
                    return fail("Host offline. Reconnect and try again.".to_owned());
                };
                live.update_value(|l| l.client = Some(client.clone()));
                let list = match ns(
                    &client,
                    "provider.account.list.request",
                    json!({ "provider": target.provider }),
                )
                .await
                {
                    Ok(v) => v,
                    Err(e) => return fail(e),
                };
                if !alive() {
                    return;
                }
                let accounts = list
                    .get("accounts")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let Some(acct) = pick_account(&accounts, &target) else {
                    return fail("This provider has no sign-in accounts on this host. Turn accounts on first.".to_owned());
                };
                account.set(Some(acct.clone()));
                let was_signed_in = acct.get("authenticated") == Some(&Value::Bool(true));
                // Starting a login can drop the account's current credential before the new one
                // exists, so a signed-in account waits for consent.
                if was_signed_in && !confirmed.get_untracked() {
                    phase.set(Phase::Confirm);
                    return;
                }
                phase.set(Phase::Starting);
                let cmd = login_command(&target.provider);
                let opts = CreateTerminalOptions {
                    name: Some(format!("Sign in · {}", s(&acct, "name"))),
                    provider_account_id: Some(s(&acct, "id")),
                    size: Some(json!({ "rows": ROWS, "cols": COLS })),
                    command: cmd.map(|c| c.0.to_owned()),
                    args: cmd.map(|c| c.1.iter().map(|a| a.to_string()).collect()),
                    ..Default::default()
                };
                let res = match client.create_terminal(&s(&acct, "configDir"), opts).await {
                    Ok(r) => serde_json::to_value(r).unwrap_or(Value::Null),
                    Err(e) => return fail(e.to_string()),
                };
                let Some(id) = res
                    .pointer("/terminal/id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                else {
                    let e = res
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("The host could not start the sign-in.");
                    return fail(if e == "workspaceId is required" {
                        "This host's daemon is too old to sign in from the app. Update it first."
                            .to_owned()
                    } else {
                        e.to_owned()
                    });
                };
                let _ = live.try_update_value(|l| l.terminal = Some(id.clone()));
                if !alive() {
                    let _ = client.kill_terminal(&id).await;
                    return;
                }
                phase.set(Phase::Waiting);
                let raw = Rc::new(RefCell::new(String::new()));
                let tid = id.clone();
                let listener = client.on_terminal_stream_event(move |e| {
                    let (term, data, restore) = match e {
                        TerminalStreamEvent::Output { terminal_id, data } => {
                            (terminal_id, data, false)
                        }
                        TerminalStreamEvent::Restore { terminal_id, data } => {
                            (terminal_id, data, true)
                        }
                        TerminalStreamEvent::Snapshot { .. } => return,
                    };
                    if *term != tid {
                        return;
                    }
                    let text = String::from_utf8_lossy(data);
                    let mut r = raw.borrow_mut();
                    if restore {
                        *r = text.into_owned();
                    } else {
                        r.push_str(&text);
                    }
                    let next = parse_login(&r);
                    let start = r.len().saturating_sub(2000);
                    let start = (start..r.len())
                        .find(|i| r.is_char_boundary(*i))
                        .unwrap_or(r.len());
                    tail.set(r[start..].to_owned());
                    if next.done {
                        phase.set(Phase::Done);
                    }
                    state.set(next);
                });
                let _ = live.try_update_value(|l| l.listener = Some(listener));
                let _ = client
                    .subscribe_terminal(&id, Some(json!({ "mode": "full-snapshot", "size": { "rows": ROWS, "cols": COLS } })))
                    .await;
                // A signed-out account that turns signed-in is done even if the CLI said nothing we know.
                if !was_signed_in {
                    let c = client.clone();
                    let provider = target.provider.clone();
                    let aid = s(&acct, "id");
                    if let Ok(h) = set_interval_with_handle(
                        move || {
                            let c = c.clone();
                            let provider = provider.clone();
                            let aid = aid.clone();
                            spawn_local(async move {
                                if let Ok(r) = ns(
                                    &c,
                                    "provider.account.list.request",
                                    json!({ "provider": provider }),
                                )
                                .await
                                {
                                    let now =
                                        r.get("accounts").and_then(Value::as_array).and_then(|a| {
                                            a.iter().find(|x| s(x, "id") == aid).cloned()
                                        });
                                    if now.is_some_and(|a| {
                                        a.get("authenticated") == Some(&Value::Bool(true))
                                    }) {
                                        phase.set(Phase::Done);
                                    }
                                }
                            });
                        },
                        std::time::Duration::from_millis(2000),
                    ) {
                        if live.try_update_value(|l| l.poll = Some(h)).is_none() {
                            h.clear();
                        }
                    }
                }
            });
        }
    };
    run();
    let run2 = StoredValue::new_local(run);
    let send_code = Callback::new(move |code: String| {
        live.with_value(|l| {
            if let (Some(c), Some(id)) = (l.client.as_ref(), l.terminal.as_ref()) {
                let _ =
                    c.send_terminal_input(id, TerminalInput::Input(format!("{}\r", code.trim())));
            }
        })
    });
    let name2 = name.clone();
    let failed = move || {
        phase.get() == Phase::Failed
            || (phase.get() == Phase::Waiting && state.with(|s| s.error.is_some()))
    };
    view! {
        <div class="sheet-head">
            <span class="si-head">
                <span class="t-label">
                    {move || account.get().map(|a| format!("{name2} · {}", s(&a, "name"))).unwrap_or_else(|| name2.clone())}
                </span>
                <span class="t-display sheet-title">
                    {let n = name.clone(); move || if phase.get() == Phase::Done { "Signed in".to_owned() } else { format!("Sign in to {n}") }}
                </span>
            </span>
            <button class="icon-btn" aria-label="Close" on:click=|_| close_sign_in()>
                <Icon ico=Ico::X size=16.0 />
            </button>
        </div>
        <div class="si-body">
            {move || match phase.get() {
                Phase::Starting => view! { <Busy text="Starting sign-in on the host…" /> }.into_any(),
                Phase::Confirm => {
                    let acct = account.get().map(|a| s(&a, "name")).unwrap_or_else(|| "This account".to_owned());
                    let n = provider_label(&t.get_value().provider);
                    view! {
                        <div class="si-steps m-enter">
                            <span class="muted">
                                {format!("{acct} is signed in on this host. Signing in again replaces that sign-in: {n} may drop it as soon as the sign-in starts, so stopping part-way can leave the account signed out.")}
                            </span>
                            <div class="set-acts">
                                <Button
                                    kind=ButtonKind::Primary
                                    label="Sign in again"
                                    on_press=Callback::new(move |_| {
                                        confirmed.set(true);
                                        run2.with_value(|r| r());
                                    })
                                />
                            </div>
                        </div>
                    }.into_any()
                }
                Phase::Failed => view! { <span class="set-err">{error.get().unwrap_or_default()}</span> }.into_any(),
                Phase::Done => view! {
                    <div class="si-done m-enter">
                        <Icon ico=Ico::Check size=16.0 class="mint" />
                        <span class="muted">"New sessions with this account use the fresh sign-in."</span>
                    </div>
                }.into_any(),
                Phase::Waiting => view! { <Steps headless=headless state=state tail=tail send_code=send_code /> }.into_any(),
            }}
        </div>
        <div class="si-foot">
            {move || failed().then(|| view! { <Button label="Try again" on_press=on_retry /> })}
            {move || if phase.get() == Phase::Done {
                view! { <Button kind=ButtonKind::Primary label="Done" on_press=Callback::new(|_| close_sign_in()) /> }.into_any()
            } else {
                view! { <Button label="Cancel" on_press=Callback::new(|_| close_sign_in()) /> }.into_any()
            }}
        </div>
    }
}

#[component]
fn Steps(
    headless: bool,
    state: RwSignal<LoginState>,
    tail: RwSignal<String>,
    send_code: Callback<String>,
) -> impl IntoView {
    move || {
        let st = state.get();
        if !headless {
            let lines = strip_ansi(&tail.get());
            let lines: Vec<&str> = lines.trim().lines().collect();
            let shown = lines[lines.len().saturating_sub(12)..].join("\n");
            return view! {
                <div class="si-steps">
                    <span class="muted">"This provider signs in interactively. Its prompts appear below."</span>
                    {st.url.clone().map(|u| view! { <UrlActions url=u /> })}
                    <pre class="si-tail t-mono">{if shown.is_empty() { "…".to_owned() } else { shown }}</pre>
                    <CodeInput on_submit=send_code placeholder="Type a reply and press Enter" />
                </div>
            }
            .into_any();
        }
        let Some(url) = st.url.clone() else {
            return view! { <Busy text="Waiting for the sign-in link…" /> }.into_any();
        };
        view! {
            <div class="si-steps">
                <Step n=1 text="Open the sign-in page and approve access.">
                    <UrlActions url=url />
                </Step>
                {st.user_code.clone().map(|code| view! {
                    <Step n=2 text="Enter this code on that page.">
                        <div class="si-code-row">
                            <span class="si-code t-mono">{code.clone()}</span>
                            <CopyButton text=code label="Copy" />
                        </div>
                        <Busy text="Waiting for the provider to confirm…" />
                    </Step>
                })}
                {(st.wants_code && st.error.is_none()).then(|| view! {
                    <Step n=2 text="Paste the code the page shows after you approve.">
                        <CodeInput on_submit=send_code placeholder="Paste code" />
                    </Step>
                })}
                {st.error.clone().map(|e| view! { <span class="set-err">{e}</span> })}
            </div>
        }
        .into_any()
    }
}

#[component]
fn Step(n: u32, #[prop(into)] text: String, children: Children) -> impl IntoView {
    view! {
        <div class="si-step">
            <span class="si-n t-mono">{n}</span>
            <div class="grow si-step-body">
                <span>{text}</span>
                {children()}
            </div>
        </div>
    }
}

#[component]
fn UrlActions(url: String) -> impl IntoView {
    let u = StoredValue::new(url.clone());
    view! {
        <div class="set-acts">
            <Button kind=ButtonKind::Primary icon=Ico::ExternalLink label="Open sign-in page" on_press=Callback::new(move |_| native::open_external(&u.get_value())) />
            <CopyButton text=url label="Copy link" />
        </div>
    }
}

#[component]
fn CopyButton(text: String, #[prop(into)] label: String) -> impl IntoView {
    let copied = RwSignal::new(false);
    let t = StoredValue::new(text);
    let label = StoredValue::new(label);
    view! {
        <Button
            icon=Ico::Copy
            label=Signal::derive(move || if copied.get() { "Copied".to_owned() } else { label.get_value() })
            on_press=Callback::new(move |_| {
                let t = t.get_value();
                spawn_local(async move {
                    if native::clipboard_write(&t).await.is_ok() {
                        copied.set(true);
                    }
                });
            })
        />
    }
}

#[component]
fn CodeInput(on_submit: Callback<String>, #[prop(into)] placeholder: String) -> impl IntoView {
    let code = RwSignal::new(String::new());
    let sent = RwSignal::new(false);
    let send = Callback::new(move |_| {
        let c = code.get_untracked();
        if c.trim().is_empty() {
            return;
        }
        on_submit.run(c);
        code.set(String::new());
        sent.set(true);
    });
    view! {
        <div class="si-code-form">
            <div class="set-acts grow">
                <Input value=code placeholder=placeholder mono=true grow=true on_enter=send />
                <Button kind=ButtonKind::Primary label="Submit" disabled=Signal::derive(move || code.get().trim().is_empty()) on_press=send />
            </div>
            {move || sent.get().then(|| view! { <Busy text="Checking with the provider…" /> })}
        </div>
    }
}

#[component]
fn Busy(#[prop(into)] text: String) -> impl IntoView {
    view! {
        <div class="si-busy">
            <span class="spinner"></span>
            <span class="muted">{text}</span>
        </div>
    }
}
