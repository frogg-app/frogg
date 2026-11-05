//! Screens and panels, one module per area (docs/plans/rust-client-work.md). The shell routes to
//! the components here (`shell::layout`); wave 2 replaces each stub's body and keeps its name
//! and props, so routing needs no change.

pub mod chat;
pub mod flows;
pub mod panels;
pub mod sessions;
pub mod settings;

use leptos::prelude::*;

use crate::components::{Ico, Icon};
use crate::shell::panel_head::PanelHead;

/// A stub side panel: the tool's heading and a line saying what comes here.
#[component]
pub fn PanelStub(#[prop(into)] title: String, #[prop(into)] note: String) -> impl IntoView {
    view! {
        <div class="panel">
            <PanelHead title=title />
            <div class="stub-note">
                <span class="t-label">"coming"</span>
                <span class="stub-text">{note}</span>
            </div>
        </div>
    }
}

/// A stub main pane: centred icon and text, with a back button on phones.
#[component]
pub fn DetailStub(
    ico: Ico,
    #[prop(into)] title: String,
    #[prop(into)] note: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    view! {
        <div class="detail">
            {on_back.map(|b| view! {
                <div class="detail-bar">
                    <button class="icon-btn" aria-label="Back" on:click=move |_| b.run(())>
                        <Icon ico=Ico::ChevronLeft size=18.0 />
                    </button>
                </div>
            })}
            <div class="detail-empty m-enter">
                <Icon ico=ico size=26.0 stroke=1.4 class="faint" />
                <span class="t-display detail-title">{title}</span>
                <span class="detail-note">{note}</span>
            </div>
        </div>
    }
}
