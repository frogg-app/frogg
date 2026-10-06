// Lab only: shape and border languages for cards, buttons and inputs, side by side.
import { Lock } from "lucide-react-native";
import { type ComponentType, type ReactNode, useCallback, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Button } from "../../components/Button";
import { Cut } from "../../components/Cut";
import { Brackets } from "../../components/SessionList";
import { T } from "../../components/Text";
import { color, font, web } from "../../theme/tokens";
import type { Entry, Variant } from "../kit";

const noop = () => {};

type Alt = "chamfer" | "bar" | "brackets" | "tab" | "soft" | "hud";

/** The shared card body: a command permission with an extra allow action. */
function Body({ head = true }: { head?: boolean }) {
  return (
    <>
      {head && (
        <View style={s.head}>
          <Lock size={13} color={color.amber} />
          <T style={s.kind}>Permission needed</T>
          <T v="mono" style={s.meta} numberOfLines={1}>
            Bash · Default
          </T>
        </View>
      )}
      <T style={s.title}>
        Run{" "}
        <T v="mono" style={s.cmd}>
          git push --force-with-lease origin feat/shapes
        </T>
      </T>
      <T style={s.desc}>Rewrites the remote branch with the rebased history.</T>
      <View style={s.actions}>
        <Button kind="danger" label="Deny" onPress={noop} />
        <Button label="Always allow git push" onPress={noop} />
        <Button label="Reply instead…" onPress={noop} />
        <Button kind="primary" label="Approve" onPress={noop} />
      </View>
    </>
  );
}

function CardChamfer() {
  return (
    <Cut size={10} flip style={s.cChamfer}>
      <Body />
    </Cut>
  );
}

function CardBar() {
  return (
    <View style={s.cBar}>
      <Body />
    </View>
  );
}

function CardBrackets() {
  return (
    <View style={s.cBrackets}>
      <Brackets c={color.amber} len={10} />
      <Body />
    </View>
  );
}

function CardTab() {
  return (
    <View style={s.tabWrap}>
      <Cut size={6} flip style={s.tab}>
        <Lock size={11} color={color.onAccent} />
        <T v="mono" style={s.tabT}>
          PERMISSION
        </T>
      </Cut>
      <View style={s.cTab}>
        <Body head={false} />
      </View>
    </View>
  );
}

function CardSoft() {
  return (
    <View style={s.cSoft}>
      <View pointerEvents="none" style={s.softInner} />
      <View pointerEvents="none" style={s.softTop} />
      <Body />
    </View>
  );
}

function CardHud() {
  return (
    <View style={s.cHud}>
      <Brackets c={color.amber} len={6} />
      <View style={s.hudStrip}>
        <T v="mono" style={s.hudT}>
          {"// PERMISSION"}
        </T>
        <T v="mono" style={s.hudMeta} numberOfLines={1}>
          BASH · REQ 3F
        </T>
      </View>
      <View style={s.hudBody}>
        <Body head={false} />
      </View>
    </View>
  );
}

/** Small button in each language; hover and keyboard focus share the lit state. */
function ShapeButton({ alt }: { alt: Alt }) {
  return (
    <Pressable onPress={noop} accessibilityRole="button">
      {({ hovered, focused }) => <ButtonFace alt={alt} on={Boolean(hovered || focused)} />}
    </Pressable>
  );
}

function ButtonFace({ alt, on }: { alt: Alt; on: boolean }) {
  const label = <T style={[s.bL, on && s.bLOn]}>Refresh</T>;
  if (alt === "chamfer")
    return (
      <Cut size={6} style={[s.b, s.bChamfer, on && s.bChamferOn]}>
        {label}
      </Cut>
    );
  if (alt === "bar") return <View style={[s.b, s.bBar, on && s.bBarOn]}>{label}</View>;
  if (alt === "brackets")
    return (
      <View style={[s.b, s.bRaise]}>
        <Brackets c={on ? color.cyan2 : color.faint} len={5} />
        {label}
      </View>
    );
  if (alt === "tab")
    return (
      <Cut size={6} flip style={[s.b, s.bTab, on && s.bTabOn]}>
        {label}
      </Cut>
    );
  if (alt === "soft") return <View style={[s.b, s.bSoft, on && s.bSoftOn]}>{label}</View>;
  return (
    <View style={[s.b, s.bHud, on && s.bHudOn]}>
      {on && <Brackets c={color.cyan2} len={4} />}
      <T v="mono" style={[s.bHudL, on && s.bLOn]}>
        [ REFRESH ]
      </T>
    </View>
  );
}

/** Text input in each language; focus lights it the way hover lights the button. */
function ShapeInput({ alt }: { alt: Alt }) {
  const [focus, setFocus] = useState(false);
  const [v, setV] = useState("");
  const on = useCallback(() => setFocus(true), []);
  const off = useCallback(() => setFocus(false), []);
  const field = (
    <TextInput
      value={v}
      onChangeText={setV}
      onFocus={on}
      onBlur={off}
      placeholder="Tell the agent what to do instead"
      placeholderTextColor={color.faint}
      style={[s.in, alt === "hud" && s.inMono]}
    />
  );
  if (alt === "chamfer")
    return (
      <Cut size={6} style={[s.iChamfer, focus && s.iChamferOn]}>
        {field}
      </Cut>
    );
  if (alt === "bar") return <View style={[s.iBar, focus && s.iBarOn]}>{field}</View>;
  if (alt === "brackets")
    return (
      <View style={s.iBrackets}>
        <Brackets c={focus ? color.cyan2 : color.line2} len={6} />
        {field}
      </View>
    );
  if (alt === "tab")
    return (
      <Cut size={6} flip style={[s.iChamfer, focus && s.iChamferOn]}>
        {field}
      </Cut>
    );
  if (alt === "soft") return <View style={[s.iSoft, focus && s.iSoftOn]}>{field}</View>;
  return (
    <View style={[s.iHud, focus && s.iHudOn]}>
      <T v="mono" style={[s.prompt, focus && s.promptOn]}>
        {">"}
      </T>
      {field}
    </View>
  );
}

function Widths({ Card, alt }: { Card: ComponentType; alt: Alt }) {
  return (
    <View style={s.widths}>
      <Frame label="side panel · 340" side>
        <Card />
      </Frame>
      <Frame label="chat column · 680">
        <Card />
      </Frame>
      <View style={s.parts}>
        <T v="mono" style={s.caption}>
          button (hover / tab to focus) · input (click to focus)
        </T>
        <View style={s.partRow}>
          <ShapeButton alt={alt} />
          <View style={s.inputBox}>
            <ShapeInput alt={alt} />
          </View>
        </View>
      </View>
    </View>
  );
}

function Frame({ label, side, children }: { label: string; side?: boolean; children: ReactNode }) {
  return (
    <View style={[s.frame, side ? s.side : s.chat]}>
      <T v="mono" style={s.caption}>
        {label}
      </T>
      {children}
    </View>
  );
}

function variant(alt: Alt, Card: ComponentType, label: string, note: string): Variant {
  function C() {
    return <Widths Card={Card} alt={alt} />;
  }
  return { id: alt, label, note, C };
}

const variants: Variant[] = [
  variant(
    "chamfer",
    CardChamfer,
    "A · Chamfer outline, done right",
    "The production shape after the fix: one continuous 1px ring, diagonals stroked at full width.",
  ),
  variant(
    "bar",
    CardBar,
    "B · Tint + edge bar",
    "No border. Amber wash with a 3px kind-coloured left bar; square corners.",
  ),
  variant(
    "brackets",
    CardBrackets,
    "C · Bracket corners",
    "No edges, only L-marks at the corners: the selection language reused as a frame.",
  ),
  variant(
    "tab",
    CardTab,
    "D · Notch tab",
    "Plain hairline box; the chamfer moves to a filled tab carrying the header label.",
  ),
  variant(
    "soft",
    CardSoft,
    "E · Soft geometric",
    "6px radius, faint inner hairline, 2px amber accent line along the top.",
  ),
  variant(
    "hud",
    CardHud,
    "F · HUD frame",
    "Dashed edge, corner ticks, mono header strip; buttons read as [ LABEL ].",
  ),
];

export const shapeAlts: Entry[] = [
  {
    id: "shape-alts",
    decision:
      "Pick the shape language: A fixed chamfer outline (current), B tint + edge bar, C bracket corners, D notch tab, E soft geometric, F HUD frame.",
    name: "Shape alternatives",
    category: "Foundations",
    path: "lab/entries/shapeAlts.tsx (lab only)",
    purpose:
      "Six shape and border languages, each on the same permission card (command with an extra allow action), a small button and an input, at side panel and chat column widths.",
    polish: "hover / focus swap colours instantly; bracket corners snap in (motion.snap)",
    variants,
  },
];

const amberLine = `${color.amber}73`;
const amberWash = `${color.amber}0a`;

const s = StyleSheet.create({
  widths: { flexDirection: "row", flexWrap: "wrap", gap: 20, alignItems: "flex-start" },
  frame: { gap: 8, maxWidth: "100%" },
  side: { width: 340 },
  chat: { width: 680 },
  parts: { gap: 8, width: 340, maxWidth: "100%" },
  partRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  inputBox: { flex: 1 },
  caption: { fontSize: 11, color: color.faint },

  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  kind: { color: color.amber, fontWeight: "600", fontSize: 12.5 },
  meta: { marginLeft: "auto", flexShrink: 1 },
  title: { fontSize: 15, marginTop: 10 },
  cmd: { fontSize: 14, color: color.cyan2 },
  desc: { color: color.muted, marginTop: 8, lineHeight: 20, fontSize: 12.5 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },

  cChamfer: { borderWidth: 1, borderColor: amberLine, backgroundColor: amberWash, padding: 14 },
  cBar: {
    backgroundColor: `${color.amber}0f`,
    borderLeftWidth: 3,
    borderLeftColor: color.amber,
    padding: 14,
    paddingLeft: 13,
  },
  cBrackets: { backgroundColor: color.wash, padding: 16 },
  tabWrap: { alignItems: "flex-start" },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: color.amber,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tabT: { fontSize: 10.5, color: color.onAccent, fontWeight: "700", letterSpacing: 1 },
  cTab: {
    alignSelf: "stretch",
    borderWidth: 1,
    borderColor: amberLine,
    backgroundColor: amberWash,
    padding: 14,
    paddingTop: 4,
  },
  cSoft: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.raise,
    padding: 14,
    paddingTop: 16,
    overflow: "hidden",
  },
  softInner: {
    ...StyleSheet.absoluteFillObject,
    margin: 1,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: color.wash2,
  },
  softTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 2,
    backgroundColor: color.amber,
  },
  cHud: { borderWidth: 1, borderStyle: "dashed", borderColor: `${color.amber}40`, padding: 3 },
  hudStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: `${color.amber}14`,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  hudT: { fontSize: 11, color: color.amber, letterSpacing: 1.5 },
  hudMeta: { fontSize: 10.5, color: color.muted, marginLeft: "auto", letterSpacing: 1 },
  hudBody: { paddingHorizontal: 11, paddingBottom: 11 },

  b: { paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", justifyContent: "center" },
  bL: { fontSize: 12.5, color: color.muted },
  bLOn: { color: color.cyan2 },
  bChamfer: { borderWidth: 1, borderColor: color.line2, backgroundColor: color.wash },
  bChamferOn: { borderColor: color.cyan, backgroundColor: color.cyanWash },
  bBar: { backgroundColor: color.raise, borderLeftWidth: 2, borderLeftColor: color.line2 },
  bBarOn: { borderLeftColor: color.cyan, backgroundColor: color.wash3 },
  bRaise: { backgroundColor: color.raise },
  bTab: { backgroundColor: color.raise },
  bTabOn: { backgroundColor: color.cyanWash2 },
  bSoft: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.raise,
  },
  bSoftOn: { borderColor: color.cyan, backgroundColor: color.cyanWash },
  bHud: { borderWidth: 1, borderStyle: "dashed", borderColor: color.line2 },
  bHudOn: { borderColor: color.cyan },
  bHudL: { fontSize: 11.5, color: color.muted, letterSpacing: 1 },

  in: {
    flex: 1,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 7,
    ...web({ outlineStyle: "none" }),
  },
  inMono: { fontFamily: font.mono, fontSize: 12, paddingLeft: 4 },
  iChamfer: { borderWidth: 1, borderColor: color.line2, backgroundColor: color.bg },
  iChamferOn: { borderColor: color.cyan },
  iBar: { backgroundColor: color.bg, borderLeftWidth: 2, borderLeftColor: color.faint },
  iBarOn: { borderLeftColor: color.cyan, backgroundColor: color.wash },
  iBrackets: { backgroundColor: color.bg },
  iSoft: { borderRadius: 4, borderWidth: 1, borderColor: color.line2, backgroundColor: color.bg },
  iSoftOn: { borderColor: color.cyan, ...web({ boxShadow: `0 0 0 3px ${color.cyanWash}` }) },
  iHud: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: color.line2,
    paddingLeft: 8,
  },
  iHudOn: { borderBottomColor: color.cyan },
  prompt: { fontSize: 12, color: color.faint },
  promptOn: { color: color.cyan2 },
});
