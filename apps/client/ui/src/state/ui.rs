//! Shell navigation state (ui-next `ui-store.ts`): the active tool, the open session, each tool's
//! open detail, and the overlays.

use leptos::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Tool {
    Sessions,
    Search,
    Files,
    Scm,
    Prs,
    Terminals,
    Tasks,
    Hosts,
    Usage,
    Plugins,
    Inbox,
    Companion,
    Settings,
}

impl Tool {
    pub const ALL: [Tool; 13] = [
        Tool::Sessions,
        Tool::Search,
        Tool::Files,
        Tool::Scm,
        Tool::Prs,
        Tool::Terminals,
        Tool::Tasks,
        Tool::Hosts,
        Tool::Usage,
        Tool::Plugins,
        Tool::Inbox,
        Tool::Companion,
        Tool::Settings,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Tool::Sessions => "sessions",
            Tool::Search => "search",
            Tool::Files => "files",
            Tool::Scm => "scm",
            Tool::Prs => "prs",
            Tool::Terminals => "terminals",
            Tool::Tasks => "tasks",
            Tool::Hosts => "hosts",
            Tool::Usage => "usage",
            Tool::Plugins => "plugins",
            Tool::Inbox => "inbox",
            Tool::Companion => "companion",
            Tool::Settings => "settings",
        }
    }

    /// The main pane falls back to the open session's chat.
    pub fn is_chat_tool(self) -> bool {
        matches!(self, Tool::Sessions | Tool::Search)
    }

    /// No detail view of its own: on wide layouts the panel takes the full width.
    pub fn is_full(self) -> bool {
        matches!(self, Tool::Usage | Tool::Plugins | Tool::Companion)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionsPane {
    Chat,
    Terminal,
}

#[derive(Clone, Copy)]
pub struct Ui {
    pub tool: RwSignal<Tool>,
    /// The open session (agent id) on the active host.
    pub selected: RwSignal<Option<String>>,
    /// Tablet/phone: the side panel is a drawer over the main pane.
    pub list_open: RwSignal<bool>,
    pub diff_path: RwSignal<Option<String>>,
    pub terminal_id: RwSignal<Option<String>>,
    pub sessions_pane: RwSignal<SessionsPane>,
    pub inbox_id: RwSignal<Option<String>>,
    pub file_path: RwSignal<Option<String>>,
    pub settings_page: RwSignal<Option<String>>,
    pub new_session_open: RwSignal<bool>,
    pub new_session_prompt: RwSignal<String>,
    pub palette_open: RwSignal<bool>,
    /// The add / switch host sheet.
    pub host_sheet_open: RwSignal<bool>,
    /// CI run open in the PRs tool (owned by the panels stream; here so the shell can route it).
    pub open_run: RwSignal<Option<String>>,
}

impl Ui {
    pub fn init() -> Self {
        Self {
            tool: RwSignal::new(Tool::Sessions),
            selected: RwSignal::new(None),
            list_open: RwSignal::new(false),
            diff_path: RwSignal::new(None),
            terminal_id: RwSignal::new(None),
            sessions_pane: RwSignal::new(SessionsPane::Chat),
            inbox_id: RwSignal::new(None),
            file_path: RwSignal::new(None),
            settings_page: RwSignal::new(None),
            new_session_open: RwSignal::new(false),
            new_session_prompt: RwSignal::new(String::new()),
            palette_open: RwSignal::new(false),
            host_sheet_open: RwSignal::new(false),
            open_run: RwSignal::new(None),
        }
    }

    pub fn set_tool(&self, tool: Tool) {
        self.tool.set(tool);
        self.list_open.set(true);
    }

    pub fn select(&self, id: Option<String>) {
        self.selected.set(id);
        self.list_open.set(false);
        self.sessions_pane.set(SessionsPane::Chat);
    }

    pub fn open_diff(&self, path: Option<String>) {
        self.diff_path.set(path);
        self.list_open.set(false);
    }

    pub fn open_terminal(&self, id: Option<String>) {
        self.terminal_id.set(id);
        self.list_open.set(false);
    }

    pub fn open_session_terminal(&self, id: Option<String>) {
        self.sessions_pane.set(if id.is_some() {
            SessionsPane::Terminal
        } else {
            SessionsPane::Chat
        });
        self.terminal_id.set(id);
        self.list_open.set(false);
    }

    pub fn open_inbox(&self, id: Option<String>) {
        self.inbox_id.set(id);
        self.list_open.set(false);
    }

    pub fn open_file(&self, path: Option<String>) {
        self.file_path.set(path);
        self.list_open.set(false);
    }

    pub fn open_settings(&self, page: Option<String>) {
        self.settings_page.set(page);
        self.list_open.set(false);
    }

    pub fn set_new_session(&self, open: bool, prompt: Option<String>) {
        if let Some(p) = prompt {
            self.new_session_prompt.set(p);
        }
        self.new_session_open.set(open);
    }

    /// The terminal the Sessions tool shows in its main pane, when one is open there.
    pub fn sessions_terminal(&self) -> Option<String> {
        if self.tool.get() == Tool::Sessions && self.sessions_pane.get() == SessionsPane::Terminal {
            self.terminal_id.get()
        } else {
            None
        }
    }

    /// A different host has different sessions and files: drop everything that pointed into it.
    pub fn reset_for_host_switch(&self) {
        self.selected.set(None);
        self.diff_path.set(None);
        self.terminal_id.set(None);
        self.sessions_pane.set(SessionsPane::Chat);
        self.inbox_id.set(None);
        self.file_path.set(None);
        self.list_open.set(false);
        self.open_run.set(None);
    }
}
