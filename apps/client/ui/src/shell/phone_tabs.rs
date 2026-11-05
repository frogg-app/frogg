//! Phone bottom tabs (ui-next `PhoneTabs.tsx`): five tools plus More, one chamfered pill gliding
//! between them; More opens every tool as a full-screen grouped menu sliding in from the right.

use leptos::html;
use leptos::prelude::*;

use super::tools::{badge, shown_groups, GROUP_NAMES};
use crate::components::glide::{glide_style, use_glide};
use crate::components::{Ico, Icon};
use crate::state::Tool;

const TABS: [(Option<Tool>, Ico, &str); 6] = [
    (Some(Tool::Sessions), Ico::Layers, "Sessions"),
    (Some(Tool::Search), Ico::Search, "Search"),
    (Some(Tool::Scm), Ico::FolderGit2, "Source"),
    (Some(Tool::Inbox), Ico::Bell, "Inbox"),
    (Some(Tool::Settings), Ico::Settings, "Settings"),
    (None, Ico::Menu, "More"),
];

#[component]
pub fn PhoneTabs() -> impl IntoView {
    let app = crate::state::get();
    let more = RwSignal::new(false);
    let in_tabs = move || {
        let t = app.ui.tool.get();
        TABS.iter().any(|(id, _, _)| *id == Some(t))
    };
    let active = Signal::derive(move || {
        if more.get() || !in_tabs() {
            "more".to_owned()
        } else {
            app.ui.tool.get().id().to_owned()
        }
    });
    let bar = NodeRef::<html::Div>::new();
    let (rect, animate) = use_glide(bar, active, Signal::derive(|| 0));
    let pick = move |id: Option<Tool>| match id {
        None => more.update(|m| *m = !*m),
        Some(t) => {
            more.set(false);
            app.ui.set_tool(t);
        }
    };
    view! {
        <Show when=move || more.get()>
            <ToolMenu on_pick=Callback::new(move |t: Tool| pick(Some(t))) on_close=Callback::new(move |_| more.set(false)) />
        </Show>
        <div class="tabs" node_ref=bar>
            <div class="tab-pill cut" style=move || format!("--c:8px;{}", glide_style(rect.get(), animate.get()))></div>
            {TABS
                .iter()
                .map(|(id, ico, label)| {
                    let id = *id;
                    let key = id.map(|t| t.id()).unwrap_or("more");
                    let on = move || active.get() == key;
                    view! {
                        <button class="tab" class:on=on data-glide=key on:click=move |_| pick(id)>
                            <Icon ico=*ico size=18.0 />
                            <span class="tab-l">{*label}</span>
                            {move || id.and_then(|t| badge(&app, t)).map(|n| view! { <span class="badge tab-badge">{n}</span> })}
                        </button>
                    }
                })
                .collect_view()}
        </div>
    }
}

#[component]
fn ToolMenu(on_pick: Callback<Tool>, on_close: Callback<()>) -> impl IntoView {
    let app = crate::state::get();
    view! {
        <div class="tool-menu">
            <div class="tool-menu-head">
                <span class="t-display tool-menu-title">"All tools"</span>
                <button class="icon-btn" aria-label="Close menu" on:click=move |_| on_close.run(())>
                    <Icon ico=Ico::X size=20.0 />
                </button>
            </div>
            <div class="tool-menu-body">
                {move || {
                    shown_groups(&app)
                        .into_iter()
                        .enumerate()
                        .map(|(i, g)| {
                            view! {
                                <div class="tm-group">
                                    <span class="t-label tm-group-t">{GROUP_NAMES[i]}</span>
                                    {g
                                        .into_iter()
                                        .map(|m| {
                                            let id = m.id;
                                            let on = move || app.ui.tool.get() == id;
                                            view! {
                                                <button class="tm-row cut" class:on=on style="--c:10px" on:click=move |_| on_pick.run(id)>
                                                    <span class="tm-icon cut" style="--c:6px">
                                                        <Icon ico=m.icon size=18.0 />
                                                    </span>
                                                    <span class="tm-label">{m.label}</span>
                                                    {move || badge(&app, id).map(|n| view! { <span class="badge">{n}</span> })}
                                                    <Icon ico=Ico::ChevronRight size=16.0 class="tm-chev" />
                                                </button>
                                            }
                                        })
                                        .collect_view()}
                                </div>
                            }
                        })
                        .collect_view()
                }}
            </div>
        </div>
    }
}
