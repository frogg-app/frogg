import { loadWebFonts } from "../theme/web-fonts";
import { Slot, usePathname } from "expo-router";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "../components/shell/ErrorBoundary";
import { hostsReady, useHosts } from "../daemon/hosts";
import { connect } from "../daemon/store";
import { popout } from "../popout";
loadWebFonts();

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
  }, [lab]);
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <Slot />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
