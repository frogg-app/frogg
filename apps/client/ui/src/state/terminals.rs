//! Terminals on the active host (ui-next `daemon/terminals.ts`): one list per watched checkout,
//! kept live through `terminals_changed`, plus the host-wide list.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};

use frogg_client_core::{CreateTerminalOptions, Event};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::Deserialize;

use super::checkout::{detached, err_text};
use super::get;

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct TermInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

impl TermInfo {
    pub fn label(&self) -> String {
        self.title
            .clone()
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| self.name.clone())
    }
}

#[derive(Clone, Copy)]
pub struct Terminals {
    /// The checkout new terminals start in (the open session's).
    pub cwd: RwSignal<Option<String>>,
    /// Terminals per watched checkout.
    pub groups: RwSignal<HashMap<String, Vec<TermInfo>>>,
    /// Every terminal on the host.
    pub all: RwSignal<Option<Vec<TermInfo>>>,
    pub error: RwSignal<Option<String>>,
}

thread_local! {
    static STORE: Cell<Option<Terminals>> = const { Cell::new(None) };
    static WATCHED: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    /// (host id, listener id) of the `terminals_changed` listener.
    static LISTENER: RefCell<Option<(String, u64)>> = const { RefCell::new(None) };
    static GENERATION: Cell<u64> = const { Cell::new(0) };
}

fn reset(t: Terminals) {
    WATCHED.with(|w| w.borrow_mut().clear());
    if let Some((host, id)) = LISTENER.with(|l| l.borrow_mut().take()) {
        if let Some(c) = get().conn.client_of(&host) {
            c.unsubscribe(id);
        }
    }
    GENERATION.with(|g| g.set(g.get() + 1));
    t.cwd.set(None);
    t.groups.set(HashMap::new());
    t.all.set(None);
    t.error.set(None);
}

pub fn store() -> Terminals {
    if let Some(t) = STORE.with(|s| s.get()) {
        return t;
    }
    let t = detached(
        || Terminals {
            cwd: RwSignal::new(None),
            groups: RwSignal::new(HashMap::new()),
            all: RwSignal::new(None),
            error: RwSignal::new(None),
        },
        reset,
    );
    STORE.with(|s| s.set(Some(t)));
    t
}

fn generation() -> u64 {
    GENERATION.with(|g| g.get())
}

fn add(list: &mut Vec<TermInfo>, t: &TermInfo) {
    if !list.iter().any(|x| x.id == t.id) {
        list.push(t.clone());
    }
}

impl Terminals {
    /// Re-reads the host-wide list.
    pub async fn refresh_all(self) {
        let Some(c) = get().conn.client() else { return };
        let mine = generation();
        match c.list_terminals(None, None).await {
            Ok(res) if mine == generation() => {
                let list = res
                    .terminals
                    .into_iter()
                    .map(|t| TermInfo {
                        id: t.id,
                        name: t.name,
                        cwd: None,
                        title: t.title,
                    })
                    .collect();
                self.all.set(Some(list));
            }
            Ok(_) => {}
            Err(e) => self.error.set(Some(err_text(e))),
        }
    }

    /// Watches every given checkout (the open session's first) plus the host-wide list.
    pub fn watch(self, cwds: Vec<String>, active: Option<String>) {
        let app = get();
        let Some(c) = app.conn.client() else { return };
        let Some(host) = app.hosts.active_id.get_untracked() else {
            return;
        };
        self.cwd.set(active);
        let has_listener = LISTENER.with(|l| l.borrow().as_ref().is_some_and(|(h, _)| *h == host));
        if !has_listener {
            let id = c.subscribe(move |e| {
                let Event::Session(f) = e else { return };
                if f.kind != "terminals_changed" {
                    return;
                }
                #[derive(Deserialize)]
                struct P {
                    cwd: String,
                    terminals: Vec<TermInfo>,
                }
                let Ok(p) = f.payload::<P>() else { return };
                if !WATCHED.with(|w| w.borrow().contains(&p.cwd)) {
                    return;
                }
                let t = store();
                t.groups.update(|g| {
                    g.insert(p.cwd, p.terminals);
                });
                spawn_local(t.refresh_all());
            });
            LISTENER.with(|l| *l.borrow_mut() = Some((host, id)));
        }
        let fresh: Vec<String> = cwds
            .into_iter()
            .filter(|cwd| WATCHED.with(|w| w.borrow_mut().insert(cwd.clone())))
            .collect();
        for cwd in &fresh {
            let _ = c.subscribe_terminals(cwd, None);
        }
        let mine = generation();
        spawn_local(self.refresh_all());
        for cwd in fresh {
            let c = c.clone();
            spawn_local(async move {
                match c.list_terminals(Some(&cwd), None).await {
                    Ok(res) if mine == generation() => {
                        let list = res
                            .terminals
                            .into_iter()
                            .map(|t| TermInfo {
                                id: t.id,
                                name: t.name,
                                cwd: Some(cwd.clone()),
                                title: t.title,
                            })
                            .collect();
                        self.groups.update(|g| {
                            g.insert(cwd, list);
                        });
                    }
                    Ok(_) => {}
                    Err(e) => self.error.set(Some(err_text(e))),
                }
            });
        }
    }

    /// Starts a terminal in `cwd`; its id on success.
    pub async fn create(self, cwd: String) -> Option<String> {
        let c = get().conn.client()?;
        match c
            .create_terminal(&cwd, CreateTerminalOptions::default())
            .await
        {
            Ok(res) => {
                if let Some(e) = res.error {
                    self.error.set(Some(e));
                    return None;
                }
                let Ok(t) = serde_json::from_value::<TermInfo>(res.terminal) else {
                    self.error.set(Some("could not start a terminal".into()));
                    return None;
                };
                self.groups
                    .update(|g| add(g.entry(cwd.clone()).or_default(), &t));
                self.all.update(|a| add(a.get_or_insert_with(Vec::new), &t));
                Some(t.id)
            }
            Err(e) => {
                self.error.set(Some(err_text(e)));
                None
            }
        }
    }

    pub async fn kill(self, id: String) {
        let Some(c) = get().conn.client() else { return };
        if let Err(e) = c.kill_terminal(&id).await {
            self.error.set(Some(err_text(e)));
        }
        self.groups.update(|g| {
            for list in g.values_mut() {
                list.retain(|t| t.id != id);
            }
        });
        self.all.update(|a| {
            if let Some(a) = a {
                a.retain(|t| t.id != id);
            }
        });
    }

    /// The terminal with this id, from any list (reactive).
    pub fn find(self, id: &str) -> Option<TermInfo> {
        self.all
            .with(|a| {
                a.as_ref()
                    .and_then(|a| a.iter().find(|t| t.id == id).cloned())
            })
            .or_else(|| {
                self.groups
                    .with(|g| g.values().flatten().find(|t| t.id == id).cloned())
            })
    }
}
