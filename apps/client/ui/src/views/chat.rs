//! Chat (wave 2, chat stream): timeline, composer, tool calls, permissions, subwork.

use leptos::prelude::*;

use super::DetailStub;
use crate::components::Ico;

/// The open session's chat. `agent_id` is on the active host.
#[component]
pub fn Chat(
    agent_id: String,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let app = crate::state::get();
    let id = agent_id.clone();
    let title = move || {
        app.active_host()
            .and_then(|h| app.agents.get(&h, &id))
            .map(|s| s.agent.title_or_untitled())
            .unwrap_or_else(|| "Session".into())
    };
    view! {
        {move || {
            let note = format!("The timeline and composer for {agent_id} land with the chat stream.");
            match on_back {
                Some(b) => view! { <DetailStub ico=Ico::MessageSquare title=title() note=note on_back=Some(b) /> }.into_any(),
                None => view! { <DetailStub ico=Ico::MessageSquare title=title() note=note /> }.into_any(),
            }
        }}
    }
}
