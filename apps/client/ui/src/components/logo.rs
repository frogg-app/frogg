//! The frogg gem (ui-next `Logo.tsx`): a hexagon in the accent gradient with a lit top face
//! and a shaded lower-left face. Motions (the `logoMotion` pref) play on hover and press:
//! - ripple: a light wave runs face to face; press sends one quick pulse.
//! - split: dark seams open between the faces.
//! - sweep: a light band crosses the gem.
//! - turn: the light moves round the gem, so the shading swaps faces as if it rotated.
//!
//! The motion is pure CSS (`styles/components.css`), so no style attribute is involved.

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
const HEX: &str = "12,1 22,7 22,17 12,23 2,17 2,7";
/// The edges shared by neighbouring faces: where `split` opens its seams.
const SEAMS: [(u8, u8); 4] = [(12, 1), (22, 7), (12, 23), (2, 17)];

/// The CSS class for a `logoMotion` value; unknown values fall back to ripple, as in ui-next.
pub fn motion_class(motion: &str) -> &'static str {
    match motion {
        "none" => "logo",
        "split" => "logo logo-split",
        "sweep" => "logo logo-sweep",
        "turn" => "logo logo-turn",
        _ => "logo logo-ripple",
    }
}

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
    // Colours are presentation attributes resolved by the stylesheet (`.logo-stop-*`), never
    // `style=""`: the desktop shell's CSP must not be able to blank the gem.
    let faces: String = FACES
        .iter()
        .enumerate()
        .map(|(i, pts)| format!(r#"<polygon class="logo-face lf{i}" points="{pts}"/>"#))
        .collect();
    let seams: String = SEAMS
        .iter()
        .map(|(x, y)| format!(r#"<line class="logo-seam" x1="12" y1="12" x2="{x}" y2="{y}"/>"#))
        .collect();
    let body = format!(
        r##"<defs><linearGradient id="logo-g{id}" x1="0" y1="0" x2="1" y2="1"><stop class="logo-stop-a" offset="0"/><stop class="logo-stop-b" offset="1"/></linearGradient><clipPath id="logo-c{id}"><polygon points="{HEX}"/></clipPath></defs><polygon points="{HEX}" fill="url(#logo-g{id})"/><g class="logo-shade"><polygon points="12,1 22,7 12,12" fill="#ffffff" opacity="0.28"/><polygon points="2,17 12,12 12,23" fill="#000000" opacity="0.25"/></g>{faces}<g clip-path="url(#logo-c{id})"><rect class="logo-band" x="-10" y="-2" width="8" height="28"/></g>{seams}"##
    );
    let class = move || motion_class(&motion.get());
    view! {
        <svg class=class width=size height=size viewBox="0 0 24 24" aria-label="frogg" inner_html=body></svg>
    }
}

#[cfg(test)]
mod tests {
    use super::motion_class;

    #[test]
    fn every_setting_has_its_own_motion() {
        assert_eq!(motion_class("none"), "logo");
        assert_eq!(motion_class("ripple"), "logo logo-ripple");
        assert_eq!(motion_class("split"), "logo logo-split");
        assert_eq!(motion_class("sweep"), "logo logo-sweep");
        assert_eq!(motion_class("turn"), "logo logo-turn");
        assert_eq!(motion_class("unknown"), "logo logo-ripple");
    }
}
