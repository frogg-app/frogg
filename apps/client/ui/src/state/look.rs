//! Look-and-feel prefs from Settings → Appearance applied to the document: density, motion and
//! fonts. Stored in the device prefs (`density`, `motion`, `fontBody`, `fontMono`); CSS reads
//! `data-density` / `data-motion` on `<html>` (styles/flows.css) and the font custom properties.

use leptos::prelude::*;
use serde_json::Value;
use wasm_bindgen::JsCast;

pub const DENSITY: &[(&str, &str)] = &[("compact", "Compact"), ("comfortable", "Comfortable")];
pub const FONT_BODY: &[(&str, &str)] = &[("inter", "Inter"), ("system", "System")];
pub const FONT_MONO: &[(&str, &str)] =
    &[("jetbrains", "JetBrains Mono"), ("system", "System mono")];

fn text(prefs: super::Prefs, key: &str, default: &str) -> String {
    prefs
        .all
        .with(|m| m.get(key).and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| default.to_owned())
}

pub fn density(prefs: super::Prefs) -> String {
    text(prefs, "density", "comfortable")
}

/// Motion on unless turned off here (the OS reduced-motion setting still applies in CSS).
pub fn motion(prefs: super::Prefs) -> bool {
    prefs
        .all
        .with(|m| m.get("motion").and_then(Value::as_bool))
        .unwrap_or(true)
}

pub fn font_body(prefs: super::Prefs) -> String {
    text(prefs, "fontBody", "inter")
}

pub fn font_mono(prefs: super::Prefs) -> String {
    text(prefs, "fontMono", "jetbrains")
}

pub fn init() {
    let prefs = super::get().prefs;
    Effect::new(move |_| {
        let density = density(prefs);
        let motion = motion(prefs);
        let body = font_body(prefs);
        let mono = font_mono(prefs);
        let Some(el) = document()
            .document_element()
            .and_then(|e| e.dyn_into::<web_sys::HtmlElement>().ok())
        else {
            return;
        };
        let _ = el.set_attribute("data-density", &density);
        let _ = el.set_attribute("data-motion", if motion { "on" } else { "off" });
        let style = el.style();
        if body == "system" {
            let _ = style.set_property(
                "--font-body",
                "system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
            );
        } else {
            let _ = style.remove_property("--font-body");
        }
        if mono == "system" {
            let _ = style.set_property(
                "--font-mono",
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            );
        } else {
            let _ = style.remove_property("--font-mono");
        }
    });
}
