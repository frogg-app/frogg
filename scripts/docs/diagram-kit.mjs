// Shared drawing primitives for the docs diagrams (stream-diagrams.mjs, workflow-diagrams.mjs).
// Every diagram is drawn once per theme; `t` is that theme's colour table.

export const THEMES = {
  dark: {
    bg: "#181b1a",
    card: "#202423",
    border: "#343a38",
    text: "#f4f7f6",
    muted: "#a3adab",
    faint: "#5b6462",
    stable: "#4cc38a",
    beta: "#f5a524",
    upstream: "#a78bfa",
    backport: "#e0a95b",
    danger: "#f87171",
    feature: "#7c8783",
    dev: "#60a5fa",
  },
  light: {
    bg: "#ffffff",
    card: "#f6f7f7",
    border: "#dfe3e2",
    text: "#18181b",
    muted: "#5b6462",
    faint: "#b8bfbd",
    stable: "#1f8a55",
    beta: "#c77700",
    upstream: "#6d28d9",
    backport: "#9a5b12",
    danger: "#c62828",
    feature: "#8a9491",
    dev: "#1d6fd1",
  },
};

export const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif";
export const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace";

export const esc = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function svg(t, width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">
<defs>
${["stable", "beta", "dev", "upstream", "backport", "muted", "danger"]
  .map(
    (name) =>
      `<marker id="arrow-${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${t[name]}"/></marker>`,
  )
  .join("\n")}
</defs>
<rect width="${width}" height="${height}" rx="16" fill="${t.bg}"/>
${body}
</svg>
`;
}

/** The docs column shows these at ~60% size; type is drawn larger than it looks here. */
export const TYPE_SCALE = 1.35;

export function text(t, x, y, value, opts = {}) {
  const {
    size: baseSize = 13,
    weight = 400,
    color = t.text,
    anchor = "start",
    mono = false,
    italic = false,
  } = opts;
  const size = Math.round(baseSize * TYPE_SCALE * 10) / 10;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}"${
    mono ? ` font-family="${MONO}"` : ""
  }${italic ? ' font-style="italic"' : ""}>${esc(value)}</text>`;
}

export function lane(t, { y, x1, x2, color, dashed = false }) {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-opacity="0.8"${
    dashed ? ' stroke-dasharray="6 6"' : ""
  }/>`;
}

export function node(t, { x, y, color, label, below = true, hollow = false }) {
  const circle = hollow
    ? `<circle cx="${x}" cy="${y}" r="8" fill="${t.bg}" stroke="${color}" stroke-width="2.5" stroke-dasharray="3 2"/>`
    : `<circle cx="${x}" cy="${y}" r="8" fill="${color}" stroke="${t.bg}" stroke-width="2"/>`;
  return (
    circle +
    (label
      ? text(t, x, below ? y + 26 : y - 16, label, {
          size: 12,
          mono: true,
          anchor: "middle",
        })
      : "")
  );
}

export function dot(t, { x, y, color }) {
  return `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/>`;
}

/** A connector between lanes; `kind` picks colour, dash and arrowhead. */
export function link(t, { x1, y1, x2, y2, kind, label, labelX, labelY, labelAnchor = "start" }) {
  const color = {
    promote: "stable",
    backport: "backport",
    sync: "upstream",
    contribute: "upstream",
  }[kind];
  const dash = kind === "backport" || kind === "contribute" ? ' stroke-dasharray="7 5"' : "";
  const mid = (y1 + y2) / 2;
  const pathD = `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2 + (y2 > y1 ? -10 : 10)}`;
  return (
    `<path d="${pathD}" fill="none" stroke="${t[color]}" stroke-width="2.5"${dash} marker-end="url(#arrow-${color})"/>` +
    (label
      ? text(t, labelX ?? (x1 + x2) / 2 + 8, labelY ?? mid + 4, label, {
          size: 12,
          weight: 600,
          color: t[color],
          anchor: labelAnchor,
        })
      : "")
  );
}

export function laneLabel(t, { y, title, subtitle, color }) {
  return (
    text(t, 32, y - 4, title, { size: 15, weight: 700, color }) +
    text(t, 32, y + 14, subtitle, { size: 12, color: t.muted })
  );
}

/** Command pills in a row from `x`, each as wide as its label. */
export function pills(t, { x, y, items }) {
  let cursor = x;
  return items
    .map(([label, color]) => {
      const out = pill(t, { x: cursor, y, label, color });
      cursor += pillWidth(label) + 12;
      return out;
    })
    .join("\n");
}

export function pillWidth(label) {
  return label.length * 7 * TYPE_SCALE + 24;
}

export function pill(t, { x, y, label, color, width }) {
  const w = width ?? pillWidth(label);
  // Fonts differ between renderers; pin the label to the pill so it never overflows.
  const size = Math.round(11.5 * TYPE_SCALE * 10) / 10;
  return `<rect x="${x}" y="${y - 17}" width="${w}" height="28" rx="14" fill="${
    t.card
  }" stroke="${color}"/><text x="${x + 12}" y="${
    y + 2
  }" font-size="${size}" font-weight="600" fill="${color}" textLength="${
    w - 24
  }" lengthAdjust="spacingAndGlyphs">${esc(label)}</text>`;
}
