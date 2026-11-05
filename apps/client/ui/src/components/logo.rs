//! The frogg gem (ui-next `Logo.tsx`): a hexagon in the accent gradient with a lit top face
//! and a shaded lower-left face. `motion="ripple"` (the default pref) runs a light wave face to
//! face on hover and a quick pulse on press; other motions fall back to ripple or none.

use std::cell::Cell;

use leptos::prelude::*;

thread_local! {
    static NEXT: Cell<u32> = const { Cell::new(0) };
}

const FACES: [&str; 4] = [
    "12,1 22,7 12,12",
    "22,7 22,17 12,23 12,12",
    "12,23 2,17 12,12",
    "2,17 2,7 12,1 12,12",
];

#[component]
pub fn Logo(
    #[prop(default = 26.0)] size: f64,
    #[prop(optional, into)] motion: Signal<String>,
) -> impl IntoView {
    let id = NEXT.with(|n| {
        n.set(n.get() + 1);
        n.get()
    });
    // Markup as a string: the view macro wraps `<stop>` in `<g>`, which breaks the gradient.
    let faces: String = FACES
        .iter()
        .enumerate()
        .map(|(i, pts)| {
            format!(
                r#"<polygon class="logo-face" points="{pts}" style="animation-delay:{}ms"/>"#,
                i * 140
            )
        })
        .collect();
    let body = format!(
        r##"<defs><linearGradient id="logo-g{id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--cyan2)"/><stop offset="1" style="stop-color:var(--deep)"/></linearGradient></defs><polygon points="12,1 22,7 22,17 12,23 2,17 2,7" fill="url(#logo-g{id})"/><polygon points="12,1 22,7 12,12" fill="#ffffff" opacity="0.28"/><polygon points="2,17 12,12 12,23" fill="#000000" opacity="0.25"/>{faces}"##
    );
    let class = move || {
        if motion.get() == "none" {
            "logo"
        } else {
            "logo logo-ripple"
        }
    };
    view! {
        <svg class=class width=size height=size viewBox="0 0 24 24" aria-label="frogg" inner_html=body></svg>
    }
}
