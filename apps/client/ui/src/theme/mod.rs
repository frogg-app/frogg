//! Theme: palettes as CSS custom properties on `:root`, shape/type/depth tokens and theme CSS as
//! an injected stylesheet, the stored choice, layout breakpoints. Base tokens, motion keyframes
//! and fonts live in `styles/theme.css`; the contract is `styles/THEMING.md`.

pub mod layout;
pub mod themes;

use leptos::prelude::*;
use wasm_bindgen::JsCast;

pub use themes::{alpha, resolve, ThemeChoice, ThemeDef, ThemeSpec, THEMES};

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
    /// Bumped whenever the set of available themes changes (plugin themes come and go).
    pub catalog: RwSignal<u32>,
}

impl ThemeStore {
    pub fn init() -> Self {
        let choice = read_stored();
        apply(&choice);
        Self {
            choice: RwSignal::new(choice),
            catalog: RwSignal::new(0),
        }
    }

    /// Every theme the picker offers: built-ins, then contributed ones. Tracks `catalog`.
    pub fn list(&self) -> Vec<&'static ThemeDef> {
        self.catalog.track();
        themes::all()
    }

    /// Replaces the contributed themes with `contributed` (owner id, spec). A stored choice of a
    /// theme that is not (yet) available falls back to Material without being forgotten, so it
    /// comes back when its plugin does.
    pub fn set_contributed(&self, contributed: &[(String, ThemeSpec)]) {
        let ids: Vec<String> = contributed
            .iter()
            .filter_map(|(owner, spec)| themes::register(owner, spec))
            .collect();
        themes::retain_registered(&ids);
        self.catalog.update(|n| *n += 1);
        apply(&self.choice.get_untracked());
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
    let _ = el.set_attribute("data-theme", r.def.id);
    let token = |k: &str, d: &str| -> String {
        r.def
            .tokens
            .iter()
            .find(|(n, _)| *n == k)
            .map(|(_, v)| (*v).to_owned())
            .unwrap_or_else(|| d.to_owned())
    };
    let _ = el.set_attribute("data-corners", &token("corners", "cut"));
    let _ = el.set_attribute("data-ornaments", &token("ornaments", "on"));
    inject_theme_css(r.def);
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

/// Writes the theme's non-colour tokens and raw CSS into one `<style>` at the end of `<head>`, so
/// it follows the base styles; inline user prefs on `<html>` (fonts) still win over it.
fn inject_theme_css(def: &ThemeDef) {
    let doc = document();
    let Some(head) = doc.head() else {
        return;
    };
    let el = match doc.get_element_by_id("frogg-theme") {
        Some(el) => el,
        None => {
            let Ok(el) = doc.create_element("style") else {
                return;
            };
            el.set_id("frogg-theme");
            el
        }
    };
    el.set_text_content(Some(&theme_css(def)));
    // Re-append so it stays last even if styles were added after it.
    let _ = head.append_child(&el);
}

/// The stylesheet text for a theme: `:root:root { --token: value; … }` then its CSS.
pub fn theme_css(def: &ThemeDef) -> String {
    let mut out = String::from(":root:root {\n");
    for (k, v) in def.tokens {
        if matches!(*k, "corners" | "ornaments") {
            continue;
        }
        out.push_str(&format!("  --{k}: {v};\n"));
    }
    out.push_str("}\n");
    out.push_str(def.css);
    out
}
