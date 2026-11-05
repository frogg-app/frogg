//! Helpers the panel stores share: the checkout the panels look at (ui-next `useActiveCwd`),
//! detached stores that outlive the panel that first reads them, and the host-switch reset.

use leptos::prelude::*;

use super::{get, Conn};

/// The checkout terminals start in: the session's (`session_cwd`), else a folder typed into
/// Files, so a host with no sessions still gets terminals (reactive).
pub fn active_cwd() -> Option<String> {
    session_cwd().or_else(|| super::files::store().browse.get())
}

/// The open session's checkout, else the most recently active session's (reactive).
pub fn session_cwd() -> Option<String> {
    let app = get();
    if let Some(s) = app.selected_session() {
        if !s.agent.cwd.is_empty() {
            return Some(s.agent.cwd);
        }
    }
    app.sessions()
        .into_iter()
        .map(|s| s.agent.cwd)
        .find(|c| !c.is_empty())
}

/// Every checkout a session on the active host points at, newest first, with a label
/// (`project · workspace`, else the path's last two parts).
pub fn checkouts() -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for s in get().sessions() {
        let cwd = s.agent.cwd.clone();
        if cwd.is_empty() || out.iter().any(|(c, _)| *c == cwd) {
            continue;
        }
        let label = s
            .project
            .as_ref()
            .map(|p| {
                [Some(p.project_name.clone()), p.workspace_name.clone()]
                    .into_iter()
                    .flatten()
                    .filter(|x| !x.is_empty())
                    .collect::<Vec<_>>()
                    .join(" · ")
            })
            .filter(|l| !l.is_empty())
            .unwrap_or_else(|| short_path(&cwd));
        out.push((cwd, label));
    }
    out
}

/// `…/parent/name`.
pub fn short_path(cwd: &str) -> String {
    let parts: Vec<&str> = cwd.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    let tail = &parts[parts.len().saturating_sub(2)..];
    format!("…/{}", tail.join("/"))
}

/// The last path component.
pub fn base_name(path: &str) -> String {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_owned()
}

/// Whether the active host is online (reactive).
pub fn online() -> bool {
    get().conn.active_link().conn == Conn::Online
}

/// Builds a store under its own root owner, so its signals live for the whole app rather than
/// for the panel that first asked for it. `on_host_switch` runs whenever the active host changes.
pub fn detached<T: Copy + 'static>(build: impl FnOnce() -> T, on_host_switch: fn(T)) -> T {
    let owner = Owner::new_root(None);
    let store = owner.with(|| {
        let store = build();
        let app = get();
        Effect::new(move |prev: Option<Option<String>>| {
            let host = app.hosts.active_id.get();
            if prev.is_some_and(|p| p != host) {
                on_host_switch(store);
            }
            host
        });
        store
    });
    std::mem::forget(owner);
    store
}

/// An error as text.
pub fn err_text(e: impl std::fmt::Display) -> String {
    e.to_string()
}
