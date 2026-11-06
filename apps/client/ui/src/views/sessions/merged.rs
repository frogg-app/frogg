//! Terminals merged into the Sessions list (ui-next `sessions/merged.tsx`, Settings › Files,
//! editor & terminal › "Terminals in Sessions"). The host's terminals follow its sessions as one
//! more group, then each other online host's terminals; opening one shows it in the Sessions
//! main pane (switching host first when it lives elsewhere). Off, terminals keep their tool.

use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::components::{Brackets, Ico, Icon};
use crate::state::terminals::{store, TermInfo};

/// Other hosts' terminals: host id -> its list. Kept per mounted list; refreshed on the timer.
type Others = RwSignal<Vec<(String, Vec<TermInfo>)>>;

/// Re-reads every other online host's terminal list.
fn refresh_others(others: Others) {
    let app = crate::state::get();
    let active = app.hosts.active_id.get_untracked();
    let hosts: Vec<String> = app
        .hosts
        .hosts
        .get_untracked()
        .into_iter()
        .map(|h| h.id)
        .filter(|id| Some(id) != active.as_ref())
        .filter(|id| app.conn.link(id).conn == crate::state::Conn::Online)
        .collect();
    // Hosts that went away or offline drop out now; the rest update as they answer.
    others.update(|o| o.retain(|(h, _)| hosts.contains(h)));
    for host in hosts {
        let Some(c) = app.conn.client_of(&host) else {
            continue;
        };
        spawn_local(async move {
            let Ok(res) = c.list_terminals(None, None).await else {
                return;
            };
            let list: Vec<TermInfo> = res
                .terminals
                .into_iter()
                .map(|t| TermInfo {
                    id: t.id,
                    name: t.name,
                    cwd: None,
                    title: t.title,
                })
                .collect();
            let _ = others.try_update(|o| match o.iter_mut().find(|(h, _)| *h == host) {
                Some(x) => x.1 = list,
                None => o.push((host, list)),
            });
        });
    }
}

/// Switches to `host`, then shows terminal `id` in the Sessions pane once the host is up
/// (ui-next `openTerminalOnHost`).
fn open_on_host(host: String, id: String) {
    let app = crate::state::get();
    app.conn.activate(&host);
    app.ui.set_tool(crate::state::Tool::Sessions);
    fn wait(host: String, id: String, tries: u32) {
        let app = crate::state::get();
        let here = app.hosts.active_id.get_untracked().as_deref() == Some(host.as_str());
        if !here {
            return;
        }
        if app.conn.link(&host).conn == crate::state::Conn::Online {
            app.ui.open_session_terminal(Some(id));
            return;
        }
        if tries == 0 {
            return;
        }
        set_timeout(
            move || wait(host, id, tries - 1),
            std::time::Duration::from_millis(100),
        );
    }
    wait(host, id, 100);
}

/// How often the terminal list refreshes while the merged list is on screen.
const REFRESH_MS: u64 = 5000;

/// The active host's terminals as a list group, filtered by the list's filter text. Renders
/// nothing while the pref is off or the host has none.
#[component]
pub fn MergedTerminals(#[prop(into)] needle: Signal<String>) -> impl IntoView {
    let app = crate::state::get();
    let on = Memo::new(move |_| app.prefs.flag("sessionsWithTerminals"));
    let t = store();
    // Refresh now and on a timer while on and online.
    Effect::new(move |_| {
        let online = app.conn.active_link().conn == crate::state::Conn::Online;
        if on.get() && online {
            spawn_local(t.refresh_all());
        }
    });
    let others: Others = RwSignal::new(Vec::new());
    // Re-read when the pref, the active host or the set of online hosts changes.
    let online_hosts = Memo::new(move |_| {
        let active = app.hosts.active_id.get();
        let mut up: Vec<String> = app.conn.links.with(|l| {
            l.iter()
                .filter(|(_, x)| x.conn == crate::state::Conn::Online)
                .map(|(h, _)| h.clone())
                .collect()
        });
        up.sort();
        (active, up)
    });
    Effect::new(move |_| {
        online_hosts.track();
        if on.get() {
            refresh_others(others);
        } else {
            others.set(Vec::new());
        }
    });
    let alive = StoredValue::new(true);
    on_cleanup(move || alive.set_value(false));
    fn tick(alive: StoredValue<bool>, on: Memo<bool>, others: Others) {
        set_timeout(
            move || {
                if !alive.try_get_value().unwrap_or(false) {
                    return;
                }
                if on.try_get_untracked().unwrap_or(false) && crate::state::checkout::online() {
                    spawn_local(store().refresh_all());
                    refresh_others(others);
                }
                tick(alive, on, others);
            },
            std::time::Duration::from_millis(REFRESH_MS),
        );
    }
    tick(alive, on, others);
    let other_groups = Memo::new(move |_| {
        let n = needle.get().trim().to_lowercase();
        others.with(|o| {
            o.iter()
                .map(|(h, list)| {
                    let list: Vec<TermInfo> = list
                        .iter()
                        .filter(|x| {
                            n.is_empty()
                                || format!("{} {}", x.title.clone().unwrap_or_default(), x.name)
                                    .to_lowercase()
                                    .contains(&n)
                        })
                        .cloned()
                        .collect();
                    (h.clone(), list)
                })
                .filter(|(_, l)| !l.is_empty())
                .collect::<Vec<_>>()
        })
    });
    let list = Memo::new(move |_| {
        if !on.get() {
            return Vec::new();
        }
        let n = needle.get().trim().to_lowercase();
        t.all
            .get()
            .unwrap_or_default()
            .into_iter()
            .filter(|x| {
                n.is_empty()
                    || format!("{} {}", x.title.clone().unwrap_or_default(), x.name)
                        .to_lowercase()
                        .contains(&n)
            })
            .collect::<Vec<_>>()
    });
    view! {
        <Show when=move || !list.with(Vec::is_empty)>
            <div class="sgroup merged-terms">
                <div class="sgroup-head">
                    <span class="sgroup-text"><span class="t-label">"Terminals"</span></span>
                    <span class="t-mono group-count">{move || list.with(Vec::len)}</span>
                </div>
                <For
                    each=move || list.get()
                    key=|x| x.id.clone()
                    children=move |x| {
                        let id = StoredValue::new(x.id.clone());
                        let on = Signal::derive(move || {
                            app.ui.sessions_terminal().as_deref() == Some(id.get_value().as_str())
                        });
                        view! {
                            <div
                                class="pn-row"
                                class:on=move || on.get()
                                role="button"
                                tabindex="0"
                                on:click=move |_| app.ui.open_session_terminal(Some(id.get_value()))
                            >
                                <Brackets on=on />
                                <Icon ico=Ico::SquareTerminal size=15.0 class="pn-muted" />
                                <div class="pn-row-text">
                                    <span class="pn-row-title">{x.label()}</span>
                                    <span class="pn-row-meta t-mono">{x.name.clone()}</span>
                                </div>
                                <button
                                    class="icon-btn pn-hover"
                                    aria-label="Kill terminal"
                                    on:click=move |e| {
                                        e.stop_propagation();
                                        let id = id.get_value();
                                        if app.ui.sessions_terminal().as_deref() == Some(id.as_str()) {
                                            app.ui.open_session_terminal(None);
                                        }
                                        spawn_local(store().kill(id));
                                    }
                                >
                                    <Icon ico=Ico::X size=14.0 class="faint" />
                                </button>
                            </div>
                        }
                    }
                />
            </div>
        </Show>
        <For
            each=move || other_groups.get()
            key=|(h, l)| (h.clone(), l.iter().map(|x| (x.id.clone(), x.label())).collect::<Vec<_>>())
            children=move |(host, list)| {
                let name = app.hosts.find(&host).map(|h| h.name).unwrap_or_else(|| "Host".into());
                let n = list.len();
                let host = StoredValue::new(host);
                view! {
                    <div class="sgroup merged-terms">
                        <div class="sgroup-head">
                            <span class="sgroup-text"><span class="t-label">{format!("Terminals · {name}")}</span></span>
                            <span class="t-mono group-count">{n}</span>
                        </div>
                        {list
                            .into_iter()
                            .map(|x| {
                                let id = StoredValue::new(x.id.clone());
                                view! {
                                    <div
                                        class="pn-row"
                                        role="button"
                                        tabindex="0"
                                        on:click=move |_| open_on_host(host.get_value(), id.get_value())
                                    >
                                        <Icon ico=Ico::SquareTerminal size=15.0 class="pn-muted" />
                                        <div class="pn-row-text">
                                            <span class="pn-row-title">{x.label()}</span>
                                            <span class="pn-row-meta t-mono">{x.name.clone()}</span>
                                        </div>
                                        <button
                                            class="icon-btn pn-hover"
                                            aria-label="Kill terminal"
                                            on:click=move |e| {
                                                e.stop_propagation();
                                                let (h, id) = (host.get_value(), id.get_value());
                                                let Some(c) = app.conn.client_of(&h) else { return };
                                                others.update(|o| {
                                                    if let Some(x) = o.iter_mut().find(|(x, _)| *x == h) {
                                                        x.1.retain(|t| t.id != id);
                                                    }
                                                });
                                                spawn_local(async move {
                                                    let _ = c.kill_terminal(&id).await;
                                                });
                                            }
                                        >
                                            <Icon ico=Ico::X size=14.0 class="faint" />
                                        </button>
                                    </div>
                                }
                            })
                            .collect_view()}
                    </div>
                }
            }
        />
    }
}
