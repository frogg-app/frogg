//! The tool list the rail, phone tabs and palette share (ui-next `Rail.tsx` `TOOLS`).

use crate::components::Ico;
use crate::state::{AppState, Tool};

#[derive(Debug, Clone, Copy)]
pub struct ToolMeta {
    pub id: Tool,
    pub icon: Ico,
    pub label: &'static str,
    pub group: usize,
}

pub const TOOLS: [ToolMeta; 13] = [
    ToolMeta {
        id: Tool::Sessions,
        icon: Ico::Layers,
        label: "Sessions",
        group: 0,
    },
    ToolMeta {
        id: Tool::Search,
        icon: Ico::Search,
        label: "Search",
        group: 0,
    },
    ToolMeta {
        id: Tool::Files,
        icon: Ico::Files,
        label: "Files",
        group: 0,
    },
    ToolMeta {
        id: Tool::Scm,
        icon: Ico::FolderGit2,
        label: "Source control",
        group: 0,
    },
    ToolMeta {
        id: Tool::Prs,
        icon: Ico::GitPullRequest,
        label: "PRs & CI",
        group: 0,
    },
    ToolMeta {
        id: Tool::Terminals,
        icon: Ico::SquareTerminal,
        label: "Terminals",
        group: 0,
    },
    ToolMeta {
        id: Tool::Tasks,
        icon: Ico::ListChecks,
        label: "Tasks",
        group: 0,
    },
    ToolMeta {
        id: Tool::Hosts,
        icon: Ico::Server,
        label: "Hosts",
        group: 1,
    },
    ToolMeta {
        id: Tool::Usage,
        icon: Ico::CircleGauge,
        label: "Usage",
        group: 1,
    },
    ToolMeta {
        id: Tool::Plugins,
        icon: Ico::Puzzle,
        label: "Plugins",
        group: 1,
    },
    ToolMeta {
        id: Tool::Inbox,
        icon: Ico::Bell,
        label: "Inbox",
        group: 2,
    },
    ToolMeta {
        id: Tool::Companion,
        icon: Ico::Bot,
        label: "Companion",
        group: 2,
    },
    ToolMeta {
        id: Tool::Settings,
        icon: Ico::Settings,
        label: "Settings",
        group: 2,
    },
];

pub const GROUP_NAMES: [&str; 3] = ["Work", "Host", "App"];

pub fn meta(tool: Tool) -> ToolMeta {
    TOOLS
        .iter()
        .copied()
        .find(|t| t.id == tool)
        .unwrap_or(TOOLS[0])
}

/// Whether a tool is offered (reactive). The Companion is a plugin feature: shown only when the
/// host's server_info says it runs it and this device hasn't turned it off. Terminals listed
/// among sessions replace the tool.
pub fn shown(app: &AppState, tool: Tool) -> bool {
    match tool {
        Tool::Terminals => !app.prefs.flag("sessionsWithTerminals"),
        Tool::Companion => app.prefs.flag("companion") && crate::state::config::companion_gate(),
        _ => true,
    }
}

/// Tools by group without the ones this host doesn't offer (reactive).
pub fn shown_groups(app: &AppState) -> [Vec<ToolMeta>; 3] {
    let mut out: [Vec<ToolMeta>; 3] = Default::default();
    for t in TOOLS {
        if shown(app, t.id) {
            out[t.group].push(t);
        }
    }
    out
}

/// Rail / tab badges per the `railBadge` pref: "attention" counts sessions needing you (and
/// needs + failed on the inbox), "unread" counts every unread session, "none" shows nothing.
pub fn badge(app: &AppState, tool: Tool) -> Option<usize> {
    let mode = app.prefs.text("railBadge");
    let n = match mode.as_str() {
        "none" => 0,
        "unread" => match tool {
            Tool::Sessions | Tool::Inbox => app
                .sessions()
                .iter()
                .filter(|s| s.agent.requires_attention == Some(true))
                .count(),
            _ => 0,
        },
        _ => {
            let b = app.agents.buckets(app.active_host().as_deref());
            match tool {
                Tool::Sessions => b.needs,
                Tool::Inbox => b.needs + b.failed,
                _ => 0,
            }
        }
    };
    (n > 0).then_some(n)
}
