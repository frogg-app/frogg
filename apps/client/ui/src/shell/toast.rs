//! Toasts (ui-next `toast/store.ts`, `ToastHost.tsx`, bracket variant): a bottom-right stack
//! (bottom, full width on phones) of chamfered cards that slide in, snap their corner marks a beat
//! later, drain a line over their lifetime, and hold while hovered.

use std::time::Duration;

use leptos::prelude::*;

use crate::components::{Ico, Icon, StatusGlyph};
use crate::state::Bucket;
use crate::theme::{TOAST_LIFE_MS, TOAST_OUT_MS};

#[allow(dead_code)] // Done / Needs: raised by the session toasts (sessions stream).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastKind {
    Ok,
    Done,
    Error,
    Needs,
    Info,
}

impl ToastKind {
    fn id(self) -> &'static str {
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
            leaving: false,
            life: 0,
        }
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

#[derive(Clone, Copy)]
pub struct Toasts {
    pub list: RwSignal<Vec<Toast>>,
    pub paused: RwSignal<bool>,
    seq: StoredValue<u64>,
}

impl Toasts {
    pub fn init() -> Self {
        Self {
            list: RwSignal::new(Vec::new()),
            paused: RwSignal::new(false),
            seq: StoredValue::new(0),
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
            self.arm(id, life);
        }
        id
    }

    fn arm(&self, id: u64, ms: u32) {
        let this = *self;
        set_timeout(
            move || {
                if this.paused.get_untracked() {
                    // Held while hovered: try again once the pointer leaves.
                    this.arm(id, 600);
                } else {
                    this.dismiss(id);
                }
            },
            Duration::from_millis(ms as u64),
        );
    }

    pub fn dismiss(&self, id: u64) {
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
            on:pointerenter=move |_| toasts.paused.set(true)
            on:pointerleave=move |_| toasts.paused.set(false)
        >
            <For
                each=move || toasts.list.get()
                key=|t| (t.id, t.leaving)
                children=move |t| {
                    let id = t.id;
                    let kind = t.kind;
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
                                    <div class="toast-title">{t.title.clone()}</div>
                                    {t.detail.clone().map(|d| view! { <div class="toast-detail">{d}</div> })}
                                    {t.action.clone().map(|a| {
                                        let run = a.run;
                                        view! {
                                            <button
                                                class="btn cut btn-tint toast-act"
                                                style="--c:6px"
                                                on:click=move |_| {
                                                    toasts.dismiss(id);
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
