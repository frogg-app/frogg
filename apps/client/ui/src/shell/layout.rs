//! The three layouts (ui-next `app/index.tsx` `Shell`): desktop and tablet put the rail, the
//! tool's side panel and the main pane in a row over the status bar (portrait tablet slides the
//! panel over the main pane as a drawer); phones show one tab's panel at a time with a detail
//! view pushed over it and bottom tabs.

use leptos::prelude::*;

use super::home::Home;
use super::phone_tabs::PhoneTabs;
use super::rail::Rail;
use super::status_bar::StatusBar;
use super::tools::meta;
use crate::state::{AppState, Tool};
use crate::theme::layout::FormFactor;
use crate::views::{self, panels as p};

fn side_panel(tool: Tool) -> AnyView {
    match tool {
        Tool::Sessions => view! { <views::sessions::SessionList /> }.into_any(),
        Tool::Scm => view! { <p::scm::ScmPanel /> }.into_any(),
        Tool::Terminals => view! { <p::terminals::TerminalsPanel /> }.into_any(),
        Tool::Inbox => view! { <p::inbox::InboxPanel /> }.into_any(),
        Tool::Settings => view! { <views::settings::SettingsNav /> }.into_any(),
        Tool::Files => view! { <p::files::FilesPanel /> }.into_any(),
        Tool::Search => view! { <p::search::SearchPanel /> }.into_any(),
        Tool::Usage => view! { <p::usage::UsagePanel /> }.into_any(),
        Tool::Hosts => view! { <p::hosts::HostsPanel /> }.into_any(),
        Tool::Prs => view! { <p::prs::PrsPanel /> }.into_any(),
        Tool::Tasks => view! { <p::tasks::TasksPanel /> }.into_any(),
        Tool::Plugins => view! { <p::plugins::PluginsPanel /> }.into_any(),
        Tool::Companion => view! { <p::companion::CompanionPanel /> }.into_any(),
    }
}

/// What the main pane shows: a tool's own detail view when it has one open, else the session.
fn main_detail(app: AppState, phone: bool, docked: bool) -> AnyView {
    let ui = app.ui;
    let tool = ui.tool.get();
    let back = |f: Box<dyn Fn() + Send + Sync>| phone.then(|| Callback::new(move |_| f()));
    if let (Tool::Scm, Some(path)) = (tool, ui.diff_path.get()) {
        let on_back = back(Box::new(move || ui.open_diff(None)));
        return view! { <p::scm::DiffView path=path on_back=on_back /> }.into_any();
    }
    if let (Tool::Terminals, Some(id)) = (tool, ui.terminal_id.get()) {
        let on_back = back(Box::new(move || ui.open_terminal(None)));
        return view! { <p::terminals::TerminalDetail id=id docked=docked on_back=on_back /> }
            .into_any();
    }
    if let Some(id) = ui.sessions_terminal() {
        let on_back = back(Box::new(move || ui.open_session_terminal(None)));
        return view! { <p::terminals::TerminalDetail id=id docked=docked on_back=on_back /> }
            .into_any();
    }
    if let (Tool::Prs, Some(id)) = (tool, ui.open_run.get()) {
        let on_back = back(Box::new(move || ui.open_run.set(None)));
        return view! { <p::prs::CiRunDetail id=id on_back=on_back /> }.into_any();
    }
    if let (Tool::Files, Some(path)) = (tool, ui.file_path.get()) {
        let on_back = back(Box::new(move || ui.open_file(None)));
        return view! { <p::files::FileViewer path=path on_back=on_back /> }.into_any();
    }
    let page = ui.settings_page.get();
    if tool == Tool::Settings && (page.is_some() || !phone) {
        let on_back = back(Box::new(move || ui.open_settings(None)));
        let id = page.unwrap_or_else(|| "appearance".into());
        return view! { <views::settings::SettingsPage id=id on_back=on_back /> }.into_any();
    }
    if let (Tool::Inbox, Some(id)) = (tool, ui.inbox_id.get()) {
        let on_back = back(Box::new(move || ui.open_inbox(None)));
        return view! { <p::inbox::InboxDetail id=id on_back=on_back /> }.into_any();
    }
    if tool == Tool::Hosts && !phone {
        return view! { <p::hosts::HostDetail /> }.into_any();
    }
    if tool == Tool::Tasks && !phone {
        return view! { <p::tasks::TodoBoard /> }.into_any();
    }
    // Nothing of the tool's own is open: the session's chat (chat tools only), else empty.
    if tool != Tool::Sessions && phone {
        return ().into_any();
    }
    if !tool.is_chat_tool() {
        return view! { <ToolEmpty tool=tool /> }.into_any();
    }
    // Only the open session's id: an agent_update must not remount the chat.
    let open = Memo::new(move |_| app.selected_session().map(|s| s.agent.id));
    match open.get() {
        Some(id) => {
            let on_back = back(Box::new(move || ui.select(None)));
            view! { <views::chat::Chat agent_id=id on_back=on_back /> }.into_any()
        }
        None if phone => ().into_any(),
        None => view! { <Home /> }.into_any(),
    }
}

fn has_detail(app: AppState) -> bool {
    let ui = app.ui;
    let tool = ui.tool.get();
    if ui.sessions_terminal().is_some() {
        return true;
    }
    if tool.is_chat_tool() && app.selected_session().is_some() {
        return true;
    }
    match tool {
        Tool::Scm => ui.diff_path.get().is_some(),
        Tool::Terminals => ui.terminal_id.get().is_some(),
        Tool::Inbox => ui.inbox_id.get().is_some(),
        Tool::Settings => ui.settings_page.get().is_some(),
        Tool::Files => ui.file_path.get().is_some(),
        Tool::Prs => ui.open_run.get().is_some(),
        Tool::Tasks => true,
        _ => false,
    }
}

/// Phone only: whether the main pane shows a view (otherwise the tab's panel does).
fn has_phone_detail(app: AppState) -> bool {
    if app.ui.tool.get() == Tool::Tasks {
        return false;
    }
    if app.ui.tool.get() != Tool::Sessions && app.ui.tool.get().is_chat_tool() {
        // Search keeps its panel on phones; a session opens from Sessions.
        return has_detail(app) && app.selected_session().is_none();
    }
    has_detail(app)
}

/// Main pane for a tool with no detail open.
#[component]
fn ToolEmpty(tool: Tool) -> impl IntoView {
    let m = meta(tool);
    view! {
        <views::DetailStub ico=m.icon title=m.label note="Pick something from the list." />
    }
}

#[component]
pub fn Shell() -> impl IntoView {
    let app = crate::state::get();
    let ui = app.ui;
    let ff = app.viewport.form_factor;
    let docked = app.viewport.docked;
    // Keyed on the tool so switching replays a short enter.
    let side = move || {
        let tool = ui.tool.get();
        view! { <div class="fill m-enter">{side_panel(tool)}</div> }
    };
    let detail = move || main_detail(app, ff.get() == FormFactor::Phone, docked.get());
    let side_hidden = move || {
        let t = ui.tool.get();
        ((t == Tool::Terminals && ui.terminal_id.get().is_some())
            || ui.sessions_terminal().is_some())
            && app.prefs.flag("terminalListHidden")
    };

    move || {
        if ff.get() == FormFactor::Phone {
            let pushed = has_phone_detail(app);
            view! {
                <div class="root phone">
                    <div class="fill">{move || if has_phone_detail(app) { detail().into_any() } else { side().into_any() }}</div>
                    {(!pushed).then(|| view! { <PhoneTabs /> })}
                </div>
            }
            .into_any()
        } else {
            let tablet = ff.get() == FormFactor::Tablet;
            view! {
                <div class="root">
                    <div class="row fill">
                        <Rail />
                        {move || {
                            let tool = ui.tool.get();
                            if tool.is_full() {
                                view! { <div class="fill full">{side()}</div> }.into_any()
                            } else if docked.get() {
                                view! {
                                    <div class="side" class:tablet=tablet class:hidden=side_hidden aria-hidden=move || side_hidden().to_string()>
                                        <div class="side-in">{side}</div>
                                    </div>
                                    <div class="fill main">{detail}</div>
                                }
                                .into_any()
                            } else {
                                // Portrait tablet: the side panel slides over the main pane.
                                view! {
                                    <div class="fill main rel">
                                        {detail}
                                        {move || {
                                            let has = has_detail(app);
                                            (ui.list_open.get() || !has).then(|| view! {
                                                {has.then(|| view! { <div class="scrim m-fade-in" on:click=move |_| ui.list_open.set(false)></div> })}
                                                <div class="side drawer">{side}</div>
                                            })
                                        }}
                                    </div>
                                }
                                .into_any()
                            }
                        }}
                    </div>
                    <StatusBar />
                </div>
            }
            .into_any()
        }
    }
}
