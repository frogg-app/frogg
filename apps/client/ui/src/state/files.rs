//! The Files tree (ui-next `daemon/files.ts`): lazily listed folders under a root (the session's
//! checkout or a typed folder), expansion state, open viewer tabs, entry actions and downloads.

use std::cell::Cell;
use std::collections::{HashMap, HashSet};

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde::{Deserialize, Serialize};

use super::checkout::{detached, err_text};
use super::get;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(default)]
    pub size: f64,
    #[serde(default)]
    pub modified_at: Option<String>,
}

impl Entry {
    pub fn is_dir(&self) -> bool {
        self.kind == "directory"
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Listing {
    Loading,
    Error(String),
    Entries(Vec<Entry>),
}

#[derive(Clone, Copy)]
pub struct Files {
    pub root: RwSignal<Option<String>>,
    pub dirs: RwSignal<HashMap<String, Listing>>,
    pub expanded: RwSignal<HashSet<String>>,
    /// A folder typed into the path field; replaces the checkout as root while set.
    pub browse: RwSignal<Option<String>>,
    /// Open viewer tabs, in order; `preview` is the one a single click opened.
    pub tabs: RwSignal<Vec<String>>,
    pub preview: RwSignal<Option<String>>,
}

thread_local! {
    static STORE: Cell<Option<Files>> = const { Cell::new(None) };
}

fn fresh_expanded() -> HashSet<String> {
    HashSet::from([".".to_owned()])
}

fn reset(f: Files) {
    f.root.set(None);
    f.dirs.set(HashMap::new());
    f.expanded.set(fresh_expanded());
    f.browse.set(None);
    f.tabs.set(Vec::new());
    f.preview.set(None);
}

pub fn store() -> Files {
    if let Some(f) = STORE.with(|s| s.get()) {
        return f;
    }
    let f = detached(
        || Files {
            root: RwSignal::new(None),
            dirs: RwSignal::new(HashMap::new()),
            expanded: RwSignal::new(fresh_expanded()),
            browse: RwSignal::new(None),
            tabs: RwSignal::new(Vec::new()),
            preview: RwSignal::new(None),
        },
        reset,
    );
    STORE.with(|s| s.set(Some(f)));
    f
}

/// Folders first, then by name.
pub fn sort_entries(entries: &mut [Entry]) {
    entries.sort_by(|a, b| {
        b.is_dir()
            .cmp(&a.is_dir())
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

pub fn parent_of(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..i].to_owned(),
        None => ".".to_owned(),
    }
}

fn is_absolute(p: &str) -> bool {
    let b = p.as_bytes();
    p.starts_with('/')
        || p.starts_with('~')
        || p.starts_with("\\\\")
        || (b.len() >= 2
            && b[0].is_ascii_alphabetic()
            && b[1] == b':'
            && (b.len() == 2 || b[2] == b'/' || b[2] == b'\\'))
}

/// Turns what was typed into a path the host can list (ui-next `resolveTypedPath`).
pub fn resolve_typed_path(input: &str, root: Option<&str>) -> Option<String> {
    let p = input.trim().trim_matches(|c| c == '"' || c == '\'');
    if p.is_empty() {
        return None;
    }
    let p = if is_absolute(p) {
        p.to_owned()
    } else {
        let root = root?;
        format!(
            "{}/{}",
            root.trim_end_matches(['/', '\\']),
            p.trim_start_matches("./")
        )
    };
    let trimmed = p.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return Some("/".into());
    }
    let b = trimmed.as_bytes();
    if b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return Some(format!("{trimmed}/"));
    }
    Some(trimmed.to_owned())
}

fn split_parent(abs: &str) -> Option<(String, String)> {
    let i = abs.rfind(['/', '\\'])?;
    if i == abs.len() - 1 {
        return None;
    }
    let parent = if i == 0 {
        "/".to_owned()
    } else {
        abs[..i].to_owned()
    };
    let b = parent.as_bytes();
    let parent = if b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        format!("{parent}/")
    } else {
        parent
    };
    Some((parent, abs[i + 1..].to_owned()))
}

fn entries_of(dir: &serde_json::Value) -> Vec<Entry> {
    let mut v: Vec<Entry> = dir["entries"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|e| serde_json::from_value(e.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    sort_entries(&mut v);
    v
}

/// `success: false` / `error` of an fs response, as an error message.
fn op_error(v: impl Serialize) -> Option<String> {
    let v = serde_json::to_value(v).ok()?;
    if let Some(e) = v["error"].as_str() {
        return Some(e.to_owned());
    }
    (v["success"] == serde_json::Value::Bool(false)).then(|| "failed".to_owned())
}

/// A file read for viewing.
#[derive(Debug, Clone, PartialEq)]
pub struct Doc {
    pub text: Option<String>,
    pub kind: String,
    pub mime: String,
    pub size: u64,
    pub bytes: Vec<u8>,
}

impl Files {
    pub fn set_root(self, root: String) {
        if self.root.get_untracked().as_deref() == Some(&root) {
            return;
        }
        self.root.set(Some(root));
        self.dirs.set(HashMap::new());
        self.expanded.set(fresh_expanded());
        self.tabs.set(Vec::new());
        self.preview.set(None);
        self.load_dir(".".into());
    }

    pub fn load_dir(self, path: String) {
        let (Some(root), Some(c)) = (self.root.get_untracked(), get().conn.client()) else {
            return;
        };
        self.dirs.update(|d| {
            d.insert(path.clone(), Listing::Loading);
        });
        spawn_local(async move {
            let res = c.list_directory(&root, &path).await;
            if self.root.get_untracked().as_deref() != Some(&root) {
                return;
            }
            let l = match res {
                Ok(dir) => Listing::Entries(entries_of(&dir)),
                Err(e) => Listing::Error(err_text(e)),
            };
            self.dirs.update(|d| {
                d.insert(path, l);
            });
        });
    }

    pub fn toggle_dir(self, path: &str) {
        let open = !self.expanded.with_untracked(|e| e.contains(path));
        self.expanded.update(|e| {
            if open {
                e.insert(path.to_owned());
            } else {
                e.remove(path);
            }
        });
        if open && self.dirs.with_untracked(|d| !d.contains_key(path)) {
            self.load_dir(path.to_owned());
        }
    }

    /// Points the tree at a typed path. A folder becomes the root; a file roots the tree at its
    /// folder and is returned so the caller can open it.
    pub async fn jump_to(self, input: String) -> Result<Option<String>, String> {
        let c = get().conn.client().ok_or("not connected")?;
        let abs = resolve_typed_path(&input, self.root.get_untracked().as_deref())
            .ok_or("Type a folder path, like ~/projects or C:/Users")?;
        match c.list_directory(&abs, ".").await {
            Ok(dir) => {
                let root = dir["absolutePath"].as_str().unwrap_or(&abs).to_owned();
                self.browse.set(Some(root.clone()));
                self.set_root(root);
                Ok(None)
            }
            Err(e) => {
                if let Some((parent, name)) = split_parent(&abs) {
                    if let Ok(dir) = c.list_directory(&parent, ".").await {
                        if entries_of(&dir)
                            .iter()
                            .any(|x| x.name == name && !x.is_dir())
                        {
                            let root = dir["absolutePath"].as_str().unwrap_or(&parent).to_owned();
                            self.browse.set(Some(root.clone()));
                            self.set_root(root);
                            return Ok(Some(name));
                        }
                    }
                }
                let msg = err_text(e);
                let low = msg.to_lowercase();
                Err(if low.contains("enoent") || low.contains("no such file") {
                    format!("Nothing at {abs}")
                } else if low.contains("enotdir") {
                    format!("{abs} is not a folder")
                } else if low.contains("eacces") || low.contains("eperm") {
                    format!("No permission to open {abs}")
                } else {
                    msg
                })
            }
        }
    }

    pub async fn read(self, path: String) -> Result<Doc, String> {
        let root = self.root.get_untracked().ok_or("no folder open")?;
        let c = get().conn.client().ok_or("not connected")?;
        let res = c
            .read_file(&root, &path, Some(1_000_000))
            .await
            .map_err(err_text)?;
        let text = (res.kind == "text" && res.bytes.len() as u64 >= res.size)
            .then(|| String::from_utf8_lossy(&res.bytes).into_owned());
        Ok(Doc {
            text,
            kind: res.kind,
            mime: res.mime,
            size: res.size,
            bytes: res.bytes,
        })
    }

    /// Reads a file whole, or zips a folder, for saving on this device: (name, mime, bytes).
    pub async fn fetch_download(
        self,
        path: String,
        dir: bool,
    ) -> Result<(String, String, Vec<u8>), String> {
        let root = self.root.get_untracked().ok_or("no folder open")?;
        let c = get().conn.client().ok_or("not connected")?;
        let base = super::checkout::base_name(if path == "." { &root } else { &path });
        let base = if base.is_empty() {
            "file".to_owned()
        } else {
            base
        };
        if !dir {
            let res = c.read_file(&root, &path, None).await.map_err(err_text)?;
            let mime = if res.mime.is_empty() {
                "application/octet-stream".to_owned()
            } else {
                res.mime
            };
            return Ok((base, mime, res.bytes));
        }
        if !c.has_feature("directoryZip") {
            return Err("Update the host's daemon to download folders.".into());
        }
        let res = c
            .zip_directory(&root, &path, false)
            .await
            .map_err(err_text)?;
        if let Some(e) = res.payload.error {
            return Err(e);
        }
        let bytes = res.bytes.ok_or("The folder could not be zipped.")?;
        Ok((
            res.payload
                .file_name
                .unwrap_or_else(|| format!("{base}.zip")),
            "application/zip".into(),
            bytes,
        ))
    }

    async fn op<F, Fut, T>(self, parent: String, f: F) -> Option<String>
    where
        F: FnOnce(frogg_client_core::DaemonClient, String) -> Fut,
        Fut: std::future::Future<Output = frogg_client_core::Result<T>>,
        T: Serialize,
    {
        let (Some(root), Some(c)) = (self.root.get_untracked(), get().conn.client()) else {
            return Some("not connected".into());
        };
        let res = f(c, root).await;
        self.load_dir(parent);
        match res {
            Ok(v) => op_error(v),
            Err(e) => Some(err_text(e)),
        }
    }

    pub async fn create(self, parent: String, name: String, kind: &'static str) -> Option<String> {
        let p = parent.clone();
        self.op(parent, move |c, root| async move {
            c.create_file_entry(&root, &p, &name, kind).await
        })
        .await
    }

    pub async fn rename(self, path: String, name: String) -> Option<String> {
        self.op(parent_of(&path), move |c, root| async move {
            c.rename_file_entry(&root, &path, &name).await
        })
        .await
    }

    pub async fn duplicate(self, path: String) -> Option<String> {
        self.op(parent_of(&path), move |c, root| async move {
            c.duplicate_file_entry(&root, &path).await
        })
        .await
    }

    pub async fn delete(self, path: String) -> Option<String> {
        let p = path.clone();
        let err = self
            .op(parent_of(&path), move |c, root| async move {
                c.delete_file_entry(&root, &p).await
            })
            .await;
        if err.is_none() {
            self.close_tabs(&[path]);
        }
        err
    }

    /// Opens `path` in the preview slot, replacing the previous preview.
    pub fn preview_tab(self, path: &str) {
        if self.tabs.with_untracked(|t| t.iter().any(|p| p == path)) {
            return;
        }
        let prev = self.preview.get_untracked();
        self.tabs.update(
            |t| match prev.and_then(|p| t.iter().position(|x| *x == p)) {
                Some(i) => t[i] = path.to_owned(),
                None => t.push(path.to_owned()),
            },
        );
        self.preview.set(Some(path.to_owned()));
    }

    /// Keeps a preview tab open.
    pub fn pin_tab(self, path: &str) {
        if self.preview.get_untracked().as_deref() == Some(path) {
            self.preview.set(None);
        }
    }

    pub fn close_tabs(self, paths: &[String]) {
        self.tabs.update(|t| t.retain(|p| !paths.contains(p)));
        if self
            .preview
            .get_untracked()
            .is_some_and(|p| paths.contains(&p))
        {
            self.preview.set(None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_paths() {
        assert_eq!(resolve_typed_path("~/x/", None).as_deref(), Some("~/x"));
        assert_eq!(resolve_typed_path("/", None).as_deref(), Some("/"));
        assert_eq!(resolve_typed_path("C:", None).as_deref(), Some("C:/"));
        assert_eq!(
            resolve_typed_path("src", Some("/r/")).as_deref(),
            Some("/r/src")
        );
        assert_eq!(resolve_typed_path("src", None), None);
        assert_eq!(resolve_typed_path("  ", Some("/r")), None);
        assert_eq!(split_parent("/a/b"), Some(("/a".into(), "b".into())));
        assert_eq!(split_parent("/a"), Some(("/".into(), "a".into())));
        assert_eq!(parent_of("a/b/c"), "a/b");
        assert_eq!(parent_of("a"), ".");
    }
}
