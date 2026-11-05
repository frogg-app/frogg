//! The bracket shape (ui-next `Cut.tsx`, `Shape.tsx`): two opposite corners chamfered.
//!
//! Only a pseudo-element layer is clipped (`.cut::before` fill, `.cut-stroke::after` ring), so
//! content inside can overflow. Paint it with `--cut-bg` (fill) and `--cut-line` (stroke); any
//! element can take the classes directly: `class="cut" style="--c:12px"`.

use leptos::prelude::*;

#[component]
pub fn Cut(
    /// Chamfer in px.
    #[prop(default = 8.0)]
    size: f64,
    /// Cut top-right/bottom-left instead of top-left/bottom-right.
    #[prop(optional)]
    flip: bool,
    /// Draw a 1px stroke along the outline (diagonals included) in `--cut-line`.
    #[prop(optional)]
    stroke: bool,
    #[prop(optional, into)] class: Signal<String>,
    children: Children,
) -> impl IntoView {
    let base = format!(
        "cut{}{}",
        if flip { " flip" } else { "" },
        if stroke { " cut-stroke" } else { "" }
    );
    view! {
        <div class=move || format!("{base} {}", class.get()) style=format!("--c:{size}px")>
            {children()}
        </div>
    }
}
