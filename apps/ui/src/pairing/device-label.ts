import { brand } from "@frogg/branding";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getDesktopHost } from "@/desktop/host";

const PLATFORM_NAMES: Record<string, string> = {
  ios: "iPhone",
  android: "Android",
  web: "browser",
  macos: "Mac",
  windows: "Windows",
};

/**
 * The label the daemon records for this device when it is claimed
 * (`principals.json`, shown by `frogg daemon claim-status`). Best effort: the
 * machine's device name (desktop: username or hostname), otherwise the app flavour.
 */
export function resolveDeviceLabel(input?: { deviceName?: string | null }): string {
  const desktop = getDesktopHost();
  if (desktop) {
    // The shell knows the machine's username/hostname; the browser runtime's
    // idea of a device name is just "Chrome".
    const name = (input?.deviceName ?? desktop.deviceName ?? "").trim();
    return name || `${brand.name} Desktop`;
  }
  const deviceName = (input?.deviceName ?? Constants.deviceName ?? "").trim();
  return deviceName || `${brand.name} (${PLATFORM_NAMES[Platform.OS] ?? Platform.OS})`;
}
