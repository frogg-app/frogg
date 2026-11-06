//! Terminals merged into the Sessions list (ui-next `sessions/merged.tsx`, Settings › Files,
//! editor & terminal › "Terminals in Sessions"). The host's terminals follow its sessions as one
//! more group; opening one shows it in the Sessions main pane. Off, terminals keep their tool.

use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::components::{Brackets, Ico, Icon};
use crate::state::terminals::store;

/// How often the terminal list refreshes while the merged list is on screen.
const REFRESH_MS: u64 = 5000;

/// The active host's terminals as a list group, filtered by the list's filter text. Renders
/// nothing while the pref is off or the host has none.
#[component]
pub fn MergedTerminals(#[prop(into)] needle: Signal<String>) -> impl IntoView {
    let app = crate::state::get();
    let on = Memo::new(move |_| app.prefs.flag("sessionsWithTerminals"));
    let t = store();
    // Refresh now and on a timer while on and online.
    Effect::new(move |_| {
        let online = app.conn.active_link().conn == crate::state::Conn::Online;
        if on.get() && online {
            spawn_local(t.refresh_all());
        }
    });
    let alive = StoredValue::new(true);
    on_cleanup(move || alive.set_value(false));
    fn tick(alive: StoredValue<bool>, on: Memo<bool>) {
        set_timeout(
            move || {
                if !alive.try_get_value().unwrap_or(false) {
                    return;
                }
                if on.get_untracked() && crate::state::checkout::online() {
                    spawn_local(store().refresh_all());
                }
                tick(alive, on);
            },
            std::time::Duration::from_millis(REFRESH_MS),
        );
    }
    tick(alive, on);
    let list = Memo::new(move |_| {
        if !on.get() {
            return Vec::new();
        }
        let n = needle.get().trim().to_lowercase();
        t.all
            .get()
            .unwrap_or_default()
            .into_iter()
            .filter(|x| {
                n.is_empty()
                    || format!("{} {}", x.title.clone().unwrap_or_default(), x.name)
                        .to_lowercase()
                        .contains(&n)
            })
            .collect::<Vec<_>>()
    });
    view! {
        <Show when=move || !list.with(Vec::is_empty)>
            <div class="sgroup merged-terms">
                <div class="sgroup-head">
                    <span class="sgroup-text"><span class="t-label">"Terminals"</span></span>
                    <span class="t-mono group-count">{move || list.with(Vec::len)}</span>
                </div>
                <For
                    each=move || list.get()
                    key=|x| x.id.clone()
                    children=move |x| {
                        let id = StoredValue::new(x.id.clone());
                        let on = Signal::derive(move || {
                            app.ui.sessions_terminal().as_deref() == Some(id.get_value().as_str())
                        });
                        view! {
                            <div
                                class="pn-row"
                                class:on=move || on.get()
                                role="button"
                                tabindex="0"
                                on:click=move |_| app.ui.open_session_terminal(Some(id.get_value()))
                            >
                                <Brackets on=on />
                                <Icon ico=Ico::SquareTerminal size=15.0 class="pn-muted" />
                                <div class="pn-row-text">
                                    <span class="pn-row-title">{x.label()}</span>
                                    <span class="pn-row-meta t-mono">{x.name.clone()}</span>
                                </div>
                                <button
                                    class="icon-btn pn-hover"
                                    aria-label="Kill terminal"
                                    on:click=move |e| {
                                        e.stop_propagation();
                                        let id = id.get_value();
                                        if app.ui.sessions_terminal().as_deref() == Some(id.as_str()) {
                                            app.ui.open_session_terminal(None);
                                        }
                                        spawn_local(store().kill(id));
                                    }
                                >
                                    <Icon ico=Ico::X size=14.0 class="faint" />
                                </button>
                            </div>
                        }
                    }
                />
            </div>
        </Show>
    }
}
