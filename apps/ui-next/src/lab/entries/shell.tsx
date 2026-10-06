import { StyleSheet, View } from "react-native";
import { Home } from "../../components/Home";
import { InboxDetail, InboxPanel } from "../../components/Inbox";
import { NewSession } from "../../components/NewSession";
import { Palette, useGlobalKeys } from "../../components/Palette";
import { PhoneTabs } from "../../components/PhoneTabs";
import { Rail } from "../../components/Rail";
import { SessionList, useBuckets } from "../../components/SessionList";
import { SettingsNav, SettingsPage } from "../../components/settings/Settings";
import { StatusBar } from "../../components/StatusBar";
import { T } from "../../components/Text";
import { ToolPane } from "../../components/ToolPane";
import { useDaemon } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { useUi, type Tool } from "../../ui-store";
import { ID, sessions } from "../fixtures";
import { Act, Column, Controls, Fill, Row, Stack, type Entry } from "../kit";

/** Badges the shell computes from the session buckets (sessions: needs, inbox: needs + failed). */
export function useBadges(): Partial<Record<Tool, number>> {
  const b = useBuckets();
  const needs = b.needs.length;
  const failed = b.failed.length;
  return { sessions: needs || undefined, inbox: needs + failed || undefined };
}

function ToolName() {
  const tool = useUi((st) => st.tool);
  return <T v="mono">tool = {tool}</T>;
}

function RailDemo() {
  const badges = useBadges();
  return (
    <Row>
      <Rail badges={badges} />
      <View style={s.railSide}>
        <ToolName />
        <T style={s.muted}>Click the rail: the 2px indicator glides between items.</T>
      </View>
    </Row>
  );
}

function PhoneTabsDemo() {
  const badges = useBadges();
  return (
    <View style={s.phone}>
      <View style={s.phoneBody}>
        <ToolName />
        <T style={s.muted}>More opens the all-tools sheet over the panel.</T>
      </View>
      <PhoneTabs badges={badges} />
    </View>
  );
}

const emptyList = () => useDaemon.setState({ sessions: {} });
const fillList = () => useDaemon.setState({ sessions: sessions() });
function SessionListDemo() {
  return (
    <Stack>
      <Controls>
        <Act label="No sessions" run={emptyList} />
        <Act label="Fixture sessions" run={fillList} />
      </Controls>
      <View style={s.listFrame}>
        <Column width={340}>
          <SessionList />
        </Column>
      </View>
    </Stack>
  );
}

const StatusBarDemo = () => <StatusBar />;
const HomeDemo = () => (
  <Fill>
    <Home />
  </Fill>
);

const openPalette = () => useUi.getState().setPalette(true);
function PaletteDemo() {
  useGlobalKeys();
  return (
    <Fill>
      <Controls>
        <Act label="Open palette (⌘K / Ctrl+K)" run={openPalette} primary />
      </Controls>
      <T style={s.muted}>Type to filter; start with &gt; for commands only; ↑↓ and Enter run.</T>
      <Palette />
    </Fill>
  );
}

const openNew = () => useUi.getState().setNewSession(true);
const openNewSeeded = () =>
  useUi.getState().setNewSession(true, "Make the session cache cap configurable via config.json.");
function NewSessionDemo() {
  return (
    <Fill>
      <Controls>
        <Act label="Open" run={openNew} primary />
        <Act label="Open with a prompt" run={openNewSeeded} />
      </Controls>
      <T style={s.muted}>
        Create session runs against the fixture host: a new session appears and plays a turn.
      </T>
      <NewSession />
    </Fill>
  );
}
const setupNewSession = () => useUi.getState().setNewSession(true);

function InboxDemo() {
  const id = useUi((st) => st.inboxId);
  return (
    <Row>
      <Column width={340}>
        <InboxPanel />
      </Column>
      <View style={s.flex}>{id && <InboxDetail id={id} />}</View>
    </Row>
  );
}
const setupInbox = () => useUi.setState({ tool: "inbox", inboxId: ID.failed });

function SettingsDemo() {
  const page = useUi((st) => st.settingsPage);
  return (
    <Row>
      <Column width={300}>
        <SettingsNav />
      </Column>
      <View style={s.flex}>
        <SettingsPage id={page ?? "appearance"} />
      </View>
    </Row>
  );
}
const setupSettings = () => useUi.setState({ tool: "settings", settingsPage: "appearance" });

const ToolPaneDemo = () => <ToolPane tool="tasks" />;

export const shell: Entry[] = [
  {
    id: "rail",
    name: "Rail",
    category: "Navigation & shell",
    path: "components/Rail.tsx",
    purpose:
      "Desktop/tablet tool rail in three groups with attention badges and a gliding indicator.",
    usedBy: 4,
    polish:
      "indicator: transform translateY, 450ms cubic-bezier(0.22,1,0.36,1) (CSS transition) · active item's chamfer grows 8→12 instantly · hover swaps wash instantly",
    variants: [{ id: "default", label: "With badges", C: RailDemo, h: 640, bleed: true }],
  },
  {
    id: "phone-tabs",
    name: "PhoneTabs",
    category: "Navigation & shell",
    path: "components/PhoneTabs.tsx",
    purpose: "Phone bottom tabs: five tools plus More, which opens an all-tools sheet.",
    usedBy: 1,
    polish:
      "tab highlight slides between tabs (Glide, 200ms glide curve) · the More sheet (scrim + sheet) appears instantly",
    variants: [
      { id: "default", label: "Tabs and More sheet", C: PhoneTabsDemo, h: 560, bleed: true },
    ],
  },
  {
    id: "session-list",
    name: "SessionList",
    category: "Navigation & shell",
    path: "components/SessionList.tsx (+ sessions/menus.tsx, sheets.tsx, history.tsx)",
    purpose:
      "Sessions grouped by attention with a proportional meter, counts, filter, scope and display menus, inline approve.",
    usedBy: 10,
    polish:
      "selected row: Brackets snap in (220ms) · hover wash instant · meter segments resize instantly",
    variants: [
      {
        id: "default",
        label: "Fixture host",
        note: "Long-press or right-click a row for its menu.",
        C: SessionListDemo,
      },
    ],
  },
  {
    id: "status-bar",
    name: "StatusBar",
    category: "Navigation & shell",
    path: "components/StatusBar.tsx",
    purpose:
      "Desktop footer: brand, host and connection, branch, diff stats, checks, attention counts.",
    usedBy: 1,
    polish: "none",
    variants: [{ id: "default", label: "Online", C: StatusBarDemo, bleed: true }],
  },
  {
    id: "home",
    name: "Home",
    category: "Navigation & shell",
    path: "components/Home.tsx",
    purpose: "Main pane with nothing selected: start cards and a project-less ask composer.",
    usedBy: 1,
    polish: "card hover swaps fill instantly",
    variants: [{ id: "default", label: "Default", C: HomeDemo, h: 620, bleed: true }],
  },
  {
    id: "palette",
    name: "Palette",
    category: "Navigation & shell",
    path: "components/Palette.tsx",
    purpose: "⌘K palette over sessions, commands and tools; also owns J/K/A/Esc and ⌘N.",
    usedBy: 1,
    polish: "in: scrim fade + card rise/scale 170ms ease · out 110ms, stays mounted",
    variants: [{ id: "default", label: "Open and filter", C: PaletteDemo, h: 560, bleed: true }],
  },
  {
    id: "new-session",
    name: "NewSession",
    category: "Navigation & shell",
    path: "components/NewSession.tsx",
    purpose: "New-session form: project, isolation, base branch, agent pickers, prompt and title.",
    usedBy: 1,
    polish:
      "desktop/tablet overlay: scrim fade + card rise/scale 170ms, out 110ms · phone: full-screen slide-up 200ms, out 140ms (native Modal slide)",
    setup: setupNewSession,
    variants: [{ id: "default", label: "Overlay", C: NewSessionDemo, h: 720, bleed: true }],
  },
  {
    id: "inbox",
    name: "Inbox",
    category: "Navigation & shell",
    path: "components/Inbox.tsx",
    purpose: "Notification list (needs you, failed, ready) and the detail with the last reply.",
    usedBy: 1,
    polish: "selected row Brackets snap (220ms); detail swaps instantly",
    setup: setupInbox,
    variants: [{ id: "default", label: "Panel and detail", C: InboxDemo, h: 620, bleed: true }],
  },
  {
    id: "settings-shell",
    name: "SettingsNav / SettingsPage",
    category: "Navigation & shell",
    path: "components/settings/Settings.tsx",
    purpose: "Settings navigation by scope with search, and the page registry.",
    usedBy: 1,
    polish: "none",
    setup: setupSettings,
    variants: [{ id: "default", label: "Appearance page", C: SettingsDemo, h: 660, bleed: true }],
  },
  {
    id: "tool-pane",
    name: "ToolPane",
    category: "Navigation & shell",
    path: "components/ToolPane.tsx",
    purpose: "Fallback panel for a tool without one, so the rail stays navigable.",
    usedBy: 1,
    polish: "none",
    variants: [{ id: "default", label: "Not built yet", C: ToolPaneDemo, h: 240, bleed: true }],
  },
];

const s = StyleSheet.create({
  flex: { flex: 1 },
  muted: { color: color.muted, fontSize: 12.5 },
  railSide: { flex: 1, padding: 16, gap: 8 },
  phone: { flex: 1, maxWidth: 390, borderRightWidth: 1, borderRightColor: color.line },
  phoneBody: { flex: 1, padding: 16, gap: 8 },
  listFrame: { height: 620, flexDirection: "row" },
});
