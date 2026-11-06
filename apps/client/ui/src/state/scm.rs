//! Source control for the active checkout (ui-next `daemon/scm.ts`): status, the live diff
//! (`subscribe_checkout_diff` + `checkout_diff_update`), and the git actions the panel offers.

use std::cell::{Cell, RefCell};

use frogg_client_core::{DaemonClient, Event};
use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::checkout::{detached, err_text};
use super::get;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: f64,
    pub old_count: f64,
    pub new_start: f64,
    pub new_count: f64,
    #[serde(default)]
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    #[serde(default)]
    pub old_path: Option<String>,
    #[serde(default)]
    pub is_new: bool,
    #[serde(default)]
    pub is_deleted: bool,
    #[serde(default)]
    pub additions: f64,
    #[serde(default)]
    pub deletions: f64,
    #[serde(default)]
    pub hunks: Vec<DiffHunk>,
}

impl DiffFile {
    /// The change letter and its tint class.
    pub fn mark(&self) -> (&'static str, &'static str) {
        if self.is_new {
            ("A", "mint")
        } else if self.is_deleted {
            ("D", "coral")
        } else {
            ("M", "amber")
        }
    }

    /// As a unified diff, for frogg-render's parser.
    pub fn to_unified(&self) -> String {
        let old = self.old_path.as_deref().unwrap_or(&self.path);
        let mut s = format!("diff --git a/{old} b/{}\n", self.path);
        if self.is_new {
            s.push_str("new file mode 100644\n--- /dev/null\n");
        } else {
            s.push_str(&format!("--- a/{old}\n"));
        }
        if self.is_deleted {
            s.push_str("+++ /dev/null\n");
        } else {
            s.push_str(&format!("+++ b/{}\n", self.path));
        }
        for h in &self.hunks {
            s.push_str(&format!(
                "@@ -{},{} +{},{} @@\n",
                h.old_start as u64, h.old_count as u64, h.new_start as u64, h.new_count as u64
            ));
            for l in &h.lines {
                let prefix = match l.kind.as_str() {
                    "add" => '+',
                    "remove" => '-',
                    "header" => continue,
                    _ => ' ',
                };
                s.push(prefix);
                s.push_str(l.content.trim_end_matches('\n'));
                s.push('\n');
            }
        }
        s
    }
}

/// `checkout_status_response` payload, the fields the panel reads.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(default)]
    pub is_git: bool,
    #[serde(default)]
    pub current_branch: Option<String>,
    #[serde(default)]
    pub base_ref: Option<String>,
    #[serde(default)]
    pub ahead_behind: Option<AheadBehind>,
    #[serde(default)]
    pub ahead_of_origin: Option<f64>,
    #[serde(default)]
    pub has_remote: bool,
    #[serde(default)]
    pub is_dirty: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct AheadBehind {
    #[serde(default)]
    pub ahead: f64,
    #[serde(default)]
    pub behind: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Commit {
    pub sha: String,
    pub subject: String,
    pub when: String,
    /// For the commit graph: author, whether it is on the base branch and on the remote.
    pub author: String,
    pub on_base: bool,
    pub on_remote: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Stash {
    pub index: u32,
    pub message: String,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrSummary {
    pub number: Option<u64>,
    pub url: String,
    pub title: String,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Branch {
    pub name: String,
    pub ahead: Option<f64>,
    pub behind: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Compare {
    Uncommitted,
    Base,
}

impl Compare {
    fn id(self) -> &'static str {
        match self {
            Compare::Uncommitted => "uncommitted",
            Compare::Base => "base",
        }
    }
}

#[derive(Clone, Copy)]
pub struct Scm {
    pub cwd: RwSignal<Option<String>>,
    pub compare: RwSignal<Compare>,
    pub status: RwSignal<Option<Status>>,
    pub files: RwSignal<Option<Vec<DiffFile>>>,
    pub busy: RwSignal<Option<&'static str>>,
    pub error: RwSignal<Option<String>>,
    pub commits: RwSignal<Option<Vec<Commit>>>,
    pub stashes: RwSignal<Option<Vec<Stash>>>,
    pub branches: RwSignal<Option<Vec<Branch>>>,
    /// `None` = not loaded, `Some(None)` = no PR.
    pub pr: RwSignal<Option<Option<PrSummary>>>,
}

thread_local! {
    static STORE: Cell<Option<Scm>> = const { Cell::new(None) };
    static SUB_ID: RefCell<Option<String>> = const { RefCell::new(None) };
    static LISTENER: RefCell<Option<(String, u64)>> = const { RefCell::new(None) };
    static COMPARE_CHOSEN: Cell<bool> = const { Cell::new(false) };
    static SEQ: Cell<u64> = const { Cell::new(0) };
}

fn reset(s: Scm) {
    SUB_ID.with(|x| *x.borrow_mut() = None);
    if let Some((host, id)) = LISTENER.with(|l| l.borrow_mut().take()) {
        if let Some(c) = get().conn.client_of(&host) {
            c.unsubscribe(id);
        }
    }
    COMPARE_CHOSEN.with(|c| c.set(false));
    s.cwd.set(None);
    s.status.set(None);
    s.files.set(None);
    s.error.set(None);
    s.commits.set(None);
    s.stashes.set(None);
    s.branches.set(None);
    s.pr.set(None);
}

pub fn store() -> Scm {
    if let Some(s) = STORE.with(|s| s.get()) {
        return s;
    }
    let s = detached(
        || Scm {
            cwd: RwSignal::new(None),
            compare: RwSignal::new(Compare::Uncommitted),
            status: RwSignal::new(None),
            files: RwSignal::new(None),
            busy: RwSignal::new(None),
            error: RwSignal::new(None),
            commits: RwSignal::new(None),
            stashes: RwSignal::new(None),
            branches: RwSignal::new(None),
            pr: RwSignal::new(None),
        },
        reset,
    );
    STORE.with(|x| x.set(Some(s)));
    s
}

/// A response's error message: `error` as a string or `{ message }`.
fn error_of(v: &Value) -> Option<String> {
    match &v["error"] {
        Value::String(s) => Some(s.clone()),
        Value::Object(o) => Some(
            o.get("message")
                .and_then(Value::as_str)
                .unwrap_or("failed")
                .to_owned(),
        ),
        _ => None,
    }
}

fn to_value<T: Serialize>(r: frogg_client_core::Result<T>) -> Result<Value, String> {
    r.map_err(err_text)
        .and_then(|v| serde_json::to_value(v).map_err(err_text))
}

fn parse_status(v: &Value) -> Option<Status> {
    serde_json::from_value(v.clone()).ok()
}

fn ahead_of_base(s: &Option<Status>) -> bool {
    s.as_ref().is_some_and(|s| {
        s.is_git && s.base_ref.is_some() && s.ahead_behind.as_ref().is_some_and(|a| a.ahead > 0.0)
    })
}

impl Scm {
    /// Current branch, when the checkout is a git repository (reactive).
    pub fn branch(self) -> Option<String> {
        self.status.with(|s| {
            s.as_ref()
                .filter(|s| s.is_git)
                .and_then(|s| s.current_branch.clone())
        })
    }

    /// Points source control at a checkout and keeps its diff live (uncommitted changes, or the
    /// branch against its base when the tree is clean and the branch is ahead).
    pub fn watch(self, cwd: String) {
        let compare = self.compare.get_untracked();
        self.watch_with(cwd, compare, false);
    }

    fn watch_with(self, cwd: String, compare: Compare, force: bool) {
        let app = get();
        let Some(c) = app.conn.client() else { return };
        let Some(host) = app.hosts.active_id.get_untracked() else {
            return;
        };
        let has_sub = SUB_ID.with(|s| s.borrow().is_some());
        if !force
            && self.cwd.get_untracked().as_deref() == Some(&cwd)
            && self.compare.get_untracked() == compare
            && has_sub
            && self.files.with_untracked(|f| f.is_some())
        {
            return;
        }
        if self.cwd.get_untracked().as_deref() != Some(&cwd) {
            COMPARE_CHOSEN.with(|x| x.set(false));
            self.commits.set(None);
            self.stashes.set(None);
            self.pr.set(None);
        }
        if let Some(old) = SUB_ID.with(|s| s.borrow_mut().take()) {
            let _ = c.unsubscribe_checkout_diff(&old);
        }
        let mine = SEQ.with(|s| {
            s.set(s.get() + 1);
            format!(
                "rs-scm-{}-{}",
                s.get(),
                (js_sys::Math::random() * 1e9) as u64
            )
        });
        SUB_ID.with(|s| *s.borrow_mut() = Some(mine.clone()));
        self.cwd.set(Some(cwd.clone()));
        self.compare.set(compare);
        self.files.set(None);
        self.error.set(None);
        let listening = LISTENER.with(|l| l.borrow().as_ref().is_some_and(|(h, _)| *h == host));
        if !listening {
            let id = c.subscribe(move |e| {
                let Event::Session(f) = e else { return };
                if f.kind != "checkout_diff_update" {
                    return;
                }
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    subscription_id: String,
                    #[serde(default)]
                    files: Vec<DiffFile>,
                }
                let Ok(p) = f.payload::<P>() else { return };
                if SUB_ID.with(|s| s.borrow().as_deref() != Some(p.subscription_id.as_str())) {
                    return;
                }
                let s = store();
                s.files.set(Some(p.files));
                spawn_local(s.refresh_status());
            });
            LISTENER.with(|l| *l.borrow_mut() = Some((host, id)));
        }
        spawn_local(async move {
            let status = c.get_checkout_status(&cwd).await;
            let diff = c
                .subscribe_checkout_diff(&cwd, json!({ "mode": compare.id() }), Some(mine.clone()))
                .await;
            if SUB_ID.with(|s| s.borrow().as_deref() != Some(mine.as_str())) {
                return;
            }
            match (status.map_err(err_text), to_value(diff)) {
                (Ok(st), Ok(d)) => {
                    let st = parse_status(&st);
                    let files: Vec<DiffFile> =
                        serde_json::from_value(d["files"].clone()).unwrap_or_default();
                    let empty = files.is_empty();
                    self.status.set(st.clone());
                    self.files.set(Some(files));
                    self.error.set(error_of(&d));
                    if compare == Compare::Uncommitted
                        && !COMPARE_CHOSEN.with(|x| x.get())
                        && empty
                        && ahead_of_base(&st)
                    {
                        self.watch_with(cwd, Compare::Base, true);
                        return;
                    }
                    self.load_extras();
                }
                (Err(e), _) | (_, Err(e)) => {
                    SUB_ID.with(|s| *s.borrow_mut() = None);
                    self.files.set(Some(Vec::new()));
                    self.error.set(Some(err_text(e)));
                }
            }
        });
    }

    pub fn refresh(self) {
        if let Some(c) = self.cwd.get_untracked() {
            let compare = self.compare.get_untracked();
            self.watch_with(c, compare, true);
        }
    }

    pub fn set_compare(self, compare: Compare) {
        COMPARE_CHOSEN.with(|x| x.set(true));
        if let Some(c) = self.cwd.get_untracked() {
            self.watch_with(c, compare, true);
        }
    }

    pub async fn refresh_status(self) {
        let (Some(cwd), Some(c)) = (self.cwd.get_untracked(), get().conn.client()) else {
            return;
        };
        if let Ok(v) = c.get_checkout_status(&cwd).await {
            if self.cwd.get_untracked().as_deref() == Some(&cwd) {
                self.status.set(parse_status(&v));
            }
        }
    }

    /// Session commits, stashes and the branch's pull request.
    pub fn load_extras(self) {
        let (Some(cwd), Some(c)) = (self.cwd.get_untracked(), get().conn.client()) else {
            return;
        };
        spawn_local(async move {
            let commits = to_value(c.list_checkout_commits(&cwd).await).ok();
            let stashes = to_value(c.stash_list(&cwd, None).await).ok();
            let pr = to_value(c.checkout_pr_status(&cwd).await).ok();
            if self.cwd.get_untracked().as_deref() != Some(&cwd) {
                return;
            }
            let commits = commits
                .and_then(|v| v["commits"].as_array().cloned())
                .unwrap_or_default()
                .iter()
                .map(|c| Commit {
                    sha: c["shortSha"]
                        .as_str()
                        .or(c["sha"].as_str())
                        .map(|s| s.chars().take(7).collect())
                        .unwrap_or_default(),
                    subject: c["subject"]
                        .as_str()
                        .or(c["message"].as_str())
                        .unwrap_or_default()
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .to_owned(),
                    when: c["relativeDate"]
                        .as_str()
                        .or(c["date"].as_str())
                        .or(c["authorDate"].as_str())
                        .unwrap_or_default()
                        .to_owned(),
                    author: c["authorName"].as_str().unwrap_or_default().to_owned(),
                    on_base: c["isOnBase"].as_bool().unwrap_or(false),
                    on_remote: c["isOnRemote"].as_bool().unwrap_or(true),
                })
                .collect();
            let stashes = stashes
                .and_then(|v| v["entries"].as_array().cloned())
                .unwrap_or_default()
                .iter()
                .map(|s| Stash {
                    index: s["index"].as_u64().unwrap_or(0) as u32,
                    message: s["message"].as_str().unwrap_or_default().to_owned(),
                    branch: s["branch"].as_str().map(str::to_owned),
                })
                .collect();
            let pr = pr.and_then(|v| {
                let s = v.get("status")?.clone();
                if s.is_null() {
                    return None;
                }
                let merged = s["isMerged"].as_bool().unwrap_or(false);
                Some(PrSummary {
                    number: s["number"].as_u64(),
                    url: s["url"].as_str().unwrap_or_default().to_owned(),
                    title: s["title"].as_str().unwrap_or_default().to_owned(),
                    state: if merged {
                        "merged".into()
                    } else {
                        s["state"].as_str().unwrap_or_default().to_lowercase()
                    },
                })
            });
            self.commits.set(Some(commits));
            self.stashes.set(Some(stashes));
            self.pr.set(Some(pr));
        });
    }

    /// Local and remote branches, most recently committed first.
    pub fn load_branches(self, query: Option<String>) {
        let (Some(cwd), Some(c)) = (self.cwd.get_untracked(), get().conn.client()) else {
            return;
        };
        spawn_local(async move {
            let Ok(v) = to_value(
                c.get_branch_suggestions(&cwd, query.as_deref(), Some(40))
                    .await,
            ) else {
                return;
            };
            let list = match v["branchDetails"].as_array() {
                Some(d) => d
                    .iter()
                    .map(|d| Branch {
                        name: d["name"].as_str().unwrap_or_default().to_owned(),
                        ahead: d["localAhead"].as_f64(),
                        behind: d["localBehind"].as_f64(),
                    })
                    .collect(),
                None => v["branches"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(Value::as_str)
                            .map(|n| Branch {
                                name: n.to_owned(),
                                ahead: None,
                                behind: None,
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            };
            self.branches.set(Some(list));
        });
    }

    /// Runs a git action with a busy label; errors land in `error`.
    fn act<F, Fut>(self, label: &'static str, f: F)
    where
        F: FnOnce(DaemonClient, String) -> Fut + 'static,
        Fut: std::future::Future<Output = Result<Value, String>> + 'static,
    {
        let (Some(cwd), Some(c)) = (self.cwd.get_untracked(), get().conn.client()) else {
            return;
        };
        self.busy.set(Some(label));
        self.error.set(None);
        spawn_local(async move {
            match f(c, cwd).await {
                Ok(v) => self.error.set(error_of(&v)),
                Err(e) => self.error.set(Some(e)),
            }
            self.busy.set(None);
            self.refresh_status().await;
            self.load_extras();
        });
    }

    pub fn commit(self, message: String, then_push: bool) {
        self.act("commit", move |c, cwd| async move {
            let v = to_value(c.checkout_commit(&cwd, Some(&message), Some(true)).await)?;
            if !then_push || error_of(&v).is_some() {
                return Ok(v);
            }
            to_value(c.checkout_push(&cwd).await)
        });
    }

    pub fn pull(self) {
        self.act("pull", |c, cwd| async move {
            to_value(c.checkout_pull(&cwd).await)
        });
    }

    pub fn push(self) {
        self.act("push", |c, cwd| async move {
            to_value(c.checkout_push(&cwd).await)
        });
    }

    pub fn pull_and_push(self) {
        self.act("pull", |c, cwd| async move {
            let v = to_value(c.checkout_pull(&cwd).await)?;
            if error_of(&v).is_some() {
                return Ok(v);
            }
            to_value(c.checkout_push(&cwd).await)
        });
    }

    pub fn switch_branch(self, branch: String, stash_first: bool) {
        self.act("switch", move |c, cwd| async move {
            if stash_first {
                let v = to_value(c.stash_save(&cwd, None).await)?;
                if error_of(&v).is_some() {
                    return Ok(v);
                }
            }
            to_value(c.checkout_switch_branch(&cwd, &branch).await)
        });
    }

    pub fn stash_save(self) {
        self.act("stash", |c, cwd| async move {
            to_value(c.stash_save(&cwd, None).await)
        });
    }

    pub fn stash_pop(self, index: u32) {
        self.act("stash", move |c, cwd| async move {
            to_value(c.stash_pop(&cwd, index).await)
        });
    }

    pub fn discard(self, paths: Vec<String>) {
        self.act("discard", move |c, cwd| async move {
            to_value(c.checkout_discard_changes(&cwd, &paths).await)
        });
    }

    pub fn merge_from_base(self) {
        self.act("merge", |c, cwd| async move {
            to_value(c.checkout_merge_from_base(&cwd, None, None).await)
        });
    }

    pub fn merge_into_base(self) {
        self.act("merge", |c, cwd| async move {
            to_value(
                c.checkout_merge(&cwd, None, Some("merge"), Some(true))
                    .await,
            )
        });
    }

    pub fn create_pr(self) {
        self.act("pr", |c, cwd| async move {
            to_value(c.checkout_pr_create(&cwd, None, None, None).await)
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unified_round_trips_through_the_renderer() {
        let f: DiffFile = serde_json::from_value(json!({
            "path": "a.txt", "isNew": false, "isDeleted": false, "additions": 1, "deletions": 1,
            "hunks": [{ "oldStart": 1, "oldCount": 2, "newStart": 1, "newCount": 2, "lines": [
                { "type": "header", "content": "@@ -1,2 +1,2 @@" },
                { "type": "context", "content": "same" },
                { "type": "remove", "content": "old" },
                { "type": "add", "content": "new" }
            ]}]
        }))
        .unwrap();
        let parsed = frogg_render::parse_unified(&f.to_unified());
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].additions, 1);
        assert_eq!(parsed[0].deletions, 1);
        assert_eq!(parsed[0].hunks[0].lines.len(), 3);
        assert_eq!(f.mark(), ("M", "amber"));
    }
}
