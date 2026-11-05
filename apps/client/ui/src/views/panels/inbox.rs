//! Inbox (wave 2, panels stream). Stub routed from the shell.

use leptos::prelude::*;

use crate::components::Ico;
use crate::views::DetailStub;
use crate::views::PanelStub;

#[component]
pub fn InboxPanel() -> impl IntoView {
    view! { <PanelStub title="Inbox" note="Sessions that need you, failed or finished." /> }
}

#[component]
pub fn InboxDetail(
    id: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let note = format!("Notification {id} opens here.");
    match on_back {
        Some(b) => {
            view! { <DetailStub ico=Ico::Bell title="Notification" note=note on_back=Some(b) /> }
                .into_any()
        }
        None => view! { <DetailStub ico=Ico::Bell title="Notification" note=note /> }.into_any(),
    }
}
