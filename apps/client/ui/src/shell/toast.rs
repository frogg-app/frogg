//! Toasts (ui-next `toast/store.ts`, `ToastHost.tsx`, bracket variant): a bottom-right stack
//! (bottom, full width on phones) of chamfered cards that slide in, snap their corner marks a beat
//! later, drain a line over their lifetime, and hold while hovered.

use std::collections::HashMap;
use std::time::Duration;

use leptos::prelude::*;
use serde::{Deserialize, Serialize};

use crate::components::{Ico, Icon, StatusGlyph};
use crate::state::Bucket;
use crate::theme::{TOAST_LIFE_MS, TOAST_OUT_MS};

#[allow(dead_code)] // Done / Needs: raised by the session toasts (sessions stream).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToastKind {
    Ok,
    Done,
    Error,
    Needs,
    Info,
}

impl ToastKind {
    pub fn id(self) -> &'static str {
        match self {
            ToastKind::Ok => "ok",
            ToastKind::Done => "done",
            ToastKind::Error => "error",
            ToastKind::Needs => "needs",
            ToastKind::Info => "info",
        }
    }

    fn tag(self) -> &'static str {
        match self {
            ToastKind::Ok => "done",
            ToastKind::Done => "review",
            ToastKind::Error => "failed",
            ToastKind::Needs => "needs you",
            ToastKind::Info => "note",
        }
    }
}

#[derive(Clone)]
pub struct ToastAction {
    pub label: String,
    pub run: Callback<()>,
}

#[derive(Clone)]
pub struct Toast {
    pub id: u64,
    pub title: String,
    pub detail: Option<String>,
    pub kind: ToastKind,
    pub action: Option<ToastAction>,
    pub sticky: bool,
    /// The action leaves the toast up (Retry may need pressing again).
    pub keep_on_action: bool,
    pub leaving: bool,
    /// Ms on screen; 0 when sticky.
    pub life: u32,
}

impl Toast {
    pub fn new(kind: ToastKind, title: impl Into<String>) -> Self {
        Self {
            id: 0,
            title: title.into(),
            detail: None,
            kind,
            action: None,
            sticky: false,
            keep_on_action: false,
            leaving: false,
            life: 0,
        }
    }

    pub fn keep_on_action(mut self) -> Self {
        self.keep_on_action = true;
        self
    }

    pub fn detail(mut self, d: impl Into<String>) -> Self {
        self.detail = Some(d.into());
        self
    }

    #[allow(dead_code)]
    pub fn sticky(mut self) -> Self {
        self.sticky = true;
        self
    }

    pub fn action(
        mut self,
        label: impl Into<String>,
        run: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        self.action = Some(ToastAction {
            label: label.into(),
            run: Callback::new(move |_| run()),
        });
        self
    }
}

const MAX: usize = 4;

/// A toast's countdown: when it ends, what was left when paused, and a token that cancels
/// superseded timeouts.
#[derive(Clone, Copy, Default)]
struct Timer {
    deadline: f64,
    remaining: f64,
    token: u64,
}

#[derive(Clone, Copy)]
pub struct Toasts {
    pub list: RwSignal<Vec<Toast>>,
    pub paused: RwSignal<bool>,
    seq: StoredValue<u64>,
    timers: StoredValue<HashMap<u64, Timer>>,
    /// Every toast raised on this device, newest first (the Inbox's log).
    pub history: RwSignal<Vec<ToastRecord>>,
}

/// One toast as the Inbox remembers it: the copy, not the live action.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToastRecord {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub kind: ToastKind,
    /// Epoch ms it was raised.
    pub at: f64,
}

const HISTORY_KEY: &str = "frogg.next.toasts";
/// Newest kept; older ones drop off whatever the retention setting says.
const HISTORY_CAP: usize = 200;
const DAY_MS: f64 = 86_400_000.0;

/// Drops records older than Settings › Notifications › "Keep notifications for".
fn prune(mut records: Vec<ToastRecord>, keep_days: &str, now: f64) -> Vec<ToastRecord> {
    if let Ok(days) = keep_days.trim().parse::<f64>() {
        let cut = now - days * DAY_MS;
        records.retain(|r| r.at >= cut);
    }
    records.truncate(HISTORY_CAP);
    records
}

fn now() -> f64 {
    js_sys::Date::now()
}

impl Toasts {
    pub fn init() -> Self {
        let saved: Vec<ToastRecord> =
            crate::state::storage::get_json(HISTORY_KEY).unwrap_or_default();
        Self {
            list: RwSignal::new(Vec::new()),
            paused: RwSignal::new(false),
            seq: StoredValue::new(0),
            timers: StoredValue::new(HashMap::new()),
            history: RwSignal::new(saved),
        }
    }

    fn record(&self, t: &Toast) {
        let at = now();
        let keep = crate::state::get()
            .prefs
            .get_untracked::<String>("keepDays");
        let rec = ToastRecord {
            id: format!("{at}-{}", t.id),
            title: t.title.clone(),
            detail: t.detail.clone(),
            kind: t.kind,
            at,
        };
        self.history.update(|h| {
            let mut next = vec![rec];
            next.append(h);
            *h = prune(next, &keep, at);
            crate::state::storage::set_json(HISTORY_KEY, h);
        });
    }

    pub fn clear_history(&self) {
        self.history.set(Vec::new());
        crate::state::storage::set_json(HISTORY_KEY, &Vec::<ToastRecord>::new());
    }

    /// Live copy changes to a toast still on screen.
    pub fn update(&self, id: u64, title: Option<String>, detail: Option<Option<String>>) {
        self.list.update(|l| {
            if let Some(t) = l.iter_mut().find(|t| t.id == id) {
                if let Some(x) = title {
                    t.title = x;
                }
                if let Some(d) = detail {
                    t.detail = d;
                }
            }
        });
    }

    /// Whether a toast is still up (not dismissed).
    pub fn showing(&self, id: u64) -> bool {
        self.list
            .with_untracked(|l| l.iter().any(|t| t.id == id && !t.leaving))
    }

    /// Holds every countdown where it is (pointer over the stack).
    pub fn pause(&self) {
        if self.paused.get_untracked() {
            return;
        }
        let t = now();
        self.timers.update_value(|m| {
            for x in m.values_mut() {
                x.remaining = (x.deadline - t).max(0.0);
                x.token += 1;
            }
        });
        self.paused.set(true);
    }

    /// Restarts each countdown with the time it had left.
    pub fn resume(&self) {
        if !self.paused.get_untracked() {
            return;
        }
        self.paused.set(false);
        let left: Vec<(u64, f64)> = self
            .timers
            .with_value(|m| m.iter().map(|(id, x)| (*id, x.remaining)).collect());
        for (id, ms) in left {
            self.arm(id, ms.max(400.0) as u32);
        }
    }

    pub fn push(&self, mut t: Toast) -> u64 {
        self.seq.update_value(|s| *s += 1);
        t.id = self.seq.get_value();
        let ms = crate::state::get().prefs.toast_ms();
        if ms == 0 {
            t.sticky = true;
        }
        t.life = if t.sticky { 0 } else { ms.max(1) };
        let id = t.id;
        let life = t.life;
        self.list.update(|l| {
            l.push(t);
            let live = l.iter().filter(|x| !x.leaving).count();
            if live > MAX {
                if let Some(old) = l.iter_mut().find(|x| !x.leaving) {
                    old.leaving = true;
                }
            }
        });
        self.reap_later();
        if life > 0 {
            if self.paused.get_untracked() {
                self.timers.update_value(|m| {
                    m.insert(
                        id,
                        Timer {
                            remaining: life as f64,
                            ..Timer::default()
                        },
                    );
                });
            } else {
                self.arm(id, life);
            }
        }
        if let Some(t) = self
            .list
            .with_untracked(|l| l.iter().find(|t| t.id == id).cloned())
        {
            self.record(&t);
        }
        id
    }

    fn arm(&self, id: u64, ms: u32) {
        let this = *self;
        let mut token = 0;
        self.timers.update_value(|m| {
            let x = m.entry(id).or_default();
            x.token += 1;
            x.deadline = now() + ms as f64;
            x.remaining = ms as f64;
            token = x.token;
        });
        set_timeout(
            move || {
                let live = this
                    .timers
                    .try_with_value(|m| m.get(&id).map(|x| x.token) == Some(token))
                    .unwrap_or(false);
                if live && !this.paused.get_untracked() {
                    this.dismiss(id);
                }
            },
            Duration::from_millis(ms as u64),
        );
    }

    pub fn dismiss(&self, id: u64) {
        self.timers.update_value(|m| {
            m.remove(&id);
        });
        self.list.update(|l| {
            if let Some(t) = l.iter_mut().find(|t| t.id == id) {
                t.leaving = true;
            }
        });
        self.reap_later();
    }

    fn reap_later(&self) {
        let list = self.list;
        set_timeout(
            move || list.update(|l| l.retain(|t| !t.leaving)),
            Duration::from_millis(TOAST_OUT_MS as u64 + 40),
        );
    }
}

/// Shorthand: `toast(ToastKind::Ok, "Saved")`.
#[allow(dead_code)]
pub fn toast(kind: ToastKind, title: impl Into<String>) -> u64 {
    crate::state::get().toasts.push(Toast::new(kind, title))
}

fn glyph(kind: ToastKind) -> impl IntoView {
    match kind {
        ToastKind::Ok => {
            view! { <Icon ico=Ico::Check size=13.0 stroke=2.0 class="toast-ok" /> }.into_any()
        }
        ToastKind::Info => view! { <span class="toast-info-dot"></span> }.into_any(),
        ToastKind::Done => view! { <StatusGlyph bucket=Bucket::Review size=8.0 /> }.into_any(),
        ToastKind::Error => view! { <StatusGlyph bucket=Bucket::Failed size=8.0 /> }.into_any(),
        ToastKind::Needs => view! { <StatusGlyph bucket=Bucket::Needs size=8.0 /> }.into_any(),
    }
}

#[component]
pub fn ToastHost() -> impl IntoView {
    let app = crate::state::get();
    let toasts = app.toasts;
    view! {
        <div
            class="toasts"
            class:phone=move || app.viewport.phone()
            on:pointerenter=move |_| toasts.pause()
            on:pointerleave=move |_| toasts.resume()
        >
            <For
                each=move || toasts.list.get()
                key=|t| (t.id, t.leaving)
                children=move |t| {
                    let id = t.id;
                    let kind = t.kind;
                    let keep = t.keep_on_action;
                    // Title and detail update live (host toasts tick their copy).
                    let title = Signal::derive(move || {
                        toasts.list.with(|l| l.iter().find(|x| x.id == id).map(|x| x.title.clone()))
                    });
                    let detail = Signal::derive(move || {
                        toasts.list.with(|l| l.iter().find(|x| x.id == id).and_then(|x| x.detail.clone()))
                    });
                    let (t_title, t_detail) = (t.title.clone(), t.detail.clone());
                    let phone = app.viewport.phone();
                    let motion = match (t.leaving, phone) {
                        (false, false) => "toast-in-side",
                        (false, true) => "toast-in-up",
                        (true, false) => "toast-out-side",
                        (true, true) => "toast-out-down",
                    };
                    let life = if t.life == 0 { TOAST_LIFE_MS } else { t.life };
                    view! {
                        <div class="toast-slot" class:leaving=t.leaving>
                            <div class=format!("toast cut cut-stroke {motion} k-{}", kind.id()) style="--c:10px">
                                <span class="toast-edge"></span>
                                <span class=if t.leaving { "toast-corners" } else { "toast-corners snap" }>
                                    <i class="tc tl"></i>
                                    <i class="tc br"></i>
                                </span>
                                <div class="toast-body">
                                    <div class="toast-head">
                                        {glyph(kind)}
                                        <span class="t-label toast-tag">{kind.tag()}</span>
                                        <span class="spacer"></span>
                                        <button class="icon-btn" aria-label="Dismiss" on:click=move |_| toasts.dismiss(id)>
                                            <Icon ico=Ico::X size=13.0 />
                                        </button>
                                    </div>
                                    <div class="toast-title">{move || title.get().unwrap_or_else(|| t_title.clone())}</div>
                                    {move || detail.get().or_else(|| t_detail.clone()).map(|d| view! { <div class="toast-detail">{d}</div> })}
                                    {t.action.clone().map(|a| {
                                        let run = a.run;
                                        view! {
                                            <button
                                                class="btn cut btn-tint toast-act"
                                                style="--c:6px"
                                                on:click=move |_| {
                                                    if !keep {
                                                        toasts.dismiss(id);
                                                    }
                                                    run.run(());
                                                }
                                            >
                                                <span class="btn-l">{a.label.clone()}</span>
                                            </button>
                                        }
                                    })}
                                </div>
                                {(!t.sticky && !t.leaving).then(|| view! {
                                    <span
                                        class="toast-drain"
                                        class:held=move || toasts.paused.get()
                                        style=format!("animation-duration:{life}ms")
                                    ></span>
                                })}
                            </div>
                        </div>
                    }
                }
            />
        </div>
    }
}

/// The grace a first connect gets before the offline toast shows.
const GRACE_MS: u64 = 2000;

/// The active host dropping raises a sticky toast with Retry (ui-next
/// `HostToasts.tsx`); its copy follows the link's state, and the link coming back retires it
/// with a short "Reconnected". Call once from the app root.
pub fn host_toasts(app: crate::state::AppState) {
    use crate::state::Conn;
    let live = StoredValue::new(None::<u64>);
    let epoch = StoredValue::new(0u64);
    // Hosts that have been online this run: a host never reached (first run, pairing, a dead
    // address) shows its offline state in Hosts and on the home screen, not as a toast.
    let seen = StoredValue::new(std::collections::HashSet::<String>::new());
    let name = move || {
        app.hosts
            .active()
            .map(|h| h.name)
            .unwrap_or_else(|| "host".into())
    };
    let copy = move || {
        let l = app.conn.active_link();
        let n = name();
        let title = if l.conn == Conn::Connecting {
            format!("Connecting to {n}")
        } else {
            format!("Disconnected from {n}")
        };
        let detail = match l.error {
            Some(e) => format!("{e}. Reconnect before sending messages."),
            None => "Reconnect before sending messages.".to_owned(),
        };
        (title, detail)
    };
    let retire = move || {
        if let Some(id) = live.get_value() {
            app.toasts.dismiss(id);
        }
        live.set_value(None);
    };
    Effect::new(move |prev: Option<(Option<String>, bool)>| {
        let host = app.hosts.active_id.get();
        let online = app.conn.active_link().conn == Conn::Online;
        let same = prev
            .as_ref()
            .is_some_and(|(h, o)| *h == host && *o == online);
        if same {
            return (host, online);
        }
        if prev.as_ref().is_some_and(|(h, _)| *h != host) {
            retire();
        }
        if online {
            if let Some(h) = &host {
                seen.update_value(|s| {
                    s.insert(h.clone());
                });
            }
            let was_up = live.get_value().is_some_and(|id| app.toasts.showing(id));
            retire();
            epoch.update_value(|e| *e += 1);
            if was_up {
                app.toasts.push(Toast::new(
                    ToastKind::Ok,
                    format!("Reconnected to {}", untrack(name)),
                ));
            }
            return (host, online);
        }
        let known = host
            .as_ref()
            .is_some_and(|h| seen.with_value(|s| s.contains(h)));
        if !known {
            return (host, online);
        }
        let mine = epoch.get_value();
        let host2 = host.clone();
        set_timeout(
            move || {
                let still = app.hosts.active_id.get_untracked() == host2
                    && untrack(|| app.conn.active_link().conn) != Conn::Online
                    && epoch.get_value() == mine
                    && live.get_value().is_none();
                if !still {
                    return;
                }
                let (title, detail) = untrack(copy);
                let id = app.toasts.push(
                    Toast::new(ToastKind::Info, title)
                        .detail(detail)
                        .sticky()
                        .keep_on_action()
                        .action("Retry now", move || {
                            if let Some(h) = app.hosts.active_id.get_untracked() {
                                app.conn.activate(&h);
                            }
                        }),
                );
                live.set_value(Some(id));
            },
            Duration::from_millis(GRACE_MS),
        );
        (host, online)
    });
    // Copy changes go to the toast already up, not a new one.
    Effect::new(move |_| {
        let (title, detail) = copy();
        if let Some(id) = live.get_value() {
            if app.toasts.showing(id) {
                app.toasts.update(id, Some(title), Some(Some(detail)));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(at: f64) -> ToastRecord {
        ToastRecord {
            id: at.to_string(),
            title: "t".into(),
            detail: None,
            kind: ToastKind::Ok,
            at,
        }
    }

    #[test]
    fn prune_keeps_recent_and_caps() {
        let now = 10.0 * DAY_MS;
        let out = prune(vec![rec(now), rec(now - 2.0 * DAY_MS)], "1", now);
        assert_eq!(out.len(), 1);
        let many: Vec<_> = (0..250).map(|i| rec(now - i as f64)).collect();
        assert_eq!(prune(many, "forever", now).len(), HISTORY_CAP);
    }
}
