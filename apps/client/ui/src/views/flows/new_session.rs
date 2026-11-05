//! New session (wave 2, flows stream): the overlay ⌘N opens. Stub: a sheet saying what comes.

use leptos::prelude::*;

use crate::components::{Button, ButtonKind, Sheet};

#[component]
pub fn NewSession() -> impl IntoView {
    let app = crate::state::get();
    let open = app.ui.new_session_open;
    let close = Callback::new(move |_| open.set(false));
    view! {
        <Sheet open=open on_close=close title="New session".to_string()>
            <div class="stub-note">
                <span class="t-label">"coming"</span>
                <span class="stub-text">"Provider, model, mode, project and worktree."</span>
                {move || {
                    let p = app.ui.new_session_prompt.get();
                    (!p.is_empty()).then(|| view! { <span class="t-mono stub-text">{p}</span> })
                }}
            </div>
            <div class="add-actions">
                <Button label="Close" kind=ButtonKind::Ghost on_press=close />
            </div>
        </Sheet>
    }
}
