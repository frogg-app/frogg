//! The 26px status bar along the bottom of wide layouts (ui-next `StatusBar.tsx`). Branch, diff
//! stat and PR checks segments come with the SCM / PRs panels (wave 2).

use leptos::prelude::*;

use crate::components::Logo;
use crate::state::kbd::kbd;
use crate::state::Tool;

/// "claude" → "Claude Code" and friends (ui-next `util.ts` `providerLabel`).
pub fn provider_label(id: &str) -> String {
    match id {
        "claude" => "Claude Code".into(),
        "codex" => "Codex".into(),
        "gemini" => "Gemini".into(),
        "opencode" => "OpenCode".into(),
        "copilot" => "Copilot".into(),
        other => {
            let mut c = other.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        }
    }
}

#[component]
pub fn StatusBar() -> impl IntoView {
    let app = crate::state::get();
    let link = Memo::new(move |_| app.conn.active_link());
    let host_label = move || {
        let l = link.get();
        l.server_name
            .or_else(|| app.hosts.active().map(|h| h.name))
            .unwrap_or_else(|| l.conn.id().to_owned())
    };
    let buckets = Memo::new(move |_| app.agents.buckets(app.active_host().as_deref()));
    let agent = Memo::new(move |_| app.selected_session().map(|s| s.agent));
    view! {
        <div class="statusbar">
            <div class="sb-seg sb-brand">
                <Logo size=12.0 motion="none".to_string() />
                <span class="sb-brand-t">"frogg"</span>
            </div>
            <button class="sb-seg" on:click=move |_| app.ui.host_sheet_open.set(true)>
                <span class=move || format!("dot {}", link.get().conn.id())></span>
                <span class="sb-t">{host_label}</span>
            </button>
            <crate::views::panels::scm::ScmStatusSegments />
            <span class="spacer"></span>
            {move || {
                let n = buckets.get().needs;
                (n > 0)
                    .then(|| {
                        view! {
                            <button class="sb-seg sb-needs" on:click=move |_| app.ui.set_tool(Tool::Inbox)>
                                <span class="sb-t">{format!("◆ {n} need you")}</span>
                            </button>
                        }
                    })
            }}
            <div class="sb-seg">
                <span class="sb-t">{move || format!("▸ {} running", buckets.get().working)}</span>
            </div>
            {move || {
                agent
                    .get()
                    .map(|a| {
                        view! {
                            <div class="sb-seg">
                                <span class="sb-t">
                                    {format!("{} · {}", provider_label(&a.provider), a.model_label())}
                                </span>
                            </div>
                        }
                    })
            }}
            <button class="sb-seg" on:click=move |_| app.ui.palette_open.set(true)>
                <span class="sb-t t-mono">{kbd("⌘K")}</span>
            </button>
        </div>
    }
}
