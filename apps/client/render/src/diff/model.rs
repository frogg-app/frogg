//! Diff model: parse unified diffs or diff two texts (`similar`), with word-level highlights
//! for paired removed/added lines.

use similar::{ChangeTag, TextDiff};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum LineKind {
    Context,
    Add,
    Remove,
}

/// A piece of a changed line; `changed` pieces get the word highlight.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Seg {
    pub text: String,
    pub changed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct DiffLine {
    pub kind: LineKind,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String,
    /// Word-level split, when this line pairs with a similar line on the other side.
    pub words: Option<Vec<Seg>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Hunk {
    /// The `@@ … @@` line (with any section heading).
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Binary,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct FileDiff {
    pub old_path: String,
    pub new_path: String,
    pub status: FileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<Hunk>,
    /// The old file's lines, when known (diffs built from texts), so collapsed context
    /// between hunks can expand.
    pub old_lines: Option<Vec<String>>,
}

impl FileDiff {
    /// The path to show (the new one unless deleted).
    pub fn path(&self) -> &str {
        if self.status == FileStatus::Deleted || self.new_path.is_empty() {
            &self.old_path
        } else {
            &self.new_path
        }
    }

    /// Unchanged lines hidden before hunk `i` (old-side count). For the last gap, see
    /// [`FileDiff::trailing_gap`].
    pub fn gap_before(&self, i: usize) -> u32 {
        let start = self.hunks[i].old_start;
        let prev_end = if i == 0 {
            1
        } else {
            hunk_old_end(&self.hunks[i - 1])
        };
        // An empty old side (pure addition) reports start 0.
        start.saturating_sub(prev_end)
    }

    /// The hidden context lines of gap `i` (before hunk `i`; `hunks.len()` is the trailing
    /// gap), when the old text is known.
    pub fn gap_lines(&self, i: usize) -> Vec<DiffLine> {
        let Some(old) = &self.old_lines else {
            return Vec::new();
        };
        let (from, to, shift) = if i < self.hunks.len() {
            let h = &self.hunks[i];
            let from = if i == 0 {
                1
            } else {
                hunk_old_end(&self.hunks[i - 1])
            };
            (from, h.old_start, h.new_start as i64 - h.old_start as i64)
        } else if let Some(h) = self.hunks.last() {
            let old_end = hunk_old_end(h);
            let new_n = h
                .lines
                .iter()
                .filter(|l| l.kind != LineKind::Remove)
                .count() as u32;
            let new_end = h.new_start.max(1) + new_n;
            (
                old_end,
                old.len() as u32 + 1,
                new_end as i64 - old_end as i64,
            )
        } else {
            return Vec::new();
        };
        (from..to)
            .filter_map(|no| {
                let text = old.get(no as usize - 1)?;
                Some(DiffLine {
                    kind: LineKind::Context,
                    old_no: Some(no),
                    new_no: Some((no as i64 + shift) as u32),
                    text: text.clone(),
                    words: None,
                })
            })
            .collect()
    }

    /// Unchanged lines after the last hunk, when the old text is known.
    pub fn trailing_gap(&self) -> u32 {
        match (&self.old_lines, self.hunks.last()) {
            (Some(lines), Some(h)) => (lines.len() as u32 + 1).saturating_sub(hunk_old_end(h)),
            _ => 0,
        }
    }
}

/// The old-side line number just past a hunk.
fn hunk_old_end(h: &Hunk) -> u32 {
    let n = h.lines.iter().filter(|l| l.kind != LineKind::Add).count() as u32;
    h.old_start.max(1) + n
}

fn strip_prefix_path(p: &str) -> String {
    let p = p
        .trim_end_matches('\t')
        .split('\t')
        .next()
        .unwrap_or(p)
        .trim();
    if p == "/dev/null" {
        return String::new();
    }
    p.strip_prefix("a/")
        .or_else(|| p.strip_prefix("b/"))
        .unwrap_or(p)
        .to_string()
}

/// `@@ -a,b +c,d @@` → (a, b, c, d); a missing count is 1.
fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    let rest = line.strip_prefix("@@ ")?;
    let mut parts = rest.split_whitespace();
    let old = parts.next()?.strip_prefix('-')?;
    let new = parts.next()?.strip_prefix('+')?;
    let range = |s: &str| -> Option<(u32, u32)> {
        let mut it = s.split(',');
        let start = it.next()?.parse().ok()?;
        let len = match it.next() {
            Some(l) => l.parse().ok()?,
            None => 1,
        };
        Some((start, len))
    };
    let (a, b) = range(old)?;
    let (c, d) = range(new)?;
    Some((a, b, c, d))
}

fn empty_file() -> FileDiff {
    FileDiff {
        old_path: String::new(),
        new_path: String::new(),
        status: FileStatus::Modified,
        additions: 0,
        deletions: 0,
        hunks: Vec::new(),
        old_lines: None,
    }
}

/// Parses a unified diff (git or plain) into files. Hunk bodies are bounded by the header
/// counts, so removed lines that look like headers (`--- x`) stay in their hunk.
pub fn parse_unified(text: &str) -> Vec<FileDiff> {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut cur: Option<FileDiff> = None;
    let (mut o, mut n) = (0u32, 0u32);
    // Lines left in the current hunk, old and new side.
    let (mut left_old, mut left_new) = (0u32, 0u32);
    let mut lines = text.lines().peekable();
    while let Some(line) = lines.next() {
        if line.starts_with('\\') {
            continue; // "\ No newline at end of file"
        }
        if left_old > 0 || left_new > 0 {
            let f = cur.as_mut().expect("hunk has a file");
            let h = f.hunks.last_mut().expect("hunk");
            let (kind, body) = match line.as_bytes().first() {
                Some(b'+') => (LineKind::Add, &line[1..]),
                Some(b'-') => (LineKind::Remove, &line[1..]),
                Some(b' ') => (LineKind::Context, &line[1..]),
                _ => (LineKind::Context, line),
            };
            let (old_no, new_no) = match kind {
                LineKind::Add => {
                    n += 1;
                    left_new = left_new.saturating_sub(1);
                    f.additions += 1;
                    (None, Some(n - 1))
                }
                LineKind::Remove => {
                    o += 1;
                    left_old = left_old.saturating_sub(1);
                    f.deletions += 1;
                    (Some(o - 1), None)
                }
                LineKind::Context => {
                    o += 1;
                    n += 1;
                    left_old = left_old.saturating_sub(1);
                    left_new = left_new.saturating_sub(1);
                    (Some(o - 1), Some(n - 1))
                }
            };
            h.lines.push(DiffLine {
                kind,
                old_no,
                new_no,
                text: body.to_string(),
                words: None,
            });
            continue;
        }
        if let Some(rest) = line.strip_prefix("diff --git ") {
            files.extend(cur.take());
            let mut f = empty_file();
            // "a/x b/y": split at " b/".
            if let Some(i) = rest.find(" b/") {
                f.old_path = strip_prefix_path(&rest[..i]);
                f.new_path = strip_prefix_path(&rest[i + 1..]);
            }
            cur = Some(f);
            continue;
        }
        if line.starts_with("--- ") && lines.peek().is_some_and(|l| l.starts_with("+++ ")) {
            let next = lines.next().unwrap_or_default();
            if cur.as_ref().is_none_or(|f| !f.hunks.is_empty()) {
                files.extend(cur.take());
                cur = Some(empty_file());
            }
            let f = cur.as_mut().expect("file");
            let old = strip_prefix_path(&line[4..]);
            let new = strip_prefix_path(&next[4..]);
            if old.is_empty() {
                f.status = FileStatus::Added;
            } else if new.is_empty() {
                f.status = FileStatus::Deleted;
            }
            if !old.is_empty() {
                f.old_path = old;
            }
            if !new.is_empty() {
                f.new_path = new;
            }
            continue;
        }
        if let Some((a, b, c, d)) = parse_hunk_header(line) {
            let f = cur.get_or_insert_with(empty_file);
            f.hunks.push(Hunk {
                header: line.to_string(),
                old_start: a,
                new_start: c,
                lines: Vec::new(),
            });
            (o, n, left_old, left_new) = (a.max(1), c.max(1), b, d);
            continue;
        }
        let Some(f) = cur.as_mut() else { continue };
        if line.starts_with("new file mode") {
            f.status = FileStatus::Added;
        } else if line.starts_with("deleted file mode") {
            f.status = FileStatus::Deleted;
        } else if let Some(p) = line.strip_prefix("rename from ") {
            f.status = FileStatus::Renamed;
            f.old_path = p.to_string();
        } else if let Some(p) = line.strip_prefix("rename to ") {
            f.new_path = p.to_string();
        } else if line.starts_with("Binary files") || line.starts_with("GIT binary patch") {
            f.status = FileStatus::Binary;
        }
    }
    files.extend(cur);
    for f in &mut files {
        for h in &mut f.hunks {
            word_highlights(&mut h.lines);
        }
    }
    files
}

/// Diffs two texts into one file with `context` lines around each change.
pub fn diff_texts(old: &str, new: &str, path: &str, context: usize) -> FileDiff {
    let diff = TextDiff::from_lines(old, new);
    let mut hunks = Vec::new();
    let (mut adds, mut dels) = (0, 0);
    for group in diff.grouped_ops(context) {
        let (Some(first), Some(last)) = (group.first(), group.last()) else {
            continue;
        };
        let old_range = first.old_range().start..last.old_range().end;
        let new_range = first.new_range().start..last.new_range().end;
        let mut lines = Vec::new();
        for op in &group {
            for ch in diff.iter_changes(op) {
                let text = ch.value().trim_end_matches(['\n', '\r']).to_string();
                let kind = match ch.tag() {
                    ChangeTag::Equal => LineKind::Context,
                    ChangeTag::Insert => {
                        adds += 1;
                        LineKind::Add
                    }
                    ChangeTag::Delete => {
                        dels += 1;
                        LineKind::Remove
                    }
                };
                lines.push(DiffLine {
                    kind,
                    old_no: ch.old_index().map(|i| i as u32 + 1),
                    new_no: ch.new_index().map(|i| i as u32 + 1),
                    text,
                    words: None,
                });
            }
        }
        word_highlights(&mut lines);
        let os = if old_range.is_empty() {
            old_range.start as u32
        } else {
            old_range.start as u32 + 1
        };
        let ns = if new_range.is_empty() {
            new_range.start as u32
        } else {
            new_range.start as u32 + 1
        };
        hunks.push(Hunk {
            header: format!(
                "@@ -{},{} +{},{} @@",
                os,
                old_range.len(),
                ns,
                new_range.len()
            ),
            old_start: os,
            new_start: ns,
            lines,
        });
    }
    let status = if old.is_empty() && !new.is_empty() {
        FileStatus::Added
    } else if new.is_empty() && !old.is_empty() {
        FileStatus::Deleted
    } else {
        FileStatus::Modified
    };
    FileDiff {
        old_path: path.into(),
        new_path: path.into(),
        status,
        additions: adds,
        deletions: dels,
        hunks,
        old_lines: Some(old.lines().map(str::to_string).collect()),
    }
}

/// Below this similarity a pair of lines is shown whole, not word by word.
const MIN_RATIO: f32 = 0.4;

/// Pairs each run of removals with the additions that follow it and marks changed words.
pub fn word_highlights(lines: &mut [DiffLine]) {
    let mut i = 0;
    while i < lines.len() {
        if lines[i].kind != LineKind::Remove {
            i += 1;
            continue;
        }
        let rs = i;
        while i < lines.len() && lines[i].kind == LineKind::Remove {
            i += 1;
        }
        let as_ = i;
        while i < lines.len() && lines[i].kind == LineKind::Add {
            i += 1;
        }
        let pairs = (as_ - rs).min(i - as_);
        for k in 0..pairs {
            if let Some((o, n)) = word_diff(&lines[rs + k].text, &lines[as_ + k].text) {
                lines[rs + k].words = Some(o);
                lines[as_ + k].words = Some(n);
            }
        }
    }
}

/// Word-level segments of a changed pair, or `None` when the lines are too different.
pub fn word_diff(old: &str, new: &str) -> Option<(Vec<Seg>, Vec<Seg>)> {
    let d = TextDiff::configure().diff_words(old, new);
    if d.ratio() < MIN_RATIO {
        return None;
    }
    let mut o: Vec<Seg> = Vec::new();
    let mut n: Vec<Seg> = Vec::new();
    let push = |v: &mut Vec<Seg>, text: &str, changed: bool| match v.last_mut() {
        Some(s) if s.changed == changed => s.text.push_str(text),
        _ => v.push(Seg {
            text: text.into(),
            changed,
        }),
    };
    for ch in d.iter_all_changes() {
        match ch.tag() {
            ChangeTag::Equal => {
                push(&mut o, ch.value(), false);
                push(&mut n, ch.value(), false);
            }
            ChangeTag::Delete => push(&mut o, ch.value(), true),
            ChangeTag::Insert => push(&mut n, ch.value(), true),
        }
    }
    // Whitespace-only highlights are noise.
    for v in [&mut o, &mut n] {
        for s in v.iter_mut() {
            if s.changed && s.text.trim().is_empty() {
                s.changed = false;
            }
        }
    }
    Some((o, n))
}

/// A split-view row: (left line, right line); either side may be empty.
pub type SplitRow<'a> = (Option<&'a DiffLine>, Option<&'a DiffLine>);

/// Pairs removals with the additions that follow them, side by side (ui-next's `Split`).
pub fn split_rows(lines: &[DiffLine]) -> Vec<SplitRow<'_>> {
    let mut rows = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].kind == LineKind::Context {
            rows.push((Some(&lines[i]), Some(&lines[i])));
            i += 1;
            continue;
        }
        let rs = i;
        while i < lines.len() && lines[i].kind == LineKind::Remove {
            i += 1;
        }
        let as_ = i;
        while i < lines.len() && lines[i].kind == LineKind::Add {
            i += 1;
        }
        let (rem, add) = (&lines[rs..as_], &lines[as_..i]);
        for k in 0..rem.len().max(add.len()) {
            rows.push((rem.get(k), add.get(k)));
        }
    }
    rows
}
