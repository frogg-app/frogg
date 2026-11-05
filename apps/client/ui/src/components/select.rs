//! A dropdown select (ui-next `Select.tsx`): a field showing the current option and a
//! popover list; options can carry a hint line.

use leptos::prelude::*;

use super::{Floating, Ico, Icon};

#[derive(Debug, Clone, PartialEq)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
    pub hint: Option<String>,
}

impl SelectOption {
    pub fn new(value: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            label: label.into(),
            hint: None,
        }
    }
}

#[component]
pub fn Select(
    options: Vec<SelectOption>,
    #[prop(into)] value: Signal<String>,
    on_change: Callback<String>,
    #[prop(optional, into)] placeholder: String,
    #[prop(optional)] mono: bool,
    /// Compact chip look instead of a full-width field.
    #[prop(optional)]
    chip: bool,
) -> impl IntoView {
    let open = RwSignal::new(false);
    let options = StoredValue::new(options);
    let current = move || {
        let v = value.get();
        options.with_value(|o| o.iter().find(|x| x.value == v).map(|x| x.label.clone()))
    };
    view! {
        <div class="select-wrap">
            <button
                class=format!(
                    "select {}{}",
                    if chip { "chip" } else { "field-box" },
                    if mono { " t-mono" } else { "" },
                )
                aria-haspopup="listbox"
                on:click=move |_| open.update(|o| *o = !*o)
            >
                <span class="select-text" class:placeholder=move || current().is_none()>
                    {move || current().unwrap_or_else(|| placeholder.clone())}
                </span>
                <Icon ico=Ico::ChevronDown size=14.0 />
            </button>
            <Floating open=open on_close=Callback::new(move |_| open.set(false)) class="select-menu">
                <div role="listbox">
                    {move || {
                        options
                            .get_value()
                            .into_iter()
                            .map(|o| {
                                let v = o.value.clone();
                                let on = o.value == value.get_untracked();
                                view! {
                                    <button
                                        class="opt"
                                        class:on=on
                                        role="option"
                                        on:click=move |_| {
                                            open.set(false);
                                            on_change.run(v.clone());
                                        }
                                    >
                                        <span class="opt-body">
                                            <span class=if mono { "opt-label t-mono" } else { "opt-label" }>
                                                {o.label.clone()}
                                            </span>
                                            {o.hint.clone().map(|h| view! { <span class="opt-hint">{h}</span> })}
                                        </span>
                                        {on.then(|| view! { <Icon ico=Ico::Check size=14.0 class="opt-check" /> })}
                                    </button>
                                }
                            })
                            .collect_view()
                    }}
                </div>
            </Floating>
        </div>
    }
}
