//! Loading placeholder rows (ui-next `Skeleton.tsx`): an icon chip and a name bar per row, a
//! soft highlight sweeping across, rows fading in on a short stagger.

use leptos::prelude::*;

const WIDTHS: [u32; 6] = [62, 44, 78, 52, 68, 38];

#[component]
pub fn SkeletonRows(
    #[prop(default = 4)] rows: usize,
    #[prop(default = 0.0)] indent: f64,
    #[prop(default = true)] icon: bool,
) -> impl IntoView {
    view! {
        <div class="skel" style=format!("padding-left:{indent}px") role="progressbar" aria-label="Loading">
            {(0..rows)
                .map(|i| {
                    view! {
                        <div class="skel-row" style=format!("animation-delay:{}ms", i * 45)>
                            {icon.then(|| view! { <span class="skel-chip sweep"></span> })}
                            <span
                                class="skel-bar sweep"
                                style=format!("width:{}%", WIDTHS[i % WIDTHS.len()])
                            ></span>
                        </div>
                    }
                })
                .collect_view()}
        </div>
    }
}
