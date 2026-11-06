//! A session popped out into its own window (ui-next `shell/SessionWindow.tsx`, `popout.ts`):
//! the shell opens a second window on the same origin with `?popout=<session>&host=<host>`; it
//! shows that session's chat and toasts, nothing else, on its own connection to the same saved
//! host, so both windows stay in step through the daemon.

use leptos::prelude::*;

use crate::components::{Ico, Icon};
use crate::state::Conn;

const KEY: &str = "frogg.next.popout";

/// The popped-out session and its host, read once and kept in this window's sessionStorage
/// (in-app navigation may drop the query).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Route {
    pub session: String,
    pub host: Option<String>,
}

pub fn route() -> Option<Route> {
    let store = web_sys::window().and_then(|w| w.session_storage().ok().flatten());
    let l = crate::native::launch();
    if let Some(session) = l
        .popout
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
    {
        let r = Route {
            session,
            host: l.host.filter(|h| !h.trim().is_empty()),
        };
        if let (Some(s), Ok(json)) = (&store, serde_json::to_string(&r)) {
            let _ = s.set_item(KEY, &json);
        }
        return Some(r);
    }
    store
        .and_then(|s| s.get_item(KEY).ok().flatten())
        .and_then(|j| serde_json::from_str(&j).ok())
}

/// Pops a session out (desktop shell: a window; browser: a tab).
pub fn open(session: &str, host: Option<&str>) {
    crate::native::open_session_window(session, host);
}

fn waiting_hint(gone: bool, conn: Conn) -> &'static str {
    if gone {
        "It was archived or lives on another host. Close this window."
    } else if conn == Conn::Offline {
        "Waiting for the host to come back."
    } else {
        "Connecting to the host…"
    }
}

/// The popped-out window's body: the session's chat, or a wait / not-found note.
#[component]
pub fn SessionWindow(route: Route) -> impl IntoView {
    let app = crate::state::get();
    let id = StoredValue::new(route.session.clone());
    app.ui.select(Some(route.session.clone()));
    let session = Memo::new(move |_| {
        let host = app.active_host()?;
        app.agents
            .get(&host, &id.get_value())
            .map(|s| s.agent.title_or_untitled())
    });
    Effect::new(move |_| {
        let title = session.get().unwrap_or_else(|| "Untitled session".into());
        if let Some(d) = web_sys::window().and_then(|w| w.document()) {
            d.set_title(&title);
        }
    });
    let conn = Memo::new(move |_| app.conn.active_link().conn);
    let loaded = Memo::new(move |_| !app.sessions().is_empty());
    let found = Memo::new(move |_| session.with(Option::is_some));
    view! {
        <div class="root popout">
            {move || {
                if found.get() {
                    view! { <div class="fill main"><crate::views::chat::Chat agent_id=id.get_value() /></div> }.into_any()
                } else {
                    let gone = conn.get() == Conn::Online && loaded.get();
                    view! {
                        <div class="popout-empty m-enter">
                            <Icon ico=Ico::AppWindow size=22.0 class="faint" />
                            <span class="t-label">{if gone { "Session not found" } else { "Opening session" }}</span>
                            <span class="popout-hint">{waiting_hint(gone, conn.get())}</span>
                        </div>
                    }
                    .into_any()
                }
            }}
        </div>
    }
}
