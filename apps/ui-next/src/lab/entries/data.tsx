import { CodeBlock } from "../../components/Code";
import { DiffView } from "../../components/DiffView";
import { Markdown } from "../../components/Markdown";
import { Meter } from "../../components/Meter";
import { LabelChip } from "../../components/sessions/sheets";
import { Pill } from "../../components/settings/controls";
import { Meter as KitMeter } from "../../components/settings/pages/kit";
import { LabelChip as HostLabelChip } from "../../components/settings/pages/hostkit";
import { AccountBlock, accountTint } from "../../components/UsagePanel";
import { watchCheckout } from "../../daemon/scm";
import type { AccountUsage } from "../../daemon/usage";
import { color } from "../../theme/tokens";
import { accounts, usage } from "../fixtures";
import { Fill, Stack, Wrap, type Entry } from "../kit";

function Meters() {
  return (
    <Stack>
      <Meter pct={8} label="Session" detail="resets in 3h 10m" />
      <Meter pct={42} label="Weekly" detail="resets Thu 09:00" />
      <Meter pct={74} label="Opus weekly" detail="warning at 70%" />
      <Meter pct={96} label="Premium requests" detail="critical at 90%" />
    </Stack>
  );
}
function MetersEdge() {
  return (
    <Stack>
      <Meter pct={null} label="Credits" detail="no figure reported" />
      <Meter pct={0} label="Empty" />
      <Meter pct={140} label="Over 100 clamps" />
      <Meter pct={55} label="Account tint" tone={color.violet} />
    </Stack>
  );
}
function KitMeters() {
  return (
    <Stack>
      <KitMeter pct={30} />
      <KitMeter pct={72} />
      <KitMeter pct={88} />
      <KitMeter pct={null} />
    </Stack>
  );
}

const TS = `import { SessionStore } from "./session-store";

/** Evicts the least recently used entry once the cap is reached. */
export function evictOldest(store: SessionStore, max = 200): number {
  let evicted = 0;
  while (store.size > max) {
    const [id] = store.oldest();
    store.delete(id);
    evicted += 1;
  }
  return evicted; // logged at debug by the caller
}
`;
const JSON_SRC = `{
  "sessionCache": { "maxEntries": 200 },
  "providers": ["claude", "codex"],
  "aVeryLongKeyThatScrollsHorizontallyBecauseCodeNeverWraps": "and keeps going to show the horizontal scroll"
}
`;
const Ts = () => <CodeBlock code={TS} filename="evict.ts" />;
const Json = () => <CodeBlock code={JSON_SRC} filename="config.json" />;
const Plain = () => <CodeBlock code={"plain text\nno highlighter for .xyz"} filename="notes.xyz" />;

const MD = `## Make the session cache cap configurable

The cap lives in **SessionStore** and is read once at start-up, via \`config.sessionCache\`.

- Add \`sessionCache.maxEntries\` to the schema
- Evict least recently used entries, one at a time
- Log each eviction at debug

\`\`\`ts
if (this.entries.size >= this.max) this.evictOldest();
\`\`\`
`;
const MD_GAPS = `1. Numbered item
> A quote
*italic* and [a link](https://frogg.dev)

---

| Key | Default |
| --- | --- |
| maxEntries | 200 |
`;
const MarkdownFull = () => <Markdown text={MD} />;
const MarkdownGaps = () => <Markdown text={MD_GAPS} />;
const MarkdownShort = () => <Markdown text="Bumped to **0.546.0**; no icon renames." />;

function Pills() {
  return (
    <Stack>
      <Wrap>
        <Pill text="default" />
        <Pill text="ready" tint={color.mint} />
        <Pill text="beta" tint={color.cyan2} />
        <Pill text="needs restart" tint={color.amber} />
        <Pill text="failed" tint={color.coral} />
      </Wrap>
      <Wrap>
        <LabelChip name="frontend" c="sky" />
        <LabelChip name="urgent" c="red" />
        <LabelChip name="no colour" />
      </Wrap>
      <Wrap>
        <HostLabelChip name="hostkit chip" tone={color.violet} />
        <HostLabelChip name="hostkit amber" tone={color.amber} />
      </Wrap>
    </Stack>
  );
}

const entryFor = (id: string): AccountUsage => {
  const account = accounts.find((a) => a.id === id) as AccountUsage["account"];
  const key = `${account.provider}:${id}`;
  return { account, usage: (usage[key] ?? null) as AccountUsage["usage"], error: null };
};
const work = entryFor("default:claude");
const personal = entryFor("claude-personal");
const workTint = accountTint(work.account, 0);
const personalTint = accountTint(personal.account, 1);
function Accounts() {
  return (
    <Stack>
      <AccountBlock entry={work} tint={workTint} />
      <AccountBlock entry={personal} tint={personalTint} />
    </Stack>
  );
}
const signedOut: AccountUsage = { ...entryFor("codex-acme"), usage: null };
const failed: AccountUsage = {
  ...entryFor("default:codex"),
  usage: null,
  error: "usage API returned 503",
};
function AccountsEdge() {
  return (
    <Stack>
      <AccountBlock entry={signedOut} tint={color.amber} />
      <AccountBlock entry={failed} tint={color.coral} />
    </Stack>
  );
}

function Diff() {
  return (
    <Fill>
      <DiffView path="src/store/session-store.ts" />
    </Fill>
  );
}
function DiffNew() {
  return (
    <Fill>
      <DiffView path="docs/session-cache.md" />
    </Fill>
  );
}
const watchFixtureCheckout = () => void watchCheckout("/home/dev/frogg");

export const data: Entry[] = [
  {
    id: "meter",
    name: "Meter",
    category: "Data display",
    path: "components/Meter.tsx",
    purpose: "20-cell segmented bar; filled cells take the tone and brighten toward the end.",
    usedBy: 2,
    polish: "none; fill changes are instant (no width or cell transition)",
    variants: [
      {
        id: "tones",
        label: "Tones by threshold",
        note: "cyan < 70, amber ≥ 70, coral ≥ 90",
        C: Meters,
      },
      { id: "edge", label: "Null, zero, clamped, custom tone", C: MetersEdge },
    ],
  },
  {
    id: "kit-meter",
    name: "Meter (settings kit)",
    category: "Data display",
    path: "components/settings/pages/kit.tsx (Meter)",
    purpose: "A second, continuous meter used by settings pages. Near-duplicate of Meter.",
    usedBy: 2,
    polish: "none",
    variants: [
      {
        id: "tones",
        label: "Thresholds",
        note: "amber ≥ 70, coral ≥ 85 (Meter uses 90)",
        C: KitMeters,
      },
    ],
  },
  {
    id: "code",
    name: "CodeBlock / Tokens",
    category: "Data display",
    path: "components/Code.tsx",
    purpose:
      "A whole file highlighted by extension with a line gutter; scrolls horizontally, never wraps.",
    usedBy: 3,
    polish: "none",
    variants: [
      { id: "ts", label: "TypeScript", C: Ts, bleed: true },
      { id: "json", label: "JSON, long line", C: Json, bleed: true },
      { id: "plain", label: "Unknown extension (plain)", C: Plain, bleed: true },
    ],
  },
  {
    id: "markdown",
    name: "Markdown",
    category: "Data display",
    path: "components/Markdown.tsx",
    purpose: "Assistant replies and plans: headings, bullets, fenced code, inline code and bold.",
    usedBy: 6,
    polish: "none",
    variants: [
      { id: "full", label: "Supported syntax", C: MarkdownFull },
      {
        id: "gaps",
        label: "Unsupported syntax",
        note: "Numbered lists, quotes, italics, links, rules and tables render as plain text.",
        C: MarkdownGaps,
      },
      { id: "short", label: "One line", C: MarkdownShort },
    ],
  },
  {
    id: "chips",
    name: "Pill / LabelChip",
    category: "Data display",
    path: "components/settings/controls.tsx (Pill) · sessions/sheets.tsx (LabelChip) · settings/pages/hostkit.tsx (LabelChip)",
    purpose: "Outlined status pills and filled label chips. Two LabelChip implementations exist.",
    usedBy: 38,
    polish: "none",
    variants: [{ id: "all", label: "Tints", C: Pills }],
  },
  {
    id: "account-block",
    name: "AccountBlock",
    category: "Data display",
    path: "components/UsagePanel.tsx (AccountBlock)",
    purpose: "One provider sign-in: name, email, active marker and its usage windows.",
    usedBy: 2,
    polish: "none",
    variants: [
      { id: "accounts", label: "Two Claude sign-ins", C: Accounts },
      { id: "edge", label: "Signed out and failed read", C: AccountsEdge },
    ],
  },
  {
    id: "diff-view",
    name: "DiffView",
    category: "Data display",
    path: "components/DiffView.tsx",
    purpose:
      "A file's diff in the main pane (source control): split on desktop, unified below, against uncommitted or base.",
    usedBy: 1,
    polish: "none",
    setup: watchFixtureCheckout,
    variants: [
      { id: "modified", label: "Modified file", C: Diff, h: 480, bleed: true },
      { id: "new", label: "New file", C: DiffNew, h: 320, bleed: true },
    ],
  },
];
