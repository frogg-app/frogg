//! Terminals (ui-next `TerminalsPanel.tsx`, `TerminalView.web.tsx`): every terminal on the host
//! grouped by checkout, and an open terminal filling the main pane through frogg-render's
//! `Terminal`, fed by the core's terminal stream router.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use frogg_client_core::binary::TerminalResize;
use frogg_client_core::{FileUploadInput, TerminalInput, TerminalStreamEvent};
use frogg_render::{Terminal, TerminalHandle, TerminalSnapshot};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::json;

use super::util::{dropped_files, dropped_paths, Ask, Confirm};
use crate::components::{Brackets, Button, ButtonKind, Ico, Icon};
use crate::shell::panel_head::{GroupHead, PanelHead};
use crate::shell::toast::{Toast, ToastKind};
use crate::state::checkout::{active_cwd, checkouts, online, short_path};
use crate::state::terminals::{store, TermInfo};
use crate::state::{self};

#[component]
pub fn TerminalsPanel() -> impl IntoView {
    let app = state::get();
    let t = store();
    let busy = RwSignal::new(false);
    let ask = RwSignal::new(None::<Ask>);
    let cwd = Memo::new(move |_| active_cwd());
    let labels = Memo::new(move |_| checkouts());
    let cwds = Memo::new(move |_| {
        let mut v: Vec<String> = cwd.get().into_iter().collect();
        for (c, _) in labels.get() {
            if !v.contains(&c) {
                v.push(c);
            }
        }
        v
    });
    Effect::new(move |_| {
        if online() {
            t.watch(cwds.get(), cwd.get());
        }
    });
    let create = move || {
        let Some(dir) = cwd.get_untracked() else {
            return;
        };
        if busy.get_untracked() || !online() {
            return;
        }
        busy.set(true);
        spawn_local(async move {
            if let Some(id) = t.create(dir).await {
                app.ui.open_terminal(Some(id));
            }
            busy.set(false);
        });
    };
    let disabled = Signal::derive(move || busy.get() || cwd.get().is_none() || !online());
    let label_of = move |c: &str| {
        labels
            .with(|l| l.iter().find(|(x, _)| x == c).map(|(_, l)| l.clone()))
            .unwrap_or_else(|| short_path(c))
    };
    let active = Memo::new(move |_| {
        cwd.get()
            .and_then(|c| t.groups.with(|g| g.get(&c).cloned()))
    });
    let rest = Memo::new(move |_| {
        let me = cwd.get();
        cwds.get()
            .into_iter()
            .filter(|c| Some(c) != me.as_ref())
            .filter_map(|c| {
                let list = t.groups.with(|g| g.get(&c).cloned()).unwrap_or_default();
                (!list.is_empty()).then_some((c, list))
            })
            .collect::<Vec<_>>()
    });
    let others = Memo::new(move |_| {
        let grouped: HashSet<String> = t
            .groups
            .with(|g| g.values().flatten().map(|x| x.id.clone()).collect());
        t.all
            .get()
            .unwrap_or_default()
            .into_iter()
            .filter(|x| !grouped.contains(&x.id))
            .collect::<Vec<_>>()
    });
    view! {
        <div class="panel pn">
            <PanelHead title="Terminals">
                <button
                    class="icon-btn"
                    aria-label="New terminal"
                    disabled=move || disabled.get()
                    on:click=move |_| create()
                >
                    <Icon ico=Ico::Plus size=17.0 class="faint" />
                </button>
            </PanelHead>
            <div class="panel-scroll">
                {move || {
                    let c = cwd.get();
                    let title = c.as_deref().map(label_of).unwrap_or_else(|| "No checkout".into());
                    let sub = c.as_deref().map(|c| format!("{} · this session", short_path(c)));
                    view! { <Group title=title sub=sub list=active.get() ask=ask on_open=None host=None /> }
                }}
                {move || {
                    (active.get().is_some_and(|l| l.is_empty()))
                        .then(|| {
                            view! {
                                <div class="pn-empty">
                                    <span class="pn-muted">"No terminals in this checkout yet."</span>
                                    <Button
                                        kind=ButtonKind::Primary
                                        label="New terminal"
                                        kbd="⌃`"
                                        disabled=disabled
                                        on_press=Callback::new(move |_| create())
                                    />
                                </div>
                            }
                        })
                }}
                {move || {
                    rest.get()
                        .into_iter()
                        .map(|(c, list)| {
                            view! {
                                <Group title=label_of(&c) sub=Some(short_path(&c)) list=Some(list) ask=ask on_open=None host=None />
                            }
                        })
                        .collect_view()
                }}
                {move || {
                    let o = others.get();
                    (!o.is_empty())
                        .then(|| {
                            view! {
                                <Group
                                    title="Elsewhere on this host".to_string()
                                    sub=Some("checkouts no open session uses".to_string())
                                    list=Some(o)
                                    ask=ask
                                    on_open=None
                                    host=None
                                />
                            }
                        })
                }}
                <OtherHosts ask=ask />
                {move || t.error.get().map(|e| view! { <div class="pn-error t-mono">{e}</div> })}
            </div>
            <Confirm ask=ask />
        </div>
    }
}

const FLEET_REFRESH_MS: u64 = 5000;

/// Terminals on the other connected hosts (Settings → Terminal can turn this off). Opening one
/// makes its host active.
#[component]
fn OtherHosts(ask: RwSignal<Option<Ask>>) -> impl IntoView {
    let app = state::get();
    let fleet = RwSignal::new(HashMap::<String, Vec<TermInfo>>::new());
    let refresh = move || {
        if !app.prefs.flag("terminalsAllHosts") {
            return;
        }
        let active = app.hosts.active_id.get_untracked();
        for h in app.hosts.hosts.get_untracked() {
            if Some(&h.id) == active.as_ref() {
                continue;
            }
            let Some(c) = app.conn.client_of(&h.id) else {
                continue;
            };
            if !c.is_connected() {
                fleet.update(|f| {
                    f.remove(&h.id);
                });
                continue;
            }
            spawn_local(async move {
                let list = c.list_terminals(None, None).await.ok().map(|r| {
                    r.terminals
                        .into_iter()
                        .map(|t| TermInfo {
                            id: t.id,
                            name: t.name,
                            cwd: None,
                            title: t.title,
                        })
                        .collect::<Vec<_>>()
                });
                fleet.update(|f| match list {
                    Some(l) => {
                        f.insert(h.id.clone(), l);
                    }
                    None => {
                        f.remove(&h.id);
                    }
                });
            });
        }
    };
    Effect::new(move |_| {
        app.hosts.active_id.track();
        fleet.set(HashMap::new());
        refresh();
    });
    if let Ok(handle) = set_interval_with_handle(refresh, Duration::from_millis(FLEET_REFRESH_MS)) {
        on_cleanup(move || handle.clear());
    }
    move || {
        if !app.prefs.flag("terminalsAllHosts") {
            return None;
        }
        let active = app.hosts.active_id.get();
        let groups = app
            .hosts
            .hosts
            .get()
            .into_iter()
            .filter(|h| Some(&h.id) != active.as_ref())
            .filter_map(|h| {
                let list = fleet
                    .with(|f| f.get(&h.id).cloned())
                    .filter(|l| !l.is_empty())?;
                let host = h.id.clone();
                let open = Callback::new(move |id: String| {
                    app.conn.activate(&host);
                    app.ui.set_tool(state::Tool::Terminals);
                    app.ui.open_terminal(Some(id));
                });
                Some(view! {
                    <Group
                        title=h.name.clone()
                        sub=Some("another host · opening a terminal switches to it".to_string())
                        list=Some(list)
                        ask=ask
                        on_open=Some(open)
                        host=Some(h.id.clone())
                    />
                })
            })
            .collect_view();
        Some(groups)
    }
}

#[component]
fn Group(
    title: String,
    sub: Option<String>,
    list: Option<Vec<TermInfo>>,
    ask: RwSignal<Option<Ask>>,
    on_open: Option<Callback<String>>,
    /// Another host's group: kills go to that host.
    host: Option<String>,
) -> impl IntoView {
    let count = list.as_ref().map(|l| l.len()).unwrap_or(0);
    view! {
        <div class="pn-group">
            <GroupHead label=title count=Signal::derive(move || count) />
            {sub.map(|s| view! { <div class="pn-sub t-mono">{s}</div> })}
            {list
                .unwrap_or_default()
                .into_iter()
                .map(|t| view! { <TerminalRow t=t ask=ask on_open=on_open host=host.clone() /> })
                .collect_view()}
        </div>
    }
}

#[component]
fn TerminalRow(
    t: TermInfo,
    ask: RwSignal<Option<Ask>>,
    on_open: Option<Callback<String>>,
    host: Option<String>,
) -> impl IntoView {
    let app = state::get();
    let id = t.id.clone();
    let other = host.is_some();
    let host_for_kill = host;
    let on = {
        let id = id.clone();
        Signal::derive(move || !other && app.ui.terminal_id.get().as_deref() == Some(&id))
    };
    let label = t.label();
    let open = {
        let id = id.clone();
        move |_| match on_open {
            Some(cb) => cb.run(id.clone()),
            None => app.ui.open_terminal(Some(id.clone())),
        }
    };
    let kill = {
        let (id, label) = (id.clone(), label.clone());
        move |e: web_sys::MouseEvent| {
            e.stop_propagation();
            let id = id.clone();
            let host = host_for_kill.clone();
            ask.set(Some(
                Ask::new(
                    format!("Close {label}?"),
                    "This stops the terminal and its running process.",
                    "Close terminal",
                    move || {
                        let id = id.clone();
                        match host.clone() {
                            None => spawn_local(store().kill(id)),
                            Some(h) => {
                                if let Some(c) = app.conn.client_of(&h) {
                                    spawn_local(async move {
                                        let _ = c.kill_terminal(&id).await;
                                    });
                                }
                            }
                        }
                    },
                )
                .danger(),
            ));
        }
    };
    view! {
        <div class="pn-row" class:on=move || on.get() role="button" tabindex="0" on:click=open>
            <Brackets on=on />
            <Icon ico=Ico::SquareTerminal size=15.0 class=if on.get_untracked() { "cyan2" } else { "pn-muted" } />
            <div class="pn-row-text">
                <span class="pn-row-title">{label}</span>
                <span class="pn-row-meta t-mono">{t.name.clone()}</span>
            </div>
            <button class="icon-btn pn-hover" aria-label="Kill terminal" on:click=kill>
                <Icon ico=Ico::X size=14.0 class="faint" />
            </button>
        </div>
    }
}

/// An open terminal filling the main pane. Phone: a back row. Wider: a header whose toggle
/// collapses the terminals list (docked; remembered) or opens it as a drawer.
#[component]
pub fn TerminalDetail(
    id: String,
    #[prop(optional)] docked: bool,
    #[prop(optional_no_strip)] on_back: Option<Callback<()>>,
) -> impl IntoView {
    let app = state::get();
    let t = store();
    let info = {
        let id = id.clone();
        Memo::new(move |_| t.find(&id))
    };
    let shown = move || docked && !app.prefs.flag("terminalListHidden");
    let toggle = move |_| {
        if docked {
            let hidden = app.prefs.flag("terminalListHidden");
            app.prefs.set("terminalListHidden", !hidden);
        } else {
            app.ui.list_open.set(true);
        }
    };
    let head = match on_back {
        Some(b) => view! {
            <button class="pn-term-back t-mono" on:click=move |_| b.run(())>"← terminals"</button>
        }
        .into_any(),
        None => view! {
            <div class="pn-term-head">
                <button
                    class="pn-term-toggle"
                    aria-label=move || if shown() { "Hide terminals list" } else { "Show terminals list" }
                    on:click=toggle
                >
                    <Icon
                        ico=Signal::derive(move || if shown() { Ico::PanelLeftClose } else { Ico::PanelLeftOpen })
                        size=15.0
                    />
                </button>
                <Icon ico=Ico::SquareTerminal size=13.0 class="cyan2" />
                <span class="pn-term-title">
                    {move || info.get().map(|i| i.label()).unwrap_or_else(|| "terminal".into())}
                </span>
                {move || {
                    info.get()
                        .filter(|i| i.title.as_ref().is_some_and(|t| *t != i.name))
                        .map(|i| view! { <span class="pn-row-meta t-mono">{i.name}</span> })
                }}
            </div>
        }
        .into_any(),
    };
    let surface_id = id.clone();
    view! {
        <div class="pn-terminal">
            {head}
            {move || {
                // Remount on host change: the stream belongs to the host's client.
                app.hosts.active_id.track();
                view! { <TerminalSurface terminal_id=surface_id.clone() /> }
            }}
        </div>
    }
}

/// The live terminal: subscribes with a full snapshot restore, writes output into a
/// `TerminalHandle`, sends keystrokes and resizes, and uploads dropped files then types their
/// paths.
#[component]
pub fn TerminalSurface(terminal_id: String) -> impl IntoView {
    let app = state::get();
    let scrollback: u64 = app.prefs.get_untracked::<f64>("scrollback").max(100.0) as u64;
    let handle = TerminalHandle::new(24, 80, scrollback as usize);
    let client = StoredValue::new_local(app.conn.client());
    let id = StoredValue::new(terminal_id.clone());
    let over = RwSignal::new(false);
    let sending = RwSignal::new(Vec::<String>::new());

    let send_size = move || {
        let (rows, cols) = handle.size();
        client.with_value(|c| {
            if let Some(c) = c {
                let _ = c.send_terminal_input(
                    &id.get_value(),
                    TerminalInput::Resize(TerminalResize {
                        rows: rows as u32,
                        cols: cols as u32,
                        intent: Some("claim".into()),
                    }),
                );
            }
        });
    };

    if let Some(c) = client.get_value() {
        let tid = terminal_id.clone();
        let listener = c.on_terminal_stream_event(move |e: &TerminalStreamEvent| {
            if e.terminal_id() != tid {
                return;
            }
            match e {
                TerminalStreamEvent::Output { data, .. } => handle.write(data),
                TerminalStreamEvent::Restore { data, .. } => handle.restore(data),
                TerminalStreamEvent::Snapshot { state, .. } => {
                    if let Ok(s) = serde_json::from_value::<TerminalSnapshot>(state.clone()) {
                        handle.load_snapshot(&s);
                    }
                }
            }
        });
        let c2 = leptos::__reexports::send_wrapper::SendWrapper::new(c.clone());
        let tid = terminal_id.clone();
        on_cleanup(move || {
            c2.unsubscribe(listener);
            let _ = c2.unsubscribe_terminal(&tid);
        });
        let tid = terminal_id.clone();
        // Let the grid fit its box first, so the snapshot comes at the real size.
        set_timeout(
            move || {
                let (rows, cols) = handle.size();
                spawn_local(async move {
                    let restore =
                        json!({ "mode": "full-snapshot", "size": { "rows": rows, "cols": cols } });
                    let _ = c.subscribe_terminal(&tid, Some(restore)).await;
                    send_size();
                });
            },
            Duration::from_millis(30),
        );
    }

    let on_input = Callback::new(move |data: String| {
        client.with_value(|c| {
            if let Some(c) = c {
                let _ = c.send_terminal_input(&id.get_value(), TerminalInput::Input(data));
            }
        });
    });
    let on_resize = Callback::new(move |_: (u16, u16)| send_size());

    let on_drop = move |e: web_sys::DragEvent| {
        e.prevent_default();
        over.set(false);
        let Some(dt) = e.data_transfer() else { return };
        let Some(c) = client.get_value() else { return };
        spawn_local(async move {
            let files = dropped_files(dt).await;
            let names: Vec<String> = files.iter().map(|f| f.name.clone()).collect();
            sending.update(|s| s.extend(names.iter().cloned()));
            let mut paths = Vec::new();
            for f in files {
                let bytes = f.bytes;
                let read = |from: u64, to: u64| bytes[from as usize..to as usize].to_vec();
                let res = c
                    .upload_file_stream(FileUploadInput {
                        file_name: f.name.clone(),
                        mime_type: if f.mime.is_empty() {
                            "application/octet-stream".into()
                        } else {
                            f.mime
                        },
                        size: bytes.len() as u64,
                        modified_at: None,
                        chunk_size: None,
                        read: &read,
                        on_progress: None,
                    })
                    .await;
                match res {
                    Ok(r) if r.error.is_none() => {
                        if let Some(p) = r.file["path"].as_str() {
                            paths.push(p.to_owned());
                        }
                    }
                    Ok(r) => upload_failed(&f.name, r.error.unwrap_or_default()),
                    Err(e) => upload_failed(&f.name, e.to_string()),
                }
            }
            sending.update(|s| s.retain(|n| !names.contains(n)));
            let text = dropped_paths(&paths);
            if !text.is_empty() {
                let _ = c.send_terminal_input(&id.get_value(), TerminalInput::Input(text));
            }
        });
    };

    view! {
        <div
            class="pn-term-frame"
            on:dragover=move |e: web_sys::DragEvent| {
                e.prevent_default();
                over.set(true);
            }
            on:dragleave=move |_| over.set(false)
            on:drop=on_drop
        >
            <Terminal handle=handle on_input=on_input on_resize=on_resize autofocus=true />
            <div class="pn-drop-ring" class:on=move || over.get()></div>
            {move || {
                let s = sending.get();
                (!s.is_empty())
                    .then(|| {
                        view! {
                            <div class="pn-uploads">
                                {s.into_iter()
                                    .map(|n| view! { <div class="pn-upload t-mono">{format!("uploading {n}…")}</div> })
                                    .collect_view()}
                            </div>
                        }
                    })
            }}
        </div>
    }
}

fn upload_failed(name: &str, err: String) {
    state::get()
        .toasts
        .push(Toast::new(ToastKind::Error, format!("Could not upload {name}")).detail(err));
}
