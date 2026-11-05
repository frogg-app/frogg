//! The rail (ui-next `Rail.tsx`, the polish bar): a 58px icon column that widens to 212px on
//! hover intent (140ms) or keyboard focus, floating over the content with a shadow; pinned it
//! takes the full width in flow. After a pick it folds away until the pointer leaves or rests
//! on another item. One 2px indicator glides between items.

use std::time::Duration;

use leptos::html;
use leptos::prelude::*;

use super::tools::{badge, shown_groups, ToolMeta};
use crate::components::{Ico, Icon, Logo};
use crate::state::Tool;

const OPEN_DELAY: u64 = 140;
const CLOSE_MS: f64 = 240.0;
const REOPEN_DWELL: u64 = 450;

#[derive(Clone, Copy)]
struct RailCtl {
    hover: RwSignal<bool>,
    focus: RwSignal<bool>,
    suppressed: RwSignal<bool>,
    picked: StoredValue<Option<Tool>>,
    inside: StoredValue<bool>,
    closing_until: StoredValue<f64>,
    /// Bumped to cancel pending timers of each kind.
    open_gen: StoredValue<u64>,
    dwell_gen: StoredValue<u64>,
    blur_gen: StoredValue<u64>,
}

fn after(ms: u64, f: impl FnOnce() + 'static) {
    set_timeout(f, Duration::from_millis(ms));
}

impl RailCtl {
    fn new() -> Self {
        Self {
            hover: RwSignal::new(false),
            focus: RwSignal::new(false),
            suppressed: RwSignal::new(false),
            picked: StoredValue::new(None),
            inside: StoredValue::new(false),
            closing_until: StoredValue::new(0.0),
            open_gen: StoredValue::new(0),
            dwell_gen: StoredValue::new(0),
            blur_gen: StoredValue::new(0),
        }
    }

    fn bump(v: StoredValue<u64>) -> u64 {
        v.update_value(|g| *g += 1);
        v.get_value()
    }

    fn wait(&self, min: u64) -> u64 {
        let left = self.closing_until.get_value() - js_sys::Date::now();
        min.max(left.max(0.0) as u64)
    }

    fn enter(self) {
        self.inside.set_value(true);
        let g = Self::bump(self.open_gen);
        after(self.wait(OPEN_DELAY), move || {
            if self.open_gen.get_value() == g {
                self.hover.set(true);
            }
        });
    }

    fn leave(self) {
        self.inside.set_value(false);
        Self::bump(self.open_gen);
        Self::bump(self.dwell_gen);
        self.hover.set(false);
        self.suppressed.set(false);
        self.picked.set_value(None);
    }

    fn item_hover(self, id: Tool) {
        let g = Self::bump(self.dwell_gen);
        let picked = self.picked.get_value();
        if picked.is_none() || picked == Some(id) {
            return;
        }
        // Sweeping across items on the way out is not intent; resting on one is.
        after(self.wait(REOPEN_DWELL), move || {
            if self.dwell_gen.get_value() == g {
                self.picked.set_value(None);
                self.suppressed.set(false);
            }
        });
    }

    fn item_focus(self) {
        Self::bump(self.blur_gen);
        // Mouse clicks focus too; only keyboard focus (pointer elsewhere) opens the rail.
        if self.inside.get_value() {
            return;
        }
        self.suppressed.set(false);
        self.focus.set(true);
    }

    fn item_blur(self) {
        let g = Self::bump(self.blur_gen);
        after(60, move || {
            if self.blur_gen.get_value() == g {
                self.focus.set(false);
            }
        });
    }

    fn fold(self) {
        self.closing_until.set_value(js_sys::Date::now() + CLOSE_MS);
        self.suppressed.set(true);
    }
}

#[component]
pub fn Rail() -> impl IntoView {
    let app = crate::state::get();
    let ctl = RailCtl::new();
    let pinned = Memo::new(move |_| app.prefs.rail_pinned());
    let open = Memo::new(move |_| {
        pinned.get() || ((ctl.hover.get() || ctl.focus.get()) && !ctl.suppressed.get())
    });
    let groups = Memo::new(move |_| {
        shown_groups(&app).map(|g| g.into_iter().map(|t| t.id).collect::<Vec<_>>())
    });

    // The glide indicator follows the active item's offset within the rail.
    let rail = NodeRef::<html::Div>::new();
    let glide_y = RwSignal::new(None::<f64>);
    Effect::new(move |_| {
        let tool = app.ui.tool.get();
        groups.track();
        request_animation_frame(move || {
            let Some(root) = rail.get_untracked() else {
                return;
            };
            let el = root
                .query_selector(&format!("[data-tool=\"{}\"]", tool.id()))
                .ok()
                .flatten();
            use wasm_bindgen::JsCast;
            glide_y.set(
                el.and_then(|e| e.dyn_into::<web_sys::HtmlElement>().ok())
                    .map(|e| e.offset_top() as f64),
            );
        });
    });

    let pick = move |id: Tool| {
        app.ui.set_tool(id);
        ctl.picked.set_value(Some(id));
        if !app.prefs.rail_pinned() {
            ctl.fold();
        } else {
            ctl.suppressed.set(true);
        }
        ctl.focus.set(false);
    };
    let toggle_pin = move |_| {
        let next = !app.prefs.rail_pinned();
        app.prefs.set("railPinned", next);
        if !next {
            ctl.fold();
        }
    };

    let item = move |t: ToolMeta| {
        let id = t.id;
        let on = Memo::new(move |_| app.ui.tool.get() == id);
        view! {
            <div class="ri-wrap" data-tool=id.id()>
                <button
                    class="ri-press"
                    aria-label=t.label
                    aria-selected=move || on.get().to_string()
                    on:click=move |_| pick(id)
                    on:pointerenter=move |_| ctl.item_hover(id)
                    on:focus=move |_| ctl.item_focus()
                    on:blur=move |_| ctl.item_blur()
                >
                    <div
                        class="ri cut"
                        class:on=move || on.get()
                        class:kbd=move || ctl.focus.get()
                        style=move || if on.get() { "--c:12px" } else { "--c:8px" }
                    >
                        <span class="ri-icon">
                            <Icon ico=t.icon size=18.0 />
                            {move || badge(&app, id).map(|n| view! { <span class="badge">{n}</span> })}
                        </span>
                        <span class="ri-label" class:shown=move || open.get()>{t.label}</span>
                    </div>
                </button>
            </div>
        }
    };
    let group = move |g: usize| {
        move || {
            groups.get()[g]
                .iter()
                .map(|id| item(super::tools::meta(*id)))
                .collect_view()
        }
    };

    view! {
        <div class="rail-slot" class:pinned=move || pinned.get()>
            <div
                class="rail"
                class:open=move || open.get()
                class:float=move || open.get() && !pinned.get()
                node_ref=rail
                on:pointerenter=move |_| ctl.enter()
                on:pointerleave=move |_| ctl.leave()
            >
                <div
                    class="rail-glide"
                    style=move || match glide_y.get() {
                        Some(y) => format!("transform:translateY({}px)", y + 6.0),
                        None => "opacity:0".into(),
                    }
                ></div>
                <div class="rail-logo">
                    <span class="rail-mark">
                        <Logo size=26.0 motion=Signal::derive(move || app.prefs.text("logoMotion")) />
                    </span>
                    <span class="t-display rail-word" class:shown=move || open.get()>"frogg"</span>
                </div>
                {group(0)}
                <div class="rail-sep"></div>
                {group(1)}
                <div class="spacer"></div>
                {group(2)}
                <button
                    class="ri-press rail-pin"
                    aria-label=move || if pinned.get() { "Collapse rail" } else { "Keep rail open" }
                    on:click=toggle_pin
                >
                    <span class="ri-icon">
                        <Icon
                            ico=Signal::derive(move || if pinned.get() { Ico::PanelLeftClose } else { Ico::PanelLeftOpen })
                            size=15.0
                        />
                    </span>
                    <span class="rail-pin-t" class:shown=move || open.get()>
                        {move || if pinned.get() { "Collapse rail" } else { "Keep rail open" }}
                    </span>
                </button>
            </div>
        </div>
    }
}
