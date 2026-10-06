import { Plus, RefreshCw, Trash2 } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { T } from "../../components/Text";
import { color } from "../../theme/tokens";
import { AltButton, type Alt, type Force } from "../AltButton";
import { Cell, Stack, Wrap, type Entry, type Variant } from "../kit";

const noop = () => {};

/** The "Kinds, icons and kbd chips" rows with one primary candidate, plus a forced state strip. */
function rows(alt: Alt) {
  function Rows() {
    return (
      <Stack>
        <Wrap>
          <AltButton alt={alt} label="Create session" onPress={noop} />
          <Button label="Cancel" onPress={noop} />
          <Button kind="danger" label="Archive" onPress={noop} />
        </Wrap>
        <Wrap>
          <AltButton alt={alt} label="New" icon={Plus} onPress={noop} />
          <Button label="Refresh" icon={RefreshCw} onPress={noop} />
          <Button kind="danger" label="Delete" icon={Trash2} onPress={noop} />
        </Wrap>
        <Wrap>
          <AltButton alt={alt} label="Create session" kbd="⌘↵" onPress={noop} />
          <Button label="Search" kbd="⌘K" onPress={noop} />
        </Wrap>
        <Wrap>
          {STATES.map((f) => (
            <Cell key={f.id} label={f.id}>
              <AltButton alt={alt} label="Create" icon={Plus} force={f.force} />
            </Cell>
          ))}
        </Wrap>
      </Stack>
    );
  }
  return Rows;
}

const STATES: Array<{ id: string; force?: Force }> = [
  { id: "rest" },
  { id: "hover", force: "hover" },
  { id: "pressed", force: "pressed" },
];

function Current() {
  return (
    <Stack>
      <Wrap>
        <Button kind="primary" label="Create session" onPress={noop} />
        <Button label="Cancel" onPress={noop} />
        <Button kind="danger" label="Archive" onPress={noop} />
      </Wrap>
      <T v="mono">current default: cyan → deep blue gradient, for reference</T>
    </Stack>
  );
}

const CANDIDATES: Array<{ alt: Alt; label: string; note: string }> = [
  {
    alt: "solid",
    label: "A · Flat cyan",
    note: "Solid cyan, no gradient; hover lifts to cyan2, press dims.",
  },
  {
    alt: "mint",
    label: "B · Flat mint",
    note: "Solid mint, the 'go' accent; ties to working/afterglow.",
  },
  { alt: "outline", label: "C · Outline", note: "1px cyan border, cyan2 text; wash on hover." },
  {
    alt: "bar",
    label: "D · Raise + accent bar",
    note: "Dark raise fill, 2px cyan left bar that brightens on hover.",
  },
  {
    alt: "bracket",
    label: "E · Bracket corners",
    note: "Raise fill framed by corner brackets, the selection language.",
  },
  { alt: "tint", label: "F · Accent wash", note: "Danger's tinted-wash recipe in cyan." },
];

const ROWS = new Map(CANDIDATES.map((c) => [c.alt, rows(c.alt)]));

function Candidate({ c }: { c: (typeof CANDIDATES)[number] }) {
  const R = ROWS.get(c.alt) ?? Current;
  return (
    <View style={s.col}>
      <View style={s.head}>
        <T style={s.name}>{c.label}</T>
        <T style={s.note}>{c.note}</T>
      </View>
      <R />
    </View>
  );
}

function Compare() {
  return (
    <View style={s.grid}>
      {CANDIDATES.map((c) => (
        <Candidate key={c.alt} c={c} />
      ))}
    </View>
  );
}

const variants: Variant[] = [
  { id: "current", label: "Current primary", C: Current },
  {
    id: "compare",
    label: "Candidates side by side",
    note: "Hover and press the top three rows; the bottom strip forces rest / hover / pressed.",
    C: Compare,
  },
];

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  col: {
    width: 340,
    flexGrow: 1,
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
  },
  head: { gap: 2 },
  name: { fontSize: 13, fontWeight: "600", color: color.text },
  note: { fontSize: 12, color: color.faint },
});

export const buttonAlts: Entry[] = [
  {
    id: "button-alts",
    name: "Primary button alternatives",
    category: "Primitives",
    path: "lab/AltButton.tsx (lab only)",
    purpose:
      "Candidates to replace the gradient primary. Each keeps the 6px chamfer and sits beside the real ghost and danger buttons; hover and press them, or read the forced rest / hover / pressed strip.",
    polish: "hover and pressed swap background instantly, matching Button",
    variants,
  },
];
