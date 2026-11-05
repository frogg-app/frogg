//! Search (wave 2, panels stream). Stub routed from the shell.

use leptos::prelude::*;

use crate::views::PanelStub;

#[component]
pub fn SearchPanel() -> impl IntoView {
    view! { <PanelStub title="Search" note="Search across sessions and files." /> }
}
