//! `DiffView`: unified and split diffs with word-level highlights, line numbers, collapsed
//! context and file headers, after ui-next's `DiffView.tsx`. Input is either a unified diff
//! (`parse_unified`) or two texts (`diff_texts`).

mod model;

pub use model::{
    diff_texts, parse_unified, split_rows, word_diff, word_highlights, DiffLine, FileDiff,
    FileStatus, Hunk, LineKind, Seg,
};

use crate::code::tokens_view;
use crate::highlight::highlight;
use leptos::prelude::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DiffMode {
    #[default]
    Unified,
    Split,
}

/// Diffs for one or more files.
#[component]
pub fn DiffView(
    #[prop(into)] files: Signal<Vec<FileDiff>>,
    #[prop(into, optional)] mode: Signal<DiffMode>,
    /// Hide the per-file header (when the host view shows the file name itself).
    #[prop(optional)]
    no_headers: bool,
) -> impl IntoView {
    view! {
        <div class="fr-diff" class:split=move || mode.get() == DiffMode::Split>
            {move || {
                let m = mode.get();
                files
                    .get()
                    .into_iter()
                    .map(|f| file_view(f, m, no_headers))
                    .collect_view()
            }}
        </div>
    }
}

fn file_view(f: FileDiff, mode: DiffMode, no_headers: bool) -> impl IntoView {
    let path = f.path().to_string();
    let (dir, name) = match path.rfind('/') {
        Some(i) => (path[..=i].to_string(), path[i + 1..].to_string()),
        None => (String::new(), path.clone()),
    };
    let (badge, badge_class) = match f.status {
        FileStatus::Added => ("A", "added"),
        FileStatus::Deleted => ("D", "deleted"),
        FileStatus::Renamed => ("R", "renamed"),
        FileStatus::Binary => ("B", "binary"),
        FileStatus::Modified => ("M", "modified"),
    };
    let head = (!no_headers).then(|| {
        let renamed = (f.status == FileStatus::Renamed).then(|| {
            view! { <span class="fr-diff-from">{format!("{} →", f.old_path)}</span> }
        });
        view! {
            <div class="fr-diff-head">
                <span class=format!("fr-diff-badge {badge_class}")>{badge}</span>
                {renamed}
                <span class="fr-diff-path">
                    <span class="fr-diff-dir">{dir}</span>
                    <span class="fr-diff-name">{name}</span>
                </span>
                <span class="fr-diff-stat">
                    <span class="plus">{format!("+{}", f.additions)}</span>
                    " "
                    <span class="minus">{format!("-{}", f.deletions)}</span>
                </span>
            </div>
        }
    });
    let body = if f.status == FileStatus::Binary {
        view! { <div class="fr-diff-note">"binary file"</div> }.into_any()
    } else if f.hunks.is_empty() {
        view! { <div class="fr-diff-note">"no changes"</div> }.into_any()
    } else {
        let f = std::sync::Arc::new(f);
        let mut parts = Vec::new();
        for i in 0..=f.hunks.len() {
            let gap = if i < f.hunks.len() {
                f.gap_before(i)
            } else {
                f.trailing_gap()
            };
            if gap > 0 {
                parts.push(gap_view(f.clone(), i, gap, mode).into_any());
            }
            if let Some(h) = f.hunks.get(i) {
                parts.push(view! { <div class="fr-diff-hunk">{h.header.clone()}</div> }.into_any());
                parts.push(lines_view(&h.lines, &path, mode).into_any());
            }
        }
        parts.collect_view().into_any()
    };
    view! {
        <section class="fr-diff-file">
            {head}
            <div class="fr-diff-body">{body}</div>
        </section>
    }
}

/// A collapsed run of unchanged lines; expands when the old text is known.
fn gap_view(f: std::sync::Arc<FileDiff>, i: usize, n: u32, mode: DiffMode) -> impl IntoView {
    let open = RwSignal::new(false);
    let can_open = f.old_lines.is_some();
    let path = f.path().to_string();
    let label = if n == 1 {
        "1 unchanged line".to_string()
    } else {
        format!("{n} unchanged lines")
    };
    move || {
        if open.get() {
            lines_view(&f.gap_lines(i), &path, mode).into_any()
        } else {
            let label = label.clone();
            view! {
                <button
                    class="fr-diff-gap"
                    disabled=!can_open
                    on:click=move |_| open.set(true)
                >
                    <span class="fr-diff-gap-dots">"⋯"</span>
                    {label}
                </button>
            }
            .into_any()
        }
    }
}

fn lines_view(lines: &[DiffLine], path: &str, mode: DiffMode) -> impl IntoView {
    match mode {
        DiffMode::Unified => lines
            .iter()
            .map(|l| {
                let no = if l.kind == LineKind::Remove { l.old_no } else { l.new_no };
                line_view(Some(l), no, path)
            })
            .collect_view()
            .into_any(),
        DiffMode::Split => split_rows(lines)
            .into_iter()
            .map(|(a, b)| {
                view! {
                    <div class="fr-diff-row">
                        <div class="fr-diff-left">{line_view(a, a.and_then(|l| l.old_no), path)}</div>
                        <div class="fr-diff-right">{line_view(b, b.and_then(|l| l.new_no), path)}</div>
                    </div>
                }
            })
            .collect_view()
            .into_any(),
    }
}

fn line_view(line: Option<&DiffLine>, no: Option<u32>, path: &str) -> impl IntoView {
    let kind = match line.map(|l| l.kind) {
        Some(LineKind::Add) => "add",
        Some(LineKind::Remove) => "remove",
        Some(LineKind::Context) => "context",
        None => "empty",
    };
    let content = line.map(|l| match &l.words {
        Some(segs) => segs
            .iter()
            .map(|s| {
                if s.changed {
                    view! { <mark class="fr-diff-word">{s.text.clone()}</mark> }.into_any()
                } else {
                    s.text.clone().into_any()
                }
            })
            .collect_view()
            .into_any(),
        None => {
            let toks = highlight(&l.text, path)
                .into_iter()
                .next()
                .unwrap_or_default();
            tokens_view(toks).into_any()
        }
    });
    let sign = match kind {
        "add" => "+",
        "remove" => "-",
        _ => " ",
    };
    view! {
        <div class=format!("fr-diff-line {kind}")>
            <span class="fr-diff-no">{no.map(|n| n.to_string()).unwrap_or_default()}</span>
            <span class="fr-diff-sign">{sign}</span>
            <span class="fr-diff-src">{content}</span>
        </div>
    }
}

#[cfg(test)]
mod tests;
