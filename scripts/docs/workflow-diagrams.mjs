// Development workflow diagrams for the contributing and fork-and-rebrand pages. Written by
// stream-diagrams.mjs together with the release-stream diagrams; run that, not this file.
import {
  MONO,
  TYPE_SCALE,
  dot,
  esc,
  lane,
  laneLabel,
  link,
  node,
  pills,
  svg,
  text,
} from "./diagram-kit.mjs";

/** Text that never runs past `max` pixels: renderers differ, so squeeze rather than overflow. */
function fit(t, x, y, value, { size = 12, weight = 400, color = t.text, mono = false, max }) {
  const px = Math.round(size * TYPE_SCALE * 10) / 10;
  const estimate = String(value).length * px * (mono ? 0.6 : 0.55);
  const squeeze =
    max && estimate > max ? ` textLength="${max}" lengthAdjust="spacingAndGlyphs"` : "";
  return `<text x="${x}" y="${y}" font-size="${px}" font-weight="${weight}" fill="${color}"${mono ? ` font-family="${MONO}"` : ""}${squeeze}>${esc(value)}</text>`;
}

function path(t, d, { color = t.muted, marker = "muted", dashed = false, width = 2 } = {}) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dashed ? ' stroke-dasharray="7 5"' : ""}${marker ? ` marker-end="url(#arrow-${marker})"` : ""}/>`;
}

function box(t, { x, y, w, h, color = t.border, fill = t.card, opacity = 1 }) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" fill-opacity="${opacity}" stroke="${color}"/>`;
}

// 1. Upstream: a feature branch is tested locally, lands on main, ships as a beta, and reaches
//    stable only by promotion or backport.
function devFlow(t) {
  const W = 1180;
  const H = 580;
  const S = 150;
  const M = 290;
  const body = [
    text(
      t,
      32,
      40,
      "Test on the cheapest local rung first. Work lands on main; a green push ships a beta.",
      {
        size: 13,
        color: t.muted,
      },
    ),
    text(
      t,
      32,
      62,
      "Stable moves only by an explicit promotion or backport. Nothing merges back from stable.",
      {
        size: 13,
        color: t.muted,
      },
    ),
    laneLabel(t, { y: S, title: "stable", subtitle: "ships frogg", color: t.stable }),
    laneLabel(t, { y: M, title: "main", subtitle: "ships frogg beta", color: t.beta }),
    lane(t, { y: S, x1: 200, x2: 1140, color: t.stable }),
    lane(t, { y: M, x1: 200, x2: 1140, color: t.beta }),
    // the feature branch and its local ladder
    box(t, { x: 220, y: 362, w: 690, h: 108 }),
    fit(t, 240, 394, "feature branch in its own worktree: test locally, cheapest rung first", {
      size: 12,
      color: t.muted,
      max: 650,
    }),
    pills(t, {
      x: 240,
      y: 440,
      items: [
        ["preview", t.muted],
        ["dev:live", t.muted],
        ["app host", t.muted],
        ["dev:desktop", t.muted],
        ["verify --changed", t.stable],
      ],
    }),
    path(t, `M 230 ${M} C 230 330, 260 330, 260 358`),
    path(t, `M 890 360 C 890 322, 930 322, 930 ${M + 12}`),
    text(t, 880, 340, "land on main", { size: 12, color: t.muted, anchor: "end" }),
    // stable releases
    node(t, { x: 250, y: S, color: t.stable, label: "1.6.4", below: false }),
    node(t, { x: 520, y: S, color: t.stable, label: "1.6.5", below: false }),
    node(t, { x: 1080, y: S, color: t.stable, label: "1.6.6", below: false }),
    // betas on main
    node(t, { x: 380, y: M, color: t.beta, label: "1.6.6-beta.1" }),
    node(t, { x: 1010, y: M, color: t.beta, label: "1.6.6-beta.2" }),
    text(t, 1010, M + 48, "test it in frogg beta", {
      size: 11.5,
      color: t.beta,
      anchor: "middle",
      weight: 600,
    }),
    dot(t, { x: 460, y: M, color: t.backport }),
    link(t, {
      x1: 460,
      y1: M,
      x2: 520,
      y2: S,
      kind: "backport",
      label: "backport",
      labelX: 474,
      labelY: 224,
      labelAnchor: "end",
    }),
    link(t, {
      x1: 1010,
      y1: M,
      x2: 1080,
      y2: S,
      kind: "promote",
      label: "promote",
      labelX: 1030,
      labelY: 224,
      labelAnchor: "end",
    }),
    text(
      t,
      32,
      512,
      "CI cuts the next X.Y.Z-beta.N and builds it after every green push to main.",
      {
        size: 12.5,
        color: t.muted,
      },
    ),
    pills(t, {
      x: 32,
      y: 552,
      items: [
        ["npm run release:backport", t.backport],
        ["npm run release:patch", t.stable],
        ["npm run release:promote", t.stable],
      ],
    }),
  ];
  return svg(t, W, H, body.join("\n"));
}

// 2. The local test ladder: cheapest rung first, a beta only for what nothing local covers.
function testLadder(t) {
  const W = 1180;
  const rows = [
    {
      rung: "npm run preview",
      runs: ["isolated daemon, mock provider,", "seeded demo project, hot reload"],
      use: ["UI layout, copy, styling", "npm run shot / npm run probe"],
      skill: "frogg-web-debug",
    },
    {
      rung: "npm run dev:live",
      runs: ["this branch's daemon, real providers,", "persistent home, restarts on edits"],
      use: ["a feature end to end", "shot / probe --live"],
      skill: "frogg-live-dev",
    },
    {
      rung: "dev:live + installed app",
      runs: ["installed app: Add host, then", "the daemon endpoint dev:live prints"],
      use: ["daemon behaviour behind", "the app users already run"],
      skill: "frogg-live-dev",
    },
    {
      rung: "npm run dev:desktop",
      runs: ["Electron shell against a web", "dev server; needs a display"],
      use: ["Electron shell,", "native bridge"],
      skill: "frogg-dev",
    },
    {
      rung: "beta build",
      runs: ["CI cuts X.Y.Z-beta.N on a green", "push to main; install as frogg beta"],
      use: ["packaging, installers,", "auto-update"],
      skill: "frogg-release",
      beta: true,
    },
  ];
  const top = 110;
  const step = 88;
  const H = top + rows.length * step + 10;
  const body = [
    text(t, 32, 40, "Pick the cheapest rung that exercises the change.", { size: 14, weight: 600 }),
    text(t, 32, 62, "A beta is for release validation, not the first time a change runs.", {
      size: 13,
      color: t.muted,
    }),
    text(t, 120, 96, "RUNG", { size: 10.5, weight: 700, color: t.muted }),
    text(t, 470, 96, "WHAT RUNS", { size: 10.5, weight: 700, color: t.muted }),
    text(t, 850, 96, "USE IT FOR", { size: 10.5, weight: 700, color: t.muted }),
    `<line x1="60" y1="${top + 38}" x2="60" y2="${top + (rows.length - 1) * step + 38}" stroke="${t.faint}" stroke-width="3"/>`,
  ];
  rows.forEach((row, index) => {
    const y = top + index * step;
    const color = row.beta ? t.beta : t.stable;
    body.push(
      box(t, { x: 100, y, w: 1050, h: 76 }),
      `<rect x="100" y="${y}" width="6" height="76" rx="3" fill="${color}"/>`,
      `<circle cx="60" cy="${y + 38}" r="17" fill="${color}" stroke="${t.bg}" stroke-width="3"/>`,
      text(t, 60, y + 45, String(index + 1), {
        size: 13,
        weight: 700,
        color: t.bg,
        anchor: "middle",
      }),
      fit(t, 120, y + 32, row.rung, { size: 13, weight: 700, mono: true, color, max: 320 }),
      fit(t, 120, y + 58, `skill: ${row.skill}`, { size: 11, color: t.muted, max: 320 }),
      fit(t, 470, y + 32, row.runs[0], { size: 12, max: 360 }),
      fit(t, 470, y + 56, row.runs[1], { size: 12, max: 360 }),
      fit(t, 850, y + 32, row.use[0], { size: 12, weight: 600, max: 285 }),
      fit(t, 850, y + 56, row.use[1], { size: 12, color: t.muted, max: 285 }),
    );
  });
  return svg(t, W, H, body.join("\n"));
}

// 3. The inner loop (edit, run, check) and the way out of it (verify, docs, main, beta, stable).
function devLoop(t) {
  const W = 1180;
  const H = 540;
  const cardW = 250;
  const cardH = 146;
  const row1 = 140;
  const row2 = 364;
  const xs = [30, 320, 610, 900];
  const card = (x, y, { title, color = t.text, lines = [], skills = [] }) => {
    const out = [
      box(t, { x, y, w: cardW, h: cardH }),
      `<rect x="${x}" y="${y}" width="${cardW}" height="6" rx="3" fill="${color}"/>`,
      text(t, x + 18, y + 34, title, { size: 14, weight: 700, color }),
    ];
    lines.forEach((line, index) => {
      const [value, mono] = Array.isArray(line) ? line : [line, false];
      out.push(
        fit(t, x + 18, y + 60 + index * 21, value, {
          size: 11,
          mono,
          color: mono ? t.text : t.muted,
          max: cardW - 36,
        }),
      );
    });
    skills.forEach((skill, index) => {
      out.push(
        fit(t, x + 18, y + cardH - 14 - (skills.length - 1 - index) * 19, skill, {
          size: 11,
          weight: 600,
          color: t.upstream,
          max: cardW - 36,
        }),
      );
    });
    return out.join("\n");
  };
  const right = (x, y) => path(t, `M ${x + cardW + 4} ${y} L ${x + cardW + 34} ${y}`);
  const left = (x, y) => path(t, `M ${x - 4} ${y} L ${x - 34} ${y}`);
  const body = [
    text(t, 32, 38, "The inner loop runs on your machine. Only a change that works leaves it.", {
      size: 14,
      weight: 600,
    }),
    text(
      t,
      32,
      60,
      "Purple: the contributor skill (.claude/skills) or agent role that guides each step.",
      {
        size: 12.5,
        color: t.muted,
      },
    ),
    card(xs[0], row1, {
      title: "Edit",
      lines: ["on a feature branch,", "in its own worktree"],
      skills: ["client-dev · daemon-dev roles"],
    }),
    card(xs[1], row1, {
      title: "Run",
      lines: [
        ["npm run preview", true],
        ["npm run dev:live", true],
      ],
      skills: ["frogg-live-dev"],
    }),
    card(xs[2], row1, {
      title: "Check",
      lines: [["npm run shot / probe", true], "or use it in a browser or app"],
      skills: ["frogg-web-debug"],
    }),
    card(xs[3], row1, {
      title: "Verify",
      color: t.stable,
      lines: [["verify.mjs --changed", true], "format, lint, types, tests"],
      skills: ["frogg-dev"],
    }),
    card(xs[3], row2, {
      title: "Docs and strings",
      lines: ["docs page and screenshots", "UI copy in nine locales"],
      skills: ["frogg-docs", "frogg-i18n"],
    }),
    card(xs[2], row2, {
      title: "Land on main",
      color: t.beta,
      lines: ["merge and push main", "CI runs the full suite"],
      skills: ["frogg-build-monitor"],
    }),
    card(xs[1], row2, {
      title: "Beta",
      color: t.beta,
      lines: [["X.Y.Z-beta.N", true], "CI cuts it; test in frogg beta"],
      skills: ["frogg-release"],
    }),
    card(xs[0], row2, {
      title: "Stable",
      color: t.stable,
      lines: [["release:promote", true], "explicit instruction only"],
      skills: ["frogg-release"],
    }),
    right(xs[0], row1 + 68),
    right(xs[1], row1 + 68),
    right(xs[2], row1 + 68),
    path(t, `M ${xs[3] + cardW / 2} ${row1 + cardH + 4} L ${xs[3] + cardW / 2} ${row2 - 6}`, {
      color: t.stable,
      marker: "stable",
    }),
    left(xs[3], row2 + 68),
    left(xs[2], row2 + 68),
    left(xs[1], row2 + 68),
    // back round the loop until it works
    path(
      t,
      `M ${xs[2] + cardW / 2} ${row1 - 4} C ${xs[2] + cardW / 2} ${row1 - 42}, ${xs[0] + cardW / 2} ${row1 - 42}, ${xs[0] + cardW / 2} ${row1 - 8}`,
      { color: t.backport, marker: "backport", dashed: true },
    ),
    text(t, (xs[0] + xs[2] + cardW) / 2, row1 - 46, "not right yet: edit again", {
      size: 11.5,
      weight: 600,
      color: t.backport,
      anchor: "middle",
    }),
    text(t, xs[3] + cardW / 2 + 12, row1 + cardH + 44, "works", {
      size: 11.5,
      weight: 600,
      color: t.stable,
    }),
  ];
  return svg(t, W, H, body.join("\n"));
}

// 4. A branded distribution that follows upstream main: upstream changes arrive on the brand's
//    main, ship as brand betas, reach brand stable by promotion, and fixes by backport.
function brandStreams(t) {
  const W = 1180;
  const H = 670;
  const FS = 124;
  const FM = 224;
  const FF = 320;
  const UM = 470;
  const US = 550;
  const X2 = 1120;
  const body = [
    text(
      t,
      32,
      38,
      'A brand that follows upstream main (follow: "development") tests each upstream change as its own beta.',
      { size: 13, color: t.muted },
    ),
    box(t, { x: 16, y: 56, w: W - 32, h: 300 }),
    text(t, 32, 82, 'your brand repository  (streams.upstream.suffix: "acme")', {
      size: 12,
      weight: 700,
    }),
    box(t, { x: 16, y: 400, w: W - 32, h: 186, fill: t.upstream, opacity: 0.06 }),
    text(t, 32, 426, "upstream  (frogg-app/frogg)", { size: 12, weight: 700, color: t.upstream }),
    laneLabel(t, { y: FS + 8, title: "stable", subtitle: "ships Acme", color: t.stable }),
    laneLabel(t, { y: FM + 8, title: "main", subtitle: "ships Acme Beta", color: t.beta }),
    laneLabel(t, { y: FF + 8, title: "feature/*", subtitle: "your changes", color: t.feature }),
    laneLabel(t, { y: UM + 8, title: "main", subtitle: "upstream/main", color: t.upstream }),
    laneLabel(t, { y: US + 8, title: "stable", subtitle: "upstream/stable", color: t.upstream }),
    lane(t, { y: FS, x1: 220, x2: X2, color: t.stable }),
    lane(t, { y: FM, x1: 220, x2: X2, color: t.beta }),
    lane(t, { y: FF, x1: 660, x2: 890, color: t.feature, dashed: true }),
    lane(t, { y: UM, x1: 220, x2: X2, color: t.upstream }),
    lane(t, { y: US, x1: 220, x2: X2, color: t.upstream, dashed: true }),
    // upstream
    node(t, { x: 300, y: UM, color: t.upstream, label: "1.8.0-beta.2" }),
    node(t, { x: 560, y: UM, color: t.upstream, label: "1.8.0-beta.3" }),
    node(t, { x: 1040, y: UM, color: t.upstream, hollow: true, label: "next" }),
    node(t, { x: 260, y: US, color: t.upstream, label: "1.7.0" }),
    // brand stable and main
    node(t, { x: 270, y: FS, color: t.stable, label: "1.7.0-acme.1", below: false }),
    node(t, { x: 820, y: FS, color: t.stable, label: "1.8.0-acme.1", below: false }),
    node(t, { x: 1030, y: FS, color: t.stable, label: "1.8.0-acme.2", below: false }),
    node(t, { x: 470, y: FM, color: t.beta, label: "1.8.0-beta.2.acme.1" }),
    node(t, { x: 750, y: FM, color: t.beta, label: "1.8.0-beta.3.acme.1" }),
    link(t, {
      x1: 300,
      y1: UM,
      x2: 340,
      y2: FM,
      kind: "sync",
      label: "sync-upstream",
      labelX: 300,
      labelY: 384,
      labelAnchor: "end",
    }),
    link(t, { x1: 560, y1: UM, x2: 600, y2: FM, kind: "sync" }),
    link(t, {
      x1: 750,
      y1: FM,
      x2: 820,
      y2: FS,
      kind: "promote",
      label: "promote",
      labelX: 768,
      labelY: 178,
      labelAnchor: "end",
    }),
    dot(t, { x: 970, y: FM, color: t.backport }),
    link(t, {
      x1: 970,
      y1: FM,
      x2: 1030,
      y2: FS,
      kind: "backport",
      label: "backport",
      labelX: 1014,
      labelY: 178,
    }),
    // a brand feature lands on brand main; a product fix goes back upstream
    path(t, `M 630 ${FM} C 630 ${FF - 40}, 640 ${FF}, 660 ${FF}`, {
      color: t.feature,
      marker: null,
    }),
    dot(t, { x: 700, y: FF, color: t.feature }),
    dot(t, { x: 760, y: FF, color: t.feature }),
    dot(t, { x: 830, y: FF, color: t.upstream }),
    path(t, `M 890 ${FF} C 915 ${FF}, 920 ${FM + 40}, 920 ${FM + 12}`, { color: t.feature }),
    link(t, {
      x1: 830,
      y1: FF,
      x2: 870,
      y2: UM,
      kind: "contribute",
      label: "contribute",
      labelX: 866,
      labelY: 384,
    }),
    pills(t, {
      x: 32,
      y: 630,
      items: [
        ["npm run release:sync-upstream", t.upstream],
        ["npm run release:promote", t.stable],
        ["npm run release:backport", t.backport],
        ["npm run release:contribute", t.upstream],
      ],
    }),
  ];
  return svg(t, W, H, body.join("\n"));
}

export const WORKFLOW_DIAGRAMS = {
  "dev-flow": devFlow,
  "test-ladder": testLadder,
  "dev-loop": devLoop,
  "brand-streams": brandStreams,
};
