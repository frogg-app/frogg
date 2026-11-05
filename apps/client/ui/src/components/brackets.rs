//! Selection brackets (ui-next `Brackets.tsx`): two corner marks that lock onto a selected row
//! with a small overshoot, and contract and fade when cleared. Place inside a positioned row.
//! The cross-row travel of ui-next's `BracketScope` is not ported yet: each row locks on in place.

use leptos::prelude::*;

#[component]
pub fn Brackets(
    #[prop(into)] on: Signal<bool>,
    /// Corner arm length in px.
    #[prop(default = 7.0)]
    len: f64,
    /// All four corners instead of top-left + bottom-right.
    #[prop(optional)]
    four: bool,
) -> impl IntoView {
    view! {
        <span
            class=move || format!("brackets{}{}", if on.get() { " on" } else { "" }, if four { " four" } else { "" })
            style=format!("--len:{len}px")
            aria-hidden="true"
        >
            <i class="bk tl"></i>
            <i class="bk br"></i>
            {four.then(|| view! { <i class="bk tr"></i><i class="bk bl"></i> })}
        </span>
    }
}
