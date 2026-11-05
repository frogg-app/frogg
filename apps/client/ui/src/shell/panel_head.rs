//! Panel headings (ui-next `PanelHead.tsx`): a display title revealed letter by letter
//! (the `stagger` heading reveal), optional trailing controls, and group headings with a count.

use leptos::prelude::*;

/// A heading whose letters fade up on a short stagger, replayed when the text changes.
#[component]
pub fn RevealHeading(
    #[prop(into)] text: Signal<String>,
    #[prop(optional, into)] class: String,
) -> impl IntoView {
    view! {
        <span class=format!("t-display reveal {class}") aria-label=move || text.get()>
            {move || {
                text.get()
                    .chars()
                    .enumerate()
                    .map(|(i, c)| {
                        let c = if c == ' ' { '\u{a0}' } else { c };
                        view! {
                            <span class="reveal-ch" aria-hidden="true" style=format!("animation-delay:{}ms", i * 18)>
                                {c.to_string()}
                            </span>
                        }
                    })
                    .collect_view()
            }}
        </span>
    }
}

#[component]
pub fn PanelHead(
    #[prop(into)] title: Signal<String>,
    #[prop(optional)] children: Option<Children>,
) -> impl IntoView {
    view! {
        <div class="panel-head">
            <RevealHeading text=title class="panel-title" />
            {children.map(|c| c())}
        </div>
    }
}

#[component]
pub fn GroupHead(
    #[prop(into)] label: String,
    #[prop(optional, into)] count: Option<Signal<usize>>,
) -> impl IntoView {
    view! {
        <div class="group-head">
            <span class="t-label">{label}</span>
            {count.map(|c| view! { <span class="t-mono group-count">{move || c.get()}</span> })}
        </div>
    }
}
