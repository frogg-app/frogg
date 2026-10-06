import type { ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chat } from "../components/Chat";
import { DiffView } from "../components/DiffView";
import { Home } from "../components/Home";
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
import { useFormFactor } from "../theme/layout";
import { color } from "../theme/tokens";
import { useUi, type Tool } from "../ui-store";

function sidePanel(tool: Tool): ReactNode {
  switch (tool) {
    case "sessions": return <SessionList />;
    case "scm": return <ScmPanel />;
    case "terminals": return <TerminalsPanel />;
    default: return <ToolPane tool={tool} />;
  }
}

export default function Shell() {
  const ff = useFormFactor();
  const docked = useWindowDimensions().width >= 900;
  const { tool, selected, listOpen, diffPath, terminalId, select, setListOpen, openDiff, openTerminal } = useUi();
  const session = useDaemon((s) => (selected ? s.sessions[selected] : undefined));
  const b = useBuckets();
  const badges: Partial<Record<Tool, number>> = {
    sessions: b.needs.length || undefined,
    inbox: b.needs.length + b.failed.length || undefined,
  };
  const phone = ff === "phone";

  // What the main pane shows: a tool's own detail view when it has one open, else the session.
  const detail: ReactNode =
    tool === "scm" && diffPath ? (
      <DiffView path={diffPath} onBack={phone ? () => openDiff(null) : undefined} />
    ) : tool === "terminals" && terminalId ? (
      <TerminalDetail id={terminalId} onBack={phone ? () => openTerminal(null) : undefined} />
    ) : tool === "sessions" || !phone ? (
      session ? <Chat session={session} onBack={phone ? () => select(null) : undefined} /> : phone ? null : <Home />
    ) : null;
  const side = sidePanel(tool);

  if (phone) {
    // Phone: each tab's panel is the root; a detail view pushes over it and hides the tabs.
    return (
      <SafeAreaView edges={["top"]} style={s.root}>
        <View style={{ flex: 1 }}>{detail ?? side}</View>
        {!detail && <PhoneTabs badges={badges} />}
      </SafeAreaView>
    );
  }

  const hasDetail = !!(session || (tool === "scm" && diffPath) || (tool === "terminals" && terminalId));
  return (
    <View style={s.root}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <Rail badges={badges} />
        {docked ? (
          <>
            <View style={[s.side, ff === "tablet" && { width: 300 }]}>{side}</View>
            <View style={{ flex: 1 }}>{detail}</View>
          </>
        ) : (
          // Portrait tablet: the side panel slides over the main pane; picking an item closes it.
          <View style={{ flex: 1 }}>
            {detail}
            {(listOpen || !hasDetail) && (
              <>
                {hasDetail && <Pressable style={s.scrim} onPress={() => setListOpen(false)} />}
                <View style={[s.side, s.drawer]}>{side}</View>
              </>
            )}
          </View>
        )}
      </View>
      <StatusBar />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  side: { width: 340, borderRightWidth: 1, borderRightColor: color.line, backgroundColor: color.bg2 },
  drawer: { position: "absolute", left: 0, top: 0, bottom: 0, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 24 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
});

function TerminalDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      {onBack && (
        <Pressable onPress={onBack} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: color.line }}>
          <T v="mono" style={{ color: color.cyan2 }}>← terminals</T>
        </Pressable>
      )}
      <TerminalSurface terminalId={id} />
    </View>
  );
}
