//! Theme: palettes as CSS custom properties on `:root`, the stored choice, layout breakpoints.
//! Motion keyframes and fonts live in `styles/theme.css`.

pub mod layout;
pub mod themes;

use leptos::prelude::*;
use wasm_bindgen::JsCast;

pub use themes::{alpha, resolve, ThemeChoice, ThemeDef, THEMES};

use crate::state::storage;

const KEY: &str = "frogg.next.theme";
const SHELL_KEY: &str = "frogg.next.chrome";

/// Glide: sliding selection indicators (tabs, segments), ms on the `--ease` curve.
pub const GLIDE_MS: u32 = 200;
/// Overlay motion durations (menus, popovers, palette, sheets).
pub const OVERLAY_IN_MS: u32 = 160;
pub const OVERLAY_OUT_MS: u32 = 110;
/// Toast timings (tokens.ts `toastMs`).
pub const TOAST_IN_MS: u32 = 200;
pub const TOAST_OUT_MS: u32 = 140;
pub const TOAST_LIFE_MS: u32 = 4200;

pub fn read_stored() -> ThemeChoice {
    storage::get_json::<ThemeChoice>(KEY).unwrap_or_default()
}

/// The active theme choice; `set` switches live (no reload, unlike ui-next).
#[derive(Clone, Copy)]
pub struct ThemeStore {
    pub choice: RwSignal<ThemeChoice>,
}

impl ThemeStore {
    pub fn init() -> Self {
        let choice = read_stored();
        apply(&choice);
        Self {
            choice: RwSignal::new(choice),
        }
    }

    pub fn set(&self, choice: ThemeChoice) {
        storage::set_json(KEY, &choice);
        apply(&choice);
        self.choice.set(choice);
    }

    pub fn scheme(&self) -> &'static str {
        themes::find_theme(&self.choice.with(|c| c.id.clone())).scheme
    }
}

const LABEL_TINT_DARK: themes::Pairs = &[
    ("violet", "#a392d5"),
    ("sky", "#6aa6ce"),
    ("emerald", "#6cae96"),
    ("orange", "#cc8f64"),
    ("pink", "#d87da3"),
    ("indigo", "#9299d5"),
    ("teal", "#6cacab"),
    ("red", "#d88381"),
    ("amber", "#b29d64"),
    ("blue", "#7ba1d5"),
];

/// Writes every token of `choice` onto `:root` as `--kebab-name` (syntax as `--syn-*`, terminal as
/// `--term-*`, workspace labels as `--label-*`), sets `color-scheme`, and hands the shell colours
/// to what paints before the UI (desktop splash, window background).
pub fn apply(choice: &ThemeChoice) {
    let r = resolve(choice);
    let Some(root) = document().document_element() else {
        return;
    };
    let Ok(el) = root.dyn_into::<web_sys::HtmlElement>() else {
        return;
    };
    let style = el.style();
    for (k, v) in &r.color {
        let _ = style.set_property(&format!("--{}", themes::kebab(k)), v);
    }
    for (k, v) in r.def.syntax {
        let _ = style.set_property(&format!("--syn-{}", themes::kebab(k)), v);
    }
    for (k, v) in r.def.terminal {
        let _ = style.set_property(&format!("--term-{}", themes::kebab(k)), v);
        // frogg-render's terminal reads ANSI slots by index (render.css `--term-0..15`).
        let index = match *k {
            "black" => Some(0),
            "blue" => Some(4),
            "white" => Some(7),
            "brightRed" => Some(9),
            "brightGreen" => Some(10),
            "brightYellow" => Some(11),
            "brightBlue" => Some(12),
            "brightMagenta" => Some(13),
            "brightWhite" => Some(15),
            _ => None,
        };
        if let Some(i) = index {
            let _ = style.set_property(&format!("--term-{i}"), v);
        }
    }
    for (k, v) in r.def.label_tint.unwrap_or(LABEL_TINT_DARK) {
        let _ = style.set_property(&format!("--label-{k}"), v);
    }
    let _ = style.set_property("color-scheme", r.def.scheme);
    let _ = el.set_attribute("data-scheme", r.def.scheme);
    storage::set_json(
        SHELL_KEY,
        &serde_json::json!({
            "bg": r.get("bg"),
            "faint": r.get("faint"),
            "accent": r.get("cyan"),
            "symbols": r.get("muted"),
        }),
    );
}
