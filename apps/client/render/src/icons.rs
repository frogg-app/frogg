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

#[component]
pub fn ImageOffIcon() -> impl IntoView {
    view! {
        <svg class="fr-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="2" x2="22" y1="2" y2="22" />
            <path d="M10.41 10.41a2 2 0 1 1-2.83-2.83" />
            <line x1="13.5" x2="6" y1="13.5" y2="21" />
            <line x1="18" x2="21" y1="12" y2="15" />
            <path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59" />
            <path d="M21 15V5a2 2 0 0 0-2-2H9" />
        </svg>
    }
}

#[component]
pub fn MaximizeIcon() -> impl IntoView {
    view! {
        <svg class="fr-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" x2="14" y1="3" y2="10" />
            <line x1="3" x2="10" y1="21" y2="14" />
        </svg>
    }
}
