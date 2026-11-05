//! Buttons (ui-next `Button.tsx`): primary (in the `buttonStyle` look), ghost and danger, on the
//! chamfer silhouette, with an optional icon and keyboard hint.

use leptos::prelude::*;

use super::{Ico, Icon};
use crate::state::kbd::kbd as format_kbd;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ButtonKind {
    Primary,
    #[default]
    Ghost,
    Danger,
}

#[component]
pub fn Button(
    #[prop(into)] label: Signal<String>,
    #[prop(optional)] kind: ButtonKind,
    #[prop(optional)] icon: Option<Ico>,
    #[prop(optional, into)] disabled: Signal<bool>,
    #[prop(optional, into)] kbd: Option<String>,
    #[prop(optional)] grow: bool,
    /// Primary look; defaults to the `buttonStyle` pref.
    #[prop(optional, into)]
    look: Option<String>,
    #[prop(optional, into)] on_press: Option<Callback<()>>,
) -> impl IntoView {
    let prefs = crate::state::get().prefs;
    let class = move || {
        let k = match kind {
            ButtonKind::Primary => format!(
                "btn-{}",
                look.clone().unwrap_or_else(|| prefs.text("buttonStyle"))
            ),
            ButtonKind::Ghost => "btn-ghost".into(),
            ButtonKind::Danger => "btn-danger".into(),
        };
        format!(
            "btn cut {k}{}{}",
            if grow { " grow" } else { "" },
            if disabled.get() { " disabled" } else { "" }
        )
    };
    view! {
        <button
            class=class
            style="--c:8px"
            disabled=move || disabled.get()
            on:click=move |_| {
                if let Some(cb) = on_press {
                    cb.run(());
                }
            }
        >
            <span class="btn-stripe"></span>
            {icon.map(|i| view! { <Icon ico=i size=12.0 /> })}
            <span class="btn-l">{move || label.get()}</span>
            {kbd.map(|k| view! { <span class="btn-k t-mono">{format_kbd(&k)}</span> })}
        </button>
    }
}
