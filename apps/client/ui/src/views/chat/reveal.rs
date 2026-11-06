//! Streamed reply text reveal per the `textReveal` pref (ui-next `chat/TextReveal.tsx`).
//!
//! The reply renders through the shared `Markdown`; after each update a pass over its text nodes
//! remembers how much rendered text there was and when each newer range arrived, and wraps only
//! the young tail in animated spans (CSS keyframes on inline spans, so nothing reflows). Ranges
//! are tracked in rendered-text characters, which only grow while a reply streams. Text present
//! at mount is history and never animates; reduced motion turns every mode off.
//!
//! Modes: `fade` and `blur` stagger per word, `glow` trails per character, `slide` and `wipe`
//! move whole network chunks, `type` paces characters steadily (draining a backlog faster),
//! `scramble` settles noise glyphs left to right over each new word, and `caret` leads the
//! stream with a block that blinks once the stream pauses.

use std::cell::RefCell;
use std::rc::Rc;

use frogg_render::Markdown;
use leptos::prelude::*;
use wasm_bindgen::JsCast;

/// Durations in ms (ui-next `revealMs`).
const FADE: f64 = 180.0;
const BLUR: f64 = 220.0;
const SCRAMBLE: f64 = 260.0;
const WIPE: f64 = 420.0;
const SLIDE: f64 = 200.0;
const TYPE_FADE: f64 = 90.0;
const TYPE_CPS: f64 = 55.0;
const GLOW: f64 = 700.0;
const CARET_IDLE: u64 = 500;
/// One stagger step.
const STEP_MS: f64 = 15.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    None,
    Fade,
    Blur,
    Caret,
    Scramble,
    Wipe,
    Slide,
    Type,
    Glow,
}

impl Mode {
    pub fn parse(s: &str) -> Self {
        match s {
            "fade" => Mode::Fade,
            "blur" => Mode::Blur,
            "caret" => Mode::Caret,
            "scramble" => Mode::Scramble,
            "wipe" => Mode::Wipe,
            "slide" => Mode::Slide,
            "type" => Mode::Type,
            "glow" => Mode::Glow,
            _ => Mode::None,
        }
    }

    fn class(self) -> &'static str {
        match self {
            Mode::Fade => "rv-fade",
            Mode::Blur => "rv-blur",
            Mode::Scramble => "rv-scr",
            Mode::Wipe => "rv-wipe",
            Mode::Slide => "rv-slide",
            Mode::Type => "rv-type",
            Mode::Glow => "rv-glow",
            Mode::None | Mode::Caret => "",
        }
    }

    /// Whether new text gets animated spans (caret and none draw none).
    fn spans(self) -> bool {
        !matches!(self, Mode::None | Mode::Caret)
    }

    fn base_ms(self) -> f64 {
        match self {
            Mode::Fade => FADE,
            Mode::Blur => BLUR,
            Mode::Scramble => SCRAMBLE,
            Mode::Wipe => WIPE,
            Mode::Slide => SLIDE,
            Mode::Type => TYPE_FADE,
            Mode::Glow => GLOW,
            Mode::None | Mode::Caret => 0.0,
        }
    }
}

/// A range of rendered characters `[from, to)` that arrived at `born`, animating after `d`
/// stagger steps.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Piece {
    pub from: usize,
    pub to: usize,
    pub d: f64,
    pub born: f64,
}

impl Piece {
    fn life(&self, mode: Mode) -> f64 {
        mode.base_ms() + self.d * STEP_MS + 40.0
    }
}

/// The pieces for newly arrived text `chunk` starting at rendered offset `from`.
pub fn pieces_for(mode: Mode, chunk: &[char], from: usize, born: f64) -> Vec<Piece> {
    let to = from + chunk.len();
    match mode {
        Mode::None | Mode::Caret => Vec::new(),
        Mode::Slide | Mode::Wipe => vec![Piece {
            from,
            to,
            d: 0.0,
            born,
        }],
        Mode::Glow | Mode::Type => chunk
            .iter()
            .enumerate()
            .filter(|(_, c)| !c.is_whitespace())
            .map(|(i, _)| Piece {
                from: from + i,
                to: from + i + 1,
                d: if mode == Mode::Glow { i as f64 } else { 0.0 },
                born,
            })
            .collect(),
        Mode::Fade | Mode::Blur | Mode::Scramble => {
            let step = if mode == Mode::Scramble { 0.0 } else { 2.0 };
            let mut out = Vec::new();
            let mut i = 0;
            while i < chunk.len() {
                if chunk[i].is_whitespace() {
                    i += 1;
                    continue;
                }
                let start = i;
                while i < chunk.len() && !chunk[i].is_whitespace() {
                    i += 1;
                }
                out.push(Piece {
                    from: from + start,
                    to: from + i,
                    d: out.len() as f64 * step,
                    born,
                });
            }
            out
        }
    }
}

/// How many characters the typewriter shows after `dt` seconds: a steady rate plus a catch-up
/// that drains a backlog quickly. Returns the new shown count and the carried fraction.
pub fn type_step(shown: usize, len: usize, dt: f64, acc: f64) -> (usize, f64) {
    let acc = acc + dt * (TYPE_CPS + len.saturating_sub(shown) as f64 * 3.0);
    let n = acc.floor();
    ((shown + n as usize).min(len), acc - n)
}

const GLYPHS: &[char] = &[
    '▓', '▒', '░', '<', '>', '/', '\\', '[', ']', '{', '}', '=', '+', '*', '#', '_', '0', '1',
];

fn hash(i: usize, tick: u32) -> u32 {
    let a = (i as u32).wrapping_add(1).wrapping_mul(2_654_435_761);
    let b = tick.wrapping_add(7).wrapping_mul(40_503);
    a ^ b
}

/// Noise for the unsettled part of a scrambling word (whitespace kept).
pub fn noise_of(text: &[char], from: usize, tick: u32) -> String {
    text.iter()
        .enumerate()
        .map(|(i, c)| {
            if c.is_whitespace() {
                *c
            } else {
                GLYPHS[hash(from + i, tick) as usize % GLYPHS.len()]
            }
        })
        .collect()
}

fn now() -> f64 {
    web_sys::window()
        .and_then(|w| js_sys::Reflect::get(&w, &"performance".into()).ok())
        .and_then(|p| p.dyn_into::<web_sys::Performance>().ok())
        .map(|p| p.now())
        .unwrap_or_else(js_sys::Date::now)
}

/// What the DOM pass remembers between updates.
#[derive(Default)]
struct Arrivals {
    /// Rendered characters seen so far; `None` before the first pass (history).
    seen: Option<usize>,
    pieces: Vec<Piece>,
}

struct TextNode {
    node: web_sys::Text,
    start: usize,
    chars: Vec<char>,
}

/// Collects the reply's text nodes in order, with their rendered offsets. Code blocks and
/// images are skipped; nodes already inside a reveal span count but are not returned.
fn collect(root: &web_sys::Node, out: &mut Vec<TextNode>, total: &mut usize, top: bool) {
    let mut child = root.first_child();
    while let Some(n) = child {
        child = n.next_sibling();
        if let Some(t) = n.dyn_ref::<web_sys::Text>() {
            let chars: Vec<char> = t.data().chars().collect();
            // Only text inside an element the markdown owns: a bare top-level node could be
            // one Leptos tracks for removal.
            if !top {
                out.push(TextNode {
                    node: t.clone(),
                    start: *total,
                    chars: chars.clone(),
                });
            }
            *total += chars.len();
        } else if let Some(el) = n.dyn_ref::<web_sys::Element>() {
            let tag = el.tag_name();
            if tag == "PRE" || tag == "IMG" || tag == "svg" || el.class_list().contains("fr-code") {
                continue;
            }
            if el.class_list().contains("rv") {
                // `data-n`: the span's own characters (a scramble overlay adds more).
                *total += el
                    .get_attribute("data-n")
                    .and_then(|n| n.parse::<usize>().ok())
                    .unwrap_or(0);
                continue;
            }
            collect(&n, out, total, false);
        }
    }
}

/// A scramble overlay settling: (overlay, host span, word, born).
type Scrambling = (web_sys::Element, web_sys::Element, Vec<char>, f64);

thread_local! {
    /// Scramble overlays settling: (overlay, host span, word, born).
    static SCRAMBLES: RefCell<Vec<Scrambling>> =
        const { RefCell::new(Vec::new()) };
}

fn scramble_frame() {
    let t = now();
    let more = SCRAMBLES.with(|s| {
        let mut s = s.borrow_mut();
        s.retain(|(over, host, word, born)| {
            let p = ((t - born) / SCRAMBLE).clamp(0.0, 1.0);
            if p >= 1.0 || !host.is_connected() {
                over.remove();
                let _ = host.class_list().remove_1("rv-ghost");
                return false;
            }
            let keep = (p * word.len() as f64).floor() as usize;
            let head: String = word[..keep].iter().collect();
            let tail = noise_of(&word[keep..], keep, (p * 40.0).floor() as u32);
            over.set_text_content(Some(&format!("{head}{tail}")));
            true
        });
        !s.is_empty()
    });
    if more {
        request_animation_frame(scramble_frame);
    }
}

fn start_scramble(over: web_sys::Element, host: web_sys::Element, word: Vec<char>, born: f64) {
    let idle = SCRAMBLES.with(|s| {
        let mut s = s.borrow_mut();
        s.push((over, host, word, born));
        s.len() == 1
    });
    if idle {
        request_animation_frame(scramble_frame);
    }
}

/// Wraps the live pieces inside one text node in animated spans.
fn wrap(doc: &web_sys::Document, t: &TextNode, live: &[Piece], mode: Mode, at: f64) {
    let end = t.start + t.chars.len();
    let mut cuts: Vec<(usize, usize, Piece)> = live
        .iter()
        .filter(|p| p.to > t.start && p.from < end)
        .map(|p| (p.from.max(t.start) - t.start, p.to.min(end) - t.start, *p))
        .collect();
    if cuts.is_empty() {
        return;
    }
    cuts.sort_by_key(|c| c.0);
    let Some(parent) = t.node.parent_node() else {
        return;
    };
    let text = |a: usize, b: usize| t.chars[a..b].iter().collect::<String>();
    let mut at_char = 0;
    for (a, b, p) in cuts {
        if a < at_char {
            continue;
        }
        if a > at_char {
            let _ = parent.insert_before(&doc.create_text_node(&text(at_char, a)), Some(&t.node));
        }
        let Ok(span) = doc.create_element("span") else {
            return;
        };
        let _ = span.set_attribute("class", &format!("rv {}", mode.class()));
        // A re-rendered span (e.g. `**bo` becoming bold) continues from its elapsed time.
        let delay = p.d * STEP_MS - (at - p.born);
        let _ = span.set_attribute("style", &format!("animation-delay:{delay:.0}ms"));
        let _ = span.set_attribute("data-n", &(b - a).to_string());
        let word: Vec<char> = t.chars[a..b].to_vec();
        span.set_text_content(Some(&text(a, b)));
        if mode == Mode::Scramble {
            if let Ok(over) = doc.create_element("span") {
                let _ = over.set_attribute("class", "rv-over");
                let _ = over.set_attribute("aria-hidden", "true");
                let _ = span.append_child(&over);
                let _ = span.class_list().add_1("rv-ghost");
                start_scramble(over, span.clone(), word, p.born);
            }
        }
        let _ = parent.insert_before(&span, Some(&t.node));
        at_char = b;
    }
    if at_char < t.chars.len() {
        let _ = parent.insert_before(
            &doc.create_text_node(&text(at_char, t.chars.len())),
            Some(&t.node),
        );
    }
    let _ = parent.remove_child(&t.node);
}

fn pass(root: &web_sys::Element, track: &mut Arrivals, mode: Mode) {
    let mut nodes = Vec::new();
    let mut total = 0;
    collect(root, &mut nodes, &mut total, true);
    let t = now();
    let Some(seen) = track.seen else {
        track.seen = Some(total);
        return;
    };
    if total > seen && mode.spans() {
        // The new characters, read back from the nodes that hold them.
        let mut chunk = Vec::with_capacity(total - seen);
        for n in &nodes {
            let end = n.start + n.chars.len();
            if end > seen {
                let from = seen.max(n.start) - n.start;
                chunk.extend_from_slice(&n.chars[from..]);
            }
        }
        // Text inside existing reveal spans is never new, so the chunk lines up with `seen`.
        let base = total - chunk.len();
        track.pieces.extend(pieces_for(mode, &chunk, base, t));
    }
    track.seen = Some(total);
    track.pieces.retain(|p| t - p.born < p.life(mode));
    if track.pieces.is_empty() {
        return;
    }
    let Some(doc) = web_sys::window().and_then(|w| w.document()) else {
        return;
    };
    for n in &nodes {
        wrap(&doc, n, &track.pieces, mode, t);
    }
}

/// The assistant reply body: markdown with the reveal on newly streamed text.
#[component]
pub fn RevealReply(
    #[prop(into)] text: Signal<String>,
    #[prop(into)] streaming: Signal<bool>,
    on_link: Callback<String>,
) -> impl IntoView {
    let prefs = crate::state::get().prefs;
    let reduced = crate::components::presence::reduced_motion();
    let mode = Memo::new(move |_| {
        if reduced {
            Mode::None
        } else {
            Mode::parse(&prefs.text("textReveal"))
        }
    });
    // Typewriter: what is shown trails the text at a steady pace while the reply streams.
    let shown = RwSignal::new(text.get_untracked());
    let typing = Rc::new(RefCell::new(None::<(f64, f64)>));
    let typing_fx = typing.clone();
    Effect::new(move |_| {
        let full = text.get();
        let on = mode.get() == Mode::Type && streaming.get();
        let cur = shown.get_untracked();
        if !on || !full.starts_with(&cur) {
            *typing_fx.borrow_mut() = None;
            if cur != full {
                shown.set(full);
            }
            return;
        }
        if typing_fx.borrow().is_none() && cur.len() < full.len() {
            *typing_fx.borrow_mut() = Some((now(), 0.0));
            type_tick(shown, text, typing_fx.clone());
        }
    });

    let body = NodeRef::<leptos::html::Div>::new();
    let track = Rc::new(RefCell::new(Arrivals::default()));
    Effect::new(move |_| {
        shown.track();
        let m = mode.get();
        let track = track.clone();
        request_animation_frame(move || {
            if let Some(el) = body.try_get_untracked().flatten() {
                pass(&el, &mut track.borrow_mut(), m);
            }
        });
    });

    // Caret mode: solid while text flows, blinking once it pauses.
    let idle = RwSignal::new(false);
    let timer = StoredValue::new_local(None::<TimeoutHandle>);
    Effect::new(move |_| {
        text.track();
        idle.set(false);
        if let Some(h) = timer.try_update_value(Option::take).flatten() {
            h.clear();
        }
        if let Ok(h) = set_timeout_with_handle(
            move || {
                idle.try_set(true);
            },
            std::time::Duration::from_millis(CARET_IDLE),
        ) {
            timer.set_value(Some(h));
        }
    });
    on_cleanup(move || {
        if let Some(h) = timer.try_update_value(Option::take).flatten() {
            h.clear();
        }
    });
    let caret = move || mode.get() == Mode::Caret && streaming.get();
    view! {
        <div
            class="tl-reply-body rv-body"
            class:rv-caret=caret
            class:idle=move || caret() && idle.get()
            node_ref=body
        >
            <Markdown text=shown on_link=on_link />
        </div>
    }
}

fn type_tick(
    shown: RwSignal<String>,
    full: Signal<String>,
    state: Rc<RefCell<Option<(f64, f64)>>>,
) {
    let Some((last, acc)) = *state.borrow() else {
        return;
    };
    let Some(text) = full.try_get_untracked() else {
        return;
    };
    let Some(cur) = shown.try_get_untracked() else {
        return;
    };
    let t = now();
    let len = text.chars().count();
    let have = cur.chars().count();
    let (next, acc) = type_step(have, len, (t - last) / 1000.0, acc);
    if next > have {
        shown.set(text.chars().take(next).collect());
    }
    if next < len {
        *state.borrow_mut() = Some((t, acc));
        request_animation_frame(move || type_tick(shown, full, state));
    } else {
        *state.borrow_mut() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chars(s: &str) -> Vec<char> {
        s.chars().collect()
    }

    #[test]
    fn word_pieces_stagger() {
        let p = pieces_for(Mode::Fade, &chars(" hello  big world"), 10, 0.0);
        let spans: Vec<_> = p.iter().map(|p| (p.from, p.to, p.d)).collect();
        assert_eq!(spans, [(11, 16, 0.0), (18, 21, 2.0), (22, 27, 4.0)]);
        assert!(pieces_for(Mode::Scramble, &chars("a b"), 0, 0.0)
            .iter()
            .all(|p| p.d == 0.0));
    }

    #[test]
    fn chunk_and_char_pieces() {
        assert_eq!(pieces_for(Mode::Slide, &chars("ab c"), 3, 1.0).len(), 1);
        let g = pieces_for(Mode::Glow, &chars("a b"), 0, 0.0);
        assert_eq!(g.len(), 2);
        assert_eq!(g[1].d, 2.0);
        assert!(pieces_for(Mode::Caret, &chars("abc"), 0, 0.0).is_empty());
    }

    #[test]
    fn typewriter_drains_backlog() {
        // A small backlog types at about the steady rate.
        let (n, _) = type_step(0, 2, 0.01, 0.0);
        assert_eq!(n, 0);
        let (n, acc) = type_step(0, 2, 0.1, 0.0);
        assert_eq!(n, 2.min((0.1f64 * (55.0 + 6.0)).floor() as usize));
        assert!(acc < 1.0);
        // A big backlog catches up much faster.
        let (n, _) = type_step(0, 1000, 0.1, 0.0);
        assert!(n >= 300);
        assert_eq!(type_step(5, 5, 1.0, 0.0).0, 5);
    }

    #[test]
    fn noise_keeps_whitespace() {
        let n = noise_of(&chars("ab c"), 0, 3);
        assert_eq!(n.chars().count(), 4);
        assert_eq!(n.chars().nth(2), Some(' '));
        assert_ne!(
            noise_of(&chars("abcd"), 0, 1),
            noise_of(&chars("abcd"), 0, 2)
        );
    }

    #[test]
    fn modes_parse() {
        assert_eq!(Mode::parse("glow"), Mode::Glow);
        assert_eq!(Mode::parse("bogus"), Mode::None);
    }
}
