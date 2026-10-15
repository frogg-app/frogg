import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Chat } from "../../components/Chat";
import { AccountChip } from "../../components/chat/AccountChip";
import { ContextMeter } from "../../components/chat/ContextMeter";
import type { Attachment, SlashCommand } from "../../components/chat/actions";
import { AttachChips, AttachMenu } from "../../components/chat/Attach";
import { SessionMenu } from "../../components/chat/SessionMenu";
import { SlashMenu } from "../../components/chat/SlashMenu";
import { Composer } from "../../components/Composer";
import { toast } from "../../components/toast/store";
import { ToolCall } from "../../components/ToolCall";
import { TimelineLoading } from "../../components/chat/TimelineLoading";
import { ViewerList, ViewersRow } from "../../components/chat/Viewers";
import type { Viewer } from "../../daemon/viewers";
import { useDaemon } from "../../daemon/store";
import type { TimelineItem } from "../../daemon/types";
import { color } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { commands as COMMANDS, entry, ID, toolDetails, toolItem } from "../fixtures";
import { LAB_ATTACHMENTS } from "../sim/fs";
import { Above, Case, Cases, Fill, W, type Entry } from "../kit";

type ToolItem = Extract<TimelineItem, { type: "tool_call" }>;

/** The real Chat for a fixture session, live from the store. */
export function LiveChat({ id, back }: { id: string; back?: () => void }) {
  const sess = useDaemon((st) => st.sessions[id]);
  if (!sess) return null;
  return (
    <Fill>
      <Chat session={sess} onBack={back} />
    </Fill>
  );
}
const noop = () => {};
const Preview = () => <LiveChat id={ID.preview} />;
const PreviewPhone = () => (
  <Case
    name="Chat"
    props="session onBack"
    note="Phone push: back arrow, compact composer."
    w={W.phone}
    h={560}
  >
    <LiveChat id={ID.preview} back={noop} />
  </Case>
);
const Failed = () => <LiveChat id={ID.failed} />;

const RENDER_ID = "s-render";
const RENDER_PROMPT =
  "The sidebar needs to expand out smoothly when hovering or selecting a tool, and the rail icons should keep their place while it does";
/** A session with a provisional (cut) title, a relayed agent message, images and a table. */
function seedRender() {
  const st = useDaemon.getState();
  const base = st.sessions[ID.preview];
  if (!base || st.sessions[RENDER_ID]) return;
  const it = (item: TimelineItem) => entry(item, "turn-r");
  useDaemon.setState({
    sessions: {
      ...st.sessions,
      [RENDER_ID]: {
        ...base,
        agent: {
          ...base.agent,
          id: RENDER_ID,
          title: RENDER_PROMPT.slice(0, 60).trim(),
          cwd: LAB_ATTACHMENTS,
        },
      },
    },
    timelines: {
      ...st.timelines,
      [RENDER_ID]: [
        it({ type: "user_message", text: RENDER_PROMPT, messageId: "r-u1" }),
        it({
          type: "user_message",
          text: `Here is what it does now:\n![Image](file://${LAB_ATTACHMENTS}/before-sidebar.png)`,
          messageId: "r-u2",
        }),
        it({
          type: "user_message",
          text: `From the "Frogg Plugin: Google Suite" agent (${ID.review.slice(0, 5)}, worktree ~/.frogg/worktrees/1j7d90so/frogg-plugin-google-suite): The **Drive** picker is ready. Can you wire it into the attach menu?`,
          messageId: "r-u3",
        }),
        it({
          type: "user_message",
          text: "From Google Suite agent (cf989ce): Calendar sync landed too.",
          messageId: "r-u4",
        }),
        it({
          type: "assistant_message",
          text: `Before and after:\n\n![Image](file://${LAB_ATTACHMENTS}/before-sidebar.png)![Image](file://${LAB_ATTACHMENTS}/after-sidebar.png)\n\n| Prize pool | 1st | 2nd | 3rd |\n|---|---:|---:|---:|\n| $5k (Cup #1) | 2,000 | 1,250 | 750 |\n| $10k (Cup #2) | 4,000 | 2,500 | 1,500 |`,
          messageId: "r-a1",
        }),
        it(toolItem("r-long", "Bash", toolDetails.shellLong)),
      ],
    },
  });
}
function Rendering() {
  useState(seedRender);
  return <LiveChat id={RENDER_ID} />;
}
const Needs = () => <LiveChat id={ID.needs} />;
const Working = () => <LiveChat id={ID.working} />;
const selectPreview = () => useUi.setState({ selected: ID.preview });

// ---- loading and presence ----

/** Replay to see the beat before it appears: a fast load never shows it. */
const Loading = () => (
  <Cases>
    <Case
      name="TimelineLoading"
      props="(loading)"
      note="Host online, conversation on its way."
      w={CHAT}
      plain
    >
      <TimelineLoading />
    </Case>
    <Case
      name="TimelineLoading"
      props="connecting"
      note="Host not connected yet."
      w={W.phone}
      plain
    >
      <TimelineLoading connecting />
    </Case>
  </Cases>
);

const viewer = (
  name: string,
  activity: Viewer["activity"] = "viewing",
  clientType = "browser",
): Viewer => ({
  id: name,
  name,
  key: `k-${name}`,
  clientType,
  activity,
});
const ONE = [viewer("Pixel 8", "viewing", "mobile")];
const TWO = [viewer("Pixel 8", "viewing", "mobile"), viewer("MacBook Pro")];
const TYPING = [viewer("MacBook Pro"), viewer("Pixel 8", "typing", "mobile")];
const MANY = [
  viewer("Pixel 8", "viewing", "mobile"),
  viewer("MacBook Pro"),
  viewer("Frogg Next on web"),
  viewer("frogg cli", "idle", "cli"),
  viewer("Office iMac"),
];
const Here = () => (
  <Cases>
    <Case name="ViewersRow" props="one" w={W.phone} plain>
      <ViewersRow viewers={ONE} />
    </Case>
    <Case name="ViewersRow" props="two" w={W.phone} plain>
      <ViewersRow viewers={TWO} />
    </Case>
    <Case name="ViewersRow" props="someone typing" w={W.phone} plain>
      <ViewersRow viewers={TYPING} />
    </Case>
    <Case name="ViewersRow" props="five (+2 folded)" w={W.phone} plain>
      <ViewersRow viewers={MANY} />
    </Case>
    <Case name="ViewerList" props="popover body" w={260} plain>
      <ViewerList viewers={MANY} />
    </Case>
  </Cases>
);

// ---- tool calls ----

const T = (
  callId: string,
  name: string,
  d: keyof typeof toolDetails,
  status?: "running" | "failed",
) =>
  toolItem(
    callId,
    name,
    toolDetails[d],
    status ?? "completed",
    status === "failed" ? "exit code 2" : null,
  ) as ToolItem;

const KINDS: ToolItem[] = [
  T("k-read", "Read", "read"),
  T("k-edit", "Edit", "edit"),
  T("k-write", "Write", "write"),
  T("k-shell", "Bash", "shell"),
  T("k-grep", "Grep", "search"),
  T("k-glob", "Glob", "glob"),
  T("k-fetch", "WebFetch", "fetch"),
  T("k-sub", "Task", "subAgent"),
  T("k-plan", "ExitPlanMode", "plan"),
  T("k-plain", "Skill", "plainText"),
  T("k-wt", "worktree", "worktree"),
  T("k-unknown", "mcp__frogg__list_agents", "unknown"),
];
const LONG: ToolItem[] = [T("l-long", "Bash", "shellLong"), T("l-short", "Bash", "shell")];
const STATES: ToolItem[] = [
  T("s-run", "Bash", "shell", "running"),
  T("s-done", "Bash", "shell"),
  T("s-fail", "Bash", "shellFailed", "failed"),
];

function ToolList({ items }: { items: ToolItem[] }) {
  return (
    <View>
      {items.map((it) => (
        <ToolCall key={it.callId} item={it} />
      ))}
    </View>
  );
}
/** Chat column width on desktop. */
const CHAT = 720;
const Kinds = () => (
  <Case
    name="ToolCall"
    props="item={tool_call} × 12 detail kinds"
    note="Chat column width."
    w={CHAT}
    plain
  >
    <ToolList items={KINDS} />
  </Case>
);
const Long = () => (
  <Case
    name="ToolCall"
    props="item={long shell output}"
    note="Expand the first row: output past 320px is clamped behind Show more. The second fits."
    w={CHAT}
    plain
  >
    <ToolList items={LONG} />
  </Case>
);
const States = () => (
  <Cases>
    <Case name="ToolCall" props={'status="running" | "completed" | "failed"'} w={CHAT} plain>
      <ToolList items={STATES} />
    </Case>
    <Case name="ToolCall" props="(same)" note="Phone: long arguments truncate." w={W.phone} plain>
      <ToolList items={STATES} />
    </Case>
  </Cases>
);

// ---- composer ----

const send = (t: string) => {
  toast({ title: "Sent", detail: t || "(attachments only)" });
};
const CHIPS = ["Claude Code"];
const NO_CHIPS: string[] = [];
const loadCommands = async (): Promise<SlashCommand[]> => COMMANDS as SlashCommand[];
const failCommands = async (): Promise<SlashCommand[]> => {
  throw new Error("listCommands is not supported by this host");
};

const ATTACHMENTS: Attachment[] = [
  { kind: "image", id: "i1", name: "screenshot.png", mimeType: "image/png", data: "" },
  { kind: "file", id: "f1", name: "invoice-sample.pdf", file: {} as never },
  { kind: "fork", id: "k1", name: "Forked from Preview chat", context: {} as never },
];

const DefaultInner = () => (
  <Composer
    placeholder="Message Claude Code — / commands"
    chips={CHIPS}
    onSend={send}
    attach
    loadCommands={loadCommands}
  />
);
const Default = () => (
  <View style={s.foot}>
    <Case name="Composer" props="chips attach loadCommands" w={CHAT} plain>
      <DefaultInner />
    </Case>
  </View>
);
const Disabled = () => (
  <Case name="Composer" props='disabled placeholder="Host offline"' w={CHAT} plain>
    <Composer placeholder="Host offline" chips={CHIPS} onSend={send} disabled />
  </Case>
);
const Compact = () => (
  <Case name="Composer" props="compact attach chips={[]}" w={W.phone} plain>
    <Composer placeholder="Message Claude Code" chips={NO_CHIPS} onSend={send} compact attach />
  </Case>
);
const Running = () => (
  <Case name="Composer" props="onStop" note="Turn running: send becomes stop." w={CHAT} plain>
    <Composer placeholder="Message Claude Code" chips={CHIPS} onSend={send} onStop={noop} />
  </Case>
);
const WithFiles = () => (
  <Case name="Composer" props="initialAttachments={[image, file, fork]}" w={CHAT} plain>
    <WithFilesInner />
  </Case>
);
const WithFilesInner = () => (
  <Composer
    placeholder="Message Claude Code"
    chips={CHIPS}
    onSend={send}
    attach
    initialAttachments={ATTACHMENTS}
  />
);
const SlashFails = () => (
  <View style={s.foot}>
    <Case
      name="Composer"
      props="loadCommands={rejects}"
      note="Type / to see the error state."
      w={CHAT}
      plain
    >
      <SlashFailsInner />
    </Case>
  </View>
);
const SlashFailsInner = () => (
  <Composer
    placeholder="Type / to see the error state"
    chips={CHIPS}
    onSend={send}
    loadCommands={failCommands}
  />
);

function Live() {
  const a = useDaemon((st) => st.sessions[ID.preview]?.agent);
  if (!a) return null;
  return (
    <View style={s.foot}>
      <Case
        name="Composer"
        props="children=[AccountChip, ContextMeter]"
        note="Model, mode and account pickers are live."
        w={CHAT}
        plain
      >
        <Composer placeholder="Pickers are live: model, mode, account" chips={CHIPS} onSend={send}>
          <AccountChip agent={a} />
          <ContextMeter agent={a} />
        </Composer>
      </Case>
    </View>
  );
}

// ---- slash menu ----

const CMDS = COMMANDS as SlashCommand[];
const NONE: SlashCommand[] = [];
const SlashLoading = () => (
  <Above>
    <SlashMenu commands={null} matches={NONE} highlight={0} onPick={noop} />
  </Above>
);
const SlashMatches = () => (
  <Above>
    <SlashMenu commands={CMDS} matches={CMDS} highlight={1} onPick={noop} />
  </Above>
);
const SlashEmpty = () => (
  <Above>
    <SlashMenu commands={CMDS} matches={NONE} highlight={0} onPick={noop} />
  </Above>
);
const SlashError = () => (
  <Above>
    <SlashMenu commands={CMDS} error matches={NONE} highlight={0} onPick={noop} />
  </Above>
);

function Attachments() {
  const [items, setItems] = useState<Attachment[]>(ATTACHMENTS);
  const remove = useCallback((id: string) => setItems((l) => l.filter((a) => a.id !== id)), []);
  const add = useCallback((a: Attachment[]) => setItems((l) => [...l, ...a]), []);
  return (
    <Cases>
      <Case name="AttachMenu" props="onAdd" note="Click + for the menu (web file picker)." plain>
        <AttachMenu onAdd={add} />
      </Case>
      <Case
        name="AttachChips"
        props="items={[image, file, fork]} onRemove"
        note="× removes a chip; long names truncate at the phone width."
        w={W.phone}
        plain
      >
        <AttachChips items={items} onRemove={remove} />
      </Case>
    </Cases>
  );
}

function HeaderMenu() {
  const sess = useDaemon((st) => st.sessions[ID.preview]);
  if (!sess) return null;
  return (
    <View style={s.menuRow}>
      <SessionMenu session={sess} />
    </View>
  );
}

export const chat: Entry[] = [
  {
    id: "chat",
    name: "Chat",
    category: "Chat",
    path: "components/Chat.tsx",
    purpose:
      "The conversation: header (crumb, title, state, provider/model), timeline, permission cards, state card, composer with live pickers.",
    usedBy: 1,
    polish:
      "tool rows enter with motion.enter (200ms); the working indicator shimmers (2s linear ∞); scroll jumps to the end on every content change, not animated",
    setup: selectPreview,
    variants: [
      {
        id: "review",
        label: "Finished, ready to review",
        note: "Send a message: the fixture host plays a turn.",
        C: Preview,
        h: 720,
        bleed: true,
      },
      {
        id: "phone",
        label: "Pushed (back arrow, compact composer)",
        C: PreviewPhone,
      },
      { id: "needs", label: "Waiting on a permission", C: Needs, h: 520, bleed: true },
      { id: "working", label: "Working (thinking indicator)", C: Working, h: 420, bleed: true },
      { id: "failed", label: "Failed", C: Failed, h: 480, bleed: true },
      {
        id: "render",
        label: "Rich content",
        note: "Images, a table, relayed agent messages and a provisional title. The relay from the review session links to it; cf989ce matches no session.",
        C: Rendering,
        h: 900,
        bleed: true,
      },
    ],
  },
  {
    id: "timeline-loading",
    name: "Timeline loading",
    category: "Chat",
    path: "components/chat/TimelineLoading.tsx",
    purpose:
      "What a chat shows while its timeline is on the way: the shape of a conversation under a soft sweep and a line saying whether the host is still connecting or the conversation is loading. Also used for a subagent's activity.",
    usedBy: 2,
    polish:
      "groups enter with motion.enter 260ms after a 180ms hold, staggered 50ms; shapes sweep (shimmer 1.6s linear ∞, fixed attachment so all bars move together); loading line shimmers 2s, connecting line breathes 1.6s · native shows the still shapes",
    variants: [{ id: "states", label: "Loading and connecting", C: Loading }],
  },
  {
    id: "viewers",
    name: "Who else is here",
    category: "Chat",
    path: "components/chat/Viewers.tsx · daemon/viewers.ts",
    purpose:
      "Above the composer: chamfered device avatars and one sentence naming who else has this session open on the host, led by whoever is typing; press for the full list. Reads the daemon's session presence (features.sessionPresence) and reports this app as viewing or typing. Hidden when nobody else is there or the host does not share presence.",
    usedBy: 1,
    polish:
      "row enters with motion.enter 200ms; the typing mark breathes 1.6s; hover washes the row; the list opens in the shared popover (popDown/popUp)",
    variants: [{ id: "cases", label: "One, two, typing, many, list", C: Here }],
  },
  {
    id: "tool-call",
    name: "ToolCall",
    category: "Chat",
    path: "components/ToolCall.tsx",
    purpose:
      "One collapsible row per tool call: icon, verb, argument, meta, status; expands to its output.",
    usedBy: 1,
    polish:
      "mount: motion.enter 200ms · running: a 1px beam sweeps the top edge, 1.4s cubic-bezier(0.77,0,0.175,1) ∞ · done (live only): glyph draws 220ms + pop 260ms, edge flash and row sweep 420ms on ease, sweep throttled to one per 300ms · expand/collapse: instant; the chevron rotates 0→90° with no transition",
    variants: [
      { id: "kinds", label: "Every detail type", note: "Click a row to expand.", C: Kinds },
      { id: "states", label: "Running, completed, failed", C: States },
      { id: "long", label: "Long output (see more)", C: Long },
    ],
  },
  {
    id: "composer",
    name: "Composer",
    category: "Chat",
    path: "components/Composer.tsx",
    purpose:
      "Message input with chips, live pickers, attachments, slash-command autocomplete, send and stop.",
    usedBy: 3,
    polish:
      "slash menu enters with overlayMotion.popUp (160ms, origin bottom-left); nothing else animates",
    variants: [
      {
        id: "default",
        label: "Default",
        note: "Type / for commands; ↑↓ and Enter pick.",
        C: Default,
        h: 300,
      },
      { id: "live", label: "With the account chip", C: Live, h: 200 },
      { id: "files", label: "With attachments", C: WithFiles },
      { id: "running", label: "Turn running (stop button)", C: Running },
      { id: "compact", label: "Compact (phone)", C: Compact },
      { id: "disabled", label: "Disabled (host offline)", C: Disabled },
      { id: "slash-error", label: "Commands fail to load", C: SlashFails, h: 220 },
    ],
  },
  {
    id: "slash-menu",
    name: "SlashMenu",
    category: "Chat",
    path: "components/chat/SlashMenu.tsx",
    purpose: "The composer's command and skill list.",
    usedBy: 1,
    polish:
      "overlayMotion.popUp on mount (fade + scale 0.96→1 + 4px, 160ms, origin bottom-left); unmounts instantly",
    variants: [
      { id: "matches", label: "Commands and skills, one highlighted", C: SlashMatches, h: 360 },
      { id: "loading", label: "Loading", C: SlashLoading, h: 110 },
      { id: "empty", label: "No matches", C: SlashEmpty, h: 110 },
      { id: "error", label: "Unavailable", C: SlashError, h: 110 },
    ],
  },
  {
    id: "attach",
    name: "AttachMenu / AttachChips",
    category: "Chat",
    path: "components/chat/Attach.tsx",
    purpose: "The + menu (web file picker) and removable chips for images, files and fork context.",
    usedBy: 1,
    polish: "none",
    variants: [{ id: "default", label: "Menu and chips", C: Attachments }],
  },
  {
    id: "session-menu",
    name: "SessionMenu (chat header)",
    category: "Chat",
    path: "components/chat/SessionMenu.tsx",
    purpose: "The ⋯ menu in the conversation header: rename, fork, rewind, clean cut, archive.",
    usedBy: 1,
    polish:
      "Menu: popover motion 160ms in / 110ms out · its dialogs: scrim fade + card rise 170ms / 110ms",
    variants: [{ id: "default", label: "Open the ⋯ menu", C: HeaderMenu }],
  },
];

const s = StyleSheet.create({
  menuRow: { flexDirection: "row", backgroundColor: color.bg2 },
  foot: { flex: 1, justifyContent: "flex-end" },
});
