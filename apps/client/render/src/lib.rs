//! Content renderers shared by the client UI: markdown, code highlighting, diffs and the
//! terminal emulator. Pure Rust, no JS dependencies (docs/plans/rust-client.md).
//!
//! Components style themselves with the classes in `render/styles/render.css`, which read the
//! theme's custom properties (`--syn-*` for syntax roles, `--term-*` for the terminal palette,
//! plus the shared `--bg`, `--text`, `--cyan`, …) with Material fallbacks.

pub mod code;
pub mod diff;
pub mod highlight;
mod icons;
pub mod markdown;
pub mod terminal;

pub use code::{Code, CodeFence};
pub use diff::{diff_texts, parse_unified, DiffMode, DiffView, FileDiff};
pub use highlight::{highlight, Lang, Role, Token};
pub use markdown::Markdown;
pub use terminal::{Terminal, TerminalHandle, TerminalSnapshot};

/// The stylesheet for every component here; include it once (Trunk: copy or inline it).
pub const STYLES: &str = include_str!("../styles/render.css");
