//! Terminals (wave 2, panels stream). Stub routed from the shell.

use leptos::prelude::*;

use crate::components::Ico;
use crate::views::DetailStub;
use crate::views::PanelStub;

#[component]
pub fn TerminalsPanel() -> impl IntoView {
    view! { <PanelStub title="Terminals" note="Terminals on this host, live." /> }
}

#[component]
pub fn TerminalDetail(
    id: String,
    #[prop(optional)] docked: bool,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let _ = docked;
    let note = format!("Terminal {id} opens here.");
    match on_back {
        Some(b) => view! { <DetailStub ico=Ico::SquareTerminal title="Terminal" note=note on_back=Some(b) /> }.into_any(),
        None => view! { <DetailStub ico=Ico::SquareTerminal title="Terminal" note=note /> }.into_any(),
    }
}
