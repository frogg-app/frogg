// Mounted once by the shell: opens the walkthrough on first run, presents it (a centred card on
// desktop and tablet, full screen on phones), and shows the resume chip while it's minimised.
import { Check, Sparkles, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { hostsReady, useHosts } from "../../daemon/hosts";
import { color, motion, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { Cut } from "../Cut";
import { Num } from "../CountUp";
import { useHostView } from "../hosts/state";
import { exitPointer, riseStyle, scrimStyle, usePresence } from "../presence";
import { useModalLayer } from "../shell/modalStack";
import { T } from "../Text";
import { OnboardingCard } from "./Card";
import { nextStep, progressOf, STEPS } from "./model";
import { useAway } from "./nav";
import { FILL_MS } from "./parts";
import { useDone } from "./progress";
import {
  finishOnboarding,
  goStep,
  hideOnboarding,
  minimiseOnboarding,
  openOnboarding,
  useOnboarding,
} from "./store";

/** Opens the walkthrough on a first run once nothing else (pairing, new session) is on screen. */
function useFirstRun(): void {
  const loaded = useOnboarding((st) => st.loaded);
  const status = useOnboarding((st) => st.status);
  const sheet = useHostView((st) => st.sheet);
  const busy = useUi((st) => st.newSessionOpen || st.paletteOpen);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!loaded || status !== "new") return;
    let live = true;
    void hostsReady.then(() => {
      if (!live) return undefined;
      // Someone already using the app gets the chip, not a walkthrough over their work.
      if (useHosts.getState().hosts.length) minimiseOnboarding();
      else setFresh(true);
      return undefined;
    });
    return () => {
      live = false;
    };
  }, [loaded, status]);
  useEffect(() => {
    if (fresh && status === "new" && !sheet && !busy) openOnboarding();
  }, [fresh, status, sheet, busy]);
}

/**
 * Back from pairing: once the hosts dialog closes, reopen on the host step, which shows whether
 * the host is now connected (pairing closes the dialog before the connection lands). Skipped if
 * the welcome questions were never answered: the walkthrough resumes where it was.
 */
function useAutoResume(): void {
  const status = useOnboarding((st) => st.status);
  const level = useOnboarding((st) => st.level);
  const awayStep = useAway((st) => st.step);
  const sheet = useHostView((st) => st.sheet);
  useEffect(() => {
    if (status !== "minimised" || awayStep !== "host" || sheet) return;
    useAway.setState({ step: null });
    openOnboarding(level ? "host" : undefined);
  }, [status, awayStep, sheet, level]);
  // A hosts dialog opened from elsewhere (the first-launch pairing prompt) takes precedence.
  useEffect(() => {
    if (status === "active" && sheet) {
      useAway.setState({ step: "host" });
      minimiseOnboarding();
    }
  }, [status, sheet]);
}

/**
 * `chipLeft` places the resume chip bottom-left, clear of the toast stack (desktop passes the
 * expanded rail's width: RN-web views each stack at z-index 0, so the rail can't cover it).
 * Without it the chip sits bottom-right.
 */
export function Onboarding({
  phone,
  chipBottom,
  chipLeft,
}: {
  phone: boolean;
  chipBottom: number;
  chipLeft?: number;
}) {
  useFirstRun();
  useAutoResume();
  const status = useOnboarding((st) => st.status);
  return (
    <>
      <OnboardingModal phone={phone} open={status === "active"} />
      {status === "minimised" && <ResumeChip bottom={chipBottom} left={chipLeft} />}
    </>
  );
}

function OnboardingModal({ phone, open }: { phone: boolean; open: boolean }) {
  const step = useOnboarding((st) => st.step);
  const { width, height } = useWindowDimensions();
  const { mounted, closing } = usePresence(open);
  const root = useRef<View>(null);
  useModalLayer(open, minimiseOnboarding, root);
  const box = useMemo(
    () => [
      s.box,
      { width: Math.min(980, width - 48), height: Math.min(680, height - 48) },
      riseStyle(closing),
    ],
    [width, height, closing],
  );
  const card = (
    <OnboardingCard
      phone={phone}
      step={step}
      onStep={goStep}
      onMinimise={minimiseOnboarding}
      onSkip={hideOnboarding}
      onFinish={finishOnboarding}
    />
  );
  return (
    <Modal
      transparent={!phone}
      visible={mounted}
      onRequestClose={minimiseOnboarding}
      animationType={Platform.OS === "web" ? "none" : "fade"}
    >
      {phone ? (
        <SafeAreaView style={s.phone}>
          <View style={s.fill} ref={root}>
            {card}
          </View>
        </SafeAreaView>
      ) : (
        <View style={s.wrap} pointerEvents={exitPointer(closing)}>
          <Pressable
            style={[s.scrim, scrimStyle(closing)]}
            onPress={minimiseOnboarding}
            accessibilityLabel="Close, resume later"
          />
          <View style={box} ref={root}>
            {card}
          </View>
        </View>
      )}
    </Modal>
  );
}

/** Bottom-right while minimised: progress, resume, dismiss. Turns mint when the step it left for is done. */
export function ResumeChip({ bottom, left }: { bottom: number; left?: number }) {
  const done = useDone();
  const level = useOnboarding((st) => st.level);
  const status = useOnboarding((st) => st.status);
  const started = useOnboarding((st) => st.seen.length > 0 || st.level !== null);
  const awayStep = useAway((st) => st.step);
  const { done: n, total } = progressOf(done);
  const finishedAway = awayStep !== null && done.has(awayStep);
  const resume = useCallback(() => {
    const at = useAway.getState().step;
    useAway.setState({ step: null });
    // Back from a step that's now done: carry on with the next one.
    if (at && done.has(at)) openOnboarding(nextStep(at, done, level));
    else openOnboarding();
  }, [done, level]);
  const place = useMemo(
    () => [s.chipPlace, left === undefined ? s.chipRight : { left }, { bottom }],
    [bottom, left],
  );
  const format = useCallback((v: number) => `${Math.round(v)}/${total}`, [total]);
  if (status !== "minimised") return null;
  const label = STEPS.find((x) => x.id === awayStep)?.label;
  let title = started ? "Resume getting started" : "New here? Take the tour";
  if (finishedAway && label) title = `${label} done · continue`;
  return (
    <View style={place} pointerEvents="box-none">
      <Cut size={10} style={[s.chip, s.chipEnter, finishedAway && s.chipOk]}>
        <Pressable onPress={resume} style={s.chipMain} accessibilityRole="button">
          {({ hovered }) => (
            <>
              {finishedAway ? (
                <View style={[s.chipDone, s.snap]}>
                  <Check size={11} strokeWidth={3} color={color.onAccent} />
                </View>
              ) : (
                <Sparkles size={15} color={color.cyan2} strokeWidth={1.6} />
              )}
              <T style={[s.chipT, hovered && s.chipTH]}>{title}</T>
              {started && <Num value={n} format={format} duration={FILL_MS} style={s.chipN} />}
            </>
          )}
        </Pressable>
        <Pressable
          onPress={hideOnboarding}
          accessibilityRole="button"
          accessibilityLabel="Dismiss getting started"
          hitSlop={8}
          style={s.chipX}
        >
          {({ hovered }) => <X size={13} color={hovered ? color.text : color.faint} />}
        </Pressable>
      </Cut>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: color.scrim },
  box: {
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 32,
    ...web({ boxShadow: "0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(127,217,230,0.06)" }),
  },
  phone: { flex: 1, backgroundColor: color.bg2 },
  fill: { flex: 1 },
  chipPlace: { position: "absolute", zIndex: 50, elevation: 14 },
  chipRight: { right: 16 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.raise,
    borderWidth: 1,
    borderColor: color.line2,
    ...web({ boxShadow: "0 10px 28px rgba(0,0,0,0.45)" }),
  },
  chipEnter: motion.enter,
  chipOk: { borderColor: "rgba(63,207,142,0.45)" },
  snap: motion.snap,
  chipMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 9,
    ...web({ outlineStyle: "none" }),
  },
  chipT: { fontSize: 12.5, fontWeight: "500", ...web({ transition: "color 120ms ease-out" }) },
  chipTH: { color: color.cyan2 },
  chipN: { fontSize: 11, color: color.muted },
  chipDone: {
    width: 15,
    height: 15,
    backgroundColor: color.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  chipX: { paddingHorizontal: 10, paddingVertical: 9, ...web({ outlineStyle: "none" }) },
});
