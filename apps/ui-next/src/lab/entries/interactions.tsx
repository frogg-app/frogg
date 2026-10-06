import { useCallback, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Shell from "../../app/index";
import { InboxPanel } from "../../components/Inbox";
import { PhoneTabs } from "../../components/PhoneTabs";
import { TOOLS } from "../../components/Rail";
import { ScmPanel } from "../../components/ScmPanel";
import { SearchPanel } from "../../components/SearchPanel";
import { SessionList } from "../../components/SessionList";
import { SettingsNav } from "../../components/settings/Settings";
import { KeyboardFrame } from "../../components/shell/KeyboardFrame";
import { T } from "../../components/Text";
import { toast } from "../../components/toast/store";
import { ToolCall } from "../../components/ToolCall";
import { ToolPane } from "../../components/ToolPane";
import { cancelTurn, useDaemon } from "../../daemon/store";
import { bucketOf, type TimelineItem } from "../../daemon/types";
import { color, motion } from "../../theme/tokens";
import { useUi, type Tool } from "../../ui-store";
import { askPermission, patchAgent, playTurn } from "../client";
import {
  ID,
  planPermission,
  questionPermission,
  shellPermission,
  toolDetails,
  toolItem,
} from "../fixtures";
import { Act, Controls, Fill, type Entry } from "../kit";
import { LiveChat } from "./chat";
import { useBadges } from "./shell";

// ---- shared ----

const ORDER = ["needs", "failed", "review", "working", "idle"];
function orderedIds(): string[] {
  return Object.values(useDaemon.getState().sessions)
    .sort(
      (a, b) =>
        ORDER.indexOf(bucketOf(a.agent)) - ORDER.indexOf(bucketOf(b.agent)) ||
        Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt),
    )
    .map((x) => x.agent.id);
}
function step(by: number) {
  const ui = useUi.getState();
  const ids = orderedIds();
  const at = ui.selected ? ids.indexOf(ui.selected) : -1;
  const next = ids[Math.max(0, Math.min(ids.length - 1, at + by))];
  ui.setTool("sessions");
  if (next) ui.select(next);
}
const nextSession = () => step(1);
const prevSession = () => step(-1);
const openFailed = () => {
  useUi.getState().setTool("sessions");
  useUi.getState().select(ID.failed);
};
const deselect = () => useUi.getState().select(null);
const selectPreview = () => useUi.setState({ selected: ID.preview });

const RAIL_IDS = TOOLS.map((t) => t.id);
const nextTool = () => {
  const ui = useUi.getState();
  ui.setTool(RAIL_IDS[(RAIL_IDS.indexOf(ui.tool) + 1) % RAIL_IDS.length]);
};
const tool = (t: Tool) => () => useUi.getState().setTool(t);
const toSessions = tool("sessions");
const toScm = tool("scm");
const toUsage = tool("usage");
const toSettings = tool("settings");

const openInboxItem = () => {
  useUi.getState().setTool("inbox");
  useUi.getState().openInbox(ID.needs);
};
const closeInboxItem = () => useUi.getState().openInbox(null);
const openSettingsPage = () => {
  useUi.getState().setTool("settings");
  useUi.getState().openSettings("chat");
};
const closeSettingsPage = () => useUi.getState().openSettings(null);

const openPalette = () => useUi.getState().setPalette(true);
const closePalette = () => useUi.getState().setPalette(false);
const openNew = () => useUi.getState().setNewSession(true, "Add an LRU eviction log line");
const closeNew = () => useUi.getState().setNewSession(false);

const toastOk = () => toast({ title: "Copied branch name" });
const toastError = () =>
  toast({ title: "Could not stop", detail: "agent is not running", kind: "error" });
const finishWorking = () =>
  patchAgent(ID.working, { status: "idle", requiresAttention: true, attentionReason: "finished" });

/** The real app shell (app/index.tsx) inside a frame, driven by the fixture host. */
function InShell({ children }: { children: ReactNode }) {
  return (
    <Fill>
      <Controls>{children}</Controls>
      <View style={s.shell}>
        <Shell />
      </View>
    </Fill>
  );
}

const SwitchDemo = () => (
  <InShell>
    <Act label="Next (J)" run={nextSession} primary />
    <Act label="Previous (K)" run={prevSession} />
    <Act label="Open failed" run={openFailed} />
    <Act label="Deselect" run={deselect} />
  </InShell>
);
const RailDemo = () => (
  <InShell>
    <Act label="Next tool" run={nextTool} primary />
    <Act label="Sessions" run={toSessions} />
    <Act label="Source control" run={toScm} />
    <Act label="Usage" run={toUsage} />
    <Act label="Settings" run={toSettings} />
  </InShell>
);
const DetailDemo = () => (
  <InShell>
    <Act label="Open inbox item" run={openInboxItem} primary />
    <Act label="Close it" run={closeInboxItem} />
    <Act label="Open a settings page" run={openSettingsPage} />
    <Act label="Back from settings" run={closeSettingsPage} />
  </InShell>
);
const PaletteDemo = () => (
  <InShell>
    <Act label="Open palette (⌘K)" run={openPalette} primary />
    <Act label="Close" run={closePalette} />
  </InShell>
);
const NewDemo = () => (
  <InShell>
    <Act label="Open new session (⌘N)" run={openNew} primary />
    <Act label="Close" run={closeNew} />
  </InShell>
);
const ToastDemo = () => (
  <InShell>
    <Act label="Background session finishes" run={finishWorking} primary />
    <Act label="ok toast" run={toastOk} />
    <Act label="error toast" run={toastError} />
  </InShell>
);

// ---- portrait-tablet drawer ----

const openList = () => useUi.getState().setListOpen(true);
const closeList = () => useUi.getState().setListOpen(false);
/** Replica of app/index.tsx's portrait-tablet branch (700–899px windows), which the lab can't reach at its own width. */
function DrawerDemo() {
  const open = useUi((st) => st.listOpen);
  return (
    <Fill>
      <Controls>
        <Act label="Open list" run={openList} primary />
        <Act label="Close (scrim)" run={closeList} />
      </Controls>
      <View style={s.drawerFrame}>
        <LiveChat id={ID.preview} />
        {open && (
          <>
            <Pressable style={s.scrim} onPress={closeList} accessibilityLabel="Close list" />
            <View style={s.drawer}>
              <SessionList />
            </View>
          </>
        )}
      </View>
    </Fill>
  );
}

// ---- phone tabs ----

function phonePanel(t: Tool): ReactNode {
  switch (t) {
    case "sessions":
      return <SessionList />;
    case "search":
      return <SearchPanel />;
    case "scm":
      return <ScmPanel />;
    case "inbox":
      return <InboxPanel />;
    case "settings":
      return <SettingsNav />;
    default:
      return <ToolPane tool={t} />;
  }
}
/** The phone branch of the shell: a keyed panel per tab (replays motion.enter), pushes a chat. */
function PhoneDemo() {
  const current = useUi((st) => st.tool);
  const selected = useUi((st) => st.selected);
  const badges = useBadges();
  const pushed = current === "sessions" && !!selected;
  return (
    <View style={s.phone}>
      {pushed && selected ? (
        <LiveChat id={selected} back={deselect} />
      ) : (
        <View key={current} style={s.panel}>
          {phonePanel(current)}
        </View>
      )}
      {!pushed && <PhoneTabs badges={badges} />}
    </View>
  );
}

// ---- streaming ----

const play = () => void playTurn(ID.preview);
const stop = () => void cancelTurn(ID.preview);
const StreamDemo = () => (
  <Fill>
    <Controls>
      <Act label="Play a turn" run={play} primary />
      <Act label="Stop" run={stop} />
    </Controls>
    <View style={s.chat}>
      <LiveChat id={ID.preview} />
    </View>
  </Fill>
);

// ---- tool call lifecycle ----

type Status = "running" | "completed" | "failed";
function ToolLifecycle() {
  const [status, setStatus] = useState<Status>("running");
  const [n, setN] = useState(0);
  const running = useCallback(() => {
    setStatus("running");
    setN((x) => x + 1);
  }, []);
  const done = useCallback(() => setStatus("completed"), []);
  const fail = useCallback(() => setStatus("failed"), []);
  const item = toolItem(
    `life-${n}`,
    "Bash",
    status === "failed" ? toolDetails.shellFailed : toolDetails.shell,
    status,
    status === "failed" ? "exit code 2" : null,
  ) as Extract<TimelineItem, { type: "tool_call" }>;
  return (
    <View>
      <Controls>
        <Act label="Start (remount)" run={running} primary />
        <Act label="Complete" run={done} />
        <Act label="Fail" run={fail} />
      </Controls>
      <ToolCall item={item} />
      <T style={s.hint}>Click the row to expand and collapse it.</T>
    </View>
  );
}

// ---- permissions ----

const askShell = () => askPermission(ID.needs, shellPermission);
const askPlan = () => askPermission(ID.needs, planPermission);
const askQuestion = () => askPermission(ID.needs, questionPermission);
const selectNeeds = () => useUi.setState({ selected: ID.needs });
const PermissionDemo = () => (
  <Fill>
    <Controls>
      <Act label="Ask: command" run={askShell} primary />
      <Act label="Ask: plan" run={askPlan} />
      <Act label="Ask: questions" run={askQuestion} />
    </Controls>
    <View style={s.chat}>
      <LiveChat id={ID.needs} />
    </View>
  </Fill>
);

// ---- keyboard ----

const KEY_ROWS = [
  { id: "r1", keys: "qwertyuiop".split("") },
  { id: "r2", keys: "asdfghjkl".split("") },
  { id: "r3", keys: "zxcvbnm".split("") },
];
function FakeKeyboard() {
  return (
    <View style={s.kb}>
      {KEY_ROWS.map((r) => (
        <View key={r.id} style={s.kbRow}>
          {r.keys.map((k) => (
            <View key={k} style={s.key}>
              <T style={s.keyT}>{k}</T>
            </View>
          ))}
        </View>
      ))}
      <View style={s.kbRow}>
        <View style={s.space} />
      </View>
    </View>
  );
}
function KeyboardDemo() {
  const [kb, setKb] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const up = useCallback(() => setKb(true), []);
  const down = useCallback(() => setKb(false), []);
  const toChat = useCallback(() => setChatOpen(true), []);
  const toList = useCallback(() => setChatOpen(false), []);
  const badges = useBadges();
  return (
    <Fill>
      <Controls>
        <Act label="Keyboard up" run={up} primary />
        <Act label="Keyboard down" run={down} />
        <Act label="Chat (pushed)" run={toChat} />
        <Act label="List (tabs)" run={toList} />
      </Controls>
      <View style={s.phone}>
        <KeyboardFrame style={s.panel}>
          {chatOpen ? <LiveChat id={ID.preview} back={toList} /> : <SessionList />}
          {!chatOpen && !kb && <PhoneTabs badges={badges} />}
        </KeyboardFrame>
        {kb && <FakeKeyboard />}
      </View>
    </Fill>
  );
}

const SHELL_NOTE =
  "The real shell from app/index.tsx in a frame; keyboard shortcuts work while it shows.";

export const interactions: Entry[] = [
  {
    id: "x-session-switch",
    name: "Session switching",
    category: "Interactions",
    path: "app/index.tsx · SessionList.tsx · Chat.tsx · Palette.tsx (J/K)",
    purpose: "Selecting sessions from the list, J/K, or a toast's Open.",
    polish:
      "new row's Brackets snap (opacity + scale 1.06→1, 220ms); chat swaps instantly and scrolls to the end without animation",
    ownToasts: true,
    variants: [
      { id: "shell", label: "Shell", note: SHELL_NOTE, C: SwitchDemo, h: 760, bleed: true },
    ],
  },
  {
    id: "x-rail",
    name: "Rail tool switching",
    category: "Interactions",
    path: "app/index.tsx (side panel keyed by tool) · Rail.tsx",
    purpose: "Changing tools from the rail: indicator glides, side panel replays its enter.",
    polish:
      "indicator translateY 450ms cubic-bezier(0.22,1,0.36,1) · side panel motion.enter 200ms cubic-bezier(0.23,1,0.32,1) on every switch (two curves, two durations)",
    ownToasts: true,
    variants: [{ id: "shell", label: "Shell", note: SHELL_NOTE, C: RailDemo, h: 760, bleed: true }],
  },
  {
    id: "x-tool-detail",
    name: "Tool detail open / close",
    category: "Interactions",
    path: "app/index.tsx (MainDetail)",
    purpose:
      "A tool's detail (inbox item, settings page, diff, file, terminal, CI run) taking the main pane.",
    polish: "none: the main pane swaps instantly in both directions",
    ownToasts: true,
    variants: [
      { id: "shell", label: "Shell", note: SHELL_NOTE, C: DetailDemo, h: 760, bleed: true },
    ],
  },
  {
    id: "x-drawer",
    name: "Session list drawer",
    category: "Interactions",
    path: "app/index.tsx (portrait tablet branch)",
    purpose:
      "Portrait tablet: the side panel slides over the main pane with a scrim; picking an item closes it.",
    polish: "none: the code has no slide; drawer and scrim appear and vanish instantly",
    setup: selectPreview,
    variants: [
      {
        id: "replica",
        label: "Replica of the portrait branch",
        C: DrawerDemo,
        h: 680,
        bleed: true,
      },
    ],
  },
  {
    id: "x-phone-tabs",
    name: "Phone tabs navigation",
    category: "Interactions",
    path: "app/index.tsx (phone branch) · PhoneTabs.tsx",
    purpose: "Tab panels at the root, More sheet, a session pushes full screen and hides the tabs.",
    polish:
      "panel motion.enter 200ms on each tab change · More sheet: none · push and back: none (instant)",
    variants: [
      {
        id: "phone",
        label: "Phone, 390 wide",
        note: "Tap a session to push it; Back returns.",
        C: PhoneDemo,
        h: 760,
        bleed: true,
      },
    ],
  },
  {
    id: "x-palette",
    name: "Palette open / close",
    category: "Interactions",
    path: "Palette.tsx",
    purpose: "⌘K over the shell; Esc or the scrim closes.",
    polish: "none (instant)",
    ownToasts: true,
    variants: [
      { id: "shell", label: "Shell", note: SHELL_NOTE, C: PaletteDemo, h: 760, bleed: true },
    ],
  },
  {
    id: "x-new-session",
    name: "New-session sheet",
    category: "Interactions",
    path: "NewSession.tsx",
    purpose: "⌘N over the shell; creating selects the new session, which plays a turn.",
    polish: "desktop: none (instant) · phone: Modal slide (RN-web 300ms)",
    ownToasts: true,
    variants: [{ id: "shell", label: "Shell", note: SHELL_NOTE, C: NewDemo, h: 760, bleed: true }],
  },
  {
    id: "x-toast",
    name: "Toast in / out",
    category: "Interactions",
    path: "toast/ToastHost.tsx",
    purpose: "Toasts over the shell, including the session-status toast with Open.",
    polish: "in: motion.enter 200ms · out: none (instant removal) · lifetime 4200ms",
    ownToasts: true,
    variants: [
      { id: "shell", label: "Shell", note: SHELL_NOTE, C: ToastDemo, h: 760, bleed: true },
    ],
  },
  {
    id: "x-streaming",
    name: "Streaming reply and thinking",
    category: "Interactions",
    path: "Chat.tsx (Thinking) · ToolCall.tsx",
    purpose:
      "A turn: thinking shimmer, a tool call running then done, the reply streaming word by word.",
    polish:
      "shimmer 2s linear ∞ · running beam 1.4s ∞ · tool row enter 200ms · streamed text has no reveal animation; the scroll jumps to the end per chunk",
    setup: selectPreview,
    variants: [
      {
        id: "chat",
        label: "Chat",
        note: "Speed control also slows the fixture's timers.",
        C: StreamDemo,
        h: 760,
        bleed: true,
      },
    ],
  },
  {
    id: "x-tool-call",
    name: "Tool call lifecycle",
    category: "Interactions",
    path: "ToolCall.tsx",
    purpose: "Running → completed or failed, expand and collapse.",
    polish: "enter 200ms on mount · beam while running · expand instant · chevron rotate instant",
    variants: [{ id: "one", label: "One call", C: ToolLifecycle }],
  },
  {
    id: "x-permission",
    name: "Permission approve / deny",
    category: "Interactions",
    path: "PermissionCard.tsx · chat/QuestionCard.tsx",
    purpose: "Answering in the chat: the card goes, a toast confirms, the agent carries on.",
    polish: "card removal instant; confirmation toast enters 200ms",
    setup: selectNeeds,
    variants: [{ id: "chat", label: "Chat", C: PermissionDemo, h: 760, bleed: true }],
  },
  {
    id: "x-keyboard",
    name: "Keyboard frame",
    category: "Interactions",
    path: "shell/KeyboardFrame.tsx · shell/useKeyboardVisible.ts · app/index.tsx",
    purpose:
      "Web approximation: the window shrinks above the keyboard (Android adjustResize) and the phone tabs hide while it is up.",
    polish:
      "none in code: Android resizes the window natively, iOS uses KeyboardAvoidingView behavior=padding, web never reports a keyboard",
    setup: selectPreview,
    variants: [{ id: "phone", label: "Phone, 390 wide", C: KeyboardDemo, h: 800, bleed: true }],
  },
];

const s = StyleSheet.create({
  shell: { flex: 1, borderTopWidth: 1, borderTopColor: color.line },
  chat: { flex: 1, borderTopWidth: 1, borderTopColor: color.line },
  drawerFrame: { flex: 1, borderTopWidth: 1, borderTopColor: color.line },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: color.scrim },
  drawer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 340,
    borderRightWidth: 1,
    borderRightColor: color.line,
    backgroundColor: color.bg2,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 24,
  },
  phone: {
    flex: 1,
    width: "100%",
    maxWidth: 390,
    alignSelf: "center",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
  },
  panel: { flex: 1, ...motion.enter },
  hint: { color: color.faint, fontSize: 12, marginTop: 10 },
  kb: { backgroundColor: color.raise, paddingVertical: 8, gap: 8, height: 230 },
  kbRow: { flexDirection: "row", justifyContent: "center", gap: 5 },
  key: {
    width: 30,
    height: 40,
    backgroundColor: color.wash3,
    alignItems: "center",
    justifyContent: "center",
  },
  keyT: { color: color.text },
  space: { width: 200, height: 40, backgroundColor: color.wash3 },
});
