//! Text variants (ui-next `Text.tsx`): body, display (Space Grotesk), mono, label (mono caps).

use leptos::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextVariant {
    #[default]
    Body,
    Display,
    Mono,
    Label,
}

impl TextVariant {
    pub fn class(self) -> &'static str {
        match self {
            TextVariant::Body => "t-body",
            TextVariant::Display => "t-display",
            TextVariant::Mono => "t-mono",
            TextVariant::Label => "t-label",
        }
    }
}

#[component]
pub fn Text(
    #[prop(optional)] v: TextVariant,
    #[prop(optional, into)] class: String,
    children: Children,
) -> impl IntoView {
    view! { <span class=format!("{} {class}", v.class())>{children()}</span> }
}
