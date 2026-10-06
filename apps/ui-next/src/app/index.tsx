import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chat } from "../components/Chat";
import { DiffView } from "../components/DiffView";
import { InboxDetail, InboxPanel } from "../components/Inbox";
import { SettingsNav, SettingsPage } from "../components/settings/Settings";
import { FilesPanel, FileViewer } from "../components/Files";
import { SearchPanel } from "../components/SearchPanel";
import { UsagePanel } from "../components/UsagePanel";
import { HostsPanel } from "../components/HostsPanel";
import { CiRunDetail, closeRun, PrsPanel, useOpenRun } from "../components/PrsPanel";
import { TasksPanel } from "../components/TasksPanel";
import { PluginsPanel } from "../components/PluginsPanel";
import { CompanionPanel } from "../components/CompanionPanel";
import { Home } from "../components/Home";
import { NewSession } from "../components/NewSession";
import { Palette, useGlobalKeys } from "../components/Palette";
import { PhoneTabs } from "../components/PhoneTabs";
import { Rail } from "../components/Rail";
import { ScmPanel } from "../components/ScmPanel";
import { SessionList, useBuckets } from "../components/SessionList";
import { StatusBar } from "../components/StatusBar";
import { TerminalSurface } from "../components/TerminalView";
import { TerminalsPanel } from "../components/TerminalsPanel";
import { ToolPane } from "../components/ToolPane";
import { T } from "../components/Text";
import { useDaemon } from "../daemon/store";
import type { Session } from "../daemon/types";
import { useFormFactor } from "../theme/layout";
import { color, motion } from "../theme/tokens";
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

interface DetailProps {
  ui: UiState;
  phone: boolean;
  openRun: string | null | undefined;
  session: Session | undefined;
}

/** What the main pane shows: a tool's own detail view when it has one open, else the session. */
function MainDetail({ ui, phone, openRun, session }: DetailProps): ReactNode {
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
    return <TerminalDetail id={terminalId} onBack={phone ? backTerminal : undefined} />;
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
  if (tool !== "sessions" && phone) return null;
  if (session) return <Chat session={session} onBack={phone ? backChat : undefined} />;
  return phone ? null : <Home />;
}

function hasDetailFor(
  ui: UiState,
  openRun: string | null | undefined,
  session: Session | undefined,
): boolean {
  const { tool } = ui;
  if (session) return true;
  if (tool === "scm") return !!ui.diffPath;
  if (tool === "terminals") return !!ui.terminalId;
  if (tool === "inbox") return !!ui.inboxId;
  if (tool === "settings") return !!ui.settingsPage;
  if (tool === "files") return !!ui.filePath;
  if (tool === "prs") return !!openRun;
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
  const closeList = useCallback(() => setListOpen(false), [setListOpen]);

  const detailEl = <MainDetail ui={ui} phone={phone} openRun={openRun} session={session} />;
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
      <SafeAreaView edges={EDGES_TOP} style={s.root}>
        <View style={s.fill}>{phoneHasDetail ? detailEl : side}</View>
        {!phoneHasDetail && <PhoneTabs badges={badges} />}
        <Palette />
        <NewSession />
      </SafeAreaView>
    );
  }

  const hasDetail = hasDetailFor(ui, openRun, session);
  return (
    <View style={s.root}>
      <View style={s.row}>
        <Rail badges={badges} />
        {docked ? (
          <>
            <View style={[s.side, ff === "tablet" && s.sideTablet]}>{side}</View>
            <View style={s.fill}>{detailEl}</View>
          </>
        ) : (
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
      <Palette />
      <NewSession />
    </View>
  );
}

/** Phone only: whether MainDetail renders a view (otherwise the tab panel shows). */
function hasPhoneDetail(
  ui: UiState,
  openRun: string | null | undefined,
  session: Session | undefined,
): boolean {
  return hasDetailFor(ui, openRun, ui.tool === "sessions" ? session : undefined);
}

const EDGES_TOP = ["top"] as const;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  side: {
    width: 340,
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
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: "row" },
  sideTablet: { width: 300 },
  terminal: { flex: 1, backgroundColor: color.bg },
  termBack: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  termBackText: { color: color.cyan2 },
});

function TerminalDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  return (
    <View style={s.terminal}>
      {onBack && (
        <Pressable onPress={onBack} style={s.termBack}>
          <T v="mono" style={s.termBackText}>
            ← terminals
          </T>
        </Pressable>
      )}
      <TerminalSurface terminalId={id} />
    </View>
  );
}
