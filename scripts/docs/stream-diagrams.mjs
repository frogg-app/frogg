#!/usr/bin/env node
// Generates the docs diagrams used by the docs site and docs/release-streams.md:
//   node scripts/docs/stream-diagrams.mjs
// Each diagram is written twice, `<name>-dark.svg` and `<name>-light.svg`, into
// website/src/assets/docs/diagrams/. The release-stream diagrams are drawn here, the development
// workflow ones in workflow-diagrams.mjs. Edit those files, not the SVGs.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES, dot, lane, laneLabel, link, node, pills, svg, text } from "./diagram-kit.mjs";
import { WORKFLOW_DIAGRAMS } from "./workflow-diagrams.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "website/src/assets/docs/diagrams");

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
  ...WORKFLOW_DIAGRAMS,
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
