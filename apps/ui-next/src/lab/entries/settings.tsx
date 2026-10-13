import { Cpu, KeyRound, Monitor } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import {
  Area,
  Lede,
  Note,
  NumField,
  Pill,
  Row,
  Section,
  Seg,
  TextField,
  Toggle,
} from "../../components/settings/controls";
import { DesignOptions } from "../../components/settings/pages/DesignOptions";
import { Acts, Block, Field, Item, Value } from "../../components/settings/pages/kit";
import { color } from "../../theme/tokens";
import { Case, Cases, Cell, W, Wrap, type Entry } from "../kit";

const noop = () => {};

function DesignOptionsCase() {
  return (
    <Cases>
      <Case
        name="DesignOptions"
        props="(Settings → Design options)"
        note="Every pending pick on one page; changes apply to the whole lab and app live."
        w={W.phone}
      >
        <DesignOptions />
      </Case>
    </Cases>
  );
}

function Toggles() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <Wrap>
      <Cell label={`value={${a}}`}>
        <Toggle value={a} onChange={setA} />
      </Cell>
      <Cell label={`value={${b}}`}>
        <Toggle value={b} onChange={setB} />
      </Cell>
      <Cell label="value disabled">
        <Toggle value disabled onChange={noop} />
      </Cell>
      <Cell label="value={false} disabled">
        <Toggle value={false} disabled onChange={noop} />
      </Cell>
    </Wrap>
  );
}

type Density = "compact" | "comfortable" | "roomy";
const DENSITY: Array<[Density, string]> = [
  ["compact", "Compact"],
  ["comfortable", "Comfortable"],
  ["roomy", "Roomy"],
];
const TWO: Array<[string, string]> = [
  ["worktree", "New worktree"],
  ["local", "Local checkout"],
];
function Segs() {
  const [d, setD] = useState<Density>("comfortable");
  const [i, setI] = useState("worktree");
  return (
    <Cases>
      <Case
        name="Seg"
        props={`options={3} value="${d}"`}
        note="Click another option: the indicator slides."
      >
        <Seg options={DENSITY} value={d} onChange={setD} />
      </Case>
      <Case name="Seg" props={`options={2} value="${i}"`}>
        <Seg options={TWO} value={i} onChange={setI} />
      </Case>
    </Cases>
  );
}

function Fields() {
  const [area, setArea] = useState(
    "Prefer small, reviewable commits.\nRun the tests before finishing.",
  );
  const [num, setNum] = useState<number | null>(200);
  const [txt, setTxt] = useState("main");
  const [field, setField] = useState("");
  return (
    <Cases>
      <Case name="Area" props='placeholder="Instructions for every session"' w={560} plain>
        <Area value={area} onChange={setArea} placeholder="Instructions for every session" />
      </Case>
      <Case
        name="NumField"
        props='unit="sessions" min={10} max={1000}'
        note={`Commits on blur or Enter, clamps to [min, max]; value ${String(num)}.`}
        plain
      >
        <NumField value={num} onChange={setNum} unit="sessions" min={10} max={1000} />
      </Case>
      <Case name="NumField" props='value={null} placeholder="auto" unit="h"' plain>
        <NumField value={null} onChange={setNum} placeholder="auto" unit="h" />
      </Case>
      <Case name="TextField" props="width={140}" plain>
        <TextField value={txt} onChange={setTxt} width={140} />
      </Case>
      <Case name="Field (kit)" props='placeholder="kit Field"' w={W.tablet} plain>
        <Field value={field} onChangeText={setField} placeholder="kit Field" />
      </Case>
      <Case name="Field (kit)" props="mono short editable={false}" plain>
        <Field value="mono short" mono short editable={false} />
      </Case>
    </Cases>
  );
}

function SectionBody() {
  const [v, setV] = useState(true);
  return (
    <View>
      <Lede>
        Lede: the intro paragraph above a page’s first section, in muted body text, capped at 640px.
      </Lede>
      <Section title="Interface">
        <Row label="Motion" hint="Rail indicator, bracket and panel transitions.">
          <Toggle value={v} onChange={setV} />
        </Row>
        <Row label="Status" hint="A row with a pill">
          <Pill text="ready" tint={color.mint} />
        </Row>
        <Row
          label="A long row label that wraps when the column is narrow"
          hint="And a hint that also wraps onto a second line on the phone width of the lab."
          last
        >
          <Button label="Change…" onPress={noop} />
        </Row>
      </Section>
      <Note>Note: a faint line under a section.</Note>
    </View>
  );
}

function SectionRows() {
  return (
    <Cases>
      <Case
        name="Section + Row"
        props='title="Interface"'
        note="Settings page column."
        w={640}
        plain
      >
        <SectionBody />
      </Case>
      <Case
        name="Section + Row"
        props="(same)"
        note="Phone: long label and hint wrap beside the control."
        w={W.phone}
        plain
      >
        <SectionBody />
      </Case>
    </Cases>
  );
}

function KitRowsBody() {
  return (
    <View style={s.card}>
      <Item icon={Monitor} title="MacBook Pro" sub="paired 3 days ago · owner">
        <Button label="Revoke" kind="danger" onPress={noop} />
      </Item>
      <Item icon={KeyRound} title="Device key" sub="sha256:4f2a…9c1e" subMono />
      <Item icon={Cpu} title="Load" last>
        <Value>0.42 · 0.38 · 0.31</Value>
      </Item>
      <Block last>
        <Acts>
          <Button label="Export" onPress={noop} />
          <Button kind="primary" label="Save" onPress={noop} />
        </Acts>
      </Block>
    </View>
  );
}

function KitRows() {
  return (
    <Cases>
      <Case
        name="Item / Block / Acts / Value"
        props="icon title sub children"
        note="Host page column."
        w={640}
        plain
      >
        <KitRowsBody />
      </Case>
      <Case name="(same)" note="Phone width." w={W.phone} plain>
        <KitRowsBody />
      </Case>
    </Cases>
  );
}

export const settings: Entry[] = [
  {
    id: "design-options",
    name: "Design options",
    category: "Settings controls",
    path: "components/settings/pages/DesignOptions.tsx",
    purpose:
      "Settings page that switches every pending lab decision on-device: primary button, logo motion, shape language, toast, session state card, streaming text reveal and heading reveal. Persisted in prefs; production components read the picks. The lab entries that carry each decision stay marked and point here.",
    usedBy: 1,
    polish:
      "chooser chips use the bracket selection language (slide + lock-on) · each pick previews on the real production component · motions that are web-only are tagged 'web only'",
    variants: [{ id: "page", label: "Phone width", C: DesignOptionsCase }],
  },
  {
    id: "toggle",
    name: "Toggle",
    category: "Settings controls",
    path: "components/settings/controls.tsx (Toggle)",
    purpose: "Switch with accessibilityRole=switch.",
    usedBy: 38,
    polish:
      "track: background-color .25s (default ease) · knob: transform .3s cubic-bezier(0.22,1,0.36,1) · CSS transitions, web only",
    variants: [
      {
        id: "states",
        label: "States",
        note: "Click to flip; slow motion shows the knob curve.",
        C: Toggles,
      },
    ],
  },
  {
    id: "seg",
    name: "Seg",
    category: "Settings controls",
    path: "components/settings/controls.tsx (Seg)",
    purpose: "Segmented choice of two to four options.",
    usedBy: 38,
    polish:
      "selection indicator slides between options (Glide, components/Glide.tsx: 200ms on the glide curve); shared with Tabs, the DiffView toggles and PhoneTabs · label colour swaps instantly · reduced motion: jumps",
    variants: [{ id: "default", label: "Three and two options", C: Segs }],
  },
  {
    id: "fields",
    name: "Area / NumField / TextField / Field",
    category: "Settings controls",
    path: "components/settings/controls.tsx · settings/pages/kit.tsx (Field)",
    purpose:
      "Multi-line text, clamped numbers with a unit, short text; kit Field is a fourth input style.",
    usedBy: 38,
    polish: "none; no focus ring (outline removed on web)",
    variants: [{ id: "all", label: "All inputs", C: Fields }],
  },
  {
    id: "section-row",
    name: "Section / Row / Lede / Note",
    category: "Settings controls",
    path: "components/settings/controls.tsx",
    purpose:
      "The settings page grammar: titled card sections of label/hint rows with a trailing control.",
    usedBy: 38,
    polish: "none",
    variants: [{ id: "default", label: "A page section", C: SectionRows }],
  },
  {
    id: "kit-rows",
    name: "Item / Block / Acts / Value",
    category: "Settings controls",
    path: "components/settings/pages/kit.tsx",
    purpose:
      "List rows with icon, title, sub-line and trailing actions, used by host and device pages.",
    usedBy: 21,
    polish: "none",
    variants: [{ id: "default", label: "Rows", C: KitRows }],
  },
];

const s = StyleSheet.create({
  card: { borderWidth: 1, borderColor: color.line, backgroundColor: color.panel },
});
