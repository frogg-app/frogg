use super::*;

const GIT: &str = "diff --git a/src/a.rs b/src/a.rs
index 111..222 100644
--- a/src/a.rs
+++ b/src/a.rs
@@ -3,4 +3,4 @@ fn main() {
 let a = 1;
-let b = foo(2);
--- not a header
+let b = bar(2);
+++ not a header
 end
\\ No newline at end of file
@@ -20,2 +20,3 @@
 x
+y
 z
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
";

#[test]
fn parses_git_diffs() {
    let f = parse_unified(GIT);
    assert_eq!(f.len(), 3);
    assert_eq!(f[0].path(), "src/a.rs");
    assert_eq!((f[0].additions, f[0].deletions), (3, 2));
    let h = &f[0].hunks[0];
    assert_eq!(h.lines.len(), 6);
    assert_eq!(h.lines[2].text, "-- not a header");
    assert_eq!(h.lines[2].kind, LineKind::Remove);
    assert_eq!(h.lines[0].old_no, Some(3));
    assert_eq!(h.lines[3].new_no, Some(4));
    assert_eq!(h.lines[5].old_no, Some(6));
    assert_eq!(f[0].gap_before(0), 2);
    assert_eq!(f[0].gap_before(1), 13);
    assert_eq!(f[1].status, FileStatus::Added);
    assert_eq!(f[1].path(), "new.txt");
    assert_eq!(f[1].hunks[0].lines[0].new_no, Some(1));
    assert_eq!(f[2].status, FileStatus::Binary);
}

#[test]
fn word_level_pairs() {
    let f = parse_unified(GIT);
    let l = &f[0].hunks[0].lines;
    let old = l[1].words.as_ref().expect("paired");
    let new = l[3].words.as_ref().expect("paired");
    assert!(old.iter().any(|s| s.changed && s.text.contains("foo")));
    assert!(new.iter().any(|s| s.changed && s.text.contains("bar")));
    assert!(new.iter().any(|s| !s.changed && s.text.contains("let b")));
    // Unrelated lines are not split into words.
    assert!(word_diff("alpha beta", "totally different words here").is_none());
}

#[test]
fn diffs_texts_with_collapsed_context() {
    let old: String = (1..=20).map(|i| format!("line {i}\n")).collect();
    let new = old
        .replace("line 10\n", "line ten\n")
        .replace("line 20\n", "");
    let f = diff_texts(&old, &new, "f.txt", 2);
    assert_eq!((f.additions, f.deletions), (1, 2));
    assert_eq!(f.hunks.len(), 2);
    assert_eq!(f.hunks[0].old_start, 8);
    assert_eq!(f.gap_before(0), 7);
    let gap = f.gap_lines(0);
    assert_eq!(gap.len(), 7);
    assert_eq!(gap[0].text, "line 1");
    assert_eq!(f.gap_before(1), 5);
    let gap = f.gap_lines(1);
    assert_eq!(
        gap.iter().map(|l| l.old_no.unwrap()).collect::<Vec<_>>(),
        vec![13, 14, 15, 16, 17]
    );
    assert_eq!(gap[0].new_no, Some(13));
    assert_eq!(f.trailing_gap(), 0);
}

#[test]
fn split_pairs_runs() {
    let f = parse_unified(GIT);
    let rows = split_rows(&f[0].hunks[0].lines);
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[1].0.unwrap().text, "let b = foo(2);");
    assert_eq!(rows[1].1.unwrap().text, "let b = bar(2);");
    let rows = split_rows(&f[0].hunks[1].lines);
    assert!(rows[1].0.is_none() && rows[1].1.is_some());
}
