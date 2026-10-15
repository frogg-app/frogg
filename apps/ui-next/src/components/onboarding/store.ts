import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { STEP_IDS, type Level, type StepId, type Work } from "./model";

/**
 * Where this device is in onboarding, and the answers that tailor it. Device-local, like
 * prefs: a second device asks again, because what's set up differs per device.
 *
 * status: `new` never started · `active` the walkthrough is open · `minimised` closed to do a
 * step in the app, a resume chip shows · `hidden` skipped or dismissed · `finished`.
 */
export type Status = "new" | "active" | "minimised" | "hidden" | "finished";

export interface OnboardingState {
  status: Status;
  step: StepId;
  level: Level | null;
  work: Work[];
  /** Steps the user finished by hand (answered, read, or ticked off). Live checks add the rest. */
  seen: StepId[];
  /** True once the saved state has been read; first-run decisions wait for it. */
  loaded: boolean;
}

const KEY = "frogg.next.onboarding";

export const INITIAL: Omit<OnboardingState, "loaded"> = {
  status: "new",
  step: "level",
  level: null,
  work: [],
  seen: [],
};

export const useOnboarding = create<OnboardingState>(() => ({ ...INITIAL, loaded: false }));

/** The component lab drives this store on fixtures and must not overwrite the app's saved state. */
let persist = true;
export function setOnboardingPersist(on: boolean): void {
  persist = on;
}

type Saved = Partial<Omit<OnboardingState, "loaded">>;

/** Keeps only known values, so a state saved by another build can't wedge the flow. */
export function sanitize(saved: Saved): Omit<OnboardingState, "loaded"> {
  const statuses: Status[] = ["new", "active", "minimised", "hidden", "finished"];
  return {
    status: saved.status && statuses.includes(saved.status) ? saved.status : "new",
    step: saved.step && STEP_IDS.includes(saved.step) ? saved.step : "level",
    level: saved.level ?? null,
    work: Array.isArray(saved.work) ? saved.work : [],
    seen: Array.isArray(saved.seen) ? saved.seen.filter((x) => STEP_IDS.includes(x)) : [],
  };
}

export const onboardingReady: Promise<void> = AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) useOnboarding.setState(sanitize(JSON.parse(raw) as Saved));
    return undefined;
  })
  .catch(() => {})
  .finally(() => {
    useOnboarding.setState({ loaded: true });
    useOnboarding.subscribe(({ loaded: _, ...rest }) => {
      if (persist) void AsyncStorage.setItem(KEY, JSON.stringify(rest));
    });
  });

const set = (patch: Partial<OnboardingState>) => useOnboarding.setState(patch);

/** Opens the walkthrough, at `step` or wherever it was left. */
export function openOnboarding(step?: StepId): void {
  const st = useOnboarding.getState();
  // A finished walkthrough reopens at the start rather than on the closing page.
  const at = step ?? (st.status === "finished" ? "level" : st.step);
  set({ status: "active", step: at });
}

/** Closes the walkthrough so the user can do the current step in the app; a chip resumes it. */
export const minimiseOnboarding = () => set({ status: "minimised" });
/** Skip or dismiss: nothing shows until reopened from Settings or the palette. */
export const hideOnboarding = () => set({ status: "hidden" });
export const finishOnboarding = () => {
  markSeen("done");
  set({ status: "finished", step: "done" });
};

export function restartOnboarding(): void {
  set({ status: "active", step: "level", seen: [] });
}

export const goStep = (step: StepId) => set({ step });

export function markSeen(step: StepId): void {
  const { seen } = useOnboarding.getState();
  if (!seen.includes(step)) set({ seen: [...seen, step] });
}

export function unmarkSeen(step: StepId): void {
  const { seen } = useOnboarding.getState();
  if (seen.includes(step)) set({ seen: seen.filter((x) => x !== step) });
}

export function setLevel(level: Level): void {
  set({ level });
  markSeen("level");
}

export function toggleWork(w: Work): void {
  const { work } = useOnboarding.getState();
  const next = work.includes(w) ? work.filter((x) => x !== w) : [...work, w];
  set({ work: next });
  if (next.length) markSeen("work");
  else unmarkSeen("work");
}

/** Forgets the answers and progress (Settings → Getting started → Reset). */
export const resetOnboarding = () => set({ ...INITIAL, status: "hidden" });
