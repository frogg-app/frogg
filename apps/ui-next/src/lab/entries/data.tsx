import { useCallback, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
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
import { T } from "../../components/Text";
import { accounts, usage } from "../fixtures";
import { Case, Cases, Cell, Fill, W, type Entry } from "../kit";

const PRESETS = [8, 42, 69, 74, 89, 96, 100];

/** Drag across 70 and 90 to see fills, the amber shimmer and the coral pulses; Replay remounts. */
function MeterPlay({ render }: { render: (pct: number) => ReactNode }) {
  const [pct, setPct] = useState(42);
  const [run, setRun] = useState(0);
  const [w, setW] = useState(1);
  const onLayout = useCallback((e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width || 1), []);
  const pick = useCallback(
    (e: GestureResponderEvent) =>
      setPct(Math.round(Math.max(0, Math.min(100, (e.nativeEvent.locationX / w) * 100)))),
    [w],
  );
  const yes = useCallback(() => true, []);
  const replay = useCallback(() => setRun((n) => n + 1), []);
  return (
    <View style={s.play}>
      <View key={run}>{render(pct)}</View>
      <View
        style={s.track}
        onLayout={onLayout}
        onStartShouldSetResponder={yes}
        onMoveShouldSetResponder={yes}
        onResponderGrant={pick}
        onResponderMove={pick}
        accessibilityLabel="Meter value"
      >
        <View pointerEvents="none" style={[s.mark, s.mark70]} />
        <View pointerEvents="none" style={[s.mark, s.mark90]} />
      </View>
      <View style={s.playRow}>
        {PRESETS.map((v) => (
          <Preset key={v} v={v} on={v === pct} set={setPct} />
        ))}
        <Pressable onPress={replay} style={s.replay} accessibilityLabel="Replay">
          <T v="mono" style={s.replayT}>
            Replay
          </T>
        </Pressable>
      </View>
    </View>
  );
}
function Preset({ v, on, set }: { v: number; on: boolean; set: (v: number) => void }) {
  const go = useCallback(() => set(v), [set, v]);
  return (
    <Pressable onPress={go} style={[s.preset, on && s.presetOn]}>
      <T v="mono" style={s.replayT}>
        {v}
      </T>
    </Pressable>
  );
}
const renderMeter = (pct: number) => (
  <Meter pct={pct} label="Drag me" detail="warning 70 · critical 90" />
);
const renderKit = (pct: number) => <KitMeter pct={pct} />;
function MeterPlayground() {
  return (
    <Cases>
      <Case
        name="Meter"
        props="pct={drag}"
        note="Drag the track or tap a value; Replay remounts the mount animation."
        w={W.panel}
      >
        <View style={s.pad}>
          <MeterPlay render={renderMeter} />
        </View>
      </Case>
    </Cases>
  );
}
function KitMeterPlayground() {
  return (
    <Cases>
      <Case
        name="KitMeter"
        props="pct={drag}"
        note="Drag across 70 and 90; Replay remounts."
        w={W.panel}
      >
        <View style={s.pad}>
          <MeterPlay render={renderKit} />
        </View>
      </Case>
    </Cases>
  );
}

function Meters() {
  return (
    <Cases>
      <Case name="Meter" props={'pct={8} label="Session" detail="resets in 3h 10m"'} w={W.panel}>
        <View style={s.pad}>
          <Meter pct={8} label="Session" detail="resets in 3h 10m" />
        </View>
      </Case>
      <Case name="Meter" props={"pct={42}"} note="Below 70: cyan." w={W.panel}>
        <View style={s.pad}>
          <Meter pct={42} label="Weekly" detail="resets Thu 09:00" />
        </View>
      </Case>
      <Case name="Meter" props={"pct={74}"} note="70 and over: amber." w={W.panel}>
        <View style={s.pad}>
          <Meter pct={74} label="Opus weekly" detail="warning at 70%" />
        </View>
      </Case>
      <Case name="Meter" props={"pct={96}"} note="90 and over: coral." w={W.panel}>
        <View style={s.pad}>
          <Meter pct={96} label="Premium requests" detail="critical at 90%" />
        </View>
      </Case>
    </Cases>
  );
}
function MetersEdge() {
  return (
    <Cases>
      <Case name="Meter" props={"pct={null}"} note="No figure: dash, empty cells." w={W.panel}>
        <View style={s.pad}>
          <Meter pct={null} label="Credits" detail="no figure reported" />
        </View>
      </Case>
      <Case name="Meter" props={"pct={0}"} note="No detail line." w={W.panel}>
        <View style={s.pad}>
          <Meter pct={0} label="Empty" />
        </View>
      </Case>
      <Case name="Meter" props={"pct={140}"} note="Clamps to 100%." w={W.panel}>
        <View style={s.pad}>
          <Meter pct={140} label="Over 100 clamps" />
        </View>
      </Case>
      <Case
        name="Meter"
        props={"pct={55} tone={violet}"}
        note="Account tint overrides thresholds."
        w={W.panel}
      >
        <View style={s.pad}>
          <Meter pct={55} label="Account tint" tone={color.violet} />
        </View>
      </Case>
      <Case
        name="Meter"
        props={'pct={42} label="A very long window label for a narrow panel"'}
        note="Long label at the tablet panel width."
        w={W.tablet}
      >
        <View style={s.pad}>
          <Meter
            pct={42}
            label="A very long window label for a narrow panel"
            detail="resets in 6d 23h 59m"
          />
        </View>
      </Case>
    </Cases>
  );
}
function KitMeters() {
  return (
    <Cases>
      <Case name="KitMeter" props={"pct={30}"} w={W.panel}>
        <View style={s.pad}>
          <KitMeter pct={30} />
        </View>
      </Case>
      <Case name="KitMeter" props={"pct={72}"} note="70 and over: amber." w={W.panel}>
        <View style={s.pad}>
          <KitMeter pct={72} />
        </View>
      </Case>
      <Case name="KitMeter" props={"pct={94}"} note="90 and over: coral." w={W.panel}>
        <View style={s.pad}>
          <KitMeter pct={94} />
        </View>
      </Case>
      <Case name="KitMeter" props={"pct={null}"} w={W.panel}>
        <View style={s.pad}>
          <KitMeter pct={null} />
        </View>
      </Case>
    </Cases>
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
const MarkdownFull = () => (
  <Case name="Markdown" props="text={plan}" note="At the chat column width." w={680} plain>
    <Markdown text={MD} />
  </Case>
);
const MarkdownGaps = () => (
  <Case name="Markdown" props="text={unsupported}" w={680} plain>
    <Markdown text={MD_GAPS} />
  </Case>
);
const MarkdownShort = () => (
  <Case name="Markdown" props={'text="Bumped to **0.546.0**…"'} w={W.phone} plain>
    <Markdown text="Bumped to **0.546.0**; no icon renames." />
  </Case>
);

function Pills() {
  return (
    <Cases>
      <Case name="Pill" props="text tint" note="settings/controls.tsx: outlined status.">
        <View style={s.padWrap}>
          <Cell label="no tint">
            <Pill text="default" />
          </Cell>
          <Cell label="mint">
            <Pill text="ready" tint={color.mint} />
          </Cell>
          <Cell label="cyan2">
            <Pill text="beta" tint={color.cyan2} />
          </Cell>
          <Cell label="amber">
            <Pill text="needs restart" tint={color.amber} />
          </Cell>
          <Cell label="coral">
            <Pill text="failed" tint={color.coral} />
          </Cell>
        </View>
      </Case>
      <Case name="LabelChip" props="name c" note="sessions/sheets.tsx: session labels.">
        <View style={s.padWrap}>
          <Cell label='c="sky"'>
            <LabelChip name="frontend" c="sky" />
          </Cell>
          <Cell label='c="red"'>
            <LabelChip name="urgent" c="red" />
          </Cell>
          <Cell label="no c">
            <LabelChip name="no colour" />
          </Cell>
        </View>
      </Case>
      <Case
        name="LabelChip (hostkit)"
        props="name tone"
        note="settings/pages/hostkit.tsx: host labels; the duplicate."
      >
        <View style={s.padWrap}>
          <Cell label="violet">
            <HostLabelChip name="gpu" tone={color.violet} />
          </Cell>
          <Cell label="amber">
            <HostLabelChip name="staging" tone={color.amber} />
          </Cell>
        </View>
      </Case>
    </Cases>
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
    <Cases>
      <Case
        name="AccountBlock"
        props="entry={work} tint={cyan}"
        note="Active sign-in: marker and plan."
        w={W.panel}
      >
        <AccountBlock entry={work} tint={workTint} />
      </Case>
      <Case name="AccountBlock" props="entry={personal} tint={violet}" w={W.panel}>
        <AccountBlock entry={personal} tint={personalTint} />
      </Case>
    </Cases>
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
    <Cases>
      <Case
        name="AccountBlock"
        props="entry={{usage: null}}"
        note="Signed out: no windows."
        w={W.panel}
      >
        <AccountBlock entry={signedOut} tint={color.amber} />
      </Case>
      <Case
        name="AccountBlock"
        props={'entry={{error: "usage API returned 503"}}'}
        note="Failed read: error line."
        w={W.panel}
      >
        <AccountBlock entry={failed} tint={color.coral} />
      </Case>
    </Cases>
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
    polish:
      "cells stagger in (16ms/cell, 110ms each on glide, ~420ms full) and toward new values; tone crossfades; amber shimmers once then breathes the lead cell; coral pulses the run 3x then keeps a lead pulse and flashes the %; reduced motion static",
    variants: [
      {
        id: "tones",
        label: "Tones by threshold",
        note: "cyan < 70, amber ≥ 70, coral ≥ 90",
        C: Meters,
      },
      { id: "edge", label: "Null, zero, clamped, custom tone", C: MetersEdge },
      { id: "play", label: "Value slider / replay", C: MeterPlayground },
    ],
  },
  {
    id: "kit-meter",
    name: "Meter (settings kit)",
    category: "Data display",
    path: "components/settings/pages/kit.tsx (Meter)",
    purpose: "A second, continuous meter used by settings pages. Near-duplicate of Meter.",
    usedBy: 2,
    polish:
      "width glides in and toward new values; amber flashes once then breathes the edge; coral pulses 3x then keeps an edge pulse and flashes the %; reduced motion static",
    variants: [
      {
        id: "tones",
        label: "Thresholds",
        note: "amber ≥ 70, coral ≥ 90 (matches Meter)",
        C: KitMeters,
      },
      { id: "play", label: "Value slider / replay", C: KitMeterPlayground },
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
    polish:
      "split/unified and uncommitted/base toggles: sliding indicator (Glide, 200ms glide curve); diff body swaps instantly",
    setup: watchFixtureCheckout,
    variants: [
      { id: "modified", label: "Modified file", C: Diff, h: 480, bleed: true },
      { id: "new", label: "New file", C: DiffNew, h: 320, bleed: true },
    ],
  },
];

const s = StyleSheet.create({
  pad: { padding: 16 },
  padWrap: { padding: 16, flexDirection: "row", flexWrap: "wrap", gap: 16 },
  play: { gap: 12 },
  track: { height: 22, backgroundColor: color.line, justifyContent: "center" },
  mark: { position: "absolute", top: 0, bottom: 0, width: 1 },
  mark70: { left: "70%", backgroundColor: color.amber },
  mark90: { left: "90%", backgroundColor: color.coral },
  playRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  preset: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: color.line },
  presetOn: { borderColor: color.cyan },
  replay: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: color.amber },
  replayT: { fontSize: 11, color: color.text },
});
