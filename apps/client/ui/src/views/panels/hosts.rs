//! Hosts (wave 2, panels stream / flows). Stub routed from the shell.

use leptos::prelude::*;

use crate::components::Ico;
use crate::views::DetailStub;
use crate::views::PanelStub;

#[component]
pub fn HostsPanel() -> impl IntoView {
    view! { <PanelStub title="Hosts" note="Saved hosts, routes and pairing." /> }
}

#[component]
pub fn HostDetail() -> impl IntoView {
    let note = "Host details land with the flows stream.".to_string();
    view! { <DetailStub ico=Ico::Server title="Host" note=note /> }
}
