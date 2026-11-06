//! Markdown → a small owned tree (GFM: tables, task lists, strikethrough, bare-URL autolinks).
//! Top-level blocks keep a hash of their source so a streaming view re-renders only the blocks
//! whose text changed (in practice the last one).

use pulldown_cmark::{Alignment, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use std::hash::{Hash, Hasher};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
    None,
    Left,
    Center,
    Right,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Inline {
    Text(String),
    Code(String),
    Strong(Vec<Inline>),
    Em(Vec<Inline>),
    Strike(Vec<Inline>),
    Link { href: String, children: Vec<Inline> },
    Image { src: String, alt: String },
    Break,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    /// `Some(checked)` for a task item.
    pub task: Option<bool>,
    pub children: Vec<Node>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Node {
    Para(Vec<Inline>),
    /// Inline content directly in a tight list item.
    Plain(Vec<Inline>),
    Heading(u8, Vec<Inline>),
    Code {
        lang: String,
        text: String,
    },
    Quote(Vec<Node>),
    List {
        start: Option<u64>,
        items: Vec<Item>,
    },
    Table {
        align: Vec<Align>,
        head: Vec<Vec<Inline>>,
        rows: Vec<Vec<Vec<Inline>>>,
    },
    Rule,
    // Parser-internal pieces of tables and lists.
    #[doc(hidden)]
    Cell(Vec<Inline>),
    #[doc(hidden)]
    Row(Vec<Vec<Inline>>),
    #[doc(hidden)]
    ItemNode(Item),
}

/// A top-level block: its position, a hash of its source text, and its tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub index: usize,
    pub hash: u64,
    pub node: Node,
}

enum Kind {
    Root,
    Para,
    Heading(u8),
    Quote,
    Code(String),
    List(Option<u64>),
    Item,
    Table(Vec<Align>),
    Head,
    Row,
    Cell,
    Strong,
    Em,
    Strike,
    Link(String),
    Image(String),
    /// Raw HTML and anything else we show as its text.
    Other,
}

struct Frame {
    kind: Kind,
    blocks: Vec<Node>,
    inlines: Vec<Inline>,
    task: Option<bool>,
    text: String,
}

impl Frame {
    fn new(kind: Kind) -> Self {
        Frame {
            kind,
            blocks: Vec::new(),
            inlines: Vec::new(),
            task: None,
            text: String::new(),
        }
    }
    fn flush(&mut self) {
        if !self.inlines.is_empty() {
            let inl = std::mem::take(&mut self.inlines);
            self.blocks.push(Node::Plain(inl));
        }
    }
}

pub fn options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_GFM
}

/// Parses markdown into top-level blocks.
pub fn parse(src: &str) -> Vec<Block> {
    let mut stack = vec![Frame::new(Kind::Root)];
    let mut out: Vec<Block> = Vec::new();
    let mut top_start = 0usize;
    let mut finish = |stack: &mut Vec<Frame>, node: Node, range_end: usize, start: usize| {
        if stack.len() == 1 {
            let mut h = std::collections::hash_map::DefaultHasher::new();
            src[start..range_end].hash(&mut h);
            out.push(Block {
                index: out.len(),
                hash: h.finish(),
                node,
            });
        } else {
            add_block(stack.last_mut().unwrap(), node);
        }
    };
    for (ev, range) in Parser::new_ext(src, options()).into_offset_iter() {
        match ev {
            Event::Start(tag) => {
                if stack.len() == 1 {
                    top_start = range.start;
                }
                let kind = match tag {
                    Tag::Paragraph => Kind::Para,
                    Tag::Heading { level, .. } => Kind::Heading(level as u8),
                    Tag::BlockQuote(_) => Kind::Quote,
                    Tag::CodeBlock(k) => Kind::Code(match k {
                        CodeBlockKind::Fenced(info) => info.to_string(),
                        CodeBlockKind::Indented => String::new(),
                    }),
                    Tag::List(start) => Kind::List(start),
                    Tag::Item => Kind::Item,
                    Tag::Table(a) => Kind::Table(
                        a.iter()
                            .map(|a| match a {
                                Alignment::None => Align::None,
                                Alignment::Left => Align::Left,
                                Alignment::Center => Align::Center,
                                Alignment::Right => Align::Right,
                            })
                            .collect(),
                    ),
                    Tag::TableHead => Kind::Head,
                    Tag::TableRow => Kind::Row,
                    Tag::TableCell => Kind::Cell,
                    Tag::Emphasis => Kind::Em,
                    Tag::Strong => Kind::Strong,
                    Tag::Strikethrough => Kind::Strike,
                    Tag::Link { dest_url, .. } => Kind::Link(dest_url.to_string()),
                    Tag::Image { dest_url, .. } => Kind::Image(dest_url.to_string()),
                    Tag::HtmlBlock => Kind::Para,
                    _ => Kind::Other,
                };
                stack.push(Frame::new(kind));
            }
            Event::End(end) => {
                let mut f = stack.pop().expect("balanced events");
                let start = top_start;
                match f.kind {
                    Kind::Para => {
                        let node = Node::Para(f.inlines);
                        finish(&mut stack, node, range.end, start);
                    }
                    Kind::Heading(l) => {
                        finish(&mut stack, Node::Heading(l, f.inlines), range.end, start)
                    }
                    Kind::Quote => {
                        f.flush();
                        finish(&mut stack, Node::Quote(f.blocks), range.end, start);
                    }
                    Kind::Code(lang) => {
                        let mut text = f.text;
                        if text.ends_with('\n') {
                            text.pop();
                        }
                        finish(&mut stack, Node::Code { lang, text }, range.end, start);
                    }
                    Kind::List(s) => {
                        let items = f
                            .blocks
                            .into_iter()
                            .filter_map(|n| match n {
                                Node::ItemNode(i) => Some(i),
                                _ => None,
                            })
                            .collect();
                        finish(&mut stack, Node::List { start: s, items }, range.end, start);
                    }
                    Kind::Item => {
                        f.flush();
                        let item = Item {
                            task: f.task,
                            children: f.blocks,
                        };
                        stack.last_mut().unwrap().blocks.push(Node::ItemNode(item));
                    }
                    Kind::Cell => stack.last_mut().unwrap().blocks.push(Node::Cell(f.inlines)),
                    Kind::Head | Kind::Row => {
                        let cells = f
                            .blocks
                            .into_iter()
                            .filter_map(|n| match n {
                                Node::Cell(c) => Some(c),
                                _ => None,
                            })
                            .collect();
                        let parent = stack.last_mut().unwrap();
                        if matches!(end, TagEnd::TableHead) {
                            parent.blocks.insert(0, Node::Row(cells));
                            parent.task = Some(true); // marks "has head"
                        } else {
                            parent.blocks.push(Node::Row(cells));
                        }
                    }
                    Kind::Table(align) => {
                        let mut rows: Vec<Vec<Vec<Inline>>> = f
                            .blocks
                            .into_iter()
                            .filter_map(|n| match n {
                                Node::Row(r) => Some(r),
                                _ => None,
                            })
                            .collect();
                        let head = if f.task.is_some() && !rows.is_empty() {
                            rows.remove(0)
                        } else {
                            Vec::new()
                        };
                        finish(
                            &mut stack,
                            Node::Table { align, head, rows },
                            range.end,
                            start,
                        );
                    }
                    Kind::Strong => push_inline(&mut stack, Inline::Strong(f.inlines)),
                    Kind::Em => push_inline(&mut stack, Inline::Em(f.inlines)),
                    Kind::Strike => push_inline(&mut stack, Inline::Strike(f.inlines)),
                    Kind::Link(href) => push_inline(
                        &mut stack,
                        Inline::Link {
                            href,
                            children: f.inlines,
                        },
                    ),
                    Kind::Image(src) => {
                        let alt = plain_text(&f.inlines);
                        push_inline(&mut stack, Inline::Image { src, alt });
                    }
                    Kind::Other | Kind::Root => {
                        for i in f.inlines {
                            push_inline(&mut stack, i);
                        }
                    }
                }
            }
            Event::Text(t) => {
                let top = stack.last_mut().unwrap();
                if matches!(top.kind, Kind::Code(_)) {
                    top.text.push_str(&t);
                } else if stack
                    .iter()
                    .any(|f| matches!(f.kind, Kind::Link(_) | Kind::Image(_)))
                {
                    push_inline(&mut stack, Inline::Text(t.to_string()));
                } else {
                    for i in linkify(&t) {
                        push_inline(&mut stack, i);
                    }
                }
            }
            Event::Code(t) => push_inline(&mut stack, Inline::Code(t.to_string())),
            Event::Html(t) | Event::InlineHtml(t) => {
                if stack.len() == 1 {
                    // Bare HTML at the top level without a block wrapper: show as text.
                    finish(
                        &mut stack,
                        Node::Para(vec![Inline::Text(t.to_string())]),
                        range.end,
                        range.start,
                    );
                } else {
                    push_inline(&mut stack, Inline::Text(t.to_string()))
                }
            }
            Event::SoftBreak => push_inline(&mut stack, Inline::Text(" ".into())),
            Event::HardBreak => push_inline(&mut stack, Inline::Break),
            Event::Rule => {
                if stack.len() == 1 {
                    finish(&mut stack, Node::Rule, range.end, range.start);
                } else {
                    add_block(stack.last_mut().unwrap(), Node::Rule);
                }
            }
            Event::TaskListMarker(done) => {
                if let Some(f) = stack
                    .iter_mut()
                    .rev()
                    .find(|f| matches!(f.kind, Kind::Item))
                {
                    f.task = Some(done);
                }
            }
            Event::FootnoteReference(t) => push_inline(&mut stack, Inline::Text(format!("[{t}]"))),
            _ => {}
        }
    }
    out
}

fn add_block(frame: &mut Frame, node: Node) {
    frame.flush();
    frame.blocks.push(node);
}

fn push_inline(stack: &mut [Frame], inline: Inline) {
    let top = stack.last_mut().unwrap();
    // Merge adjacent text runs so soft breaks don't split words into many nodes.
    if let (Inline::Text(t), Some(Inline::Text(prev))) = (&inline, top.inlines.last_mut()) {
        prev.push_str(t);
        return;
    }
    top.inlines.push(inline);
}

pub fn plain_text(inlines: &[Inline]) -> String {
    let mut s = String::new();
    for i in inlines {
        match i {
            Inline::Text(t) | Inline::Code(t) => s.push_str(t),
            Inline::Strong(c) | Inline::Em(c) | Inline::Strike(c) => s.push_str(&plain_text(c)),
            Inline::Link { children, .. } => s.push_str(&plain_text(children)),
            Inline::Image { alt, .. } => s.push_str(alt),
            Inline::Break => s.push('\n'),
        }
    }
    s
}

/// Splits bare `http(s)://` URLs out of text as links (GFM extended autolinks). Trailing
/// punctuation stays outside the link, as in ui-next's INLINE pattern.
pub fn linkify(text: &str) -> Vec<Inline> {
    let mut out = Vec::new();
    let mut rest = text;
    loop {
        let at = [rest.find("https://"), rest.find("http://")]
            .into_iter()
            .flatten()
            .min();
        let Some(at) = at else { break };
        // Must start a word.
        if at > 0 && rest.as_bytes()[at - 1].is_ascii_alphanumeric() {
            let skip = at + 4;
            out.push(Inline::Text(rest[..skip].into()));
            rest = &rest[skip..];
            continue;
        }
        let tail = &rest[at..];
        let mut end = tail
            .find(|c: char| c.is_whitespace() || "<>()".contains(c))
            .unwrap_or(tail.len());
        while end > 0 && ".,;:!?'\"".contains(tail.as_bytes()[end - 1] as char) {
            end -= 1;
        }
        let url = &tail[..end];
        if url.len() <= "https://".len() {
            out.push(Inline::Text(rest[..at + url.len().max(1)].into()));
            rest = &rest[at + url.len().max(1)..];
            continue;
        }
        if at > 0 {
            out.push(Inline::Text(rest[..at].into()));
        }
        out.push(Inline::Link {
            href: url.into(),
            children: vec![Inline::Text(url.into())],
        });
        rest = &tail[end..];
    }
    if !rest.is_empty() {
        out.push(Inline::Text(rest.into()));
    }
    // Merge the text runs the skips produced.
    let mut merged: Vec<Inline> = Vec::with_capacity(out.len());
    for i in out {
        if let (Inline::Text(t), Some(Inline::Text(p))) = (&i, merged.last_mut()) {
            p.push_str(t);
            continue;
        }
        merged.push(i);
    }
    merged
}

/// Only web and mail links open from a reply; anything else (paths, `javascript:`) stays text.
pub fn safe_href(href: &str) -> Option<&str> {
    let l = href.trim_start().to_ascii_lowercase();
    (l.starts_with("http:") || l.starts_with("https:") || l.starts_with("mailto:")).then_some(href)
}

/// Where an image lives (port of ui-next's `resolveImage`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImageSource {
    /// http(s), data and blob URLs load directly.
    Uri(String),
    /// A file on the agent's host, read through the daemon; relative paths resolve from `cwd`.
    Host { cwd: String, path: String },
}

fn is_drive_path(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'/' || b[2] == b'\\')
}

fn root_of(abs: &str) -> String {
    if is_drive_path(abs) {
        format!("{}/", &abs[..2])
    } else {
        "/".into()
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = s
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

pub fn resolve_image(src: &str, cwd: Option<&str>) -> Option<ImageSource> {
    let s = src.trim();
    if s.is_empty() {
        return None;
    }
    let lower = s.to_ascii_lowercase();
    if ["http:", "https:", "data:", "blob:"]
        .iter()
        .any(|p| lower.starts_with(p))
    {
        return Some(ImageSource::Uri(s.into()));
    }
    if lower.starts_with("file:") {
        let mut rest = &s[5..];
        rest = rest.strip_prefix("//").unwrap_or(rest);
        if rest.to_ascii_lowercase().starts_with("localhost") {
            rest = &rest[9..];
        }
        let mut p = percent_decode(rest);
        if p.starts_with('/') && is_drive_path(&p[1..]) {
            p.remove(0);
        }
        return Some(ImageSource::Host {
            cwd: root_of(&p),
            path: p,
        });
    }
    // Another scheme (but not a Windows drive).
    if let Some(colon) = s.find(':') {
        let scheme = &s[..colon];
        if !scheme.is_empty()
            && scheme.as_bytes()[0].is_ascii_alphabetic()
            && scheme
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"+.-_".contains(&c))
            && !is_drive_path(s)
        {
            return None;
        }
    }
    let p = percent_decode(s);
    if p == "~" || p.starts_with("~/") {
        return Some(ImageSource::Host {
            cwd: "~".into(),
            path: p,
        });
    }
    if p.starts_with('/') || is_drive_path(&p) {
        return Some(ImageSource::Host {
            cwd: root_of(&p),
            path: p,
        });
    }
    let cwd = cwd?;
    Some(ImageSource::Host {
        cwd: cwd.into(),
        path: p.strip_prefix("./").unwrap_or(&p).into(),
    })
}

// ---- table column widths (ui-next `MdTable.tsx`) ---------------------------------------------

const MIN_COL: f64 = 56.0;
const MAX_COL: f64 = 300.0;
const CHAR_PX: f64 = 7.4;
const CELL_PAD: f64 = 24.0;

/// Column widths in px from each column's longest cell, so wrapped rows still line up across
/// columns. The table grows them proportionally to fill the reply and scrolls when wider.
pub fn column_widths(head: &[Vec<Inline>], rows: &[Vec<Vec<Inline>>]) -> Vec<u32> {
    let ncols = rows.iter().map(Vec::len).fold(head.len(), usize::max);
    let len = |cell: Option<&Vec<Inline>>| cell.map_or(0, |i| plain_text(i).chars().count());
    (0..ncols)
        .map(|c| {
            let longest = rows
                .iter()
                .map(|r| len(r.get(c)))
                .fold(len(head.get(c)), usize::max);
            (longest as f64 * CHAR_PX + CELL_PAD)
                .clamp(MIN_COL, MAX_COL)
                .round() as u32
        })
        .collect()
}

// ---- data URLs ---------------------------------------------------------------------------------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard padded base64.
pub fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(B64[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A `data:` URL for an image's bytes.
pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64(bytes))
}
