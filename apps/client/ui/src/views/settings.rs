//! Settings (wave 2, flows stream). The Appearance page's theme picker is live already so themes
//! are switchable; the rest are stubs.

use leptos::prelude::*;

use super::DetailStub;
use crate::components::{Ico, Seg};
use crate::shell::panel_head::PanelHead;
use crate::theme::{ThemeChoice, THEMES};

const PAGES: [(&str, &str); 6] = [
    ("appearance", "Appearance"),
    ("hosts", "Hosts"),
    ("providers", "Providers"),
    ("notifications", "Notifications"),
    ("shortcuts", "Shortcuts"),
    ("about", "About"),
];

#[component]
pub fn SettingsNav() -> impl IntoView {
    let app = crate::state::get();
    view! {
        <div class="panel">
            <PanelHead title="Settings".to_string() />
            <div class="panel-scroll">
                {PAGES
                    .iter()
                    .map(|(id, label)| {
                        let id = *id;
                        let on = move || app.ui.settings_page.get().as_deref().unwrap_or("appearance") == id;
                        view! {
                            <button class="srow" class:on=on on:click=move |_| app.ui.open_settings(Some(id.to_owned()))>
                                <span class="srow-title">{*label}</span>
                            </button>
                        }
                    })
                    .collect_view()}
            </div>
        </div>
    }
}

#[component]
pub fn SettingsPage(
    id: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    if id != "appearance" {
        let title = PAGES
            .iter()
            .find(|p| p.0 == id)
            .map(|p| p.1)
            .unwrap_or("Settings");
        let note = "This page lands with the settings flow.";
        return match on_back {
            Some(b) => {
                view! { <DetailStub ico=Ico::Settings title=title note=note on_back=Some(b) /> }
                    .into_any()
            }
            None => view! { <DetailStub ico=Ico::Settings title=title note=note /> }.into_any(),
        };
    }
    let app = crate::state::get();
    let theme = app.theme;
    let current = Signal::derive(move || {
        let id = theme.choice.with(|c| c.id.clone());
        if id.is_empty() {
            "material".to_owned()
        } else {
            id
        }
    });
    view! {
        <div class="detail settings-page">
            <PanelHead title="Appearance".to_string() />
            <div class="settings-body">
                <span class="t-label">"Theme"</span>
                <Seg
                    options=THEMES.iter().map(|t| (t.id.to_owned(), t.label.to_owned())).collect()
                    value=current
                    on_change=Callback::new(move |id: String| {
                        let overrides = theme.choice.with_untracked(|c| c.overrides.clone());
                        theme.set(ThemeChoice { id, overrides });
                    })
                />
                <span class="settings-hint">
                    {move || crate::theme::themes::find_theme(&current.get()).description}
                </span>
            </div>
        </div>
    }
    .into_any()
}
