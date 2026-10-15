// The walkthrough itself: step list, the current step and its footer. Desktop/tablet show the
// list beside the step; phones stack a progress bar over a full-height step.
import { ArrowLeft, Minimize2, X } from "lucide-react-native";
import { useCallback, useMemo, type ComponentType } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { color, motion, web } from "../../theme/tokens";
import { Button } from "../Button";
import { Cut } from "../Cut";
import { useGlide } from "../Glide";
import { NativeEnter } from "../nativeMotion";
import { T } from "../Text";
import { STEPS, nextStep, prevStep, progressOf, type StepId } from "./model";
import { Progress, StepGlyph } from "./parts";
import { useDone } from "./progress";
import { ConceptsStep, SessionStep } from "./StepWork";
import { DoneStep, SettingsStep } from "./StepFinish";
import { HostStep } from "./StepHost";
import { LevelStep, WorkStep } from "./StepProfile";
import { ProvidersStep } from "./StepProviders";
import { markSeen, useOnboarding } from "./store";

export const BODIES: Record<StepId, ComponentType> = {
  level: LevelStep,
  work: WorkStep,
  host: HostStep,
  providers: ProvidersStep,
  session: SessionStep,
  concepts: ConceptsStep,
  settings: SettingsStep,
  done: DoneStep,
};

const ENTER = { opacity: 0, y: 6 };

export interface CardProps {
  phone: boolean;
  step: StepId;
  onStep: (step: StepId) => void;
  /** Close for now; the resume chip brings it back. */
  onMinimise: () => void;
  /** Skip the walkthrough entirely. */
  onSkip: () => void;
  onFinish: () => void;
}

export function OnboardingCard({ phone, step, onStep, onMinimise, onSkip, onFinish }: CardProps) {
  const done = useDone();
  const level = useOnboarding((st) => st.level);
  const work = useOnboarding((st) => st.work);
  const { done: n, total } = progressOf(done);
  const meta = STEPS.find((x) => x.id === step) ?? STEPS[0];
  const index = STEPS.indexOf(meta);
  const Body = BODIES[step];

  const next = useCallback(() => {
    // Reading and answering steps count once the user moves past them.
    if (!meta.setup && step !== "done") markSeen(step);
    if (step === "done") onFinish();
    else onStep(nextStep(step, done, level));
  }, [meta.setup, step, done, level, onFinish, onStep]);
  const back = useCallback(() => onStep(prevStep(step)), [step, onStep]);

  const isDone = done.has(step);
  let primary = "Continue";
  if (step === "done") primary = "Start using Frogg";
  else if (step === "work" && !work.length) primary = "Skip question";
  const waiting = meta.setup && !isDone;

  const footer = (
    <View style={[s.foot, phone && s.footPhone]}>
      {!phone && (
        <Pressable onPress={onSkip} accessibilityRole="button" style={s.skip}>
          {({ hovered }) => <T style={[s.skipT, hovered && s.skipTH]}>Skip setup</T>}
        </Pressable>
      )}
      <View style={s.grow} />
      {index > 0 && <Button label="Back" icon={phone ? ArrowLeft : undefined} onPress={back} />}
      {waiting ? (
        <Button label="Skip for now" onPress={next} grow={phone} />
      ) : (
        <Button
          label={primary}
          kind="primary"
          onPress={next}
          disabled={step === "level" && !level}
          grow={phone}
        />
      )}
    </View>
  );

  const body = (
    <ScrollView
      style={s.grow}
      contentContainerStyle={phone ? s.bodyPhone : s.body}
      keyboardShouldPersistTaps="handled"
    >
      {/* Keyed by step so every step change replays the enter. */}
      <NativeEnter key={step} from={ENTER} ms={200} style={s.enter}>
        <T v="label" style={s.eyebrow}>
          Step {index + 1} of {STEPS.length}
        </T>
        <Body />
      </NativeEnter>
    </ScrollView>
  );

  if (phone)
    return (
      <View style={s.phone}>
        <View style={s.phoneHead}>
          <T v="label" style={s.grow}>
            Getting started
          </T>
          <Pressable onPress={onSkip} accessibilityRole="button" hitSlop={8}>
            <T style={s.skipT}>Skip</T>
          </Pressable>
          <Pressable onPress={onMinimise} accessibilityLabel="Close, resume later" hitSlop={10}>
            <X size={17} color={color.muted} />
          </Pressable>
        </View>
        <View style={s.phoneProgress}>
          <Progress done={n} total={total} />
        </View>
        {body}
        {footer}
      </View>
    );

  return (
    <Cut size={16} style={s.card}>
      <View style={s.head}>
        <T v="label">Getting started</T>
        <View style={s.headProgress}>
          <Progress done={n} total={total} />
        </View>
        <Pressable
          onPress={onMinimise}
          accessibilityRole="button"
          accessibilityLabel="Close, resume later"
          hitSlop={10}
          style={s.close}
        >
          {({ hovered }) => <Minimize2 size={15} color={hovered ? color.text : color.muted} />}
        </Pressable>
      </View>
      <View style={s.row}>
        <StepList step={step} done={done} onStep={onStep} />
        <View style={s.main}>
          {body}
          {footer}
        </View>
      </View>
    </Cut>
  );
}

/** The steps down the side, with one indicator that glides to the current step like the rail's. */
function StepList({
  step,
  done,
  onStep,
}: {
  step: StepId;
  done: Set<StepId>;
  onStep: (s: StepId) => void;
}) {
  const g = useGlide(step);
  const bar = useMemo(() => [s.glide, { top: g.top, height: g.height }], [g.top, g.height]);
  return (
    <View style={s.list}>
      {g.ready && <Animated.View style={bar} />}
      {STEPS.map((x, i) => (
        <StepItem
          key={x.id}
          id={x.id}
          n={i + 1}
          label={x.label}
          on={x.id === step}
          done={done.has(x.id)}
          onStep={onStep}
          onMeasure={g.measure}
        />
      ))}
    </View>
  );
}

function StepItem({
  id,
  n,
  label,
  on,
  done,
  onStep,
  onMeasure,
}: {
  id: StepId;
  n: number;
  label: string;
  on: boolean;
  done: boolean;
  onStep: (s: StepId) => void;
  onMeasure: (id: StepId, e: LayoutChangeEvent) => void;
}) {
  const press = useCallback(() => onStep(id), [id, onStep]);
  const layout = useCallback((e: LayoutChangeEvent) => onMeasure(id, e), [id, onMeasure]);
  const state = useMemo(() => ({ selected: on }), [on]);
  return (
    <Pressable
      onPress={press}
      onLayout={layout}
      accessibilityRole="button"
      accessibilityState={state}
      accessibilityLabel={`${label}${done ? ", done" : ""}`}
      style={s.itemPress}
    >
      {({ hovered }) => (
        <Cut size={on ? 12 : 8} style={[s.item, hovered && s.itemHover, on && s.itemOn]}>
          <StepGlyph n={n} done={done} on={on} />
          <T style={[s.itemT, on && s.itemTOn, done && !on && s.itemTDone]} numberOfLines={1}>
            {label}
          </T>
        </Cut>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  card: {
    flex: 1,
    backgroundColor: color.bg2,
    borderWidth: 1,
    borderColor: color.line2,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  headProgress: { flex: 1, maxWidth: 360, marginLeft: "auto" },
  close: { padding: 4, ...web({ outlineStyle: "none" }) },
  row: { flex: 1, flexDirection: "row" },
  list: {
    width: 220,
    paddingVertical: 14,
    paddingHorizontal: 10,
    gap: 4,
    borderRightWidth: 1,
    borderRightColor: color.line,
    backgroundColor: color.bg,
  },
  glide: {
    position: "absolute",
    left: 0,
    width: 2,
    backgroundColor: color.cyan2,
    ...web({ backgroundImage: "linear-gradient(#7fd9e6, #25b5c8)" }),
  },
  itemPress: { ...web({ outlineStyle: "none" }) },
  item: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    backgroundColor: color.wash,
    ...web({ transition: "background-color 160ms ease-out" }),
  },
  itemHover: { backgroundColor: color.wash3 },
  itemOn: {
    backgroundColor: "rgba(37,181,200,0.16)",
    ...web({ backgroundImage: "linear-gradient(135deg, #7fd9e62e, #25b5c81a)" }),
  },
  itemT: { flex: 1, fontSize: 13, color: color.muted },
  itemTOn: { color: color.cyan2 },
  itemTDone: { color: color.text },
  main: { flex: 1 },
  body: { padding: 28, paddingBottom: 20, maxWidth: 760 },
  bodyPhone: { padding: 18, paddingBottom: 24 },
  eyebrow: { marginBottom: 10 },
  enter: motion.enter,
  foot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  footPhone: { paddingHorizontal: 16 },
  skip: { paddingVertical: 6, ...web({ outlineStyle: "none" }) },
  skipT: { color: color.faint, fontSize: 12.5, ...web({ transition: "color 120ms ease-out" }) },
  skipTH: { color: color.text },
  phone: { flex: 1, backgroundColor: color.bg2 },
  phoneHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  phoneProgress: { paddingHorizontal: 16, paddingBottom: 6 },
});
