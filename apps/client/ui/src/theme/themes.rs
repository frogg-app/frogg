//! Themes (apps/ui-next/src/theme/themes.ts, extended): named palettes, per-token colour
//! overrides, the derived colours computed from the palette unless a theme pins them, plus the
//! non-colour tokens (shape, type, depth, motion) and optional raw CSS. Built-ins are `const`;
//! plugin themes are registered at runtime (`register`). Contract: styles/THEMING.md.

use std::collections::BTreeMap;

pub type Pairs = &'static [(&'static str, &'static str)];

pub struct ThemeDef {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    /// "dark" or "light".
    pub scheme: &'static str,
    /// Palette keys (camelCase, as in themes.ts) plus any pinned derived tokens.
    pub palette: Pairs,
    pub label_tint: Option<Pairs>,
    pub syntax: Pairs,
    pub terminal: Pairs,
    /// Non-colour tokens over the base defaults in styles/theme.css: CSS custom property names
    /// without `--` (`r-card`, `font-body`, `glow`, …), plus `corners` (`cut` | `round`) and
    /// `ornaments` (`on` | `off`), which become `data-corners` / `data-ornaments` on `<html>`.
    pub tokens: Pairs,
    /// Raw CSS injected after the base styles while this theme is active. Scope rules to
    /// `:root[data-theme="<id>"]`.
    pub css: &'static str,
}

const LABEL_TINT: Pairs = &[
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

pub const GRAPHITE: ThemeDef = ThemeDef {
    id: "graphite",
    label: "Graphite",
    description: "Bracket shapes on neutral graphite with a calm blue accent.",
    scheme: "dark",
    palette: &[
        ("bg", "#16181b"),
        ("bg2", "#1a1d20"),
        ("panel", "#1d2024"),
        ("raise", "#25292d"),
        ("text", "#eceff1"),
        ("muted", "#a3abb2"),
        ("faint", "#6c757d"),
        ("cyan", "#82aaff"),
        ("cyan2", "#b0c9ff"),
        ("deep", "#3f5fa8"),
        ("mint", "#8fcf96"),
        ("violet", "#c3a6ef"),
        ("amber", "#ffcb6b"),
        ("coral", "#f07178"),
        ("onAccent", "#0f1a2e"),
        ("onWarn", "#1f1600"),
        ("addText", "#c2e6c6"),
        ("delText", "#ffc4c8"),
        ("ink", "#ffffff"),
        ("shadow", "#000000"),
        ("line", "rgba(255,255,255,0.07)"),
        ("line2", "rgba(255,255,255,0.14)"),
        ("scrim", "rgba(10,11,13,0.6)"),
    ],
    label_tint: None,
    syntax: &[
        ("keyword", "#c792ea"),
        ("comment", "#6c757d"),
        ("string", "#c3e88d"),
        ("number", "#f78c6c"),
        ("literal", "#f78c6c"),
        ("function", "#82aaff"),
        ("definition", "#82aaff"),
        ("class", "#ffcb6b"),
        ("type", "#ffcb6b"),
        ("tag", "#f07178"),
        ("attribute", "#c792ea"),
        ("property", "#b2ccd6"),
        ("variable", "#eceff1"),
        ("operator", "#89ddff"),
        ("punctuation", "#a3abb2"),
        ("regexp", "#89ddff"),
        ("escape", "#f78c6c"),
        ("meta", "#6c757d"),
        ("heading", "#82aaff"),
        ("link", "#80cbc4"),
    ],
    terminal: &[
        ("black", "#1d2024"),
        ("blue", "#82aaff"),
        ("white", "#d5dade"),
        ("brightRed", "#ff9aa0"),
        ("brightGreen", "#c3e88d"),
        ("brightYellow", "#ffd98e"),
        ("brightBlue", "#a8c4ff"),
        ("brightMagenta", "#d6b8f5"),
        ("brightWhite", "#ffffff"),
    ],
    tokens: &[],
    css: "",
};

pub const GRAPHITE_LIGHT: ThemeDef = ThemeDef {
    id: "graphite-light",
    label: "Graphite Light",
    description: "Bracket shapes on light paper surfaces, the same calm blue accent.",
    scheme: "light",
    palette: &[
        ("bg", "#f5f6f8"),
        ("bg2", "#eceef2"),
        ("panel", "#ffffff"),
        ("raise", "#e9ecf0"),
        ("text", "#1a1f26"),
        ("muted", "#4a535e"),
        ("faint", "#5f6873"),
        ("cyan", "#2557c2"),
        ("cyan2", "#1d4aa6"),
        ("deep", "#173a85"),
        ("mint", "#1b7a3a"),
        ("violet", "#6a3fc0"),
        ("amber", "#8a5800"),
        ("coral", "#c0283a"),
        ("onAccent", "#ffffff"),
        ("onWarn", "#ffffff"),
        ("addText", "#18652f"),
        ("delText", "#a01f2e"),
        ("ink", "#0b1220"),
        ("shadow", "#3a4556"),
        ("line", "rgba(11,18,32,0.11)"),
        ("line2", "rgba(11,18,32,0.2)"),
        ("wash", "rgba(11,18,32,0.03)"),
        ("wash2", "rgba(11,18,32,0.05)"),
        ("wash3", "rgba(11,18,32,0.09)"),
        ("scrim", "rgba(26,31,38,0.32)"),
    ],
    label_tint: Some(&[
        ("violet", "#6a4fb0"),
        ("sky", "#1f6a9a"),
        ("emerald", "#1e7356"),
        ("orange", "#9a5413"),
        ("pink", "#a8336b"),
        ("indigo", "#4650a8"),
        ("teal", "#17706e"),
        ("red", "#a8343a"),
        ("amber", "#7a6100"),
        ("blue", "#2f5ea8"),
    ]),
    syntax: &[
        ("keyword", "#7a3cb8"),
        ("comment", "#5f6873"),
        ("string", "#1b6b33"),
        ("number", "#9a4a00"),
        ("literal", "#9a4a00"),
        ("function", "#2050b0"),
        ("definition", "#2050b0"),
        ("class", "#8a5800"),
        ("type", "#8a5800"),
        ("tag", "#b0263a"),
        ("attribute", "#7a3cb8"),
        ("property", "#265f80"),
        ("variable", "#1a1f26"),
        ("operator", "#0b6a80"),
        ("punctuation", "#4a535e"),
        ("regexp", "#0b6a80"),
        ("escape", "#9a4a00"),
        ("meta", "#5f6873"),
        ("heading", "#2050b0"),
        ("link", "#1d6f6a"),
    ],
    terminal: &[
        ("black", "#1a1f26"),
        ("blue", "#2557c2"),
        ("white", "#5f6873"),
        ("brightRed", "#a01f2e"),
        ("brightGreen", "#18652f"),
        ("brightYellow", "#7a4e00"),
        ("brightBlue", "#1d4aa6"),
        ("brightMagenta", "#5a32a8"),
        ("brightWhite", "#4a535e"),
    ],
    tokens: &[],
    css: "",
};

/// Shape, type and depth of the Material themes: rounded, flat, no glow or gradients.
const MATERIAL_TOKENS: Pairs = &[
    ("corners", "round"),
    ("ornaments", "off"),
    ("r-sm", "6px"),
    ("r-md", "8px"),
    ("r-card", "12px"),
    ("r-menu", "12px"),
    ("r-button", "20px"),
    ("r-field", "8px"),
    ("r-chip", "8px"),
    ("r-row", "8px"),
    ("r-cut", "10px"),
    ("glow", "0"),
    ("accent-fill", "var(--cyan)"),
    ("accent-bar", "var(--cyan)"),
    ("accent-soft", "var(--cyan-wash2)"),
    ("banner-wash", "linear-gradient(transparent, transparent)"),
    (
        "elev-1",
        "0 1px 2px color-mix(in srgb, var(--shadow) 30%, transparent), 0 1px 3px 1px color-mix(in srgb, var(--shadow) 15%, transparent)",
    ),
    (
        "elev-2",
        "0 1px 2px color-mix(in srgb, var(--shadow) 30%, transparent), 0 2px 6px 2px color-mix(in srgb, var(--shadow) 15%, transparent)",
    ),
    (
        "elev-3",
        "0 4px 8px 3px color-mix(in srgb, var(--shadow) 15%, transparent), 0 1px 3px color-mix(in srgb, var(--shadow) 30%, transparent)",
    ),
    (
        "elev-drop-1",
        "drop-shadow(0 1px 3px color-mix(in srgb, var(--shadow) 28%, transparent))",
    ),
    (
        "elev-drop-2",
        "drop-shadow(0 2px 6px color-mix(in srgb, var(--shadow) 28%, transparent))",
    ),
    (
        "elev-drop-3",
        "drop-shadow(0 4px 12px color-mix(in srgb, var(--shadow) 30%, transparent))",
    ),
    (
        "font-body",
        "\"Roboto\", \"Inter\", system-ui, -apple-system, \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif",
    ),
    ("font-display", "var(--font-body)"),
    ("font-label", "var(--font-body)"),
    ("fw-display", "500"),
    ("label-transform", "none"),
    ("label-tracking", "0.1px"),
    ("label-size", "11.5px"),
    ("label-weight", "500"),
];

/// Material details the tokens alone don't cover: solid selection markers and no accent
/// stripes on buttons.
const MATERIAL_CSS: &str = r#":root[data-theme^="material"] .btn-bar .btn-stripe { display: none; }
:root[data-theme^="material"] .btn-outline { box-shadow: inset 0 0 0 var(--bw) var(--line2); }
:root[data-theme^="material"] .seg-pill { box-shadow: none; border-radius: var(--r-chip); }
:root[data-theme^="material"] .sheet.phone { box-shadow: var(--elev-3); }
"#;

/// Material 3–style, restrained: neutral greys, one muted blue accent, calm status colours.
pub const MATERIAL: ThemeDef = ThemeDef {
    id: "material",
    label: "Material",
    description: "Rounded, flat and quiet: neutral greys with a muted blue accent.",
    scheme: "dark",
    palette: &[
        ("bg", "#131416"),
        ("bg2", "#17181b"),
        ("panel", "#1c1d21"),
        ("raise", "#25272b"),
        ("text", "#e4e5e8"),
        ("muted", "#aaadb3"),
        ("faint", "#7c8088"),
        ("cyan", "#94b4e8"),
        ("cyan2", "#b5cbf0"),
        ("deep", "#3d5a8c"),
        ("mint", "#86c59a"),
        ("violet", "#b9a9e0"),
        ("amber", "#dfb866"),
        ("coral", "#e8918c"),
        ("onAccent", "#0e1c33"),
        ("onWarn", "#241a00"),
        ("addText", "#bfe0c8"),
        ("delText", "#f3c6c3"),
        ("ink", "#ffffff"),
        ("shadow", "#000000"),
        ("line", "rgba(255,255,255,0.08)"),
        ("line2", "rgba(255,255,255,0.14)"),
        ("wash", "rgba(255,255,255,0.03)"),
        ("wash2", "rgba(255,255,255,0.055)"),
        ("wash3", "rgba(255,255,255,0.09)"),
        ("scrim", "rgba(0,0,0,0.5)"),
    ],
    label_tint: None,
    syntax: &[
        ("keyword", "#c2a5e6"),
        ("comment", "#7c8088"),
        ("string", "#a8d4a2"),
        ("number", "#e3a679"),
        ("literal", "#e3a679"),
        ("function", "#94b4e8"),
        ("definition", "#94b4e8"),
        ("class", "#dfc07a"),
        ("type", "#dfc07a"),
        ("tag", "#e8918c"),
        ("attribute", "#c2a5e6"),
        ("property", "#b3c7d4"),
        ("variable", "#e4e5e8"),
        ("operator", "#8fc8d8"),
        ("punctuation", "#aaadb3"),
        ("regexp", "#8fc8d8"),
        ("escape", "#e3a679"),
        ("meta", "#7c8088"),
        ("heading", "#94b4e8"),
        ("link", "#88c2bc"),
    ],
    terminal: &[
        ("black", "#1c1d21"),
        ("blue", "#94b4e8"),
        ("white", "#d6d8dc"),
        ("brightRed", "#f0a9a5"),
        ("brightGreen", "#a8d4a2"),
        ("brightYellow", "#ead08f"),
        ("brightBlue", "#b5cbf0"),
        ("brightMagenta", "#d2bfee"),
        ("brightWhite", "#ffffff"),
    ],
    tokens: MATERIAL_TOKENS,
    css: MATERIAL_CSS,
};

pub const MATERIAL_LIGHT: ThemeDef = ThemeDef {
    id: "material-light",
    label: "Material Light",
    description: "Material on light surfaces: the same shapes and muted blue accent.",
    scheme: "light",
    palette: &[
        ("bg", "#f7f8fa"),
        ("bg2", "#eff1f4"),
        ("panel", "#ffffff"),
        ("raise", "#eceef2"),
        ("text", "#1b1c1f"),
        ("muted", "#474b52"),
        ("faint", "#666b73"),
        ("cyan", "#3a5f9e"),
        ("cyan2", "#2f5190"),
        ("deep", "#22406f"),
        ("mint", "#2d7048"),
        ("violet", "#634f9c"),
        ("amber", "#80590c"),
        ("coral", "#a8352d"),
        ("onAccent", "#ffffff"),
        ("onWarn", "#ffffff"),
        ("addText", "#1f6037"),
        ("delText", "#952c25"),
        ("ink", "#111317"),
        ("shadow", "#1d232c"),
        ("line", "rgba(17,19,23,0.1)"),
        ("line2", "rgba(17,19,23,0.18)"),
        ("wash", "rgba(17,19,23,0.03)"),
        ("wash2", "rgba(17,19,23,0.05)"),
        ("wash3", "rgba(17,19,23,0.08)"),
        ("scrim", "rgba(17,19,23,0.32)"),
    ],
    label_tint: GRAPHITE_LIGHT.label_tint,
    syntax: GRAPHITE_LIGHT.syntax,
    terminal: GRAPHITE_LIGHT.terminal,
    tokens: MATERIAL_TOKENS,
    css: MATERIAL_CSS,
};

pub const BLUE_TECH: ThemeDef = ThemeDef {
    id: "blue-tech",
    label: "Blue Tech",
    description: "The original deep-teal Bracket look with cyan glow.",
    scheme: "dark",
    palette: &[
        ("bg", "#080b0d"),
        ("bg2", "#0c1114"),
        ("panel", "#0e1418"),
        ("raise", "#131b20"),
        ("text", "#f2f6f7"),
        ("muted", "#9aa6a9"),
        ("faint", "#5f6b6e"),
        ("cyan", "#25b5c8"),
        ("cyan2", "#7fd9e6"),
        ("deep", "#045b9d"),
        ("mint", "#3fcf8e"),
        ("violet", "#8b7cf6"),
        ("amber", "#f5b84a"),
        ("coral", "#ff6b6b"),
        ("onAccent", "#04161a"),
        ("onWarn", "#1a1204"),
        ("addText", "#a6ecc8"),
        ("delText", "#ffb3b3"),
        ("ink", "#ffffff"),
        ("shadow", "#000000"),
        ("line", "rgba(255,255,255,0.08)"),
        ("line2", "rgba(255,255,255,0.16)"),
        ("wash", "rgba(255,255,255,0.03)"),
        ("wash2", "rgba(255,255,255,0.05)"),
        ("wash3", "rgba(255,255,255,0.1)"),
        ("scrim", "rgba(4,8,10,0.6)"),
        ("coralWash", "rgba(255,107,107,0.08)"),
        ("cyanWash", "rgba(37,181,200,0.1)"),
        ("cyanWash2", "rgba(37,181,200,0.18)"),
        ("cyanWash3", "rgba(37,181,200,0.28)"),
        ("cyanDim", "#1e9aab"),
        ("mintDim", "#33b47a"),
    ],
    label_tint: None,
    syntax: &[
        ("keyword", "#8b7cf6"),
        ("comment", "#5f6b6e"),
        ("string", "#7fe3b2"),
        ("number", "#f5b84a"),
        ("literal", "#f5b84a"),
        ("function", "#7fd9e6"),
        ("definition", "#7fd9e6"),
        ("class", "#ffcf7a"),
        ("type", "#b1a6fa"),
        ("tag", "#7fd9e6"),
        ("attribute", "#f5b84a"),
        ("property", "#c9e6ea"),
        ("variable", "#f2f6f7"),
        ("operator", "#9aa6a9"),
        ("punctuation", "#9aa6a9"),
        ("regexp", "#7fe3b2"),
        ("escape", "#f5b84a"),
        ("meta", "#5f6b6e"),
        ("heading", "#7fd9e6"),
        ("link", "#25b5c8"),
    ],
    terminal: &[
        ("black", "#0c1114"),
        ("blue", "#4aa3df"),
        ("white", "#d6dee0"),
        ("brightRed", "#ff8f8f"),
        ("brightGreen", "#7fe3b2"),
        ("brightYellow", "#ffd27a"),
        ("brightBlue", "#7fc0ef"),
        ("brightMagenta", "#b1a6fa"),
        ("brightWhite", "#ffffff"),
    ],
    tokens: &[],
    css: "",
};

pub const THEMES: &[&ThemeDef] = &[
    &MATERIAL,
    &MATERIAL_LIGHT,
    &GRAPHITE,
    &GRAPHITE_LIGHT,
    &BLUE_TECH,
];
pub const DEFAULT_THEME_ID: &str = "material";

/// Keys a user can override, in the order Settings lists them.
pub const OVERRIDABLE: &[&str] = &[
    "bg", "bg2", "panel", "raise", "text", "muted", "faint", "cyan", "cyan2", "deep", "mint",
    "violet", "amber", "coral", "onAccent",
];

/// The stored choice: a theme id plus per-token overrides (`#rrggbb`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ThemeChoice {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub overrides: BTreeMap<String, String>,
}

pub fn find_theme(id: &str) -> &'static ThemeDef {
    all().into_iter().find(|t| t.id == id).unwrap_or(&MATERIAL)
}

thread_local! {
    /// Themes contributed at runtime (plugins), keyed by id; registration order is kept.
    static EXTRA: std::cell::RefCell<Vec<(&'static ThemeDef, String)>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Built-ins, then registered themes.
pub fn all() -> Vec<&'static ThemeDef> {
    let mut v: Vec<&'static ThemeDef> = THEMES.to_vec();
    EXTRA.with(|e| v.extend(e.borrow().iter().map(|(t, _)| *t)));
    v
}

/// A theme as a plugin contributes it (manifest `contributes.themes[]`, THEMING.md). Colours
/// missing from `colors` come from `extends` (a built-in id; default by scheme).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSpec {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub scheme: Option<String>,
    #[serde(default)]
    pub extends: Option<String>,
    #[serde(default)]
    pub colors: BTreeMap<String, String>,
    #[serde(default)]
    pub tokens: BTreeMap<String, String>,
    #[serde(default)]
    pub syntax: BTreeMap<String, String>,
    #[serde(default)]
    pub terminal: BTreeMap<String, String>,
    #[serde(default)]
    pub css: String,
}

/// Max raw CSS a contributed theme may carry.
pub const MAX_THEME_CSS: usize = 64 * 1024;

fn safe_name(k: &str) -> bool {
    !k.is_empty()
        && k.len() <= 48
        && k.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// A token value may not close the declaration or the rule it lands in.
fn safe_value(v: &str) -> bool {
    v.len() <= 400 && !v.contains([';', '{', '}', '<'])
}

fn leak(s: &str) -> &'static str {
    Box::leak(s.to_owned().into_boxed_str())
}

fn merge(base: Pairs, extra: &BTreeMap<String, String>) -> Pairs {
    let mut out: Vec<(&'static str, &'static str)> = base.to_vec();
    for (k, v) in extra {
        if !(safe_name(k) && safe_value(v)) {
            continue;
        }
        let (k, v) = (leak(k), leak(v));
        match out.iter_mut().find(|(n, _)| *n == k) {
            Some(slot) => slot.1 = v,
            None => out.push((k, v)),
        }
    }
    Box::leak(out.into_boxed_slice())
}

/// Registers a contributed theme under `<owner>.<id>`; returns the full id. Re-registering the
/// same spec is free; a changed spec replaces the old entry. Leaks the strings it keeps (a few
/// KB per distinct spec).
pub fn register(owner: &str, spec: &ThemeSpec) -> Option<String> {
    if !safe_name(owner) || !safe_name(&spec.id) || spec.label.trim().is_empty() {
        return None;
    }
    let id = format!("{owner}.{}", spec.id);
    let key = serde_json::to_string(spec).ok()?;
    if EXTRA.with(|e| e.borrow().iter().any(|(t, k)| t.id == id && *k == key)) {
        return Some(id);
    }
    let scheme = match spec.scheme.as_deref() {
        Some("light") => "light",
        _ => "dark",
    };
    let base = spec
        .extends
        .as_deref()
        .and_then(|b| THEMES.iter().copied().find(|t| t.id == b))
        .unwrap_or(if scheme == "light" {
            &MATERIAL_LIGHT
        } else {
            &MATERIAL
        });
    let css = if spec.css.len() <= MAX_THEME_CSS {
        leak(&spec.css)
    } else {
        ""
    };
    let def: &'static ThemeDef = Box::leak(Box::new(ThemeDef {
        id: leak(&id),
        label: leak(spec.label.trim()),
        description: leak(spec.description.trim()),
        scheme,
        palette: merge(base.palette, &spec.colors),
        label_tint: base.label_tint,
        syntax: merge(base.syntax, &spec.syntax),
        terminal: merge(base.terminal, &spec.terminal),
        tokens: merge(base.tokens, &spec.tokens),
        css: if spec.extends.is_some() && spec.css.is_empty() {
            base.css
        } else {
            css
        },
    }));
    EXTRA.with(|e| {
        let mut e = e.borrow_mut();
        e.retain(|(t, _)| t.id != id);
        e.push((def, key));
    });
    Some(id)
}

/// Drops every registered theme whose id is not in `keep`.
pub fn retain_registered(keep: &[String]) {
    EXTRA.with(|e| {
        e.borrow_mut()
            .retain(|(t, _)| keep.iter().any(|k| k == t.id))
    });
}

pub fn is_hex(v: &str) -> bool {
    v.len() == 7 && v.starts_with('#') && v[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn rgb(hex: &str) -> Option<(u8, u8, u8)> {
    let h = hex.trim_start_matches('#');
    let full: String = match h.len() {
        3 | 4 => h[..3].chars().flat_map(|c| [c, c]).collect(),
        n if n >= 6 => h[..6].to_owned(),
        _ => return None,
    };
    let n = u32::from_str_radix(&full, 16).ok()?;
    Some(((n >> 16) as u8, (n >> 8) as u8, n as u8))
}

/// `#rgb` / `#rrggbb` as `rgba(r,g,b,a)`; non-hex input passes through.
pub fn alpha(hex: &str, a: f32) -> String {
    match rgb(hex) {
        Some((r, g, b)) => format!("rgba({r},{g},{b},{a})"),
        None => hex.to_owned(),
    }
}

/// Mix `hex` towards black by `k` (0–1).
fn darken(hex: &str, k: f32) -> String {
    if !hex.starts_with('#') || hex.len() < 7 {
        return hex.to_owned();
    }
    match rgb(hex) {
        Some((r, g, b)) => {
            let ch = |v: u8| ((v as f32) * (1.0 - k)).round() as u8;
            format!("#{:02x}{:02x}{:02x}", ch(r), ch(g), ch(b))
        }
        None => hex.to_owned(),
    }
}

/// Every colour token (camelCase keys) for a choice: palette, then derived, then overrides.
pub struct Resolved {
    pub def: &'static ThemeDef,
    pub color: BTreeMap<&'static str, String>,
}

impl Resolved {
    pub fn get(&self, key: &str) -> &str {
        self.color.get(key).map(String::as_str).unwrap_or("")
    }
}

pub fn resolve(choice: &ThemeChoice) -> Resolved {
    let def = find_theme(&choice.id);
    let overrides: BTreeMap<&str, &str> = choice
        .overrides
        .iter()
        .filter(|(_, v)| is_hex(v))
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let pal = |k: &str| -> Option<&'static str> {
        def.palette.iter().find(|(n, _)| *n == k).map(|(_, v)| *v)
    };
    let base = |k: &str| -> String {
        overrides
            .get(k)
            .map(|s| (*s).to_owned())
            .or_else(|| pal(k).map(str::to_owned))
            .unwrap_or_default()
    };
    // A pinned derived value only stands while the base key it came from is not overridden.
    let pin = |k: &str, from: &str| -> Option<String> {
        if overrides.contains_key(from) {
            None
        } else {
            pal(k).map(str::to_owned)
        }
    };
    let mut color: BTreeMap<&'static str, String> = BTreeMap::new();
    for (k, v) in def.palette {
        color.insert(k, (*v).to_owned());
    }
    let ink = base("ink");
    let derived: [(&'static str, String); 12] = [
        (
            "line",
            pin("line", "ink").unwrap_or_else(|| alpha(&ink, 0.08)),
        ),
        (
            "line2",
            pin("line2", "ink").unwrap_or_else(|| alpha(&ink, 0.16)),
        ),
        (
            "wash",
            pin("wash", "ink").unwrap_or_else(|| alpha(&ink, 0.03)),
        ),
        (
            "wash2",
            pin("wash2", "ink").unwrap_or_else(|| alpha(&ink, 0.05)),
        ),
        (
            "wash3",
            pin("wash3", "ink").unwrap_or_else(|| alpha(&ink, 0.1)),
        ),
        (
            "scrim",
            pin("scrim", "bg").unwrap_or_else(|| alpha(&base("bg"), 0.6)),
        ),
        (
            "coralWash",
            pin("coralWash", "coral").unwrap_or_else(|| alpha(&base("coral"), 0.08)),
        ),
        (
            "cyanWash",
            pin("cyanWash", "cyan").unwrap_or_else(|| alpha(&base("cyan"), 0.1)),
        ),
        (
            "cyanWash2",
            pin("cyanWash2", "cyan").unwrap_or_else(|| alpha(&base("cyan"), 0.18)),
        ),
        (
            "cyanWash3",
            pin("cyanWash3", "cyan").unwrap_or_else(|| alpha(&base("cyan"), 0.28)),
        ),
        (
            "cyanDim",
            pin("cyanDim", "cyan").unwrap_or_else(|| darken(&base("cyan"), 0.17)),
        ),
        (
            "mintDim",
            pin("mintDim", "mint").unwrap_or_else(|| darken(&base("mint"), 0.13)),
        ),
    ];
    for (k, v) in derived {
        color.insert(k, v);
    }
    for k in OVERRIDABLE {
        if let Some(v) = overrides.get(k) {
            color.insert(k, (*v).to_owned());
        }
    }
    Resolved { def, color }
}

/// `onAccent` → `on-accent`, `cyanWash2` → `cyan-wash2`.
pub fn kebab(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 2);
    for c in key.chars() {
        if c.is_ascii_uppercase() {
            out.push('-');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_from_palette_and_follows_overrides() {
        let r = resolve(&ThemeChoice {
            id: "graphite".into(),
            ..Default::default()
        });
        assert_eq!(r.def.id, "graphite");
        assert_eq!(r.get("line"), "rgba(255,255,255,0.07)");
        assert_eq!(r.get("cyanWash"), "rgba(130,170,255,0.1)");
        assert_eq!(resolve(&ThemeChoice::default()).def.id, "material");
        let mut c = ThemeChoice {
            id: "blue-tech".into(),
            ..Default::default()
        };
        assert_eq!(resolve(&c).get("cyanDim"), "#1e9aab");
        c.overrides.insert("cyan".into(), "#ff0000".into());
        c.overrides.insert("mint".into(), "nope".into());
        let r = resolve(&c);
        assert_eq!(r.get("cyan"), "#ff0000");
        assert_eq!(r.get("cyanWash"), "rgba(255,0,0,0.1)");
        assert_eq!(r.get("cyanDim"), "#d40000");
        assert_eq!(r.get("mintDim"), "#33b47a");
        assert_eq!(kebab("cyanWash2"), "cyan-wash2");
    }

    #[test]
    fn registers_contributed_themes() {
        let mut spec = ThemeSpec {
            id: "paper".into(),
            label: "Paper".into(),
            description: String::new(),
            scheme: Some("light".into()),
            extends: None,
            colors: BTreeMap::from([("cyan".into(), "#ff0000".into())]),
            tokens: BTreeMap::from([
                ("r-card".into(), "2px".into()),
                ("bad;".into(), "x".into()),
                ("glow".into(), "1;}body{".into()),
            ]),
            syntax: BTreeMap::new(),
            terminal: BTreeMap::new(),
            css: ":root[data-theme=\"acme.paper\"] .tool { border-width: 2px; }".into(),
        };
        let id = register("acme", &spec).unwrap();
        assert_eq!(id, "acme.paper");
        let t = find_theme(&id);
        assert_eq!(t.scheme, "light");
        let tok = |k: &str| t.tokens.iter().find(|(n, _)| *n == k).map(|(_, v)| *v);
        assert_eq!(tok("r-card"), Some("2px"));
        assert_eq!(tok("corners"), Some("round"));
        assert_eq!(tok("glow"), Some("0"));
        assert_eq!(tok("bad;"), None);
        let r = resolve(&ThemeChoice {
            id: id.clone(),
            ..Default::default()
        });
        assert_eq!(r.get("cyan"), "#ff0000");
        assert_eq!(r.get("bg"), "#f7f8fa");
        assert_eq!(all().len(), THEMES.len() + 1);
        spec.label = "Paper 2".into();
        register("acme", &spec);
        assert_eq!(all().len(), THEMES.len() + 1);
        assert_eq!(find_theme(&id).label, "Paper 2");
        assert!(register("bad owner", &spec).is_none());
        retain_registered(&[]);
        assert_eq!(find_theme(&id).id, "material");
    }
}
