import { loadWebFonts } from "../theme/web-fonts";
import { syncShellTheme } from "../theme/stored";
import { color, scheme } from "../theme/tokens";
import { Slot, usePathname } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "../components/shell/ErrorBoundary";
import { hostsReady, useHosts } from "../daemon/hosts";
import { connect } from "../daemon/store";
import { popout } from "../popout";
import { startUsageStats } from "../usage-stats/store";
loadWebFonts();
syncShellTheme({ bg: color.bg, faint: color.faint, accent: color.cyan, symbols: color.muted });

/** A popped-out session window dials the host its session lives on (once hosts are loaded). */
function popoutHost() {
  if (!popout?.host) return undefined;
  return useHosts.getState().hosts.find((h) => h.id === popout?.host);
}

export default function RootLayout() {
  // The component lab runs on fixtures and must never dial a host.
  const lab = /^\/lab(\/|$)/.test(usePathname());
  useEffect(() => {
    if (!lab) void hostsReady.then(() => connect(popoutHost()));
    // A popped-out session window is the same app; only the main window counts as an open.
    if (!lab && !popout) startUsageStats();
  }, [lab]);
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={scheme === "light" ? "dark-content" : "light-content"}
        backgroundColor={color.bg}
      />
      <ErrorBoundary>
        <Slot />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
