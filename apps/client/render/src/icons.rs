//! The few lucide icons the renderers need, inline (the UI crate has its own set).

use leptos::prelude::*;

#[component]
pub fn CopyIcon() -> impl IntoView {
    view! {
        <svg class="fr-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
    }
}

#[component]
pub fn CheckIcon() -> impl IntoView {
    view! {
        <svg class="fr-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6 9 17l-5-5" />
        </svg>
    }
}
