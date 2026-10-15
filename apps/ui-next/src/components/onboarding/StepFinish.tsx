// Settings worth a look for this profile, and the closing summary.
import { ChevronRight } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { color, web } from "../../theme/tokens";
import { T } from "../Text";
import { LEVELS, STEPS, WORKS, settingsFor, type SettingTip, type StepId } from "./model";
import { away, openSettingsPage } from "./nav";
import { Para, StepGlyph, StepHead } from "./parts";
import { useDone } from "./progress";
import { goStep, useOnboarding } from "./store";

export function SettingsStep() {
  const level = useOnboarding((st) => st.level);
  const work = useOnboarding((st) => st.work);
  const tips = useMemo(() => settingsFor(level, work), [level, work]);
  return (
    <>
      <StepHead
        title="Settings for you"
        lede="Based on your answers, these are the pages worth a look. Everything else can wait."
      />
      <View style={s.list}>
        {tips.map((t, i) => (
          <TipRow key={t.page} tip={t} last={i === tips.length - 1} />
        ))}
      </View>
      <Para faint>
        Reopen this walkthrough any time from Settings → Getting started, or ⌘K → Getting started.
      </Para>
    </>
  );
}

function TipRow({ tip, last }: { tip: SettingTip; last: boolean }) {
  const open = useCallback(() => away("settings", () => openSettingsPage(tip.page)), [tip.page]);
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`Open ${tip.label}`}
      style={s.press}
    >
      {({ hovered }) => (
        <View style={[s.row, !last && s.rowLine, hovered && s.rowHover]}>
          <View style={s.grow}>
            <T style={s.rowT}>{tip.label}</T>
            <T style={s.rowSub}>{tip.why}</T>
          </View>
          <ChevronRight size={15} color={hovered ? color.cyan2 : color.faint} />
        </View>
      )}
    </Pressable>
  );
}

export function DoneStep() {
  const done = useDone();
  const level = useOnboarding((st) => st.level);
  const work = useOnboarding((st) => st.work);
  const open = STEPS.filter((x) => x.id !== "done" && !done.has(x.id));
  const levelName = LEVELS.find((l) => l.id === level)?.title;
  const workNames = WORKS.filter((w) => work.includes(w.id)).map((w) => w.title);
  return (
    <>
      <StepHead
        title={open.length ? "Almost there" : "You're set up"}
        lede={
          open.length
            ? "You can start now and finish these later; the walkthrough remembers where you were."
            : "Everything's in place. Agents that need you show up in the session list and the inbox."
        }
      />
      {open.length > 0 && (
        <View style={s.list}>
          {open.map((x, i) => (
            <OpenRow key={x.id} id={x.id} n={STEPS.indexOf(x) + 1} last={i === open.length - 1} />
          ))}
        </View>
      )}
      {(levelName || workNames.length > 0) && (
        <Para faint>
          Tailored for: {[levelName, ...workNames].filter(Boolean).join(" · ")}. Change it in
          Settings → Getting started.
        </Para>
      )}
    </>
  );
}

function OpenRow({ id, n, last }: { id: StepId; n: number; last: boolean }) {
  const go = useCallback(() => goStep(id), [id]);
  const label = STEPS.find((x) => x.id === id)?.label ?? id;
  return (
    <Pressable onPress={go} accessibilityRole="button" style={s.press}>
      {({ hovered }) => (
        <View style={[s.row, !last && s.rowLine, hovered && s.rowHover]}>
          <StepGlyph n={n} done={false} on={false} />
          <T style={[s.grow, s.rowT]}>{label}</T>
          <ChevronRight size={15} color={hovered ? color.cyan2 : color.faint} />
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  list: { backgroundColor: color.panel, marginBottom: 14 },
  press: { ...web({ outlineStyle: "none" }) },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    ...web({ transition: "background-color 120ms ease-out" }),
  },
  rowLine: { borderBottomWidth: 1, borderBottomColor: color.line },
  rowHover: { backgroundColor: color.raise },
  grow: { flex: 1 },
  rowT: { fontWeight: "500" },
  rowSub: { color: color.faint, fontSize: 12, marginTop: 2 },
});
