//! Root component: builds the stores, applies the theme, dials the active host, and mounts the
//! shell with the overlays every layout shares.

use leptos::prelude::*;

use crate::native;
use crate::shell::host_sheet::HostSheet;
use crate::shell::palette::Palette;
use crate::shell::title_bar::TitleBar;
use crate::shell::toast::ToastHost;
use crate::shell::{keys, Shell};
use crate::state;
use crate::views::flows;

#[component]
pub fn App() -> impl IntoView {
    let app = state::init();
    keys::install();
    crate::shell::back::install();
    app.conn.start();
    crate::shell::toast::host_toasts(app);
    pair_links(app);
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
