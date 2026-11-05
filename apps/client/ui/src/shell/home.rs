//! Home (ui-next `Home.tsx`): shown in the main pane when no session is open. Four start cards
//! and an "ask anything" composer; the real composer arrives with the chat stream
//! (`views::chat::Composer`), this one hands its text to New session.

use leptos::prelude::*;

use super::panel_head::RevealHeading;
use crate::components::{Ico, Icon};
use crate::state::Tool;

#[component]
pub fn Home() -> impl IntoView {
    let app = crate::state::get();
    let host = move || {
        app.conn
            .active_link()
            .server_name
            .or_else(|| app.hosts.active().map(|h| h.name))
            .unwrap_or_else(|| "host".into())
    };
    let ui = app.ui;
    let cards: [(Ico, &str, &str, Option<Callback<()>>); 4] = [
        (
            Ico::Plus,
            "Add a project",
            "Browse this host or open a path",
            Some(Callback::new(move |_| ui.set_new_session(true, None))),
        ),
        (
            Ico::Upload,
            "Import conversations",
            "Claude Code, Codex or JSONL files",
            None,
        ),
        (
            Ico::Zap,
            "Set up providers",
            "Sign in once, use everywhere",
            Some(Callback::new(move |_| ui.set_tool(Tool::Settings))),
        ),
        (
            Ico::QrCode,
            "Pair a device",
            "Phone, browser or another computer",
            Some(Callback::new(move |_| ui.host_sheet_open.set(true))),
        ),
    ];
    let prompt = RwSignal::new(String::new());
    let ask = move || {
        let text = prompt.get_untracked();
        prompt.set(String::new());
        ui.set_new_session(true, Some(text));
    };
    view! {
        <div class="home">
            <div class="home-head">
                <span class="t-label">{host}</span>
                <span class="t-display home-title">"Start something"</span>
            </div>
            <div class="home-body" class:phone=move || app.viewport.phone()>
                <div class="home-cards">
                    {cards
                        .into_iter()
                        .map(|(ico, title, sub, run)| {
                            view! {
                                <button class="home-card-wrap" on:click=move |_| if let Some(r) = run { r.run(()) }>
                                    <div class="home-card cut flip" style="--c:12px">
                                        <Icon ico=ico size=18.0 class="cyan2" />
                                        <span class="home-card-title">{title}</span>
                                        <span class="home-card-sub">{sub}</span>
                                    </div>
                                </button>
                            }
                        })
                        .collect_view()}
                </div>
                <div class="home-ask">
                    <span class="t-label center">"or just ask · no project"</span>
                    <RevealHeading text="What do you want to know?".to_string() class="home-ask-title" />
                    <div class="composer-stub cut cut-stroke" style="--c:10px">
                        <textarea
                            class="composer-input"
                            rows="2"
                            placeholder="Ask anything…"
                            prop:value=move || prompt.get()
                            on:input=move |ev| prompt.set(event_target_value(&ev))
                            on:keydown=move |ev| {
                                if ev.key() == "Enter" && !ev.shift_key() {
                                    ev.prevent_default();
                                    ask();
                                }
                            }
                        ></textarea>
                        <div class="composer-row">
                            <span class="chip">"Claude Code"</span>
                            <span class="chip">"Opus 5.5"</span>
                            <span class="spacer"></span>
                            <button class="send cut" style="--c:6px" aria-label="Send" on:click=move |_| ask()>
                                <Icon ico=Ico::ArrowUp size=15.0 stroke=2.0 />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    }
}
