//! The terminal's pure parts: screen → styled runs, keys → bytes, daemon snapshots → ANSI.

use serde::Deserialize;
use std::fmt::Write;
use vt100::{Color, Screen};

/// A run of cells sharing one style.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Run {
    pub text: String,
    /// Space-separated CSS classes (`fg-N`, `bg-N`, `b`, `i`, `u`, `cur`).
    pub class: String,
    /// Inline style for truecolor and 256-colour values.
    pub style: String,
}

/// The CSS colour for a 256-colour palette index above the 16 themed ones.
fn idx_rgb(i: u8) -> (u8, u8, u8) {
    if i >= 232 {
        let v = 8 + 10 * (i - 232);
        return (v, v, v);
    }
    let i = i - 16;
    let lv = |n: u8| if n == 0 { 0 } else { 55 + n * 40 };
    (lv(i / 36), lv((i / 6) % 6), lv(i % 6))
}

/// (class, style) for one colour on one side.
fn color_css(c: Color, side: &str, class: &mut String, style: &mut String) {
    match c {
        Color::Default => {}
        Color::Idx(i) if i < 16 => {
            let _ = write!(class, " {side}-{i}");
        }
        Color::Idx(i) => {
            let (r, g, b) = idx_rgb(i);
            let _ = write!(style, "{}:rgb({r},{g},{b});", css_prop(side));
        }
        Color::Rgb(r, g, b) => {
            let _ = write!(style, "{}:rgb({r},{g},{b});", css_prop(side));
        }
    }
}

fn css_prop(side: &str) -> &'static str {
    if side == "fg" {
        "color"
    } else {
        "background-color"
    }
}

#[derive(PartialEq, Eq, Clone, Copy)]
struct Style {
    fg: Color,
    bg: Color,
    bold: bool,
    italic: bool,
    underline: bool,
    inverse: bool,
    cursor: bool,
}

impl Style {
    fn css(self) -> (String, String) {
        let mut class = String::new();
        let mut style = String::new();
        let (fg, bg) = if self.inverse {
            (self.bg, self.fg)
        } else {
            (self.fg, self.bg)
        };
        if self.inverse {
            // Default colours swap too.
            if fg == Color::Default {
                class.push_str(" fg-bg");
            }
            if bg == Color::Default {
                class.push_str(" bg-fg");
            }
        }
        color_css(fg, "fg", &mut class, &mut style);
        color_css(bg, "bg", &mut class, &mut style);
        if self.bold {
            class.push_str(" b");
        }
        if self.italic {
            class.push_str(" i");
        }
        if self.underline {
            class.push_str(" u");
        }
        if self.cursor {
            class.push_str(" cur");
        }
        (class.trim_start().to_string(), style)
    }
}

/// The visible rows (honouring the scrollback offset) as styled runs. The cursor cell gets its
/// own run with the `cur` class when `cursor` is true.
pub fn rows(screen: &Screen, cursor: bool) -> Vec<Vec<Run>> {
    let (nrows, ncols) = screen.size();
    let (crow, ccol) = screen.cursor_position();
    let show_cursor = cursor && !screen.hide_cursor() && screen.scrollback() == 0;
    let mut out = Vec::with_capacity(nrows as usize);
    for r in 0..nrows {
        let mut runs: Vec<Run> = Vec::new();
        let mut cur: Option<(Style, String)> = None;
        // Trailing default-styled blanks are dropped (the row's background is the default).
        let mut last = 0;
        for c in 0..ncols {
            if let Some(cell) = screen.cell(r, c) {
                let blank =
                    !cell.has_contents() && cell.bgcolor() == Color::Default && !cell.inverse();
                if !blank || (show_cursor && r == crow && c == ccol) {
                    last = c + 1;
                }
            }
        }
        for c in 0..last {
            let Some(cell) = screen.cell(r, c) else {
                continue;
            };
            if cell.is_wide_continuation() {
                continue;
            }
            let style = Style {
                fg: cell.fgcolor(),
                bg: cell.bgcolor(),
                bold: cell.bold(),
                italic: cell.italic(),
                underline: cell.underline(),
                inverse: cell.inverse(),
                cursor: show_cursor && r == crow && c == ccol,
            };
            let text = if cell.has_contents() {
                cell.contents()
            } else {
                " ".to_string()
            };
            match &mut cur {
                Some((s, t)) if *s == style => t.push_str(&text),
                _ => {
                    if let Some((s, t)) = cur.take() {
                        let (class, style) = s.css();
                        runs.push(Run {
                            text: t,
                            class,
                            style,
                        });
                    }
                    cur = Some((style, text));
                }
            }
        }
        if let Some((s, t)) = cur {
            let (class, style) = s.css();
            runs.push(Run {
                text: t,
                class,
                style,
            });
        }
        out.push(runs);
    }
    out
}

/// The bytes a key press sends to the program, or `None` to let the browser have it (plain
/// printable keys arrive through the input element instead, so IME and mobile keyboards work).
pub fn key_bytes(
    key: &str,
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
    app_cursor: bool,
) -> Option<String> {
    if meta {
        return None;
    }
    // xterm modifier parameter: 1 + shift + 2·alt + 4·ctrl.
    let m = 1 + shift as u8 + 2 * alt as u8 + 4 * ctrl as u8;
    let csi = |final_: char| -> String {
        if m > 1 {
            format!("\x1b[1;{m}{final_}")
        } else if app_cursor {
            format!("\x1bO{final_}")
        } else {
            format!("\x1b[{final_}")
        }
    };
    let tilde = |n: u8| -> String {
        if m > 1 {
            format!("\x1b[{n};{m}~")
        } else {
            format!("\x1b[{n}~")
        }
    };
    let s = match key {
        "Enter" => {
            if alt {
                "\x1b\r".into()
            } else {
                "\r".into()
            }
        }
        "Backspace" => {
            if ctrl {
                "\x08".into()
            } else if alt {
                "\x1b\x7f".into()
            } else {
                "\x7f".into()
            }
        }
        "Tab" => {
            if shift {
                "\x1b[Z".into()
            } else {
                "\t".into()
            }
        }
        "Escape" => "\x1b".into(),
        "ArrowUp" => csi('A'),
        "ArrowDown" => csi('B'),
        "ArrowRight" => csi('C'),
        "ArrowLeft" => csi('D'),
        "Home" => csi('H'),
        "End" => csi('F'),
        "Insert" => tilde(2),
        "Delete" => tilde(3),
        "PageUp" => tilde(5),
        "PageDown" => tilde(6),
        "F1" => "\x1bOP".into(),
        "F2" => "\x1bOQ".into(),
        "F3" => "\x1bOR".into(),
        "F4" => "\x1bOS".into(),
        "F5" => tilde(15),
        "F6" => tilde(17),
        "F7" => tilde(18),
        "F8" => tilde(19),
        "F9" => tilde(20),
        "F10" => tilde(21),
        "F11" => tilde(23),
        "F12" => tilde(24),
        k if k.chars().count() == 1 => {
            let ch = k.chars().next().unwrap();
            if ctrl {
                // Ctrl+Shift+C/V belong to copy and paste.
                if shift && matches!(ch, 'c' | 'C' | 'v' | 'V') {
                    return None;
                }
                let code = match ch {
                    'a'..='z' | 'A'..='Z' => (ch.to_ascii_lowercase() as u8) & 0x1f,
                    ' ' | '@' | '2' => 0,
                    '[' | '3' => 0x1b,
                    '\\' | '4' => 0x1c,
                    ']' | '5' => 0x1d,
                    '^' | '6' => 0x1e,
                    '_' | '-' | '7' => 0x1f,
                    '?' | '8' => 0x7f,
                    _ => return None,
                };
                let c = (code as char).to_string();
                if alt {
                    format!("\x1b{c}")
                } else {
                    c
                }
            } else if alt {
                format!("\x1b{ch}")
            } else {
                return None;
            }
        }
        _ => return None,
    };
    Some(s)
}

// ---- daemon snapshots ---------------------------------------------------------------------------

/// One cell of a daemon terminal snapshot (`TerminalCellSchema`).
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCell {
    pub char: String,
    #[serde(default)]
    pub fg: Option<u32>,
    #[serde(default)]
    pub bg: Option<u32>,
    #[serde(default)]
    pub fg_mode: Option<u32>,
    #[serde(default)]
    pub bg_mode: Option<u32>,
    #[serde(default)]
    pub bold: Option<bool>,
    #[serde(default)]
    pub italic: Option<bool>,
    #[serde(default)]
    pub underline: Option<bool>,
    #[serde(default)]
    pub dim: Option<bool>,
    #[serde(default)]
    pub inverse: Option<bool>,
    #[serde(default)]
    pub strikethrough: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCursor {
    pub row: u32,
    pub col: u32,
    #[serde(default)]
    pub hidden: Option<bool>,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub blink: Option<bool>,
}

/// A daemon terminal snapshot (`TerminalStateSchema`), including the reflow flags.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSnapshot {
    pub rows: u32,
    pub cols: u32,
    pub grid: Vec<Vec<SnapshotCell>>,
    pub scrollback: Vec<Vec<SnapshotCell>>,
    pub cursor: SnapshotCursor,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub grid_wrapped: Option<Vec<bool>>,
    #[serde(default)]
    pub scrollback_wrapped: Option<Vec<bool>>,
}

fn styled(c: &SnapshotCell) -> bool {
    c.fg.is_some()
        || c.bg.is_some()
        || c.fg_mode.is_some()
        || c.bg_mode.is_some()
        || c.bold == Some(true)
        || c.italic == Some(true)
        || c.underline == Some(true)
        || c.dim == Some(true)
        || c.inverse == Some(true)
        || c.strikethrough == Some(true)
}

fn row_len(row: &[SnapshotCell]) -> usize {
    row.iter()
        .rposition(|c| c.char != " " || styled(c))
        .map_or(0, |i| i + 1)
}

fn sgr_color(mode: u32, v: u32, bg: bool, out: &mut Vec<String>) {
    match mode {
        1 if v >= 8 => out.push(((if bg { 100 } else { 90 }) + v - 8).to_string()),
        1 => out.push(((if bg { 40 } else { 30 }) + v).to_string()),
        2 => out.push(format!("{};5;{v}", if bg { 48 } else { 38 })),
        3 => out.push(format!(
            "{};2;{};{};{}",
            if bg { 48 } else { 38 },
            (v >> 16) & 0xff,
            (v >> 8) & 0xff,
            v & 0xff
        )),
        _ => {}
    }
}

fn style_key(c: &SnapshotCell) -> String {
    let mut codes = vec!["0".to_string()];
    let on = |b: Option<bool>| b == Some(true);
    for (flag, code) in [
        (on(c.bold), "1"),
        (on(c.dim), "2"),
        (on(c.italic), "3"),
        (on(c.underline), "4"),
        (on(c.inverse), "7"),
        (on(c.strikethrough), "9"),
    ] {
        if flag {
            codes.push(code.into());
        }
    }
    if let (Some(v), Some(m)) = (c.fg, c.fg_mode) {
        sgr_color(m, v, false, &mut codes);
    }
    if let (Some(v), Some(m)) = (c.bg, c.bg_mode) {
        sgr_color(m, v, true, &mut codes);
    }
    format!("\x1b[{}m", codes.join(";"))
}

/// Replays a snapshot as ANSI (port of `renderTerminalSnapshotToAnsi`). With wrap flags each
/// logical line is written as one unbroken run, so feeding it to a parser of a different width
/// reflows it; without them rows replay verbatim with autowrap off.
pub fn snapshot_to_ansi(state: &TerminalSnapshot) -> String {
    let rows: Vec<&Vec<SnapshotCell>> = state.scrollback.iter().chain(state.grid.iter()).collect();
    let wraps: Vec<bool> = state
        .scrollback_wrapped
        .iter()
        .flatten()
        .chain(state.grid_wrapped.iter().flatten())
        .copied()
        .collect();
    let has_wrap = wraps.len() == rows.len();
    let mut out = String::new();
    if !has_wrap {
        out.push_str("\x1b[?7l");
    }
    let plain = "\x1b[0m".to_string();
    let blank = SnapshotCell {
        char: " ".into(),
        ..Default::default()
    };
    for (i, row) in rows.iter().enumerate() {
        let cont = has_wrap && wraps[i];
        let len = if cont {
            row_len(row).max(state.cols as usize)
        } else {
            row_len(row)
        };
        let mut prev = plain.clone();
        for n in 0..len {
            let cell = row.get(n).unwrap_or(&blank);
            let key = style_key(cell);
            if key != prev {
                out.push_str(&key);
                prev = key;
            }
            out.push_str(if cell.char.is_empty() {
                " "
            } else {
                &cell.char
            });
        }
        if prev != plain {
            out.push_str(&plain);
        }
        if i + 1 < rows.len() && !cont {
            out.push_str("\r\n");
        }
    }
    out.push_str("\x1b[0m");
    if let Some(style) = &state.cursor.style {
        let blink_off = state.cursor.blink == Some(false);
        let code = match style.as_str() {
            "block" => {
                if blink_off {
                    2
                } else {
                    1
                }
            }
            "underline" => {
                if blink_off {
                    4
                } else {
                    3
                }
            }
            _ => {
                if blink_off {
                    6
                } else {
                    5
                }
            }
        };
        let _ = write!(out, "\x1b[{code} q");
    }
    let _ = write!(
        out,
        "\x1b[{};{}H",
        state.cursor.row + 1,
        state.cursor.col + 1
    );
    out.push_str(if state.cursor.hidden == Some(true) {
        "\x1b[?25l"
    } else {
        "\x1b[?25h"
    });
    if !has_wrap {
        out.push_str("\x1b[?7h");
    }
    out
}
