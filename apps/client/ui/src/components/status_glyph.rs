//! Session status glyphs (ui-next `StatusGlyph.tsx`): diamond = needs you, square = failed,
//! dot = review, triangle = working (breathing), hollow diamond = idle.

use leptos::prelude::*;

use crate::state::Bucket;

#[component]
pub fn StatusGlyph(
    #[prop(into)] bucket: Signal<Bucket>,
    #[prop(default = 9.0)] size: f64,
    #[prop(optional)] still: bool,
) -> impl IntoView {
    view! {
        <span
            class=move || {
                format!("glyph glyph-{}{}", bucket.get().id(), if still { " still" } else { "" })
            }
            style=format!("--g:{size}px")
        ></span>
    }
}
