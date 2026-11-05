//! Files (wave 2, panels stream). Stub routed from the shell.

use leptos::prelude::*;

use crate::components::Ico;
use crate::views::DetailStub;
use crate::views::PanelStub;

#[component]
pub fn FilesPanel() -> impl IntoView {
    view! { <PanelStub title="Files" note="Browse, view and diff files on this host." /> }
}

#[component]
pub fn FileViewer(
    path: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let note = format!("File viewer {path} opens here.");
    match on_back {
        Some(b) => {
            view! { <DetailStub ico=Ico::File title="File viewer" note=note on_back=Some(b) /> }
                .into_any()
        }
        None => view! { <DetailStub ico=Ico::File title="File viewer" note=note /> }.into_any(),
    }
}
