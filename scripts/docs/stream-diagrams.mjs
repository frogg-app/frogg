#!/usr/bin/env node
// Generates the release-stream diagrams used by the docs site and docs/release-streams.md:
//   node scripts/docs/stream-diagrams.mjs
// Each diagram is written twice, `<name>-dark.svg` and `<name>-light.svg`, into
// website/src/assets/docs/diagrams/. Edit this file, not the SVGs.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "website/src/assets/docs/diagrams");

const THEMES = {
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
  },
};

const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace";

const esc = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function svg(t, width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">
<defs>
${["stable", "beta", "upstream", "backport", "muted", "danger"]
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
const TYPE_SCALE = 1.35;

function text(t, x, y, value, opts = {}) {
  const {
    size: baseSize = 13,
    weight = 400,
    color = t.text,
    anchor = "start",
    mono = false,
    italic = false,
  } = opts;
  const size = Math.round(baseSize * TYPE_SCALE * 10) / 10;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}"${mono ? ` font-family="${MONO}"` : ""}${italic ? ' font-style="italic"' : ""}>${esc(value)}</text>`;
}

function lane(t, { y, x1, x2, color, dashed = false }) {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-opacity="0.8"${dashed ? ' stroke-dasharray="6 6"' : ""}/>`;
}

function node(t, { x, y, color, label, below = true, hollow = false }) {
  const circle = hollow
    ? `<circle cx="${x}" cy="${y}" r="8" fill="${t.bg}" stroke="${color}" stroke-width="2.5" stroke-dasharray="3 2"/>`
    : `<circle cx="${x}" cy="${y}" r="8" fill="${color}" stroke="${t.bg}" stroke-width="2"/>`;
  return (
    circle +
    (label
      ? text(t, x, below ? y + 26 : y - 16, label, { size: 12, mono: true, anchor: "middle" })
      : "")
  );
}

function dot(t, { x, y, color }) {
  return `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/>`;
}

/** A connector between lanes; `kind` picks colour, dash and arrowhead. */
function link(t, { x1, y1, x2, y2, kind, label, labelX, labelY, labelAnchor = "start" }) {
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

function laneLabel(t, { y, title, subtitle, color }) {
  return (
    text(t, 32, y - 4, title, { size: 15, weight: 700, color }) +
    text(t, 32, y + 14, subtitle, { size: 12, color: t.muted })
  );
}

/** Command pills in a row from `x`, each as wide as its label. */
function pills(t, { x, y, items }) {
  let cursor = x;
  return items
    .map(([label, color]) => {
      const out = pill(t, { x: cursor, y, label, color });
      cursor += pillWidth(label) + 12;
      return out;
    })
    .join("\n");
}

function pillWidth(label) {
  return label.length * 7 * TYPE_SCALE + 24;
}

function pill(t, { x, y, label, color, width }) {
  const w = width ?? pillWidth(label);
  // Fonts differ between renderers; pin the label to the pill so it never overflows.
  const size = Math.round(11.5 * TYPE_SCALE * 10) / 10;
  return `<rect x="${x}" y="${y - 17}" width="${w}" height="28" rx="14" fill="${t.card}" stroke="${color}"/><text x="${x + 12}" y="${y + 2}" font-size="${size}" font-weight="600" fill="${color}" textLength="${w - 24}" lengthAdjust="spacingAndGlyphs">${esc(label)}</text>`;
}

// 1. The two streams: betas on main, promotion and backports to stable.
function streams(t) {
  const W = 1000;
  const H = 440;
  const S = 120;
  const M = 290;
  const F = 380;
  const body = [
    laneLabel(t, { y: S, title: "stable", subtitle: "ships frogg", color: t.stable }),
    laneLabel(t, { y: M, title: "main", subtitle: "ships frogg beta", color: t.beta }),
    text(t, 32, F + 4, "feature branches", { size: 12, color: t.muted }),
    lane(t, { y: S, x1: 200, x2: 960, color: t.stable }),
    lane(t, { y: M, x1: 200, x2: 960, color: t.beta }),
    // feature branches land on main
    `<path d="M 245 ${M} C 250 ${F}, 300 ${F}, 330 ${F} L 360 ${F} C 390 ${F}, 395 ${M + 20}, 400 ${M + 10}" fill="none" stroke="${t.feature}" stroke-width="2" marker-end="url(#arrow-muted)"/>`,
    dot(t, { x: 300, y: F, color: t.feature }),
    dot(t, { x: 340, y: F, color: t.feature }),
    `<path d="M 600 ${M} C 605 ${F}, 650 ${F}, 680 ${F} L 760 ${F} C 790 ${F}, 795 ${M + 20}, 800 ${M + 10}" fill="none" stroke="${t.feature}" stroke-width="2" marker-end="url(#arrow-muted)"/>`,
    dot(t, { x: 680, y: F, color: t.feature }),
    dot(t, { x: 730, y: F, color: t.feature }),
    // stable releases
    node(t, { x: 230, y: S, color: t.stable, label: "1.5.0", below: false }),
    node(t, { x: 420, y: S, color: t.stable, label: "1.5.1", below: false }),
    node(t, { x: 580, y: S, color: t.stable, label: "1.6.0", below: false }),
    node(t, { x: 880, y: S, color: t.stable, label: "1.6.1", below: false }),
    // main betas
    node(t, { x: 300, y: M, color: t.beta, label: "1.6.0-beta.1" }),
    node(t, { x: 500, y: M, color: t.beta, label: "1.6.0-beta.2" }),
    node(t, { x: 700, y: M, color: t.beta, label: "1.7.0-beta.1" }),
    node(t, { x: 940, y: M, color: t.beta, hollow: true, label: "next beta" }),
    // backports and promotion
    dot(t, { x: 360, y: M, color: t.backport }),
    link(t, {
      x1: 360,
      y1: M,
      x2: 420,
      y2: S,
      kind: "backport",
      label: "backport",
      labelX: 372,
      labelY: 214,
      labelAnchor: "end",
    }),
    link(t, {
      x1: 500,
      y1: M,
      x2: 580,
      y2: S,
      kind: "promote",
      label: "promote",
      labelX: 552,
      labelY: 214,
    }),
    dot(t, { x: 830, y: M, color: t.backport }),
    link(t, {
      x1: 830,
      y1: M,
      x2: 880,
      y2: S,
      kind: "backport",
      label: "backport",
      labelX: 868,
      labelY: 214,
    }),
    // notes
    text(
      t,
      200,
      44,
      "Work lands on main and ships as betas. Stable only gets a promoted beta line or a backported fix.",
      {
        size: 13,
        color: t.muted,
      },
    ),
    text(t, 200, 64, "Nothing merges from stable back into main.", { size: 13, color: t.muted }),
    pills(t, {
      x: 32,
      y: 418,
      items: [
        ["npm run release:beta", t.beta],
        ["npm run release:backport", t.backport],
        ["npm run release:patch", t.stable],
        ["npm run release:promote", t.stable],
      ],
    }),
  ];
  return svg(t, W, H, body.join("\n"));
}

// 2. frogg and frogg beta on one machine.
function sideBySide(t) {
  const W = 1120;
  const H = 400;
  const column = (x, { title, color, rows, note }) => {
    const width = 440;
    const out = [
      `<rect x="${x}" y="92" width="${width}" height="244" rx="14" fill="${t.card}" stroke="${color}" stroke-width="1.5"/>`,
      `<rect x="${x}" y="92" width="${width}" height="44" rx="14" fill="${color}" fill-opacity="0.16"/>`,
      text(t, x + 20, 120, title, { size: 17, weight: 700, color }),
    ];
    rows.forEach(([label, value], index) => {
      const y = 164 + index * 30;
      out.push(text(t, x + 20, y, label, { size: 13, color: t.muted }));
      out.push(text(t, x + 150, y, value, { size: 13, mono: true }));
    });
    out.push(text(t, x + 20, 322, note, { size: 12.5, color, weight: 600 }));
    return out.join("\n");
  };
  const body = [
    text(
      t,
      40,
      44,
      "One machine, two installs. Nothing is shared: port, data, service, CLI, app id.",
      {
        size: 14,
        weight: 600,
      },
    ),
    text(t, 40, 66, "Run your agents in frogg; install each beta in frogg beta to try it.", {
      size: 13,
      color: t.muted,
    }),
    column(40, {
      title: "frogg",
      color: t.stable,
      rows: [
        ["App", "frogg"],
        ["Daemon", "frogg-daemon :9999"],
        ["Data", "~/.frogg"],
        ["CLI", "frogg"],
        ["App id", "app.frogg.frogg"],
      ],
      note: "Updates to stable releases only",
    }),
    column(640, {
      title: "frogg beta",
      color: t.beta,
      rows: [
        ["App", "frogg beta"],
        ["Daemon", "frogg-beta-daemon :9998"],
        ["Data", "~/.frogg-beta"],
        ["CLI", "frogg-beta"],
        ["App id", "app.frogg.frogg.beta"],
      ],
      note: "Updates to betas only",
    }),
    `<path d="M 500 214 L 626 214" stroke="${t.muted}" stroke-width="2" marker-end="url(#arrow-muted)"/>`,
    text(t, 560, 200, "agents build it", { size: 12, color: t.muted, anchor: "middle" }),
    text(t, 560, 236, "you test it", { size: 12, color: t.muted, anchor: "middle" }),
    text(
      t,
      40,
      372,
      "Worktree dev daemons (npm run dev:server) use their own home and port, so they touch neither install.",
      {
        size: 12.5,
        color: t.muted,
      },
    ),
  ];
  return svg(t, W, H, body.join("\n"));
}

// 3. A fork: upstream's streams above, the fork's below.
function fork(t) {
  const W = 1180;
  const H = 600;
  const US = 140;
  const UM = 215;
  const FS = 380;
  const FM = 465;
  const X2 = 1120;
  const body = [
    text(
      t,
      32,
      38,
      "Upstream releases arrive on your main, ship to your testers as Acme Beta, then to your users.",
      {
        size: 13,
        color: t.muted,
      },
    ),
    `<rect x="16" y="60" width="${W - 32}" height="190" rx="12" fill="${t.upstream}" fill-opacity="0.06" stroke="${t.border}"/>`,
    text(t, 32, 88, "upstream  (frogg-app/frogg)", { size: 12, weight: 700, color: t.upstream }),
    `<rect x="16" y="290" width="${W - 32}" height="220" rx="12" fill="${t.card}" stroke="${t.border}"/>`,
    text(t, 32, 318, 'your fork  (streams.upstream.suffix: "acme")', { size: 12, weight: 700 }),
    laneLabel(t, { y: US + 8, title: "stable", subtitle: "upstream/stable", color: t.upstream }),
    laneLabel(t, { y: UM + 8, title: "main", subtitle: "upstream/main", color: t.upstream }),
    laneLabel(t, { y: FS + 8, title: "stable", subtitle: "ships Acme", color: t.stable }),
    laneLabel(t, { y: FM + 8, title: "main", subtitle: "ships Acme Beta", color: t.beta }),
    lane(t, { y: US, x1: 220, x2: X2, color: t.upstream }),
    lane(t, { y: UM, x1: 220, x2: X2, color: t.upstream, dashed: true }),
    lane(t, { y: FS, x1: 220, x2: X2, color: t.stable }),
    lane(t, { y: FM, x1: 220, x2: X2, color: t.beta }),
    node(t, { x: 280, y: US, color: t.upstream, label: "1.7.0", below: false }),
    node(t, { x: 440, y: US, color: t.upstream, label: "1.8.0", below: false }),
    node(t, { x: 320, y: UM, color: t.upstream, label: "1.8.0-beta.2" }),
    node(t, { x: 1020, y: UM, color: t.upstream, label: "1.9.0-beta.1" }),
    node(t, { x: 300, y: FS, color: t.stable, label: "1.7.0-acme.1", below: false }),
    node(t, { x: 860, y: FS, color: t.stable, label: "1.8.0-acme.1", below: false }),
    node(t, { x: 1050, y: FS, color: t.stable, label: "1.8.0-acme.2", below: false }),
    node(t, { x: 540, y: FM, color: t.beta, label: "1.8.0-rc.1.acme.1" }),
    node(t, { x: 780, y: FM, color: t.beta, label: "1.8.0-rc.1.acme.2" }),
    link(t, {
      x1: 440,
      y1: US,
      x2: 460,
      y2: FM,
      kind: "sync",
      label: "sync-upstream",
      labelX: 428,
      labelY: 274,
      labelAnchor: "end",
    }),
    link(t, {
      x1: 780,
      y1: FM,
      x2: 860,
      y2: FS,
      kind: "promote",
      label: "promote",
      labelX: 790,
      labelY: 424,
      labelAnchor: "end",
    }),
    dot(t, { x: 970, y: FM, color: t.backport }),
    link(t, {
      x1: 970,
      y1: FM,
      x2: 1050,
      y2: FS,
      kind: "backport",
      label: "backport",
      labelX: 1024,
      labelY: 432,
    }),
    dot(t, { x: 660, y: FM, color: t.upstream }),
    link(t, {
      x1: 660,
      y1: FM,
      x2: 730,
      y2: UM,
      kind: "contribute",
      label: "contribute",
      labelX: 742,
      labelY: 274,
    }),
    pills(t, {
      x: 32,
      y: 558,
      items: [
        ["npm run release:sync-upstream", t.upstream],
        ["npm run release:beta", t.beta],
        ["npm run release:promote", t.stable],
        ["npm run release:contribute", t.upstream],
      ],
    }),
  ];
  return svg(t, W, H, body.join("\n"));
}

// 4. How versions order, and which app takes each.
function versions(t) {
  const W = 1180;
  const H = 350;
  const Y = 175;
  const items = [
    ["1.8.0-beta.3", "upstream beta", "beta"],
    ["1.8.0-beta.3.acme.1", "fork build of it", "beta"],
    ["1.8.0-rc.1.acme.1", "fork candidate", "beta"],
    ["1.8.0", "upstream release", "stable"],
    ["1.8.0-acme.1", "fork release", "stable"],
    ["1.8.0-acme.2", "fork fix", "stable"],
    ["1.9.0-beta.1", "next beta line", "beta"],
  ];
  const x0 = 100;
  const step = 162;
  const body = [
    text(
      t,
      40,
      44,
      "Channel part first, build counter second. Every updater orders versions this way, oldest to newest.",
      {
        size: 14,
        weight: 600,
      },
    ),
    text(
      t,
      40,
      66,
      "A suffix that starts with a channel name (beta, rc) is a beta; any other suffix is a rebuild of a release.",
      {
        size: 13,
        color: t.muted,
      },
    ),
    `<line x1="50" y1="${Y}" x2="${W - 40}" y2="${Y}" stroke="${t.faint}" stroke-width="2" marker-end="url(#arrow-muted)"/>`,
  ];
  items.forEach(([version, note, channel], index) => {
    const x = x0 + index * step;
    const color = channel === "beta" ? t.beta : t.stable;
    body.push(node(t, { x, y: Y, color }));
    // Long versions would collide; every other label sits a row higher on a leader line.
    const labelY = index % 2 === 0 ? Y - 22 : Y - 54;
    if (index % 2 === 1) {
      body.push(
        `<line x1="${x}" y1="${Y - 10}" x2="${x}" y2="${labelY + 6}" stroke="${t.faint}" stroke-width="1"/>`,
      );
    }
    body.push(text(t, x, labelY, version, { size: 12, mono: true, anchor: "middle", weight: 600 }));
    body.push(text(t, x, Y + 30, note, { size: 11.5, color: t.muted, anchor: "middle" }));
    body.push(
      text(t, x, Y + 48, channel === "beta" ? "beta app" : "stable app", {
        size: 11.5,
        color,
        anchor: "middle",
        weight: 600,
      }),
    );
  });
  body.push(
    `<rect x="40" y="272" width="${W - 80}" height="50" rx="10" fill="${t.danger}" fill-opacity="0.08" stroke="${t.danger}" stroke-opacity="0.5"/>`,
    text(t, 60, 302, "✗  1.8.0-acme.1-beta.1", {
      size: 13,
      mono: true,
      color: t.danger,
      weight: 700,
    }),
    text(
      t,
      315,
      302,
      "reads as a rebuild of 1.8.0 and sorts above it. Put the channel part first: 1.8.0-beta.1.acme.1",
      {
        size: 12.5,
        color: t.text,
      },
    ),
  );
  return svg(t, W, H, body.join("\n"));
}

const DIAGRAMS = {
  "release-streams": streams,
  "side-by-side": sideBySide,
  "fork-streams": fork,
  "version-order": versions,
};

await mkdir(outDir, { recursive: true });
for (const [name, draw] of Object.entries(DIAGRAMS)) {
  for (const [theme, colors] of Object.entries(THEMES)) {
    await writeFile(path.join(outDir, `${name}-${theme}.svg`), draw(colors));
  }
}
process.stdout.write(
  `Wrote ${Object.keys(DIAGRAMS).length * 2} diagrams to ${path.relative(root, outDir)}\n`,
);
