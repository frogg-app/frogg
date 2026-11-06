//! Root component: builds the stores, applies the theme, dials the active host, and mounts the
//! shell with the overlays every layout shares.

use leptos::prelude::*;

use crate::native;
use crate::shell::host_sheet::HostSheet;
use crate::shell::palette::Palette;
use crate::shell::title_bar::TitleBar;
use crate::shell::toast::{Toast, ToastHost, ToastKind};
use crate::shell::{keys, Shell};
use crate::state::{self, Conn};
use crate::views::flows;

#[component]
pub fn App() -> impl IntoView {
    let app = state::init();
    keys::install();
    crate::shell::back::install();
    app.conn.start();
    host_toasts(app);
    pair_links(app);
    native::alerts::install();
    view! {
        <TitleBar />
        <Shell />
        <Palette />
        <flows::new_session::NewSession />
        <HostSheet />
        <flows::signin::SignInDialog />
        <flows::onboarding::Onboarding />
        <ToastHost />
    }
}

/// Pairing links from the launch URL (`?pair=`) and from the OS while running open the host
/// sheet's pairing form for confirmation (ui-next `offerPairLink`).
fn pair_links(app: state::AppState) {
    // A pairing link offers the host; a share link (Android share sheet) starts a session.
    let route = move |url: String| {
        if let Some(text) = native::share_text(&url) {
            app.ui.set_new_session(true, Some(text));
        } else if frogg_client_core::pairing::is_pair_url(&url) {
            app.ui.pair_link.set(Some(url));
            app.ui.host_sheet_open.set(true);
        }
    };
    // The launch link rides in the `?pair=` query, whatever kind it is.
    if let Some(url) = native::launch().pair {
        if native::share_text(&url).is_some() {
            route(url);
        } else {
            app.ui.pair_link.set(Some(url));
            app.ui.host_sheet_open.set(true);
        }
    }
    native::on_open_url(route);
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
