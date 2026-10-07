import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

/**
 * Device-local preferences: settings the daemon does not hold (composer
 * behaviour, transcript display, notification routing, Companion voice, meter
 * thresholds). Persisted to AsyncStorage as one JSON object.
 */

export type ChannelKey = "inbox" | "desktop" | "push" | "spoken" | "sound";
export type NotifyKind =
  | "needsYou"
  | "failed"
  | "finished"
  | "host"
  | "updates"
  | "plugins"
  | "pairing";

const ch = (inbox: boolean, desktop: boolean, push: boolean, spoken: boolean, sound: boolean) => ({
  inbox,
  desktop,
  push,
  spoken,
  sound,
});

/** Prototype design picks (Settings → Design options); every one is switchable at runtime. */
export type ButtonStyle = "gradient" | "solid" | "mint" | "outline" | "bar" | "bracket" | "tint";
export type LogoMotionPref = "none" | "ripple" | "split" | "sweep" | "turn";
export type ShapeLang = "chamfer" | "bar" | "brackets" | "tab" | "soft" | "hud";
export type ToastStylePref = "bracket" | "hud" | "facet";
export type StateStylePref = "edge" | "bracket" | "banner";
export type SubworkStylePref = "chip" | "dots" | "tree";
export type TextRevealPref =
  | "none"
  | "fade"
  | "blur"
  | "caret"
  | "scramble"
  | "wipe"
  | "slide"
  | "type"
  | "glow";
export type HeadingRevealPref = "none" | "stagger" | "scramble" | "wipe" | "blur";

export const PREF_DEFAULTS = {
  // Design options (prototype picks)
  buttonStyle: "gradient" as ButtonStyle,
  logoMotion: "ripple" as LogoMotionPref,
  shapeLang: "chamfer" as ShapeLang,
  toastStyle: "bracket" as ToastStylePref,
  stateStyle: "edge" as StateStylePref,
  subworkStyle: "chip" as SubworkStylePref,
  textReveal: "fade" as TextRevealPref,
  headingReveal: "stagger" as HeadingRevealPref,
  // Chat & composer
  busyEnter: "steer" as "steer" | "queue" | "interrupt",
  toolCalls: "full" as "full" | "summary",
  expandReasoning: false,
  chatOutline: true,
  subagents: "tab" as "tab" | "pane",
  serviceUrls: "ask" as "ask" | "frogg" | "external",
  prLinks: "tool" as "tool" | "pane" | "browser",
  downloads: "ask" as "ask" | "folder",
  hiddenFolders: false,
  // Files, editor & terminal
  vim: false,
  openFiles: "main" as "main" | "pane",
  openDiffs: "main" as "main" | "pane",
  externalEditor: "vscode",
  scrollback: 10000,
  copyOnSelect: false,
  legacyRenderer: false,
  // Notifications
  keepDays: "30",
  railBadge: "attention" as "attention" | "unread" | "none",
  deliver: {
    needsYou: ch(true, true, true, false, true),
    failed: ch(true, true, true, false, false),
    finished: ch(true, true, false, false, false),
    host: ch(true, true, false, false, false),
    updates: ch(true, false, false, false, false),
    plugins: ch(true, false, false, false, false),
    pairing: ch(true, true, true, false, true),
  } as Record<NotifyKind, Record<ChannelKey, boolean>>,
  playSound: true,
  quietFrom: "22:00",
  quietTo: "07:30",
  // Voice & Companion
  companion: true,
  replyLength: "brief" as "brief" | "detailed",
  spokenUpdates: "both" as "both" | "completions" | "off",
  acknowledge: false,
  audioMode: "call" as "call" | "media",
  voiceSpeed: 1.3,
  pause: "natural" as "quick" | "natural" | "relaxed",
  bargeIn: "instant" as "instant" | "short" | "deliberate",
  animateVoice: true,
  showReplyText: true,
  codexVoice: false,
  autoplayAlerts: false,
  confirmReplies: true,
  // Permission modes
  defaultMode: "edits" as "plan" | "ask" | "edits" | "auto" | "unattended",
  allowUnattended: true,
  unattendedWorktreesOnly: true,
  shiftTab: "safe" as "safe" | "all",
  // Usage meters
  meterTimer: true,
  meterSeconds: 30,
  meterHover: true,
  meterAfterReply: true,
  warnPct: 65,
  criticalPct: 90,
  meterAnimate: true,
  resumeCountdown: "reset" as "reset" | "1m" | "5m" | "off",
  suggestSwitch: true,
  // Context
  staleCacheWarning: true,
  // Shell
  railPinned: false,
};

export type Prefs = typeof PREF_DEFAULTS;

const KEY = "frogg.next.prefs";

export const usePrefs = create<Prefs>(() => PREF_DEFAULTS);

export const prefsReady: Promise<void> = AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as Partial<Prefs>;
    usePrefs.setState({
      ...saved,
      deliver: { ...PREF_DEFAULTS.deliver, ...saved.deliver },
    });
    return undefined;
  })
  .catch(() => {})
  .finally(() => {
    usePrefs.subscribe((s) => void AsyncStorage.setItem(KEY, JSON.stringify(s)));
  });

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  usePrefs.setState({ [key]: value } as Pick<Prefs, K>);
}

/** A stable setter per key, for handing straight to a control's `onChange`. */
const setters = new Map<keyof Prefs, (v: never) => void>();
export function prefSetter<K extends keyof Prefs>(key: K): (v: Prefs[K]) => void {
  let fn = setters.get(key);
  if (!fn) {
    fn = (v: never) => setPref(key, v);
    setters.set(key, fn);
  }
  return fn as (v: Prefs[K]) => void;
}

export function setDelivery(kind: NotifyKind, channel: ChannelKey, on: boolean): void {
  const deliver = usePrefs.getState().deliver;
  usePrefs.setState({
    deliver: { ...deliver, [kind]: { ...deliver[kind], [channel]: on } },
  });
}
