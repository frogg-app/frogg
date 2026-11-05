//! Segmented control: a row of options with one gliding selection pill.

use leptos::html;
use leptos::prelude::*;

use super::glide::{glide_style, use_glide};

#[component]
pub fn Seg(
    /// (value, label) pairs.
    options: Vec<(String, String)>,
    #[prop(into)] value: Signal<String>,
    on_change: Callback<String>,
    #[prop(optional, into)] class: String,
) -> impl IntoView {
    let root = NodeRef::<html::Div>::new();
    let (rect, animate) = use_glide(root, value, Signal::derive(|| 0));
    view! {
        <div class=format!("seg {class}") node_ref=root role="tablist">
            <div class="seg-pill" style=move || glide_style(rect.get(), animate.get())></div>
            {options
                .into_iter()
                .map(|(v, label)| {
                    let v2 = v.clone();
                    let v3 = v.clone();
                    view! {
                        <button
                            class="seg-opt"
                            class:on=move || value.get() == v2
                            data-glide=v.clone()
                            role="tab"
                            on:click=move |_| on_change.run(v3.clone())
                        >
                            {label}
                        </button>
                    }
                })
                .collect_view()}
        </div>
    }
}
