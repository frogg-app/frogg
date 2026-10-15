import { KeyboardFrame } from "../components/shell/KeyboardFrame";
import { ToastHost } from "../components/toast/ToastHost";
import { HostToasts } from "../components/toast/HostToasts";
import { TitleBar } from "../components/shell/TitleBar";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chat } from "../components/Chat";
import { DiffView } from "../components/DiffView";
import { InboxDetail, InboxPanel } from "../components/Inbox";
import { SettingsNav, SettingsPage } from "../components/settings/Settings";
import { FilesPanel, FileViewer } from "../components/Files";
import { SearchPanel } from "../components/SearchPanel";
import { UsagePanel } from "../components/UsagePanel";
import { HostsPanel } from "../components/HostsPanel";
import { HostDetail } from "../components/hosts/HostDetail";
import { CiRunDetail, closeRun, PrsPanel, useOpenRun } from "../components/PrsPanel";
import { TasksPanel } from "../components/TasksPanel";
import { TodoBoard } from "../components/tasks/TodoBoard";
import { PluginsPanel } from "../components/PluginsPanel";
import { CompanionPanel } from "../components/CompanionPanel";
import { Home } from "../components/Home";
import { NewSession } from "../components/NewSession";
import { Onboarding } from "../components/onboarding/Onboarding";
import { Palette, useGlobalKeys } from "../components/Palette";
import { PhoneTabs } from "../components/PhoneTabs";
import { Rail, useToolShown } from "../components/Rail";
import { ScmPanel } from "../components/ScmPanel";
import { SessionList, useBuckets } from "../components/SessionList";
import { StatusBar } from "../components/StatusBar";
import { TerminalDetail, TerminalsPanel } from "../components/TerminalsPanel";
import { ToolPane } from "../components/ToolPane";
import { ToolEmpty } from "../components/shell/ToolEmpty";
import { useHardwareBack } from "../components/shell/useHardwareBack";
import { useKeyboardVisible } from "../components/shell/useKeyboardVisible";
import { useDaemon } from "../daemon/store";
import { useWatchPluginGate } from "../daemon/plugins";
import type { Session } from "../daemon/types";
import { useFormFactor } from "../theme/layout";
import { usePrefs } from "../prefs";
import { color, ease, motion, web } from "../theme/tokens";
import { useUi, type Tool } from "../ui-store";

function sidePanel(tool: Tool): ReactNode {
  switch (tool) {
    case "sessions":
      return <SessionList />;
    case "scm":
      return <ScmPanel />;
    case "terminals":
      return <TerminalsPanel />;
    case "inbox":
      return <InboxPanel />;
    case "settings":
      return <SettingsNav />;
    case "files":
      return <FilesPanel />;
    case "search":
      return <SearchPanel />;
    case "usage":
      return <UsagePanel />;
    case "hosts":
      return <HostsPanel />;
    case "prs":
      return <PrsPanel />;
    case "tasks":
      return <TasksPanel />;
    case "plugins":
      return <PluginsPanel />;
    case "companion":
      return <CompanionPanel />;
    default:
      return <ToolPane tool={tool} />;
  }
}

type UiState = ReturnType<typeof useUi.getState>;

/** Tools whose main pane falls back to the open session's chat. */
const CHAT_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["sessions", "search"]);
/** Tools with no detail view of their own: on wide layouts the panel takes the full width. */
const FULL_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["usage", "plugins", "companion"]);

interface DetailProps {
  ui: UiState;
  phone: boolean;
  docked: boolean;
  openRun: string | null | undefined;
  session: Session | undefined;
}

/** What the main pane shows: a tool's own detail view when it has one open, else the session. */
function MainDetail({ ui, phone, docked, openRun, session }: DetailProps): ReactNode {
  const {
    tool,
    diffPath,
    terminalId,
    inboxId,
    settingsPage,
    filePath,
    select,
    openDiff,
    openTerminal,
    openInbox,
    openSettings,
    openFile,
  } = ui;
  const backDiff = useCallback(() => openDiff(null), [openDiff]);
  const backTerminal = useCallback(() => openTerminal(null), [openTerminal]);
  const backFile = useCallback(() => openFile(null), [openFile]);
  const backSettings = useCallback(() => openSettings(null), [openSettings]);
  const backInbox = useCallback(() => openInbox(null), [openInbox]);
  const backChat = useCallback(() => select(null), [select]);
  if (tool === "scm" && diffPath)
    return <DiffView path={diffPath} onBack={phone ? backDiff : undefined} />;
  if (tool === "terminals" && terminalId)
    return (
      <TerminalDetail id={terminalId} docked={docked} onBack={phone ? backTerminal : undefined} />
    );
  if (tool === "prs" && openRun)
    return <CiRunDetail id={openRun} onBack={phone ? closeRun : undefined} />;
  if (tool === "files" && filePath)
    return <FileViewer path={filePath} onBack={phone ? backFile : undefined} />;
  if (tool === "settings" && (settingsPage || !phone))
    return (
      <SettingsPage id={settingsPage ?? "appearance"} onBack={phone ? backSettings : undefined} />
    );
  if (tool === "inbox" && inboxId)
    return <InboxDetail id={inboxId} onBack={phone ? backInbox : undefined} />;
  if (tool === "hosts" && !phone) return <HostDetail />;
  if (tool === "tasks" && !phone) return <TodoBoard />;
  return fallbackDetail(tool, phone, session, backChat);
}

/** Nothing of the tool's own is open: the session's chat (chat tools only), else an empty pane. */
function fallbackDetail(
  tool: Tool,
  phone: boolean,
  session: Session | undefined,
  backChat: () => void,
): ReactNode {
  if (tool !== "sessions" && phone) return null;
  if (!CHAT_TOOLS.has(tool)) return <ToolEmpty tool={tool} />;
  if (session) return <Chat session={session} onBack={phone ? backChat : undefined} />;
  return phone ? null : <Home />;
}

function hasDetailFor(
  ui: UiState,
  openRun: string | null | undefined,
  session: Session | undefined,
): boolean {
  const { tool } = ui;
  if (session && CHAT_TOOLS.has(tool)) return true;
  if (tool === "scm") return !!ui.diffPath;
  if (tool === "terminals") return !!ui.terminalId;
  if (tool === "inbox") return !!ui.inboxId;
  if (tool === "settings") return !!ui.settingsPage;
  if (tool === "files") return !!ui.filePath;
  if (tool === "prs") return !!openRun;
  if (tool === "tasks") return true;
  return false;
}

export default function Shell() {
  const ff = useFormFactor();
  const docked = useWindowDimensions().width >= 900;
  const ui = useUi();
  const { tool, selected, listOpen, setListOpen } = ui;
  const openRun = useOpenRun();
  const session = useDaemon((st) => (selected ? st.sessions[selected] : undefined));
  const b = useBuckets();
  const needs = b.needs.length;
  const failed = b.failed.length;
  const badges = useMemo<Partial<Record<Tool, number>>>(
    () => ({
      sessions: needs || undefined,
      inbox: needs + failed || undefined,
    }),
    [needs, failed],
  );
  const phone = ff === "phone";
  useGlobalKeys();
  useWatchPluginGate();
  // A tool the host stops offering (the Companion plugin removed) falls back to Sessions.
  const shown = useToolShown();
  useEffect(() => {
    if (!shown(tool)) useUi.getState().setTool("sessions");
  }, [shown, tool]);
  const closeList = useCallback(() => setListOpen(false), [setListOpen]);
  const onHardwareBack = useCallback(() => popBack(phone, openRun), [phone, openRun]);
  useHardwareBack(onHardwareBack);
  const keyboard = useKeyboardVisible();
  const { crash } = useLocalSearchParams<{ crash?: string }>();

  const detailEl = (
    <MainDetail ui={ui} phone={phone} docked={docked} openRun={openRun} session={session} />
  );
  // Terminals: the list beside an open terminal can be collapsed; the rail stays.
  const termListHidden = usePrefs((p) => p.terminalListHidden);
  const sideHidden = tool === "terminals" && !!ui.terminalId && termListHidden;
  const phoneHasDetail = phone && hasPhoneDetail(ui, openRun, session);
  // Keyed so switching tools replays a short enter; frequent, so it stays under 200ms.
  const side = (
    <View key={tool} style={[s.fill, motion.enter]}>
      {sidePanel(tool)}
    </View>
  );

  if (phone) {
    // Phone: each tab's panel is the root; a detail view pushes over it and hides the tabs.
    return (
      // Tabs pad themselves for the bottom inset; a pushed view (or the keyboard) takes it here.
      <SafeAreaView
        edges={phoneHasDetail && !keyboard ? EDGES_ALL : EDGES_NO_BOTTOM}
        style={s.root}
      >
        <KeyboardFrame style={s.fill}>
          {crash !== undefined && <Crash />}
          <HostToasts />
          <View style={s.fill}>{phoneHasDetail ? detailEl : side}</View>
          {!phoneHasDetail && !keyboard && <PhoneTabs badges={badges} />}
        </KeyboardFrame>
        <Palette />
        <NewSession />
        <ToastHost />
        <Onboarding phone chipBottom={phoneHasDetail ? 16 : 76} />
      </SafeAreaView>
    );
  }

  const hasDetail = hasDetailFor(ui, openRun, session);
  return (
    <SafeAreaView edges={keyboard ? EDGES_NO_BOTTOM : EDGES_ALL} style={s.root}>
      <TitleBar />
      <KeyboardFrame style={s.fill}>
        {crash !== undefined && <Crash />}
        <HostToasts />
        <View style={s.row}>
          <Rail badges={badges} />
          {FULL_TOOLS.has(tool) && <View style={[s.fill, s.full]}>{side}</View>}
          {!FULL_TOOLS.has(tool) && docked && (
            <>
              <View
                style={[s.side, ff === "tablet" && s.sideTablet, sideHidden && s.sideHidden]}
                aria-hidden={sideHidden}
              >
                {/* Fixed width inside, so collapsing clips the panel instead of reflowing it. */}
                <View style={[s.sideIn, ff === "tablet" && s.sideInTablet]}>{side}</View>
              </View>
              <View style={s.fill}>{detailEl}</View>
            </>
          )}
          {!FULL_TOOLS.has(tool) && !docked && (
            // Portrait tablet: the side panel slides over the main pane; picking an item closes it.
            <View style={s.fill}>
              {detailEl}
              {(listOpen || !hasDetail) && (
                <>
                  {hasDetail && <Pressable style={s.scrim} onPress={closeList} />}
                  <View style={[s.side, s.drawer]}>{side}</View>
                </>
              )}
            </View>
          )}
        </View>
        <StatusBar />
      </KeyboardFrame>
      <Palette />
      <NewSession />
      <ToastHost />
      <Onboarding phone={false} chipBottom={40} chipLeft={224} />
    </SafeAreaView>
  );
}

/** Dev hook: `/?crash` throws during render so the root error boundary can be checked. */
function Crash(): ReactNode {
  throw new TypeError("Simulated crash from /?crash");
}

/**
 * Android back, innermost first: palette, the new-session overlay (tablet; phone uses a Modal
 * that handles back itself), a tool's pushed detail, the open session, the portrait drawer,
 * then the non-session tab. Returns false at the root so Android leaves the app.
 */
function popBack(phone: boolean, openRun: string | null | undefined): boolean {
  const pop = backAction(phone, openRun);
  pop?.();
  return !!pop;
}

function backAction(phone: boolean, openRun: string | null | undefined): (() => void) | null {
  const ui = useUi.getState();
  const { tool } = ui;
  if (ui.paletteOpen) return () => ui.setPalette(false);
  if (ui.newSessionOpen) return () => ui.setNewSession(false);
  if (tool === "scm" && ui.diffPath) return () => ui.openDiff(null);
  if (tool === "terminals" && ui.terminalId) return () => ui.openTerminal(null);
  if (tool === "prs" && openRun) return closeRun;
  if (tool === "files" && ui.filePath) return () => ui.openFile(null);
  if (tool === "settings" && ui.settingsPage && phone) return () => ui.openSettings(null);
  if (tool === "inbox" && ui.inboxId) return () => ui.openInbox(null);
  if (!phone && ui.listOpen && ui.selected) return () => ui.setListOpen(false);
  if (tool === "sessions" && ui.selected) return () => ui.select(null);
  if (tool !== "sessions") return () => ui.setTool("sessions");
  return null;
}

/** Phone only: whether MainDetail renders a view (otherwise the tab panel shows). */
function hasPhoneDetail(
  ui: UiState,
  openRun: string | null | undefined,
  session: Session | undefined,
): boolean {
  // Tasks keeps its board inside the tab on phones.
  if (ui.tool === "tasks") return false;
  return hasDetailFor(ui, openRun, ui.tool === "sessions" ? session : undefined);
}

const EDGES_ALL = ["top", "bottom", "left", "right"] as const;
const EDGES_NO_BOTTOM = ["top", "left", "right"] as const;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  side: {
    width: 340,
    overflow: "hidden",
    ...web({ transition: `width 200ms ${ease}` }),
    borderRightWidth: 1,
    borderRightColor: color.line,
    backgroundColor: color.bg2,
  },
  drawer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 24,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.scrim,
  },
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: "row" },
  sideTablet: { width: 300 },
  sideHidden: { width: 0, borderRightWidth: 0 },
  sideIn: { flex: 1, width: 339 },
  sideInTablet: { width: 299 },
  full: { backgroundColor: color.bg2 },
});
