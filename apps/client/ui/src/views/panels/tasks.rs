//! Tasks (wave 2, panels stream). Stub routed from the shell.

use leptos::prelude::*;

use crate::components::Ico;
use crate::views::DetailStub;
use crate::views::PanelStub;

#[component]
pub fn TasksPanel() -> impl IntoView {
    view! { <PanelStub title="Tasks" note="The host's to-dos and their plans." /> }
}

#[component]
pub fn TodoBoard() -> impl IntoView {
    let note = "Tasks details land with the panels stream.".to_string();
    view! { <DetailStub ico=Ico::ListChecks title="Tasks" note=note /> }
}
