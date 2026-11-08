# Theming the Rust client

A theme restyles the whole UI without touching behaviour. It has three layers, applied in this
order:

1. **Colour tokens**: written inline on `<html>` as `--<kebab-name>` (`src/theme/mod.rs::apply`).
2. **Shape / type / depth / motion tokens**: written into `<style id="frogg-theme">` at the end
   of `<head>` as `:root:root { --token: value; }`.
3. **Theme CSS**: raw CSS appended to the same `<style>`, after the tokens.

User preferences (Settings → Appearance: body and code font, density, motion) sit inline on
`<html>` and win over the theme.

`<html>` carries `data-theme="<id>"`, `data-scheme="dark|light"`, `data-corners="cut|round"` and
`data-ornaments="on|off"`. Scope theme CSS with `:root[data-theme="<id>"]`.

Built-in themes live in `src/theme/themes.rs` (`THEMES`). The base token values (the Bracket
look: cut corners, glow, gradients) are in `styles/theme.css`.

## Colour tokens

Palette keys (camelCase in a theme, kebab-case as CSS variables):

| Key                                | Role                                             |
| ---------------------------------- | ------------------------------------------------ |
| `bg`, `bg2`                        | app background, rail/sidebars                    |
| `panel`, `raise`                   | cards and panels, raised controls and menus      |
| `text`, `muted`, `faint`           | text: primary, secondary, tertiary               |
| `cyan`, `cyan2`, `deep`            | accent, accent text/hover, deep accent           |
| `mint`, `amber`, `coral`, `violet` | success, warning, danger, secondary hue          |
| `onAccent`, `onWarn`               | text on an accent / warning fill                 |
| `addText`, `delText`               | diff text                                        |
| `ink`, `shadow`                    | the base for washes and lines, the shadow colour |

Derived unless the theme pins them: `line`, `line2`, `wash`, `wash2`, `wash3`, `scrim`,
`coralWash`, `cyanWash`, `cyanWash2`, `cyanWash3`, `cyanDim`, `mintDim`. Also `syntax`
(`--syn-*`), `terminal` (`--term-*`) and workspace label tints (`--label-*`).

## Shape, type, depth and motion tokens

Token names are CSS variables without the `--`.

| Token                                                             | Bracket default                               | Meaning                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `corners`                                                         | `cut`                                         | `round` turns every chamfered `.cut` shape into a rounded one (sets `data-corners`) |
| `ornaments`                                                       | `on`                                          | `off` hides decoration: corner brackets, scanline textures, `.ornament`             |
| `cut-k`                                                           | `1`                                           | chamfer multiplier (`0` under `corners: round`)                                     |
| `r-card`                                                          | `0px`                                         | cards, tool rows, composer, settings groups, panels                                 |
| `r-menu`                                                          | `0px`                                         | menus, popovers, sheets, palette, toasts                                            |
| `r-button`                                                        | `0px`                                         | buttons, chip buttons, send                                                         |
| `r-field`                                                         | `0px`                                         | inputs, search boxes, segmented controls                                            |
| `r-chip`                                                          | `0px`                                         | chips, badges, pills, avatars                                                       |
| `r-row`                                                           | `0px`                                         | list rows, rail items, menu items, options                                          |
| `r-cut`                                                           | `0px`                                         | any other cut shape under `corners: round`                                          |
| `r-sm`, `r-md`                                                    | `4px`, `8px`                                  | small fixed radii                                                                   |
| `bw`                                                              | `1px`                                         | every 1px border                                                                    |
| `elev-1..3`                                                       | none / deep                                   | `box-shadow` elevation scale                                                        |
| `elev-drop-1..3`                                                  | deep                                          | `filter: drop-shadow` for shaped overlays                                           |
| `glow`                                                            | `1`                                           | glow intensity: text-shadows, pulse rings, glow keyframes (`0` disables)            |
| `accent-fill`                                                     | gradient                                      | primary fills (gradient buttons, active markers)                                    |
| `accent-bar`                                                      | gradient                                      | thin accent bars (rail glide, progress)                                             |
| `accent-soft`                                                     | gradient                                      | selected rail item                                                                  |
| `banner-wash`                                                     | gradient                                      | banner background wash                                                              |
| `font-body`, `font-display`, `font-mono`, `font-label`            | Inter / Space Grotesk / JetBrains Mono / mono | families                                                                            |
| `fw-display`, `fw-strong`                                         | `600`                                         | weights                                                                             |
| `text-scale`                                                      | `1`                                           | multiplies every font size                                                          |
| `label-transform`, `label-tracking`, `label-size`, `label-weight` | uppercase, 1.6px, 10.5px, 400                 | small caps labels (`.t-label`, section titles)                                      |
| `motion`                                                          | `1`                                           | multiplies every transition and animation duration (`0` = instant)                  |
| `ease`, `ease-out`                                                | curves                                        | easing                                                                              |

Spacing density is a user preference (`data-density`), not a theme token.

## Class contract

These class names are stable; theme CSS may target them. Behaviour never depends on styling.

- Shell: `.rail`, `.ri` (rail item, `.on`), `.side`, `.main`, `.detail`, `.home`, `.palette`, `.toast`
- Surfaces: `.tool`, `.composer-box`, `.set-card`, `.set-section-t`, `.pn`, `.pn-card`, `.sheet`, `.floating`, `.menu`, `.menu-item`
- Controls: `.btn` with `.btn-solid`, `.btn-ghost`, `.btn-gradient`, `.btn-outline`, `.btn-tint`, `.btn-danger`, `.btn-bar`; `.input`, `.field-box`, `.seg`, `.seg-opt`, `.seg-pill`, `.chip`, `.chip-btn`, `.select`
- Lists: `.srow`, `.srow2`, `.set-nav-item`, `.pn-row`, `.opt`
- Text: `.t-body`, `.t-display`, `.t-mono`, `.t-label`
- Shapes: `.cut` (+ `.flip`, `.cut-stroke`) paints its fill from `--cut-bg` and stroke from `--cut-line`; the chamfer size is `--c`, the rounded radius `--cut-r`
- Decoration: `.brackets`, `.ornament`

## Contributing a theme from a plugin

A plugin with the `ui.contribute` capability declares themes in its manifest:

```json
{
  "capabilities": ["ui.contribute"],
  "contributes": {
    "themes": [
      {
        "id": "paper",
        "label": "Paper",
        "description": "Warm paper, square corners.",
        "scheme": "light",
        "extends": "material-light",
        "colors": { "bg": "#f4efe6", "panel": "#fbf8f2", "cyan": "#8a5a2b" },
        "tokens": { "r-card": "4px", "r-button": "4px", "font-body": "Georgia, serif" },
        "css": ":root[data-theme=\"acme.paper\"] .tool { border-width: 2px; }"
      }
    ]
  }
}
```

- The full id is `<pluginId>.<id>`; scope CSS with it.
- `extends` names a built-in theme; anything a theme leaves out comes from it (default
  `material` or `material-light` by `scheme`). Its CSS is inherited only when `extends` is set and the theme brings none.
- `colors`, `tokens`, `syntax`, `terminal`: string maps. Keys match `[A-Za-z0-9_.-]`, values may
  not contain `;`, `{`, `}` or `<`. `css` is capped at 64 KB. At most 10 themes per plugin.
- The client reads them from `plugins.get_contributions` when a host comes online and on every
  `plugins.changed`, and lists them in Settings → You → Theme. When the plugin goes away the
  stored choice falls back to Material and returns when the plugin does.
- Theme CSS is trusted like the plugin itself: it can restyle anything and load `url()`s.
