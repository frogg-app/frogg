//! `Terminal`: a VT emulator (`vt100`) with a DOM grid renderer, replacing ui-next's xterm.js
//! `TerminalView.web.tsx`. The DOM grid keeps native text selection and copy; rows are keyed
//! by content so an output burst only rewrites the rows it changed.

mod model;

pub use model::{
    key_bytes, rows, snapshot_to_ansi, Run, SnapshotCell, SnapshotCursor, TerminalSnapshot,
};

use leptos::html;
use leptos::prelude::*;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;

pub const DEFAULT_SCROLLBACK: usize = 5000;

/// The emulator state behind a `Terminal` view. `Copy`; feed it from the terminal stream
/// (`write` for output, `restore` / `load_snapshot` for the attach replay).
#[derive(Clone, Copy)]
pub struct TerminalHandle {
    parser: StoredValue<vt100::Parser, LocalStorage>,
    scrollback: StoredValue<usize>,
    tick: RwSignal<u64>,
}

impl TerminalHandle {
    pub fn new(rows: u16, cols: u16, scrollback: usize) -> Self {
        TerminalHandle {
            parser: StoredValue::new_local(vt100::Parser::new(
                rows.max(1),
                cols.max(1),
                scrollback,
            )),
            scrollback: StoredValue::new(scrollback),
            tick: RwSignal::new(0),
        }
    }

    fn changed(&self) {
        self.tick.update(|t| *t = t.wrapping_add(1));
    }

    /// Program output.
    pub fn write(&self, bytes: &[u8]) {
        self.parser.update_value(|p| p.process(bytes));
        self.changed();
    }

    /// Clears everything (screen, scrollback, modes), keeping the size.
    pub fn reset(&self) {
        let sb = self.scrollback.get_value();
        self.parser.update_value(|p| {
            let (r, c) = p.screen().size();
            *p = vt100::Parser::new(r, c, sb);
        });
        self.changed();
    }

    /// The daemon's `restore` replay (ANSI bytes of the full snapshot): reset, then write.
    pub fn restore(&self, bytes: &[u8]) {
        self.reset();
        self.write(bytes);
    }

    /// Loads a structured snapshot. With the reflow flags, logical lines re-wrap at this
    /// terminal's current width.
    pub fn load_snapshot(&self, state: &TerminalSnapshot) {
        self.restore(snapshot_to_ansi(state).as_bytes());
    }

    pub fn resize(&self, rows: u16, cols: u16) {
        self.parser
            .update_value(|p| p.set_size(rows.max(1), cols.max(1)));
        self.changed();
    }

    /// (rows, cols).
    pub fn size(&self) -> (u16, u16) {
        self.parser.with_value(|p| p.screen().size())
    }

    pub fn title(&self) -> String {
        self.tick.track();
        self.parser.with_value(|p| p.screen().title().to_string())
    }

    /// The visible text, rows joined by newlines (trailing blanks trimmed).
    pub fn contents(&self) -> String {
        self.parser.with_value(|p| p.screen().contents())
    }

    /// Scrolls the view into the scrollback by `delta` lines (positive = back in time).
    pub fn scroll_by(&self, delta: i32) {
        self.parser.update_value(|p| {
            let now = p.screen().scrollback() as i64;
            p.set_scrollback((now + delta as i64).max(0) as usize);
        });
        self.changed();
    }

    pub fn scroll_to_bottom(&self) {
        let at = self.parser.with_value(|p| p.screen().scrollback());
        if at != 0 {
            self.parser.update_value(|p| p.set_scrollback(0));
            self.changed();
        }
    }

    /// Lines scrolled back from the bottom (0 = live).
    pub fn scroll_offset(&self) -> usize {
        self.tick.track();
        self.parser.with_value(|p| p.screen().scrollback())
    }

    fn with_screen<R>(&self, f: impl FnOnce(&vt100::Screen) -> R) -> R {
        self.parser.with_value(|p| f(p.screen()))
    }

    /// Styled rows for rendering; tracks changes.
    pub fn rows(&self, cursor: bool) -> Vec<Vec<Run>> {
        self.tick.track();
        self.with_screen(|s| rows(s, cursor))
    }
}

fn mouse_wheel_bytes(up: bool, row: u16, col: u16) -> String {
    format!(
        "\x1b[<{};{};{}M",
        if up { 64 } else { 65 },
        col + 1,
        row + 1
    )
}

/// The terminal view. Keys, IME text and pastes go to `on_input` as the bytes to send; the
/// grid fits its container and reports `(cols, rows)` to `on_resize` when that changes.
#[component]
pub fn Terminal(
    handle: TerminalHandle,
    #[prop(into)] on_input: Callback<String>,
    #[prop(optional, into)] on_resize: Option<Callback<(u16, u16)>>,
    /// Focus the terminal when mounted.
    #[prop(optional)]
    autofocus: bool,
) -> impl IntoView {
    let root = NodeRef::<html::Div>::new();
    let probe = NodeRef::<html::Span>::new();
    let input = NodeRef::<html::Textarea>::new();
    let focused = RwSignal::new(false);

    let send = move |s: String| {
        handle.scroll_to_bottom();
        on_input.run(s);
    };

    // Fit the grid to the container.
    let fit = move || {
        let (Some(root), Some(probe)) = (root.get_untracked(), probe.get_untracked()) else {
            return;
        };
        let cell = probe.get_bounding_client_rect();
        let (cw, ch) = (cell.width(), cell.height());
        if cw <= 0.0 || ch <= 0.0 {
            return;
        }
        let style = web_sys::window().and_then(|w| w.get_computed_style(&root).ok().flatten());
        let pad = |side: &str| {
            style
                .as_ref()
                .and_then(|s| s.get_property_value(side).ok())
                .and_then(|v| v.trim_end_matches("px").parse::<f64>().ok())
                .unwrap_or(0.0)
        };
        let w = root.client_width() as f64 - pad("padding-left") - pad("padding-right");
        let h = root.client_height() as f64 - pad("padding-top") - pad("padding-bottom");
        let cols = ((w / cw).floor() as u16).max(2);
        let rows = ((h / ch).floor() as u16).max(1);
        if handle.size() != (rows, cols) {
            handle.resize(rows, cols);
            if let Some(cb) = on_resize {
                cb.run((cols, rows));
            }
        }
    };

    let observer: StoredValue<Option<web_sys::ResizeObserver>, LocalStorage> =
        StoredValue::new_local(None);
    Effect::new(move |_| {
        let Some(el) = root.get() else { return };
        let cb = Closure::<dyn FnMut()>::new(fit);
        if let Ok(ro) = web_sys::ResizeObserver::new(cb.as_ref().unchecked_ref()) {
            ro.observe(&el);
            observer.set_value(Some(ro));
        }
        cb.forget();
        fit();
        if autofocus {
            if let Some(i) = input.get_untracked() {
                let _ = i.focus();
            }
        }
    });
    on_cleanup(move || {
        let _ = observer.try_with_value(|o| {
            if let Some(o) = o {
                o.disconnect();
            }
        });
    });

    let focus_input = move || {
        if let Some(i) = input.get_untracked() {
            let _ = i.focus();
        }
    };
    // Focus on click unless the user just selected text (keep the selection for copying).
    let on_mouseup = move |_: web_sys::MouseEvent| {
        let selecting = web_sys::window()
            .and_then(|w| w.get_selection().ok().flatten())
            .is_some_and(|s| !s.is_collapsed());
        if !selecting {
            focus_input();
        }
    };

    let on_wheel = move |e: web_sys::WheelEvent| {
        let lines = (e.delta_y() / if e.delta_mode() == 1 { 1.0 } else { 40.0 }).round() as i32;
        let lines = if lines == 0 {
            e.delta_y().signum() as i32
        } else {
            lines
        };
        if lines == 0 {
            return;
        }
        let (alt, mouse) = handle.with_screen(|s| {
            (
                s.alternate_screen(),
                s.mouse_protocol_mode() != vt100::MouseProtocolMode::None,
            )
        });
        e.prevent_default();
        if !alt && !e.shift_key() {
            handle.scroll_by(-lines);
        } else if mouse {
            let (r, c) = handle.with_screen(|s| s.cursor_position());
            for _ in 0..lines.unsigned_abs() {
                on_input.run(mouse_wheel_bytes(lines < 0, r, c));
            }
        } else {
            let app = handle.with_screen(|s| s.application_cursor());
            let key = if lines < 0 { "ArrowUp" } else { "ArrowDown" };
            if let Some(b) = key_bytes(key, false, false, false, false, app) {
                on_input.run(b.repeat(lines.unsigned_abs() as usize));
            }
        }
    };

    let on_keydown = move |e: web_sys::KeyboardEvent| {
        if e.is_composing() {
            return;
        }
        let key = e.key();
        // Copy: Ctrl+Shift+C or Cmd+C with a selection.
        let copy_combo = (e.ctrl_key() && e.shift_key() && key.eq_ignore_ascii_case("c"))
            || (e.meta_key() && key.eq_ignore_ascii_case("c"));
        if copy_combo {
            if let Some(sel) = web_sys::window().and_then(|w| w.get_selection().ok().flatten()) {
                let text: String = sel.to_string().into();
                if !text.is_empty() {
                    crate::code::copy_text(&text);
                    e.prevent_default();
                }
            }
            return;
        }
        // Shift+PageUp/PageDown page the scrollback on the normal buffer.
        if e.shift_key() && (key == "PageUp" || key == "PageDown") {
            let (alt, rows) = handle.with_screen(|s| (s.alternate_screen(), s.size().0 as i32));
            if !alt {
                e.prevent_default();
                handle.scroll_by(if key == "PageUp" { rows - 1 } else { 1 - rows });
                return;
            }
        }
        let app = handle.with_screen(|s| s.application_cursor());
        if let Some(bytes) = key_bytes(
            &key,
            e.ctrl_key(),
            e.alt_key(),
            e.shift_key(),
            e.meta_key(),
            app,
        ) {
            e.prevent_default();
            send(bytes);
        }
    };

    // Printable text (and IME commits) arrives as input on the hidden textarea.
    let on_input_ev = move |_: web_sys::Event| {
        let Some(t) = input.get_untracked() else {
            return;
        };
        let v = t.value();
        if !v.is_empty() {
            t.set_value("");
            send(v.replace('\n', "\r"));
        }
    };
    let on_compositionend =
        move |_: web_sys::CompositionEvent| on_input_ev(web_sys::Event::new("x").unwrap());

    let on_paste = move |e: web_sys::ClipboardEvent| {
        let Some(text) = e
            .clipboard_data()
            .and_then(|d| d.get_data("text/plain").ok())
        else {
            return;
        };
        e.prevent_default();
        if text.is_empty() {
            return;
        }
        let text = text.replace("\r\n", "\r").replace('\n', "\r");
        let bracketed = handle.with_screen(|s| s.bracketed_paste());
        send(if bracketed {
            format!("\x1b[200~{text}\x1b[201~")
        } else {
            text
        });
    };

    let grid = move || {
        let rows = handle.rows(true);
        rows.into_iter().enumerate().collect::<Vec<_>>()
    };

    view! {
        <div
            class="fr-term"
            class:focused=move || focused.get()
            node_ref=root
            on:wheel=on_wheel
            on:mouseup=on_mouseup
        >
            <div class="fr-term-rows">
                <For
                    each=grid
                    key=|(n, runs)| (*n, runs.clone())
                    children=move |(_, runs)| {
                        view! {
                            <div class="fr-term-row">
                                {runs
                                    .into_iter()
                                    .map(|r| {
                                        if r.class.is_empty() && r.style.is_empty() {
                                            r.text.into_any()
                                        } else {
                                            view! { <span class=r.class style=r.style>{r.text}</span> }.into_any()
                                        }
                                    })
                                    .collect_view()}
                                "\u{200b}"
                            </div>
                        }
                    }
                />
            </div>
            <span class="fr-term-probe" node_ref=probe aria-hidden="true">"W"</span>
            <textarea
                class="fr-term-input"
                node_ref=input
                aria-label="Terminal input"
                autocapitalize="off"
                autocomplete="off"
                spellcheck="false"
                on:keydown=on_keydown
                on:input=on_input_ev
                on:compositionend=on_compositionend
                on:paste=on_paste
                on:focus=move |_| focused.set(true)
                on:blur=move |_| focused.set(false)
            ></textarea>
        </div>
    }
}

#[cfg(test)]
mod tests;
