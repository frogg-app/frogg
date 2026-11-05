//! Root component: builds the stores, applies the theme, dials the active host, and mounts the
//! shell with the overlays every layout shares.

use leptos::prelude::*;

use crate::shell::host_sheet::HostSheet;
use crate::shell::palette::Palette;
use crate::shell::toast::{Toast, ToastHost, ToastKind};
use crate::shell::{keys, Shell};
use crate::state::{self, Conn};
use crate::views::flows;

#[component]
pub fn App() -> impl IntoView {
    let app = state::init();
    keys::install();
    app.conn.start();
    host_toasts(app);
    view! {
        <Shell />
        <Palette />
        <flows::new_session::NewSession />
        <HostSheet />
        <flows::signin::SignInDialog />
        <flows::onboarding::Onboarding />
        <ToastHost />
    }
}

/// The active host dropping or coming back raises a toast (ui-next `HostToasts.tsx`, reduced).
fn host_toasts(app: state::AppState) {
    let seen_online = StoredValue::new(false);
    Effect::new(move |prev: Option<(Option<String>, Conn)>| {
        let host = app.hosts.active_id.get();
        let conn = app.conn.active_link().conn;
        if let Some((prev_host, prev_conn)) = prev {
            if prev_host == host {
                let name = app.hosts.active().map(|h| h.name).unwrap_or_default();
                if prev_conn == Conn::Online && conn == Conn::Offline {
                    app.toasts.push(
                        Toast::new(ToastKind::Error, format!("Lost {name}"))
                            .detail("Reconnecting…")
                            .action("Hosts", move || app.ui.host_sheet_open.set(true)),
                    );
                } else if conn == Conn::Online
                    && prev_conn != Conn::Online
                    && seen_online.get_value()
                {
                    app.toasts
                        .push(Toast::new(ToastKind::Ok, format!("Back on {name}")));
                }
            }
        }
        if conn == Conn::Online {
            seen_online.set_value(true);
        }
        (host, conn)
    });
}
