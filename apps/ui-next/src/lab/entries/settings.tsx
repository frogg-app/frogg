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
import { Acts, Block, Field, Item, Value } from "../../components/settings/pages/kit";
import { T } from "../../components/Text";
import { color } from "../../theme/tokens";
import { Cell, Stack, Start, Wrap, type Entry } from "../kit";

const noop = () => {};

function Toggles() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <Wrap>
      <Cell label={`on: ${a}`}>
        <Toggle value={a} onChange={setA} />
      </Cell>
      <Cell label={`off: ${b}`}>
        <Toggle value={b} onChange={setB} />
      </Cell>
      <Cell label="disabled on">
        <Toggle value disabled onChange={noop} />
      </Cell>
      <Cell label="disabled off">
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
    <Start>
      <Seg options={DENSITY} value={d} onChange={setD} />
      <Seg options={TWO} value={i} onChange={setI} />
    </Start>
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
    <Stack>
      <Area value={area} onChange={setArea} placeholder="Instructions for every session" />
      <Wrap>
        <NumField value={num} onChange={setNum} unit="sessions" min={10} max={1000} />
        <NumField value={null} onChange={setNum} placeholder="auto" unit="h" />
        <TextField value={txt} onChange={setTxt} width={140} />
        <Field value={field} onChangeText={setField} placeholder="kit Field" />
        <Field value="mono short" mono short editable={false} />
      </Wrap>
      <T v="mono">NumField commits on blur or Enter and clamps to [min, max]; now {String(num)}</T>
    </Stack>
  );
}

function SectionRows() {
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

function KitRows() {
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

export const settings: Entry[] = [
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
    polish: "none; selection swaps instantly",
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
