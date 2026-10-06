import "../theme/web-fonts";
import { Slot } from "expo-router";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { connect } from "../daemon/store";

export default function RootLayout() {
  useEffect(() => {
    void connect();
  }, []);
  return (
    <SafeAreaProvider>
      <Slot />
    </SafeAreaProvider>
  );
}
