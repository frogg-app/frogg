use super::model::*;

fn parser(rows: u16, cols: u16) -> vt100::Parser {
    vt100::Parser::new(rows, cols, 100)
}

fn text_of(runs: &[Run]) -> String {
    runs.iter().map(|r| r.text.as_str()).collect()
}

#[test]
fn feed_and_style_runs() {
    let mut p = parser(3, 20);
    p.process(b"plain \x1b[1;31mred\x1b[0m \x1b[38;5;196mx\x1b[48;2;1;2;3my\x1b[0m");
    let r = rows(p.screen(), false);
    assert_eq!(text_of(&r[0]), "plain red xy");
    let red = r[0].iter().find(|x| x.text == "red").unwrap();
    assert_eq!(red.class, "fg-1 b");
    let x = r[0].iter().find(|x| x.text == "x").unwrap();
    assert_eq!(x.style, "color:rgb(255,0,0);");
    let y = r[0].iter().find(|x| x.text == "y").unwrap();
    assert!(y.style.contains("background-color:rgb(1,2,3)"));
    assert!(r[1].is_empty());
}

#[test]
fn cursor_gets_its_own_run() {
    let mut p = parser(2, 10);
    p.process(b"ab\x1b[1;2H");
    let r = rows(p.screen(), true);
    assert_eq!(r[0].len(), 2);
    assert_eq!(
        r[0][1],
        Run {
            text: "b".into(),
            class: "cur".into(),
            style: String::new()
        }
    );
    p.process(b"\x1b[?25l");
    assert_eq!(rows(p.screen(), true)[0].len(), 1);
}

#[test]
fn inverse_swaps_default_colours() {
    let mut p = parser(1, 10);
    p.process(b"\x1b[7mz");
    let r = rows(p.screen(), false);
    assert_eq!(r[0][0].class, "fg-bg bg-fg");
}

#[test]
fn scrollback_and_wide_chars() {
    let mut p = parser(2, 10);
    p.process(b"one\r\ntwo\r\nthree\r\n\xe4\xbd\xa0ok");
    assert_eq!(text_of(&rows(p.screen(), false)[1]), "你ok");
    p.set_scrollback(1);
    let r = rows(p.screen(), false);
    assert_eq!(text_of(&r[0]), "two");
    assert_eq!(text_of(&r[1]), "three");
}

#[test]
fn keys() {
    let k = |key, ctrl, alt, shift, app| key_bytes(key, ctrl, alt, shift, false, app);
    assert_eq!(
        k("Enter", false, false, false, false).as_deref(),
        Some("\r")
    );
    assert_eq!(
        k("ArrowUp", false, false, false, false).as_deref(),
        Some("\x1b[A")
    );
    assert_eq!(
        k("ArrowUp", false, false, false, true).as_deref(),
        Some("\x1bOA")
    );
    assert_eq!(
        k("ArrowLeft", true, false, false, false).as_deref(),
        Some("\x1b[1;5D")
    );
    assert_eq!(k("c", true, false, false, false).as_deref(), Some("\x03"));
    assert_eq!(k("C", true, false, true, false), None); // copy
    assert_eq!(k("b", false, true, false, false).as_deref(), Some("\x1bb"));
    assert_eq!(k("a", false, false, false, false), None); // arrives via input
    assert_eq!(
        k("Tab", false, false, true, false).as_deref(),
        Some("\x1b[Z")
    );
    assert_eq!(
        k("PageUp", false, false, false, false).as_deref(),
        Some("\x1b[5~")
    );
    assert_eq!(
        k("Delete", false, false, true, false).as_deref(),
        Some("\x1b[3;2~")
    );
    assert_eq!(key_bytes("v", false, false, false, true, false), None);
}

fn cell(c: &str) -> SnapshotCell {
    SnapshotCell {
        char: c.into(),
        ..Default::default()
    }
}
fn row(s: &str) -> Vec<SnapshotCell> {
    s.chars().map(|c| cell(&c.to_string())).collect()
}

#[test]
fn snapshot_replays_verbatim_without_wrap_flags() {
    let mut red = cell("R");
    red.fg = Some(1);
    red.fg_mode = Some(1);
    let state = TerminalSnapshot {
        rows: 2,
        cols: 4,
        grid: vec![vec![cell("a"), red], row("cd")],
        scrollback: vec![row("old")],
        cursor: SnapshotCursor {
            row: 1,
            col: 2,
            ..Default::default()
        },
        ..Default::default()
    };
    let ansi = snapshot_to_ansi(&state);
    assert!(ansi.starts_with("\x1b[?7l"));
    assert!(ansi.contains("a\x1b[0;31mR\x1b[0m"));
    let mut p = parser(2, 4);
    p.process(ansi.as_bytes());
    assert_eq!(p.screen().contents(), "aR\ncd");
    assert_eq!(p.screen().cursor_position(), (1, 2));
    p.set_scrollback(1);
    assert_eq!(p.screen().contents(), "old\naR");
}

#[test]
fn snapshot_reflows_wrapped_lines_at_a_new_width() {
    // "abcdef" wrapped at 4 columns, loaded into a 10-column terminal.
    let state = TerminalSnapshot {
        rows: 3,
        cols: 4,
        grid: vec![row("abcd"), row("ef"), row("$")],
        scrollback: vec![],
        cursor: SnapshotCursor {
            row: 2,
            col: 1,
            ..Default::default()
        },
        grid_wrapped: Some(vec![true, false, false]),
        scrollback_wrapped: Some(vec![]),
        ..Default::default()
    };
    let mut p = parser(3, 10);
    p.process(snapshot_to_ansi(&state).as_bytes());
    assert_eq!(p.screen().contents(), "abcdef\n$");
}

#[test]
fn snapshot_decodes_from_daemon_json() {
    let json = r#"{"rows":1,"cols":2,"grid":[[{"char":"x","fg":3,"fgMode":1,"bold":true}]],
        "scrollback":[],"cursor":{"row":0,"col":1,"style":"bar","blink":false},"gridWrapped":[false]}"#;
    let s: TerminalSnapshot = serde_json::from_str(json).unwrap();
    assert_eq!(s.grid[0][0].fg_mode, Some(1));
    assert!(snapshot_to_ansi(&s).contains("\x1b[6 q"));
}

#[test]
fn wheel_reports_follow_the_mouse_encoding() {
    use vt100::MouseProtocolEncoding as E;
    assert_eq!(mouse_wheel_bytes(true, 4, 9, E::Sgr), "\x1b[<64;10;5M");
    assert_eq!(mouse_wheel_bytes(false, 0, 0, E::Default), "\x1b[Ma!!");
    // X10 caps coordinates at 223; UTF-8 carries larger ones as wider characters.
    assert_eq!(
        mouse_wheel_bytes(true, 0, 300, E::Default),
        "\x1b[M`\u{ff}!"
    );
    assert_eq!(mouse_wheel_bytes(true, 0, 300, E::Utf8), "\x1b[M`\u{14d}!");
    // The terminal reports its encoding once the program asks for it.
    let mut p = parser(5, 20);
    p.process(b"\x1b[?1000h\x1b[?1006h");
    assert_eq!(p.screen().mouse_protocol_encoding(), E::Sgr);
}
