//! Source control (wave 2, panels stream). Stub routed from the shell.

use leptos::prelude::*;

use crate::components::Ico;
use crate::views::DetailStub;
use crate::views::PanelStub;

#[component]
pub fn ScmPanel() -> impl IntoView {
    view! { <PanelStub title="Source control" note="Status, commits, stashes and diffs of the active checkout." /> }
}

#[component]
pub fn DiffView(
    path: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let note = format!("Diff {path} opens here.");
    match on_back {
        Some(b) => {
            view! { <DetailStub ico=Ico::FolderGit2 title="Diff" note=note on_back=Some(b) /> }
                .into_any()
        }
        None => view! { <DetailStub ico=Ico::FolderGit2 title="Diff" note=note /> }.into_any(),
    }
}
