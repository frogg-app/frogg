//! PRs & CI (wave 2, panels stream). Stub routed from the shell.

use leptos::prelude::*;

use crate::components::Ico;
use crate::views::DetailStub;
use crate::views::PanelStub;

#[component]
pub fn PrsPanel() -> impl IntoView {
    view! { <PanelStub title="PRs & CI" note="Pull requests and CI runs for the active checkout." /> }
}

#[component]
pub fn CiRunDetail(
    id: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let note = format!("CI run {id} opens here.");
    match on_back {
        Some(b) => view! { <DetailStub ico=Ico::GitPullRequest title="CI run" note=note on_back=Some(b) /> }.into_any(),
        None => view! { <DetailStub ico=Ico::GitPullRequest title="CI run" note=note /> }.into_any(),
    }
}
