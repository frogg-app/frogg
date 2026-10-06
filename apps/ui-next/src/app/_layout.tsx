import { loadWebFonts } from "../theme/web-fonts";
import { Slot, usePathname } from "expo-router";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "../components/shell/ErrorBoundary";
import { connect } from "../daemon/store";
loadWebFonts();

export default function RootLayout() {
  // The component lab runs on fixtures and must never dial a host.
  const lab = /^\/lab(\/|$)/.test(usePathname());
  useEffect(() => {
    if (!lab) void connect();
  }, [lab]);
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <Slot />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
