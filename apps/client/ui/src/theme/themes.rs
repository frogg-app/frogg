//! Colour themes (apps/ui-next/src/theme/themes.ts): named palettes, per-token overrides, and the
//! derived tokens computed from the palette unless a theme pins them.

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

pub const MATERIAL: ThemeDef = ThemeDef {
    id: "material",
    label: "Material",
    description: "Neutral graphite with a calm blue accent. Minimal glow.",
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
};

pub const MATERIAL_LIGHT: ThemeDef = ThemeDef {
    id: "material-light",
    label: "Material Light",
    description: "Material on light paper surfaces, the same calm blue accent.",
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
};

pub const THEMES: &[&ThemeDef] = &[&MATERIAL, &MATERIAL_LIGHT, &BLUE_TECH];
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
    THEMES
        .iter()
        .copied()
        .find(|t| t.id == id)
        .unwrap_or(&MATERIAL)
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
        let r = resolve(&ThemeChoice::default());
        assert_eq!(r.def.id, "material");
        assert_eq!(r.get("line"), "rgba(255,255,255,0.07)");
        assert_eq!(r.get("cyanWash"), "rgba(130,170,255,0.1)");
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
}
