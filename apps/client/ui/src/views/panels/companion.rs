//! Companion (wave 2, panels stream). Stub routed from the shell.

use leptos::prelude::*;

use crate::views::PanelStub;

#[component]
pub fn CompanionPanel() -> impl IntoView {
    view! { <PanelStub title="Companion" note="The voice companion." /> }
}
