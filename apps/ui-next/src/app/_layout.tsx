import { loadWebFonts } from "../theme/web-fonts";
import { Slot } from "expo-router";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "../components/shell/ErrorBoundary";
import { connect } from "../daemon/store";
loadWebFonts();

export default function RootLayout() {
  useEffect(() => {
    void connect();
  }, []);
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <Slot />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
