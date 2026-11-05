//! Plugins (wave 2, panels stream). Stub routed from the shell.

use leptos::prelude::*;

use crate::views::PanelStub;

#[component]
pub fn PluginsPanel() -> impl IntoView {
    view! { <PanelStub title="Plugins" note="Plugins installed on this host." /> }
}
