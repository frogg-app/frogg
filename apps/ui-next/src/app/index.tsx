import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chat } from "../components/Chat";
import { Home } from "../components/Home";
import { PhoneTabs } from "../components/PhoneTabs";
import { Rail } from "../components/Rail";
import { SessionList, useBuckets } from "../components/SessionList";
import { StatusBar } from "../components/StatusBar";
import { ToolPane } from "../components/ToolPane";
import { useDaemon } from "../daemon/store";
import { useFormFactor } from "../theme/layout";
import { color } from "../theme/tokens";
import { useUi, type Tool } from "../ui-store";

export default function Shell() {
  const ff = useFormFactor();
  const docked = useWindowDimensions().width >= 900;
  const { tool, selected, listOpen, select, setListOpen } = useUi();
  const session = useDaemon((s) => (selected ? s.sessions[selected] : undefined));
  const b = useBuckets();
  const badges: Partial<Record<Tool, number>> = { sessions: b.needs.length || undefined, inbox: b.needs.length + b.failed.length || undefined };

  const side = tool === "sessions" ? <SessionList /> : <ToolPane tool={tool} />;
  const main = session ? <Chat session={session} onBack={ff === "phone" ? () => select(null) : undefined} /> : <Home />;

  if (ff === "phone") {
    // Phone: the list is the root of the Sessions tab; a chat pushes over it.
    const body = tool !== "sessions" ? side : session ? main : <SessionList />;
    return (
      <SafeAreaView edges={["top"]} style={s.root}>
        <View style={{ flex: 1 }}>{body}</View>
        {!(tool === "sessions" && session) && <PhoneTabs badges={badges} />}
      </SafeAreaView>
    );
  }

  return (
    <View style={s.root}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <Rail badges={badges} />
        {docked ? (
          <>
            <View style={[s.side, ff === "tablet" && { width: 300 }]}>{side}</View>
            <View style={{ flex: 1 }}>{main}</View>
          </>
        ) : (
          // Portrait tablet: the side panel slides over the main pane; picking a session closes it.
          <View style={{ flex: 1 }}>
            {main}
            {(listOpen || !session) && (
              <>
                {session && <Pressable style={s.scrim} onPress={() => setListOpen(false)} />}
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
