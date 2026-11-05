//! Form inputs: a labelled field wrapper and a themed text input.

use leptos::prelude::*;

/// A label (mono caps), the control, and an optional hint or error underneath.
#[component]
pub fn Field(
    #[prop(into)] label: String,
    #[prop(optional, into)] hint: Signal<Option<String>>,
    #[prop(optional, into)] error: Signal<Option<String>>,
    children: Children,
) -> impl IntoView {
    view! {
        <label class="field">
            <span class="t-label">{label}</span>
            {children()}
            {move || {
                error
                    .get()
                    .map(|e| view! { <span class="field-err">{e}</span> }.into_any())
                    .or_else(|| hint.get().map(|h| view! { <span class="field-hint">{h}</span> }.into_any()))
            }}
        </label>
    }
}

#[component]
pub fn TextInput(
    value: RwSignal<String>,
    #[prop(optional, into)] placeholder: String,
    #[prop(optional)] password: bool,
    #[prop(optional)] mono: bool,
    #[prop(optional)] autofocus: bool,
    #[prop(optional, into)] on_enter: Option<Callback<()>>,
) -> impl IntoView {
    view! {
        <input
            class=if mono { "input t-mono" } else { "input" }
            type=if password { "password" } else { "text" }
            placeholder=placeholder
            autofocus=autofocus
            spellcheck="false"
            autocomplete="off"
            prop:value=move || value.get()
            on:input=move |ev| value.set(event_target_value(&ev))
            on:keydown=move |ev| {
                if ev.key() == "Enter" {
                    if let Some(cb) = on_enter {
                        ev.prevent_default();
                        cb.run(());
                    }
                }
            }
        />
    }
}
