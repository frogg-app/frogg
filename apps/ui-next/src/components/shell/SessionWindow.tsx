import { AppWindow } from "lucide-react-native";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDaemon } from "../../daemon/store";
import type { PopoutRoute } from "../../popout";
import { color, motion } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { Chat } from "../Chat";
import { useGlobalKeys } from "../Palette";
import { T } from "../Text";
import { HostToasts } from "../toast/HostToasts";
import { ToastHost } from "../toast/ToastHost";
import { KeyboardFrame } from "./KeyboardFrame";
import { TitleBar } from "./TitleBar";

/**
 * A session popped out into its own desktop window: the title strip, that session's chat and
 * toasts, nothing else. It runs its own connection to the same saved host, so the main window
 * and this one stay in step through the daemon.
 */
export function SessionWindow({ route }: { route: PopoutRoute }) {
  const session = useDaemon((st) => st.sessions[route.session]);
  const conn = useDaemon((st) => st.conn);
  const loaded = useDaemon((st) => Object.keys(st.sessions).length > 0);
  useGlobalKeys();
  useEffect(() => {
    useUi.getState().select(route.session);
  }, [route.session]);
  const title = session?.agent.title;
  useEffect(() => {
    if (typeof document !== "undefined") document.title = title || "Untitled session";
  }, [title]);

  const gone = conn === "online" && loaded;
  const body = session ? (
    <Chat session={session} />
  ) : (
    <View style={[s.empty, motion.enter]}>
      <AppWindow size={22} color={color.faint} strokeWidth={1.4} />
      <T v="label">{gone ? "Session not found" : "Opening session"}</T>
      <T style={s.hint}>{waitingHint(gone, conn)}</T>
    </View>
  );
  return (
    <SafeAreaView style={s.root}>
      <TitleBar />
      <KeyboardFrame style={s.fill}>
        <HostToasts />
        <View style={s.fill}>{body}</View>
      </KeyboardFrame>
      <ToastHost />
    </SafeAreaView>
  );
}

function waitingHint(gone: boolean, conn: string): string {
  if (gone) return "It was archived or lives on another host. Close this window.";
  if (conn === "offline") return "Waiting for the host to come back.";
  return "Connecting to the host…";
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  fill: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  hint: { color: color.faint, fontSize: 12.5 },
});
