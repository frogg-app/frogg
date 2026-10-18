import { HardDrive, KeyRound } from "lucide-react-native";
import { usePrefs } from "../../prefs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { ComposerNotices } from "../../components/chat/Notices";
import { useSessionOps } from "../../components/chat/sessionOps";
import {
  Compaction,
  DEFAULT_STATE_VARIANT,
  SessionState,
  type StateVariant,
} from "../../components/chat/SessionState";
import { PermissionCard } from "../../components/PermissionCard";
import { Finding } from "../../components/settings/pages/hostkit";
import {
  Banner as KitBanner,
  Confirm,
  ErrorLine,
  Status,
} from "../../components/settings/pages/kit";
import { Crashed } from "../../components/shell/ErrorBoundary";
import { T } from "../../components/Text";
import { HostToasts } from "../../components/toast/HostToasts";
import {
  clearToasts,
  DEFAULT_TOAST_VARIANT,
  setToastVariant,
  toast,
  useToasts,
  type ToastVariant,
} from "../../components/toast/store";
import { useDaemon } from "../../daemon/store";
import type { TimelineItem } from "../../daemon/types";
import { color } from "../../theme/tokens";
import { askPermission, emit, patchAgent } from "../client";
import { seedRows, simRows } from "../sim/agents";
import {
  ago,
  agent,
  ahead,
  ID,
  planPermission,
  questionPermission,
  shellPermission,
  toolPermission,
  type Permission,
} from "../fixtures";
import { Act, Case, Cases, Controls, Fill, Stack, W, type Entry } from "../kit";
import { useLab } from "../store";

// ---- toasts ----

const open = () => toast({ title: "Opened", detail: "toast action ran" });
const fire = {
  ok: () => toast({ title: "Copied branch name" }),
  done: () =>
    toast({
      title: "Bump lucide icons is ready",
      kind: "done",
      action: { label: "Open", onPress: open },
    }),
  error: () =>
    toast({
      title: "Could not stop",
      detail: "Error: agent s-working is not running on this host",
      kind: "error",
    }),
  needs: () =>
    toast({
      title: "Invoice PDF renderer needs you",
      kind: "needs",
      action: { label: "Open", onPress: open },
    }),
  info: () =>
    toast({ title: "Clean cut started", detail: "Summarising the conversation", kind: "info" }),
  sticky: () =>
    toast({
      title: "Update ready",
      detail: "Sticky: stays until dismissed",
      kind: "info",
      sticky: true,
      action: { label: "Restart", onPress: open },
    }),
  long: () =>
    toast({
      title:
        "A toast with a very long title that wraps onto a second line and then truncates after that",
      detail:
        "And a detail line that is also long enough to need truncation at two lines on the narrow phone width of the lab",
      kind: "error",
      source: "s-working",
    }),
};
const flood = () => {
  for (const k of ["ok", "done", "info", "needs", "error"] as const) fire[k]();
};
const finishBackground = () =>
  patchAgent(ID.working, { status: "idle", requiresAttention: true, attentionReason: "finished" });
const failBackground = () =>
  patchAgent(ID.idle, { status: "error", lastError: "Error: provider exited with code 1" });

const VARIANTS: { id: ToastVariant; label: string }[] = [
  { id: "bracket", label: "A · bracket" },
  { id: "hud", label: "B · hud" },
  { id: "facet", label: "C · facet" },
];

function VariantAct({ id, label, on }: { id: ToastVariant; label: string; on: boolean }) {
  const run = useCallback(() => setToastVariant(id), [id]);
  return <Act label={on ? `● ${label}` : label} run={run} />;
}

function ToastDemo() {
  const count = useToasts((st) => st.toasts.length);
  const stored = useToasts((st) => st.variant);
  const pref = usePrefs((st) => st.toastStyle);
  const variant = stored ?? pref;
  useEffect(() => () => setToastVariant(null), []);
  return (
    <Stack>
      <Controls>
        {VARIANTS.map((v) => (
          <VariantAct key={v.id} id={v.id} label={v.label} on={v.id === variant} />
        ))}
      </Controls>
      <Controls>
        <Act label="ok" run={fire.ok} />
        <Act label="done + action" run={fire.done} />
        <Act label="error" run={fire.error} />
        <Act label="needs" run={fire.needs} />
        <Act label="info" run={fire.info} />
        <Act label="sticky" run={fire.sticky} />
        <Act label="long text" run={fire.long} />
        <Act label="five at once (cap 4)" run={flood} />
        <Act label="Clear" run={clearToasts} />
      </Controls>
      <Controls>
        <Act label="Background session finishes" run={finishBackground} />
        <Act label="Background session fails" run={failBackground} />
      </Controls>
      <T v="mono">
        {count} on screen · variant {variant} (shell default {DEFAULT_TOAST_VARIANT}) · auto-dismiss
        per Settings → Notifications (default 5s), held while the pointer is over the stack ·
        renders bottom-right of the lab
      </T>
    </Stack>
  );
}

// ---- host toasts ----

const noop = () => {};

const goOffline = () => useDaemon.setState({ conn: "connecting" });
const goOnline = () => useDaemon.setState({ conn: "online" });
const storageWarn = () =>
  emit({
    type: "status",
    payload: { status: "storage_alert", alert: { level: "warning", totalBytes: 21.4e9 } },
  });
const storageCritical = () =>
  emit({
    type: "status",
    payload: { status: "storage_alert", alert: { level: "critical", totalBytes: 48.2e9 } },
  });
const storageOk = () =>
  emit({
    type: "status",
    payload: { status: "storage_alert", alert: { level: "ok", totalBytes: 1e9 } },
  });

function HostToastDemo() {
  return (
    <Stack>
      <Controls>
        <Act label="Drop connection" run={goOffline} />
        <Act label="Reconnect" run={goOnline} />
        <Act label="Storage warning" run={storageWarn} />
        <Act label="Storage critical" run={storageCritical} />
        <Act label="Storage ok" run={storageOk} />
      </Controls>
      <Case
        name="HostToasts"
        props="(reads the host store; renders nothing)"
        note="Drop connection: after 2s a sticky Connecting toast whose timer ticks; Reconnect retires it with a Reconnected toast. Storage critical stays until it clears; warning fades like any toast."
      >
        <HostToasts />
        <T v="mono">Toasts appear bottom-right of the lab.</T>
      </Case>
    </Stack>
  );
}

// ---- permission cards ----

/** A session's pending permissions, live from the store; answered cards disappear like in chat. */
function LivePermission({ id, p }: { id: string; p: Permission }) {
  const pending = useDaemon((st) => st.sessions[id]?.agent.pendingPermissions);
  const ask = useCallback(() => askPermission(id, p), [id, p]);
  const live = pending?.find((x) => x.id === p.id);
  if (live) return <PermissionCard agentId={id} p={live} />;
  return (
    <View style={s.answered}>
      <T style={s.answeredT}>Answered. The agent carries on (watch the toasts).</T>
      <Button label="Ask again" onPress={ask} />
    </View>
  );
}
const Shell = () => <LivePermission id={ID.needs} p={shellPermission} />;
const Tool = () => <LivePermission id={ID.preview} p={toolPermission} />;
const Plan = () => <LivePermission id={ID.plan} p={planPermission} />;
const Question = () => <LivePermission id={ID.question} p={questionPermission} />;
const setupPermissions = () => askPermission(ID.preview, toolPermission);

// ---- session state ----

const reviewAgent = agent({ id: "x-review", requiresAttention: true, attentionReason: "finished" });
const cleanAgent = agent({
  id: "x-clean",
  cwd: "/home/dev/clean",
  requiresAttention: true,
  attentionReason: "finished",
});
const waitingAgent = agent({
  id: "x-waiting",
  requiresAttention: true,
  attentionReason: "finished",
});
// Settled children only, so "Ready" and "Finished" aren't held by the sim's running subagent;
// x-waiting keeps it and shows the waiting card.
const setupStates = () => {
  simRows.set("x-review", seedRows("x-review").slice(1));
  simRows.set("x-clean", seedRows("x-clean").slice(1));
};
const failedAgent = agent({
  id: "x-failed",
  status: "error",
  lastError: "Error: 3 tests failed in webhooks.test.ts (timeout after 5000ms)",
});
const idleAgent = agent({ id: "x-idle" });
const CHAT = 680;
const Review = () => (
  <Cases>
    <Case name="SessionState" props="agent={requiresAttention: finished} online" w={CHAT}>
      <SessionState agent={reviewAgent} online />
    </Case>
    <Case name="SessionState" props="(same)" w={W.phone}>
      <SessionState agent={reviewAgent} online />
    </Case>
  </Cases>
);
const Clean = () => (
  <Cases>
    <Case name="SessionState" props="agent={finished, checkout unchanged} online" w={CHAT}>
      <SessionState agent={cleanAgent} online />
    </Case>
  </Cases>
);
const Waiting = () => (
  <Cases>
    <Case name="SessionState" props="agent={finished, a subagent still running} online" w={CHAT}>
      <SessionState agent={waitingAgent} online />
    </Case>
    <Case name="SessionState" props="(same)" w={W.phone}>
      <SessionState agent={waitingAgent} online />
    </Case>
  </Cases>
);
const Failed = () => (
  <Cases>
    <Case name="SessionState" props={'agent={status: "error", lastError} online'} w={CHAT}>
      <SessionState agent={failedAgent} online />
    </Case>
    <Case name="SessionState" props="(same)" note="Long error wraps." w={W.phone}>
      <SessionState agent={failedAgent} online />
    </Case>
  </Cases>
);
const Offline = () => (
  <Cases>
    <Case name="SessionState" props="agent={idle} online={false}" w={CHAT}>
      <SessionState agent={idleAgent} online={false} />
    </Case>
    <Case name="SessionState" props="(same)" w={W.phone}>
      <SessionState agent={idleAgent} online={false} />
    </Case>
  </Cases>
);

const StyleCases = ({ v }: { v: StateVariant }) => (
  <Cases>
    <Case name="SessionState" props={`variant="${v}" · review`} w={CHAT}>
      <SessionState agent={reviewAgent} online variant={v} />
    </Case>
    <Case name="SessionState" props={`variant="${v}" · failed`} w={CHAT}>
      <SessionState agent={failedAgent} online variant={v} />
    </Case>
    <Case name="SessionState" props={`variant="${v}" · offline`} w={CHAT}>
      <SessionState agent={idleAgent} online={false} variant={v} />
    </Case>
    <Case name="SessionState" props={`variant="${v}" · review`} w={W.phone}>
      <SessionState agent={reviewAgent} online variant={v} />
    </Case>
    <Case name="SessionState" props={`variant="${v}" · failed`} w={W.phone}>
      <SessionState agent={failedAgent} online variant={v} />
    </Case>
  </Cases>
);
const StyleEdge = () => <StyleCases v="edge" />;
const StyleBracket = () => <StyleCases v="bracket" />;
const StyleBanner = () => <StyleCases v="banner" />;

const cutLoading = { type: "compaction", status: "loading", trigger: "manual" } as Extract<
  TimelineItem,
  { type: "compaction" }
>;
const cutDone = {
  type: "compaction",
  status: "completed",
  trigger: "manual",
  cleanCut: {
    summary:
      "## Summary\n\n- Session cache cap is configurable\n- Eviction is least-recently-used\n- Remaining: document the key",
    previousSessionId: "8f1c2a7e-claude",
    summaryModel: "claude-haiku-4-5",
    previousContextTokens: 182000,
    reason: "cold-cache",
  },
} as Extract<TimelineItem, { type: "compaction" }>;
const cutSwitched = {
  type: "compaction",
  status: "completed",
  trigger: "manual",
  cleanCut: {
    summary: "## Summary\n\n- Session cache cap is configurable\n- Remaining: document the key",
    previousSessionId: "8f1c2a7e-claude",
    previousProvider: "claude",
    previousModel: "opus",
    provider: "codex",
    model: "gpt-5",
    summaryModel: "claude-haiku-4-5",
    summaryUsage: { inputTokens: 41000, outputTokens: 900, totalCostUsd: 0.04 },
    previousContextTokens: 182000,
    reason: "manual",
  },
} as Extract<TimelineItem, { type: "compaction" }>;
const cutReused = {
  type: "compaction",
  status: "completed",
  trigger: "manual",
  cleanCut: {
    summary: "## Summary\n\n- Session cache cap is configurable\n- Remaining: document the key",
    previousProvider: "codex",
    previousModel: "gpt-5",
    provider: "gemini",
    model: "gemini-2.5-pro",
    summaryModel: "claude-haiku-4-5",
    previousContextTokens: 182000,
    reusedSummary: true,
    reason: "manual",
  },
} as Extract<TimelineItem, { type: "compaction" }>;
const autoCompaction = {
  type: "compaction",
  status: "completed",
  trigger: "auto",
  preTokens: 160000,
} as Extract<TimelineItem, { type: "compaction" }>;
const CutLoading = () => (
  <Case name="Compaction" props={'item={status: "loading", trigger: "manual"}'} w={CHAT}>
    <Compaction item={cutLoading} />
  </Case>
);
const CutDone = () => (
  <Case
    name="Compaction"
    props={'item={status: "completed", cleanCut: {summary, …}}'}
    note="Click to expand the summary."
    w={CHAT}
  >
    <Compaction item={cutDone} />
  </Case>
);
const CutSwitched = () => (
  <Case
    name="Compaction"
    props={'cleanCut={previousProvider: "claude", provider: "codex", summaryUsage, …}'}
    w={CHAT}
  >
    <Compaction item={cutSwitched} />
  </Case>
);
const CutReused = () => (
  <Case
    name="Compaction"
    props={'cleanCut={provider: "gemini", reusedSummary: true, …}'}
    note="A cut straight after another: the summary carried over, no summariser ran."
    w={CHAT}
  >
    <Compaction item={cutReused} />
  </Case>
);
const CutAuto = () => (
  <Case name="Compaction" props={'item={trigger: "auto", preTokens: 160000}'} w={CHAT}>
    <Compaction item={autoCompaction} />
  </Case>
);

// ---- composer notices ----

const coldAgent = agent({
  id: "x-cold",
  lastUserMessageAt: ago(90),
  lastUsageAt: ago(90),
  lastUsage: { contextWindowUsedTokens: 142000 } as never,
});
const resumeAgent = agent({
  id: "x-resume",
  autoResume: { resumeAt: ahead(47), resetsAt: ahead(47), detectedAt: ago(2) },
});
const opAgent = agent({ id: "x-op" });
const setupNotices = () =>
  useSessionOps.setState({ "x-op": { label: "Moving the conversation to work" } });
const Moving = () => (
  <Cases>
    <Case name="ComposerNotices" props="runSessionOp in flight (move / clean cut)" w={CHAT}>
      <ComposerNotices agent={opAgent} />
    </Case>
  </Cases>
);
const Cold = () => (
  <Cases>
    <Case name="ComposerNotices" props="agent={lastUsageAt: 90m ago, 142k context}" w={CHAT}>
      <ComposerNotices agent={coldAgent} />
    </Case>
    <Case name="ComposerNotices" props="(same)" note="Wraps at the phone width." w={W.phone}>
      <ComposerNotices agent={coldAgent} />
    </Case>
  </Cases>
);
const Resume = () => (
  <Cases>
    <Case name="ComposerNotices" props="agent={autoResume: {resumeAt: +47m}}" w={CHAT}>
      <ComposerNotices agent={resumeAgent} />
    </Case>
    <Case name="ComposerNotices" props="(same)" w={W.phone}>
      <ComposerNotices agent={resumeAgent} />
    </Case>
  </Cases>
);

// ---- settings kit feedback ----

const loadingRpc = { data: null, error: null, loading: true, reload: noop };
const errorRpc = { data: null, error: "Request timed out after 10s", loading: false, reload: noop };
function KitFeedback() {
  const confirm = useCallback(() => toast({ title: "Removed" }), []);
  const pairBtn = useMemo(() => <Button kind="primary" label="Pair a device" onPress={noop} />, []);
  return (
    <Cases>
      <Case name="Banner (kit)" props="icon={KeyRound} title body children=[button]" w={560} plain>
        <KitBanner icon={KeyRound} title="Pair a device" body="Scan the code from the phone app.">
          {pairBtn}
        </KitBanner>
      </Case>
      <Case name="Banner (kit)" props="icon={HardDrive} tint={amber}" w={560} plain>
        <KitBanner
          icon={HardDrive}
          title="devbox runs 1.6.10"
          body="Update to see every setting."
          tint={color.amber}
        />
      </Case>
      <Case name="Finding" props={'tone="ok" | "warn" | "bad" last'} w={560}>
        <Finding tone="ok" title="Password set" body="Clients must authenticate." />
        <Finding tone="warn" title="Listening on 0.0.0.0" body="Reachable from the LAN." />
        <Finding tone="bad" title="TLS off for a relay host" last />
      </Case>
      <Case name="Status" props={'rpc={loading} what="devices"'} w={W.phone}>
        <Status rpc={loadingRpc} what="devices" />
      </Case>
      <Case name="Status" props={'rpc={error: "Request timed out…"}'} w={W.phone}>
        <Status rpc={errorRpc} what="devices" />
      </Case>
      <Case name="ErrorLine" props={'text="Error: listen EADDRINUSE…"'} w={W.phone}>
        <ErrorLine text="Error: listen EADDRINUSE 0.0.0.0:6767" />
      </Case>
      <Case
        name="Confirm"
        props={'label="Remove" confirm="Remove for good"'}
        note="Click once to arm, again to confirm."
        plain
      >
        <Confirm label="Remove" confirm="Remove for good" onConfirm={confirm} />
      </Case>
      <Case name="Confirm" props="pending" plain>
        <Confirm label="Working" confirm="x" onConfirm={confirm} pending />
      </Case>
    </Cases>
  );
}

const crashError = new TypeError("Cannot read properties of undefined (reading 'agent')");
const crashStack = `TypeError: Cannot read properties of undefined (reading 'agent')
    at Row (SessionList.tsx:290:12)
    at renderWithHooks (react-dom.development.js:15486:18)
    at SessionList (SessionList.tsx:152:3)`;
/** Remounts the crash view every 2.4s (scaled by lab speed) and on Replay, so the entry replays. */
function CrashedDemo() {
  const [n, setN] = useState(0);
  const rate = Number(useLab((st) => st.speed));
  const replay = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    const id = setInterval(replay, 2400 / rate);
    return () => clearInterval(id);
  }, [replay, rate, n]);
  return (
    <Fill>
      <Controls>
        <Act label="Replay entry" run={replay} />
      </Controls>
      <Fill key={n}>
        <Crashed error={crashError} stack={crashStack} onRetry={noop} />
      </Fill>
    </Fill>
  );
}

export const feedback: Entry[] = [
  {
    id: "toast",
    decision:
      "Pick the toast style: A bracket (current default), B HUD or C facet. Switchable on-device in Settings → Design options.",
    name: "Toasts",
    category: "Feedback",
    path: "components/toast/ToastHost.tsx · toast/store.ts",
    purpose:
      "Transient bottom-right stack (full width above the tabs on phones), max 4. Background session status changes become toasts with Open.",
    usedBy: 10,
    polish:
      "in: 200ms slide from right (up on phones) + fade on glide, corners/gem snap +60ms · out: 140ms accelerating slide + fade, stays mounted through exit · stack slots open/close over 180ms on glide · drain line runs the 4200ms lifetime, paused on hover · reduced motion and native: static, instant removal",
    variants: [{ id: "lifecycle", label: "Fire, stack, dismiss", C: ToastDemo }],
  },
  {
    id: "host-toasts",
    name: "Host toasts",
    category: "Feedback",
    path: "components/toast/HostToasts.tsx",
    purpose:
      "Host conditions as toasts (formerly full-width banners): daemon older than the app, reconnecting, storage alerts.",
    usedBy: 1,
    polish:
      "toast motion (see Toasts) · the reconnecting toast is sticky and its offline timer ticks every 1s in place · retired with a 140ms exit when the link returns",
    variants: [
      {
        id: "host",
        label: "Live host toasts",
        note: "Drives the real HostToasts from the fixture host.",
        C: HostToastDemo,
      },
    ],
  },
  {
    id: "permission-card",
    name: "PermissionCard",
    category: "Feedback",
    path: "components/PermissionCard.tsx · chat/QuestionCard.tsx",
    purpose:
      "Inline approval in the timeline: a command, a tool, a plan to review, or questions with options.",
    usedBy: 2,
    polish:
      "none; the card is swapped out when answered; buttons disable while the answer is in flight",
    setup: setupPermissions,
    variants: [
      {
        id: "shell",
        label: "Command with extra actions",
        note: "Approve, deny or reply; the fixture host answers.",
        C: Shell,
      },
      { id: "tool", label: "Tool without a command", C: Tool },
      { id: "plan", label: "Plan ready for review", C: Plan },
      { id: "question", label: "Questions (two steps)", C: Question },
    ],
  },
  {
    id: "session-state",
    name: "SessionState / Compaction",
    setup: setupStates,
    category: "Feedback",
    path: "components/chat/SessionState.tsx",
    purpose:
      "End-of-timeline state cards (review, failed, host offline) and the compaction / clean-cut marker.",
    usedBy: 1,
    polish:
      "Cards rise 8px + fade on mount (200ms, glide curve); the kind edge/trim/corners draw in 60ms later; failed flashes coral once, review glows mint once. Clean-cut marker is the apps/ui divider (amber cut line, scissors) with a beam running along the line while compacting; the summary unfolds (180ms) and folds (140ms). Native runs the same motion on the native driver (summary height on the JS driver); reduced motion: static. Replay to see entry.",
    decision: `Pick the state card style: A edge (wash + 3px edge bar + tag), B bracket (raised card, kind corners), C banner (full-width wash, top trim). Current default: ${DEFAULT_STATE_VARIANT}. Switchable on-device in Settings → Design options.`,
    variants: [
      { id: "style-edge", label: "Style A · edge bar (default)", C: StyleEdge },
      { id: "style-bracket", label: "Style B · bracket card", C: StyleBracket },
      { id: "style-banner", label: "Style C · banner + top trim", C: StyleBanner },
      { id: "review", label: "Ready to review", C: Review },
      { id: "clean", label: "Finished, no file changes", C: Clean },
      { id: "waiting", label: "Waiting on background work", C: Waiting },
      { id: "failed", label: "Failed", C: Failed },
      { id: "offline", label: "Host offline", C: Offline },
      { id: "cut-loading", label: "Clean cut running", C: CutLoading },
      { id: "cut-done", label: "Clean cut with summary", C: CutDone },
      { id: "cut-switched", label: "Clean cut onto another provider", C: CutSwitched },
      { id: "cut-reused", label: "Clean cut reusing the last summary", C: CutReused },
      { id: "cut-auto", label: "Automatic compaction", C: CutAuto },
    ],
  },
  {
    id: "notices",
    name: "ComposerNotices",
    setup: setupNotices,
    category: "Feedback",
    path: "components/chat/Notices.tsx",
    purpose:
      "Strips above the composer: a lapsed prompt cache (offer a clean cut) and a pending auto-resume countdown.",
    usedBy: 1,
    polish: "none; the countdown ticks every 1s",
    variants: [
      { id: "moving", label: "Move or clean cut running", C: Moving },
      { id: "cold", label: "Cold prompt cache", C: Cold },
      { id: "resume", label: "Auto-resume pending", C: Resume },
    ],
  },
  {
    id: "settings-feedback",
    name: "Settings kit feedback",
    category: "Feedback",
    path: "components/settings/pages/kit.tsx · hostkit.tsx",
    purpose:
      "Page call-out banner, security findings, loading / error status, error line, inline confirm.",
    usedBy: 21,
    polish: "none",
    variants: [{ id: "all", label: "All", C: KitFeedback }],
  },
  {
    id: "crashed",
    name: "Crashed",
    category: "Feedback",
    path: "components/shell/ErrorBoundary.tsx (Crashed)",
    purpose: "The root error boundary's screen: message, top stack frames, copy and retry.",
    usedBy: 1,
    polish:
      "Entry, web CSS keyframes on ease, settled by 420ms: eyebrow one-shot glitch (opacity flicker + x jitter, 180ms); title rise 8px (220ms, +40ms); coral glyph snaps scale 1.3 -> 0.96 -> 1 with a coral glow flash (260ms, +60ms); message rise (+120ms); stack trace slides up + scaleY (240ms, +170ms); buttons rise last (200ms, +220ms). Copy -> Copied crossfades (140ms fade on remount). Native renders the settled state; prefers-reduced-motion collapses it. Loops every 2.4s here; Replay entry restarts.",
    variants: [{ id: "default", label: "Render error", C: CrashedDemo, h: 520, bleed: true }],
  },
];

const s = StyleSheet.create({
  answered: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  answeredT: { color: color.muted, flex: 1 },
});
