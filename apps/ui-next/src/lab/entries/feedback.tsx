import { HardDrive, KeyRound } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { ComposerNotices } from "../../components/chat/Notices";
import { Compaction, SessionState } from "../../components/chat/SessionState";
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
import { Banner, Banners } from "../../components/toast/Banners";
import { toast, useToasts } from "../../components/toast/store";
import { useDaemon } from "../../daemon/store";
import type { TimelineItem } from "../../daemon/types";
import { color } from "../../theme/tokens";
import { askPermission, emit, patchAgent } from "../client";
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
import { Act, Controls, Fill, Stack, type Entry } from "../kit";

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
    }),
};
const flood = () => {
  for (const k of ["ok", "done", "info", "needs", "error"] as const) fire[k]();
};
const clearToasts = () => useToasts.setState({ toasts: [] });
const finishBackground = () =>
  patchAgent(ID.working, { status: "idle", requiresAttention: true, attentionReason: "finished" });
const failBackground = () =>
  patchAgent(ID.idle, { status: "error", lastError: "Error: provider exited with code 1" });

function ToastDemo() {
  const count = useToasts((st) => st.toasts.length);
  return (
    <Stack>
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
        {count} on screen · auto-dismiss after 4200ms unless sticky · toasts render bottom-right of
        the lab
      </T>
    </Stack>
  );
}

// ---- banners ----

const noop = () => {};
function BannerTones() {
  return (
    <View>
      <Banner
        tone="warn"
        title="devbox runs daemon 1.6.10"
        detail="older than this app (1.6.13); some features are hidden"
        action="Update host…"
        onPress={noop}
        onDismiss={noop}
      />
      <Banner
        tone="run"
        title="Connecting to devbox"
        detail="offline for 0:42 · reconnect before sending messages"
        action="Retry now"
        onPress={noop}
        onDismiss={noop}
      />
      <Banner
        tone="error"
        title="Frogg storage on devbox is 48.2 GB"
        detail="clean up worktrees, logs and caches to free space"
        action="Review storage…"
        onPress={noop}
        onDismiss={noop}
      />
      <Banner tone="warn" title="No action, not dismissible" />
    </View>
  );
}

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

function BannerHost() {
  return (
    <Stack>
      <Controls>
        <Act label="Drop connection" run={goOffline} />
        <Act label="Reconnect" run={goOnline} />
        <Act label="Storage warning" run={storageWarn} />
        <Act label="Storage critical" run={storageCritical} />
        <Act label="Storage ok" run={storageOk} />
      </Controls>
      <View style={s.bannerFrame}>
        <Banners />
      </View>
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
const failedAgent = agent({
  id: "x-failed",
  status: "error",
  lastError: "Error: 3 tests failed in webhooks.test.ts (timeout after 5000ms)",
});
const idleAgent = agent({ id: "x-idle" });
const Review = () => <SessionState agent={reviewAgent} online />;
const Failed = () => <SessionState agent={failedAgent} online />;
const Offline = () => <SessionState agent={idleAgent} online={false} />;

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
const autoCompaction = {
  type: "compaction",
  status: "completed",
  trigger: "auto",
  preTokens: 160000,
} as Extract<TimelineItem, { type: "compaction" }>;
const CutLoading = () => <Compaction item={cutLoading} />;
const CutDone = () => <Compaction item={cutDone} />;
const CutAuto = () => <Compaction item={autoCompaction} />;

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
const Cold = () => <ComposerNotices agent={coldAgent} />;
const Resume = () => <ComposerNotices agent={resumeAgent} />;

// ---- settings kit feedback ----

const loadingRpc = { data: null, error: null, loading: true, reload: noop };
const errorRpc = { data: null, error: "Request timed out after 10s", loading: false, reload: noop };
function KitFeedback() {
  const confirm = useCallback(() => toast({ title: "Removed" }), []);
  const pairBtn = useMemo(() => <Button kind="primary" label="Pair a device" onPress={noop} />, []);
  return (
    <Stack>
      <KitBanner icon={KeyRound} title="Pair a device" body="Scan the code from the phone app.">
        {pairBtn}
      </KitBanner>
      <KitBanner
        icon={HardDrive}
        title="devbox runs 1.6.10"
        body="Update to see every setting."
        tint={color.amber}
      />
      <View style={s.findBox}>
        <Finding tone="ok" title="Password set" body="Clients must authenticate." />
        <Finding tone="warn" title="Listening on 0.0.0.0" body="Reachable from the LAN." />
        <Finding tone="bad" title="TLS off for a relay host" last />
      </View>
      <Status rpc={loadingRpc} what="devices" />
      <Status rpc={errorRpc} what="devices" />
      <ErrorLine text="Error: listen EADDRINUSE 0.0.0.0:6767" />
      <View style={s.row}>
        <Confirm label="Remove" confirm="Remove for good" onConfirm={confirm} />
        <Confirm label="Working" confirm="x" onConfirm={confirm} pending />
      </View>
    </Stack>
  );
}

const crashError = new TypeError("Cannot read properties of undefined (reading 'agent')");
const crashStack = `TypeError: Cannot read properties of undefined (reading 'agent')
    at Row (SessionList.tsx:290:12)
    at renderWithHooks (react-dom.development.js:15486:18)
    at SessionList (SessionList.tsx:152:3)`;
function CrashedDemo() {
  return (
    <Fill>
      <Crashed error={crashError} stack={crashStack} onRetry={noop} />
    </Fill>
  );
}

export const feedback: Entry[] = [
  {
    id: "toast",
    name: "Toasts",
    category: "Feedback",
    path: "components/toast/ToastHost.tsx · toast/store.ts",
    purpose:
      "Transient bottom-right stack (full width above the tabs on phones), max 4. Background session status changes become toasts with Open.",
    usedBy: 10,
    polish:
      "in: motion.enter (opacity + translateY 6px, 200ms cubic-bezier(0.23,1,0.32,1)) · out: none, removed instantly on dismiss or after 4200ms · no reflow animation when the stack shifts",
    variants: [{ id: "lifecycle", label: "Fire, stack, dismiss", C: ToastDemo }],
  },
  {
    id: "banner",
    name: "Banners",
    category: "Feedback",
    path: "components/toast/Banners.tsx",
    purpose: "Full-width host conditions: daemon older than the app, reconnecting, storage alerts.",
    usedBy: 1,
    polish:
      "none on show or dismiss; the run tone's glyph breathes (1.6s ∞); the offline timer ticks every 1s",
    variants: [
      { id: "tones", label: "Tones", C: BannerTones, bleed: true },
      {
        id: "host",
        label: "Live host banners",
        note: "Drives the real Banners from the fixture host.",
        C: BannerHost,
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
    category: "Feedback",
    path: "components/chat/SessionState.tsx",
    purpose:
      "End-of-timeline state cards (review, failed, host offline) and the compaction / clean-cut marker.",
    usedBy: 1,
    polish: "none; the compaction summary expands instantly",
    variants: [
      { id: "review", label: "Ready to review", C: Review },
      { id: "failed", label: "Failed", C: Failed },
      { id: "offline", label: "Host offline", C: Offline },
      { id: "cut-loading", label: "Clean cut running", C: CutLoading },
      { id: "cut-done", label: "Clean cut with summary", C: CutDone },
      { id: "cut-auto", label: "Automatic compaction", C: CutAuto },
    ],
  },
  {
    id: "notices",
    name: "ComposerNotices",
    category: "Feedback",
    path: "components/chat/Notices.tsx",
    purpose:
      "Strips above the composer: a lapsed prompt cache (offer a clean cut) and a pending auto-resume countdown.",
    usedBy: 1,
    polish: "none; the countdown ticks every 1s",
    variants: [
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
    polish: "none",
    variants: [{ id: "default", label: "Render error", C: CrashedDemo, h: 520, bleed: true }],
  },
];

const s = StyleSheet.create({
  bannerFrame: { borderWidth: 1, borderColor: color.line, minHeight: 60 },
  answered: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  answeredT: { color: color.muted, flex: 1 },
  findBox: { borderWidth: 1, borderColor: color.line },
  row: { flexDirection: "row", gap: 12 },
});
