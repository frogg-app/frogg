//! Settings page bodies, one module per scope.

pub mod agents;
pub mod app;
pub mod context;
pub mod host;
pub mod labels;
pub mod security;
pub mod tools;
pub mod voice;
pub mod you;

use leptos::prelude::*;

use super::kit::Note;
use super::Page;
use crate::state::Conn;

pub fn body(page: &Page) -> AnyView {
    match page.id {
        "appearance" => view! { <you::Appearance /> }.into_any(),
        "chat" => view! { <you::ChatComposer /> }.into_any(),
        "files" => view! { <you::FilesEditor /> }.into_any(),
        "keys" => view! { <you::Shortcuts /> }.into_any(),
        "notify" => view! { <you::Notifications /> }.into_any(),
        "design" => view! { <you::DesignOptions /> }.into_any(),
        "providers" => view! { <agents::Providers /> }.into_any(),
        "accounts" => view! { <agents::Accounts /> }.into_any(),
        "modes" => view! { <agents::PermissionModes /> }.into_any(),
        "usage" => view! { <agents::UsageLimits /> }.into_any(),
        "overview" => host_page(|| view! { <host::HostOverview /> }.into_any()),
        "devices" => host_page(|| view! { <host::DevicesAccess /> }.into_any()),
        "automation" => host_page(|| view! { <host::Automation /> }.into_any()),
        "daemon" => host_page(|| view! { <host::DaemonUpdates /> }.into_any()),
        "voice" => view! { <voice::VoiceCompanion /> }.into_any(),
        "context" => view! { <context::ContextCleanCut /> }.into_any(),
        "tools" => host_page(|| view! { <tools::ToolsPrompts /> }.into_any()),
        "security" => host_page(|| view! { <security::Security /> }.into_any()),
        "labels" => host_page(|| view! { <labels::SessionLabels /> }.into_any()),
        "onboarding" => view! { <app::GettingStarted /> }.into_any(),
        "privacy" => view! { <app::Privacy /> }.into_any(),
        "about" => view! { <app::About /> }.into_any(),
        "updates" => view! { <app::AppUpdates /> }.into_any(),
        _ => view! { <span class="t-label">"not built yet"</span> }.into_any(),
    }
}

/// A host settings page belongs to one connection: offline shows a note, and a host switch
/// remounts the body so no draft carries over (ui-next `HostPage`).
fn host_page(body: fn() -> AnyView) -> AnyView {
    let app = crate::state::get();
    let online = Memo::new(move |_| app.conn.active_link().conn == Conn::Online);
    let host = Memo::new(move |_| app.hosts.active_id.get());
    (move || {
        let _host = host.get();
        if online.get() {
            body()
        } else {
            view! { <Note>"Host offline. Connect to load and change its settings."</Note> }
                .into_any()
        }
    })
    .into_any()
}
