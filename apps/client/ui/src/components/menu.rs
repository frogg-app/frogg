//! A popover menu of actions, anchored inside a positioned parent.

use leptos::prelude::*;

use super::{Floating, Ico, Icon};

#[derive(Clone)]
pub struct MenuItem {
    pub label: String,
    pub icon: Option<Ico>,
    pub hint: Option<String>,
    pub danger: bool,
    pub run: Callback<()>,
}

impl MenuItem {
    pub fn new(label: impl Into<String>, run: impl Fn() + Send + Sync + 'static) -> Self {
        Self {
            label: label.into(),
            icon: None,
            hint: None,
            danger: false,
            run: Callback::new(move |_| run()),
        }
    }

    pub fn icon(mut self, icon: Ico) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    pub fn danger(mut self) -> Self {
        self.danger = true;
        self
    }
}

#[component]
pub fn Menu(
    #[prop(into)] open: Signal<bool>,
    on_close: Callback<()>,
    items: Vec<MenuItem>,
    #[prop(optional)] up: bool,
    #[prop(optional)] align_right: bool,
) -> impl IntoView {
    let items = StoredValue::new(items);
    view! {
        <Floating open=open on_close=on_close up=up align_right=align_right class="menu">
            {move || {
                items
                    .get_value()
                    .into_iter()
                    .map(|i| {
                        let run = i.run;
                        view! {
                            <button
                                class="menu-item"
                                class:danger=i.danger
                                on:click=move |_| {
                                    on_close.run(());
                                    run.run(());
                                }
                            >
                                {i.icon.map(|ic| view! { <Icon ico=ic size=14.0 /> })}
                                <span class="menu-label">{i.label.clone()}</span>
                                {i.hint.clone().map(|h| view! { <span class="t-mono menu-hint">{h}</span> })}
                            </button>
                        }
                    })
                    .collect_view()
            }}
        </Floating>
    }
}
