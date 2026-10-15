import { useState, type ComponentType } from "react";
import { StyleSheet, View } from "react-native";
import { OnboardingCard } from "../../components/onboarding/Card";
import { STEPS, type StepId } from "../../components/onboarding/model";
import { useAway } from "../../components/onboarding/nav";
import { Onboarding, ResumeChip } from "../../components/onboarding/Onboarding";
import { OnboardingSettings } from "../../components/onboarding/OnboardingSettings";
import {
  INITIAL,
  goStep,
  minimiseOnboarding,
  onboardingReady,
  openOnboarding,
  setOnboardingPersist,
  useOnboarding,
} from "../../components/onboarding/store";
import { T } from "../../components/Text";
import { loadConfig } from "../../daemon/config";
import { useDaemon } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { sessions } from "../fixtures";
import { failNextInstall, setNoProviderReady } from "../sim/providers";
import { Act, Controls, Fill, Stack, W, type Entry, type Variant } from "../kit";

const noop = () => {};

/** A walkthrough already answered, so the tailored steps have something to tailor. */
function seed(): void {
  useOnboarding.setState({
    ...INITIAL,
    status: "hidden",
    level: "new",
    work: ["web", "infra"],
    seen: ["level", "work"],
  });
  useAway.setState({ step: null });
}
function setup(): void {
  setOnboardingPersist(false);
  seed();
  // The app's saved state may still be loading; the lab's seed wins.
  void onboardingReady.then(seed);
}

const fresh = () => useOnboarding.setState({ ...INITIAL, status: "hidden" });
const asNew = () => useOnboarding.setState({ level: "new", work: ["web"] });
const asExpert = () => useOnboarding.setState({ level: "expert", work: ["infra", "backend"] });
const offline = () => useDaemon.setState({ conn: "offline" });
const online = () => useDaemon.setState({ conn: "online" });
const noSessions = () => useDaemon.setState({ sessions: {} });
const someSessions = () => useDaemon.setState({ sessions: sessions() });
const noProvider = () => {
  setNoProviderReady(true);
  void loadConfig();
};
const someProvider = () => {
  setNoProviderReady(false);
  void loadConfig();
};
const failCopilot = () => failNextInstall("copilot");

/** Global host-state controls, shared by the flow and per-step variants. */
function HostControls() {
  return (
    <Controls>
      <Act label="No answers" run={fresh} />
      <Act label="New · web" run={asNew} />
      <Act label="Expert · infra" run={asExpert} />
      <Act label="Host offline" run={offline} />
      <Act label="Host online" run={online} />
      <Act label="No sessions" run={noSessions} />
      <Act label="Fixture sessions" run={someSessions} />
      <Act label="No provider ready" run={noProvider} />
      <Act label="Providers ready" run={someProvider} />
      <Act label="Next Copilot install fails" run={failCopilot} />
    </Controls>
  );
}

function FlowDemo() {
  const step = useOnboarding((st) => st.step);
  return (
    <Stack>
      <HostControls />
      <View style={s.desktop}>
        <OnboardingCard
          phone={false}
          step={step}
          onStep={goStep}
          onMinimise={noop}
          onSkip={noop}
          onFinish={noop}
        />
      </View>
    </Stack>
  );
}

function PhoneDemo() {
  const step = useOnboarding((st) => st.step);
  return (
    <View style={s.phone}>
      <OnboardingCard
        phone
        step={step}
        onStep={goStep}
        onMinimise={noop}
        onSkip={noop}
        onFinish={noop}
      />
    </View>
  );
}

/** One step on its own; the card's navigation moves only this specimen. */
function stepFrame(step: StepId): ComponentType {
  function StepFrame() {
    const [at, setAt] = useState<StepId>(step);
    return (
      <Fill>
        <OnboardingCard
          phone={false}
          step={at}
          onStep={setAt}
          onMinimise={noop}
          onSkip={noop}
          onFinish={noop}
        />
      </Fill>
    );
  }
  return StepFrame;
}

const stepVariants: Variant[] = STEPS.map((x, i) => ({
  id: `step-${x.id}`,
  label: `${i + 1}. ${x.label}`,
  C: stepFrame(x.id),
  h: 600,
  bleed: true,
}));

const chipAway = () => useAway.setState({ step: "host" });
const chipBack = () => useAway.setState({ step: null });
const chipMin = () => minimiseOnboarding();
function ChipDemo() {
  return (
    <Stack>
      <Controls>
        <Act label="Minimise" run={chipMin} primary />
        <Act label="Left for a done step" run={chipAway} />
        <Act label="Plain resume" run={chipBack} />
      </Controls>
      <T style={s.muted}>Resume reopens the modal (shown in the Modal variant).</T>
      <View style={s.chipFrame}>
        <ResumeChip bottom={16} />
      </View>
    </Stack>
  );
}
const SettingsDemo = () => <OnboardingSettings />;

const open = () => openOnboarding();
const openAt = () => openOnboarding("providers");
function ModalDemo() {
  return (
    <Fill>
      <Controls>
        <Act label="Open" run={open} primary />
        <Act label="Open at Providers" run={openAt} />
      </Controls>
      <T style={s.muted}>
        Esc, the scrim or the minimise button closes it to the resume chip below; Skip setup hides
        both.
      </T>
      <Onboarding phone={false} chipBottom={16} />
    </Fill>
  );
}

export const onboarding: Entry = {
  id: "onboarding",
  name: "Onboarding",
  category: "Navigation & shell",
  path: "components/onboarding/ (Onboarding.tsx, Card.tsx, Step*.tsx, model.ts, store.ts)",
  purpose:
    "First-run walkthrough: asks how technical the user is and what they work on, then tailors host pairing, providers, first session, concepts and settings. Skippable, resumable, reopened from Settings → Getting started or the palette.",
  usedBy: 4,
  polish:
    "card: overlayMotion rise in / popOut out, scrim fadeIn/fadeOut (160/110ms ease) · step body: motion.enter (opacity + translateY 6px, 200ms) on every step change, NativeEnter on Android · step indicator: 2px bar glides between steps (useGlide, 200ms glide curve) · active step chamfer 8→12 · level choice: Brackets slide + lock-on · progress fill: width, 420ms glide curve, count lerps with it (Num, same duration) · chip: motion.enter in, done check snaps (220ms)",
  setup,
  variants: [
    {
      id: "flow",
      label: "Desktop · full flow",
      note: "Answer, then Continue. The controls change the host underneath; steps tick themselves.",
      C: FlowDemo,
      h: 760,
      bleed: true,
    },
    ...stepVariants,
    {
      id: "phone",
      label: "Phone · 390",
      note: "Same step as the full flow; progress bar on top, buttons fill the footer.",
      C: PhoneDemo,
      h: 760,
    },
    {
      id: "modal",
      label: "Modal and resume chip",
      note: "As the shell mounts it.",
      C: ModalDemo,
      h: 320,
    },
    { id: "chip", label: "Resume chip", C: ChipDemo, h: 200 },
    { id: "settings", label: "Settings → Getting started", C: SettingsDemo },
  ],
};

const s = StyleSheet.create({
  desktop: { height: 640 },
  phone: {
    width: W.phone,
    height: 740,
    borderWidth: 1,
    borderColor: color.line,
  },
  chipFrame: { height: 80 },
  muted: { color: color.muted, marginBottom: 8 },
});
