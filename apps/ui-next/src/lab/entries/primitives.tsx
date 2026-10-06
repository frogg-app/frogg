import { Archive, Copy, GitFork, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { Cut } from "../../components/Cut";
import { Logo, type LogoMotion } from "../../components/Logo";
import { GroupHead, PanelHead } from "../../components/PanelHead";
import { Select, type Option } from "../../components/Select";
import { Brackets } from "../../components/SessionList";
import { StatusGlyph } from "../../components/StatusGlyph";
import { T } from "../../components/Text";
import { Dialog } from "../../components/tools/Dialog";
import { Menu, useAnchor, type MenuEntry } from "../../components/tools/Menu";
import { Tabs } from "../../components/tools/Tabs";
import type { Bucket } from "../../daemon/types";
import { color } from "../../theme/tokens";
import { Case, Cases, Cell, Ghost, Loop, Stack, Start, W, Wrap, type Entry } from "../kit";

const noop = () => {};

function Buttons() {
  return (
    <Stack>
      <Wrap>
        <Cell label='kind="primary"'>
          <Button kind="primary" label="Create session" onPress={noop} />
        </Cell>
        <Cell label="(ghost, default)">
          <Button label="Cancel" onPress={noop} />
        </Cell>
        <Cell label='kind="danger"'>
          <Button kind="danger" label="Archive" onPress={noop} />
        </Cell>
      </Wrap>
      <Wrap>
        <Cell label="primary icon={Plus}">
          <Button kind="primary" label="New" icon={Plus} onPress={noop} />
        </Cell>
        <Cell label="icon={RefreshCw}">
          <Button label="Refresh" icon={RefreshCw} onPress={noop} />
        </Cell>
        <Cell label="danger icon={Trash2}">
          <Button kind="danger" label="Delete" icon={Trash2} onPress={noop} />
        </Cell>
      </Wrap>
      <Wrap>
        <Cell label='primary kbd="⌘↵"'>
          <Button kind="primary" label="Create session" kbd="⌘↵" onPress={noop} />
        </Cell>
        <Cell label='kbd="⌘K"'>
          <Button label="Search" kbd="⌘K" onPress={noop} />
        </Cell>
      </Wrap>
    </Stack>
  );
}

function ButtonsDisabled() {
  return (
    <Wrap>
      <Cell label="primary disabled">
        <Button kind="primary" label="Creating…" disabled />
      </Cell>
      <Cell label="disabled">
        <Button label="Working…" disabled />
      </Cell>
      <Cell label="danger disabled">
        <Button kind="danger" label="Deny" disabled />
      </Cell>
    </Wrap>
  );
}

function ButtonsGrow() {
  return (
    <Case
      name="Button"
      props="grow (× 2)"
      note="Phone sheet footer: the pair splits the width."
      w={W.phone}
    >
      <View style={s.growRow}>
        <Button label="Cancel" grow onPress={noop} />
        <Button kind="primary" label="Create session" grow onPress={noop} />
      </View>
    </Case>
  );
}

function CutShapes() {
  return (
    <Wrap>
      <Cell label="filled">
        <Cut size={8} style={s.cutFill} />
      </Cell>
      <Cell label="flip">
        <Cut size={8} flip style={s.cutFill} />
      </Cell>
      <Cell label="bordered">
        <Cut size={10} style={s.cutBorder} />
      </Cell>
      <Cell label="gradient">
        <Cut size={6} style={s.cutGrad} />
      </Cell>
    </Wrap>
  );
}

function CutContent() {
  return (
    <Cut size={12} flip style={s.cutCard}>
      <T v="label">card with content</T>
      <T>Only the painted layer is clipped, so content and popovers can overflow the chamfer.</T>
    </Cut>
  );
}

function BracketSet() {
  return (
    <Wrap>
      <Cell label="default cyan2 · 8">
        <Loop>
          <View style={s.bracketBox}>
            <Brackets />
          </View>
        </Loop>
      </Cell>
      <Cell label="len 6 (files)">
        <Loop>
          <View style={s.bracketBox}>
            <Brackets len={6} />
          </View>
        </Loop>
      </Cell>
      <Cell label="amber">
        <Loop>
          <View style={s.bracketBox}>
            <Brackets c={color.amber} />
          </View>
        </Loop>
      </Cell>
    </Wrap>
  );
}

const BUCKETS: Bucket[] = ["needs", "failed", "review", "working", "idle"];
function Glyphs() {
  return (
    <Wrap>
      {BUCKETS.map((b) => (
        <Cell key={b} label={b}>
          <StatusGlyph bucket={b} />
        </Cell>
      ))}
    </Wrap>
  );
}
function GlyphSizes() {
  return (
    <Wrap>
      <Cell label="7 (list counts)">
        <StatusGlyph bucket="needs" size={7} />
      </Cell>
      <Cell label="9 (default)">
        <StatusGlyph bucket="needs" />
      </Cell>
      <Cell label="14">
        <StatusGlyph bucket="needs" size={14} />
      </Cell>
      <Cell label="working still">
        <StatusGlyph bucket="working" size={14} still />
      </Cell>
      <Cell label="working breathing">
        <StatusGlyph bucket="working" size={14} />
      </Cell>
    </Wrap>
  );
}

function Logos() {
  return (
    <Wrap>
      <Cell label="12 (status bar)">
        <Logo size={12} />
      </Cell>
      <Cell label="24">
        <Logo />
      </Cell>
      <Cell label="26 (rail)">
        <Logo size={26} />
      </Cell>
      <Cell label="48">
        <Logo size={48} />
      </Cell>
    </Wrap>
  );
}

function LogoMotionRow({ motion }: { motion: LogoMotion }) {
  return (
    <Wrap>
      <Cell label={`${motion} · 26 (rail)`}>
        <Logo size={26} motion={motion} />
      </Cell>
      <Cell label={`${motion} · 48`}>
        <Logo size={48} motion={motion} />
      </Cell>
    </Wrap>
  );
}

function LogoRipple() {
  return <LogoMotionRow motion="ripple" />;
}

function LogoShatter() {
  return <LogoMotionRow motion="shatter" />;
}

function LogoSweep() {
  return <LogoMotionRow motion="sweep" />;
}

function HeadTop() {
  return (
    <Cases>
      <Case name="PanelHead" props={'title="Usage" children=[refresh]'} w={W.panel}>
        <PanelHead title="Usage">
          <RefreshCw size={14} color={color.faint} />
        </PanelHead>
        <Ghost n={3} />
      </Case>
      <Case name="PanelHead" props={'title="Files" children=[new, refresh]'} w={W.tablet}>
        <PanelHead title="Files">
          <Plus size={16} color={color.faint} />
          <RefreshCw size={14} color={color.faint} />
        </PanelHead>
        <Ghost n={3} />
      </Case>
      <Case name="PanelHead" props={'title="Search"'} note="No children: title only." w={W.tablet}>
        <PanelHead title="Search" />
        <Ghost n={2} />
      </Case>
    </Cases>
  );
}

function HeadGroups() {
  return (
    <Cases>
      <Case
        name="GroupHead"
        props={'label="Needs you" count={3}'}
        note="Count sits flush right; the label is uppercased by the label variant."
        w={W.panel}
      >
        <GroupHead label="Needs you" count={3} />
        <Ghost n={3} />
        <GroupHead label="Idle" count={12} />
        <Ghost n={2} />
      </Case>
      <Case
        name="GroupHead"
        props={'label="Idle"'}
        note="No count prop: nothing on the right."
        w={W.panel}
      >
        <GroupHead label="Idle" />
        <Ghost n={2} />
      </Case>
    </Cases>
  );
}

function HeadLong() {
  return (
    <Cases>
      <Case
        name="PanelHead"
        props={'title="Pull requests and checks for frogg-interface-design" children=[+]'}
        note="Title wraps (no numberOfLines); the action stays pinned right."
        w={W.tablet}
      >
        <PanelHead title="Pull requests and checks for frogg-interface-design">
          <Plus size={16} color={color.faint} />
        </PanelHead>
        <Ghost n={2} />
      </Case>
      <Case
        name="GroupHead"
        props={'label="Waiting on review from the platform team" count={128}'}
        note="At the phone width the label wraps; the count stays top right."
        w={W.phone}
      >
        <GroupHead label="Waiting on review from the platform team" count={128} />
        <Ghost n={2} />
      </Case>
    </Cases>
  );
}

const MODELS: Array<Option<string>> = [
  { value: "claude-opus-4-5", label: "Opus 4.5", hint: "Most capable" },
  { value: "claude-sonnet-4-5", label: "Sonnet 4.5", hint: "Fast and capable" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5", hint: "Fastest" },
  { value: "legacy", label: "Claude 3 Opus", hint: "Retired on this host", disabled: true },
];

function useChoice(initial: string | null) {
  const [v, setV] = useState<string | null>(initial);
  const set = useCallback((x: string) => setV(x), []);
  return [v, set] as const;
}

function SelectField() {
  const [v, set] = useChoice("claude-opus-4-5");
  return (
    <Case
      name="Select"
      props='label="Model" options={4, one disabled}'
      note="Click to open; hover rows."
      w={W.panel}
      plain
    >
      <Select value={v} options={MODELS} onChange={set} label="Model" />
    </Case>
  );
}
function SelectMono() {
  const [v, set] = useChoice("claude-sonnet-4-5");
  return (
    <Case name="Select" props="mono width={200}" plain>
      <Select mono width={200} value={v} options={MODELS} onChange={set} />
    </Case>
  );
}
function SelectEmpty() {
  const [v, set] = useChoice(null);
  return (
    <Case name="Select" props='value={null} placeholder="Choose a model"' w={W.panel} plain>
      <Select value={v} options={MODELS} onChange={set} placeholder="Choose a model" />
    </Case>
  );
}
function SelectNone() {
  const [v, set] = useChoice(null);
  return (
    <Case name="Select" props='options={[]} placeholder="No ready agents"' w={W.panel} plain>
      <Select value={v} options={NO_OPTIONS} onChange={set} placeholder="No ready agents" />
    </Case>
  );
}
const NO_OPTIONS: Array<Option<string>> = [];
function SelectChip() {
  const [v, set] = useChoice("claude-opus-4-5");
  return (
    <View style={s.chipRow}>
      <Select chip mono up width="auto" menuWidth={240} value={v} options={MODELS} onChange={set} />
    </View>
  );
}

const TABS = [
  { id: "changes", label: "Changes", count: 12 },
  { id: "commits", label: "Commits", count: 3 },
  { id: "streams", label: "Streams", count: null },
] as const;
type TabId = (typeof TABS)[number]["id"];
function TabsDemo() {
  const [v, setV] = useState<TabId>("changes");
  return (
    <Cases>
      <Case
        name="Tabs"
        props="tabs={[12, 3, null counts]}"
        note="Click a tab: the underline glides."
        w={W.panel}
      >
        <Tabs
          tabs={TABS as unknown as Array<{ id: TabId; label: string }>}
          value={v}
          onChange={setV}
        />
        <Ghost n={2} />
      </Case>
      <Case name="Tabs" props="(same)" note="Tablet side panel width." w={W.tablet}>
        <Tabs
          tabs={TABS as unknown as Array<{ id: TabId; label: string }>}
          value={v}
          onChange={setV}
        />
        <Ghost n={2} />
      </Case>
    </Cases>
  );
}

const MENU: MenuEntry[] = [
  { head: "Session" },
  { label: "Rename", icon: Pencil, kbd: "R", onPress: noop },
  { label: "Fork", icon: GitFork, hint: "A new session carries this conversation", onPress: noop },
  { label: "Copy id", icon: Copy, onPress: noop },
  { label: "Plan mode", on: true, onPress: noop },
  { label: "Rewind", hint: "This host is too old", warn: true, disabled: true },
  "-",
  { label: "Archive", icon: Archive, danger: true, onPress: noop },
];
function MenuDemo() {
  const a = useAnchor();
  return (
    <View style={s.anchorRow}>
      <View ref={a.ref} collapsable={false}>
        <Button label="Open menu" onPress={a.open} />
      </View>
      <Menu rect={a.rect} onClose={a.close} items={MENU} />
    </View>
  );
}

function DialogDemo() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const footer = useMemo(() => <DialogFoot onClose={hide} />, [hide]);
  return (
    <Start>
      <Button label="Open dialog" onPress={show} />
      <Dialog
        open={open}
        onClose={hide}
        eyebrow="Archive"
        title="Archive Invoice PDF renderer?"
        footer={footer}
      >
        <T style={s.dialogBody}>
          The worktree stays on disk. You can restore the session from History.
        </T>
      </Dialog>
    </Start>
  );
}
function DialogFoot({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Button label="Cancel" onPress={onClose} />
      <Button kind="danger" label="Archive" onPress={onClose} />
    </>
  );
}

function HoverProbe() {
  return (
    <Pressable style={s.probe}>
      {({ hovered, pressed }) => (
        <T v="mono">
          Hover or press this box · hovered {String(!!hovered)} · pressed {String(pressed)}
        </T>
      )}
    </Pressable>
  );
}

export const primitives: Entry[] = [
  {
    id: "button",
    name: "Button",
    category: "Primitives",
    path: "components/Button.tsx",
    purpose: "The chamfered action button: primary gradient, ghost wash, danger tint.",
    usedBy: 43,
    polish:
      "hover swaps background instantly (no transition); primary hover is filter brightness(1.1); no pressed state",
    variants: [
      {
        id: "kinds",
        label: "Kinds, icons and kbd chips",
        note: "Hover each on desktop.",
        C: Buttons,
      },
      { id: "disabled", label: "Disabled / busy", C: ButtonsDisabled },
      { id: "grow", label: "grow (phone footers)", C: ButtonsGrow },
      {
        id: "probe",
        label: "Pressable state probe",
        note: "What RN-web reports while you hover and press.",
        C: HoverProbe,
      },
    ],
  },
  {
    id: "cut",
    name: "Cut",
    category: "Primitives",
    path: "components/Cut.tsx",
    purpose:
      "The bracket shape: two opposite corners chamfered via clip-path on a painted layer. Native draws a plain box.",
    usedBy: 24,
    polish: "none",
    variants: [
      { id: "shapes", label: "Fills and borders", C: CutShapes },
      { id: "content", label: "With content", C: CutContent },
    ],
  },
  {
    id: "brackets",
    name: "Brackets",
    category: "Primitives",
    path: "components/SessionList.tsx (Brackets)",
    purpose: "Corner brackets framing the selected row: sessions, inbox, files, terminals, hosts.",
    usedBy: 5,
    polish: "motion.snap on mount: opacity 0→1, scale 1.06→1, 220ms cubic-bezier(0.23,1,0.32,1)",
    variants: [
      {
        id: "set",
        label: "Colours and lengths",
        note: "Loops every 1.6s; click one to replay the snap.",
        C: BracketSet,
      },
    ],
  },
  {
    id: "status-glyph",
    name: "StatusGlyph",
    category: "Primitives",
    path: "components/StatusGlyph.tsx",
    purpose:
      "Session state as shape: diamond needs you, square failed, dot review, triangle working, hollow idle.",
    usedBy: 14,
    polish: "working breathes: opacity 0.45↔1, 1.6s ease-in-out ∞ (still={true} turns it off)",
    variants: [
      { id: "buckets", label: "Buckets", C: Glyphs },
      { id: "sizes", label: "Sizes and still", C: GlyphSizes },
    ],
  },
  {
    id: "logo",
    name: "Logo",
    category: "Primitives",
    path: "components/Logo.tsx",
    purpose:
      "Faceted gem mark (SVG). Hover and press it: a low-poly mesh after the frogg.dev hero takes over the facets. Motion via the `motion` prop; the rail uses ripple.",
    usedBy: 2,
    polish:
      "motion: three candidates (ripple default in the rail). Web only, 20px and up, off under reduced motion; native and the 12px status-bar mark stay static.",
    variants: [
      { id: "sizes", label: "Sizes in use", C: Logos },
      { id: "ripple", label: "Motion: ripple (rail default)", C: LogoRipple },
      { id: "shatter", label: "Motion: shatter", C: LogoShatter },
      { id: "sweep", label: "Motion: sweep", C: LogoSweep },
    ],
  },
  {
    id: "panel-head",
    name: "PanelHead / GroupHead",
    category: "Primitives",
    path: "components/PanelHead.tsx",
    purpose:
      "Side-panel title row with trailing actions, and the uppercase group label with a count.",
    usedBy: 11,
    polish: "none",
    variants: [
      { id: "panel", label: "PanelHead at the top of a side panel", C: HeadTop },
      { id: "group", label: "GroupHead between list groups", C: HeadGroups },
      { id: "long", label: "Long title and label at narrow widths", C: HeadLong },
    ],
  },
  {
    id: "select",
    name: "Select",
    category: "Primitives",
    path: "components/Select.tsx",
    purpose:
      "Bracket dropdown: in place on wide web (or above with up), a bottom sheet in a Modal on native and narrow widths.",
    usedBy: 13,
    polish:
      "wide web menu: popover motion (fade + scale 0.96→1 + 4px, 160ms ease; out 110ms) · sheet: slide-up 200ms + scrim fade, out 140ms · hover instant",
    variants: [
      { id: "field", label: "Field with hints and a disabled option", C: SelectField, h: 260 },
      { id: "mono", label: "mono, fixed width", C: SelectMono, h: 220 },
      { id: "empty", label: "No value (placeholder)", C: SelectEmpty, h: 220 },
      { id: "none", label: "No options", C: SelectNone, h: 120 },
      { id: "chip", label: "Composer chip, opens up", C: SelectChip, h: 220 },
    ],
  },
  {
    id: "tabs",
    name: "Tabs",
    category: "Primitives",
    path: "components/tools/Tabs.tsx",
    purpose: "Underlined panel tabs with counts (source control, PRs, plugins).",
    usedBy: 3,
    polish:
      "Shared underline glides and resizes between tabs (useGlide, glide token: 200ms on the ease curve); label colour crossfades; first paint and reduced motion jump.",
    variants: [{ id: "default", label: "With counts", C: TabsDemo, bleed: true }],
  },
  {
    id: "menu",
    name: "Menu / Popover",
    category: "Primitives",
    path: "components/tools/Menu.tsx",
    purpose:
      "Anchored popover in a transparent Modal: heads, rules, hints, kbd chips, checks, danger rows.",
    usedBy: 12,
    polish:
      "in: fade + scale 0.96→1 + 4px from the anchor, 160ms ease, origin at anchor corner · out: fade + scale 0.97, 110ms, stays mounted, action runs at once · hover instant · reduced motion: none",
    variants: [{ id: "default", label: "Session menu items", C: MenuDemo }],
  },
  {
    id: "dialog",
    name: "Dialog",
    category: "Primitives",
    path: "components/tools/Dialog.tsx (+ Confirm.tsx, Prompt.tsx)",
    purpose: "Centred modal card: eyebrow, title, body, right-aligned footer; backdrop closes.",
    usedBy: 11,
    polish:
      "in: scrim fade + card fade/scale 0.97→1/6px rise, 170ms ease · out: 110ms fade + scale, stays mounted · reduced motion: none",
    variants: [{ id: "default", label: "Confirm", C: DialogDemo }],
  },
];

const s = StyleSheet.create({
  growRow: { flexDirection: "row", gap: 8, padding: 12 },
  probe: {
    alignSelf: "flex-start",
    padding: 12,
    borderWidth: 1,
    borderColor: color.line2,
    borderStyle: "dashed",
  },
  cutFill: { width: 80, height: 44, backgroundColor: color.raise },
  cutBorder: { width: 80, height: 44, borderWidth: 1, borderColor: color.line2 },
  cutGrad: { width: 80, height: 44, backgroundColor: color.cyan },
  cutCard: {
    gap: 6,
    padding: 14,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line2,
    maxWidth: 420,
  },
  bracketBox: { width: 120, height: 48, backgroundColor: color.wash },
  chipRow: { flex: 1, justifyContent: "flex-end", paddingTop: 150 },
  anchorRow: { flexDirection: "row" },
  dialogBody: { color: color.muted, lineHeight: 20 },
});
