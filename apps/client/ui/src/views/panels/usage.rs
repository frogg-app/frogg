//! Usage (wave 2, panels stream). Stub routed from the shell.

use leptos::prelude::*;

use crate::views::PanelStub;

#[component]
pub fn UsagePanel() -> impl IntoView {
    view! { <PanelStub title="Usage" note="Provider usage meters and limits." /> }
}
