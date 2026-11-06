//! Settings (ui-next `components/settings/Settings.tsx`): the page list grouped by scope with a
//! search box, and the page frame (scope eyebrow, title, host badge, config error, body).

pub mod kit;
pub mod pages;

use leptos::prelude::*;

use crate::components::{Brackets, Button, Ico, Icon};
use crate::state::config;
use crate::state::Conn;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    You,
    Agents,
    Host,
    Project,
    App,
}

impl Scope {
    pub fn label(self) -> &'static str {
        match self {
            Scope::You => "You",
            Scope::Agents => "Agents",
            Scope::Host => "Host",
            Scope::Project => "Project",
            Scope::App => "App",
        }
    }

    /// Pages that read or change the connected host's config.
    pub fn is_host(self) -> bool {
        matches!(self, Scope::Host | Scope::Agents)
    }
}

const SCOPES: [Scope; 5] = [
    Scope::You,
    Scope::Agents,
    Scope::Host,
    Scope::Project,
    Scope::App,
];

pub struct Page {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: Ico,
    pub scope: Scope,
    /// Pages without a body yet; they stay out of the list and search until built.
    pub built: bool,
}

const fn page(id: &'static str, label: &'static str, icon: Ico, scope: Scope, built: bool) -> Page {
    Page {
        id,
        label,
        icon,
        scope,
        built,
    }
}

pub const PAGES: &[Page] = &[
    page("appearance", "Appearance", Ico::Eye, Scope::You, true),
    page(
        "chat",
        "Chat & composer",
        Ico::MessageSquare,
        Scope::You,
        true,
    ),
    page(
        "files",
        "Files, editor & terminal",
        Ico::FileCode,
        Scope::You,
        true,
    ),
    page(
        "keys",
        "Keyboard shortcuts",
        Ico::Keyboard,
        Scope::You,
        true,
    ),
    page(
        "notify",
        "Notifications & inbox",
        Ico::Bell,
        Scope::You,
        true,
    ),
    page("voice", "Voice & Companion", Ico::Bot, Scope::You, false),
    page(
        "providers",
        "Providers & models",
        Ico::Zap,
        Scope::Agents,
        true,
    ),
    page("accounts", "Accounts", Ico::KeyRound, Scope::Agents, true),
    page(
        "modes",
        "Permission modes",
        Ico::Shield,
        Scope::Agents,
        true,
    ),
    page("usage", "Usage & limits", Ico::Gauge, Scope::Agents, true),
    page(
        "context",
        "Context & clean cut",
        Ico::Scissors,
        Scope::Agents,
        false,
    ),
    page(
        "tools",
        "Tools, skills & prompts",
        Ico::Wrench,
        Scope::Agents,
        false,
    ),
    page(
        "overview",
        "Overview & connections",
        Ico::Server,
        Scope::Host,
        true,
    ),
    page(
        "devices",
        "Devices & access",
        Ico::Smartphone,
        Scope::Host,
        true,
    ),
    page("security", "Security", Ico::Lock, Scope::Host, false),
    page(
        "automation",
        "Automation",
        Ico::RefreshCw,
        Scope::Host,
        true,
    ),
    page("labels", "Session labels", Ico::Tag, Scope::Host, false),
    page(
        "terminals",
        "Terminal profiles",
        Ico::SquareTerminal,
        Scope::Host,
        true,
    ),
    page(
        "resources",
        "Resources & storage",
        Ico::HardDrive,
        Scope::Host,
        true,
    ),
    page(
        "daemon",
        "Daemon & updates",
        Ico::Activity,
        Scope::Host,
        true,
    ),
    page("worktrees", "Worktrees", Ico::Wrench, Scope::Project, true),
    page(
        "scripts",
        "Scripts & services",
        Ico::SquareTerminal,
        Scope::Project,
        true,
    ),
    page(
        "ci",
        "CI & release streams",
        Ico::RefreshCw,
        Scope::Project,
        true,
    ),
    page(
        "metadata",
        "Generated text",
        Ico::FileCode,
        Scope::Project,
        true,
    ),
    page("plugins", "Plugins", Ico::Wrench, Scope::App, true),
    page(
        "onboarding",
        "Getting started",
        Ico::Sparkles,
        Scope::App,
        true,
    ),
    page(
        "privacy",
        "Privacy & feedback",
        Ico::Shield,
        Scope::App,
        true,
    ),
    page(
        "about",
        "About & diagnostics",
        Ico::Activity,
        Scope::App,
        true,
    ),
    page(
        "developer",
        "Developer",
        Ico::SquareTerminal,
        Scope::App,
        true,
    ),
    page("design", "Design options", Ico::Palette, Scope::App, true),
    page("updates", "App updates", Ico::RefreshCw, Scope::App, true),
];

pub fn find(id: &str) -> &'static Page {
    PAGES
        .iter()
        .find(|p| p.id == id && p.built)
        .unwrap_or(&PAGES[0])
}

/// The host label: the daemon's own name once known, else the saved name.
fn host_label() -> Option<String> {
    let app = crate::state::get();
    let link = app.conn.active_link();
    link.server_name
        .or_else(|| app.hosts.active().map(|h| h.name))
}

#[component]
pub fn SettingsNav() -> impl IntoView {
    let app = crate::state::get();
    let q = RwSignal::new(String::new());
    let groups = move || {
        let needle = q.get().to_lowercase();
        SCOPES
            .iter()
            .filter_map(|scope| {
                let pages: Vec<&'static Page> = PAGES
                    .iter()
                    .filter(|p| {
                        p.built && p.scope == *scope && p.label.to_lowercase().contains(&needle)
                    })
                    .collect();
                (!pages.is_empty()).then_some((*scope, pages))
            })
            .collect::<Vec<_>>()
    };
    view! {
        <div class="panel set-nav">
            <div class="set-nav-head">
                <Icon ico=Ico::Settings size=15.0 class="cyan2" />
                <span class="t-display set-nav-title">"Settings"</span>
            </div>
            <input
                class="set-search"
                placeholder="Search settings"
                spellcheck="false"
                prop:value=move || q.get()
                on:input=move |ev| q.set(event_target_value(&ev))
            />
            <div class="panel-scroll">
                {move || {
                    groups()
                        .into_iter()
                        .map(|(scope, pages)| {
                            view! {
                                <div class="set-scope">
                                    <span class="t-label">{scope.label()}</span>
                                    {scope.is_host().then(|| view! {
                                        <span class="t-mono set-scope-host">{move || host_label().unwrap_or_default()}</span>
                                    })}
                                </div>
                                {pages
                                    .into_iter()
                                    .map(|p| {
                                        let id = p.id;
                                        let on = Signal::derive(move || {
                                            app.ui.settings_page.get().as_deref().unwrap_or(
                                                if app.viewport.phone() { "" } else { "appearance" },
                                            ) == id
                                        });
                                        view! {
                                            <button
                                                class="set-nav-item"
                                                class:on=move || on.get()
                                                on:click=move |_| app.ui.open_settings(Some(id.to_owned()))
                                            >
                                                <Brackets on=on />
                                                <Icon ico=p.icon size=14.0 />
                                                <span class="set-nav-t">{p.label}</span>
                                            </button>
                                        }
                                    })
                                    .collect_view()}
                            }
                        })
                        .collect_view()
                }}
            </div>
        </div>
    }
}

#[component]
pub fn SettingsPage(
    id: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let app = crate::state::get();
    let page = find(&id);
    let cfg = config::get();
    // Every host stays connected, so a switch keeps "online": reload on the host too.
    let online = Memo::new(move |_| app.conn.active_link().conn == Conn::Online);
    let host = Memo::new(move |_| app.hosts.active_id.get());
    Effect::new(move |_| {
        let _ = host.get();
        if online.get() {
            cfg.load();
        }
    });
    let offline = move || !online.get();
    let eyebrow = if page.scope == Scope::You {
        "you · this device".to_owned()
    } else {
        page.scope.label().to_owned()
    };
    let phone = on_back.is_some();
    view! {
        <div class="detail set-page">
            <div class="set-head">
                <div class="set-head-main">
                    <span class="t-label">{eyebrow}</span>
                    <div class="set-title-row">
                        {on_back.map(|b| view! {
                            <button class="icon-btn" aria-label="Back" on:click=move |_| b.run(())>
                                <Icon ico=Ico::ArrowLeft size=18.0 />
                            </button>
                        })}
                        <span class="t-display set-title">{page.label}</span>
                    </div>
                </div>
                {move || cfg.saving.get().then(|| view! { <span class="t-mono set-saving">"saving…"</span> })}
                {(page.scope.is_host() && !phone).then(|| view! {
                    <span class="set-badge t-mono">
                        {move || host_label().map(|h| format!("{h} · config.json")).unwrap_or_else(|| "no host connected".to_owned())}
                    </span>
                })}
            </div>
            <div class="set-scroll">
                <div class="set-body m-enter">
                    {move || cfg.error.get().map(|e| view! {
                        <div class="set-errbox" role="alert">
                            <Icon ico=Ico::AlertTriangle size=15.0 class="coral" />
                            <div class="grow">
                                <span class="set-errbox-t">
                                    {if offline() { "Host is offline — showing the last loaded settings" } else { "Settings didn't load or save" }}
                                </span>
                                <span class="set-errbox-m t-mono">{e}</span>
                            </div>
                            {(!offline()).then(|| view! { <Button label="Retry" on_press=Callback::new(move |_| cfg.load()) /> })}
                        </div>
                    })}
                    {pages::body(page)}
                </div>
            </div>
        </div>
    }
}
