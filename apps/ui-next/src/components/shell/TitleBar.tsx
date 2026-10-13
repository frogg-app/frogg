import { StyleSheet, View } from "react-native";
import { color, web } from "../../theme/tokens";
import { T } from "../Text";

export type WindowChrome = "windows" | "linux" | "mac";

/** Matches `TITLE_BAR_HEIGHT` in desktop/window-chrome.cjs (the native controls' overlay). */
const HEIGHT = 32;
const KEY = "frogg.next.chrome";

/**
 * The desktop shell passes `?chrome=windows|linux|mac` when it draws the window frameless. Read
 * once and kept for the tab, because in-app navigation drops the query. Also works in a plain
 * browser (`?chrome=windows`) to check the layout without Electron; the controls don't draw there.
 */
function readChrome(): WindowChrome | null {
  if (typeof location === "undefined") return null;
  const store = typeof sessionStorage === "undefined" ? null : sessionStorage;
  const asked = new URLSearchParams(location.search).get("chrome");
  if (asked === "windows" || asked === "linux" || asked === "mac") {
    store?.setItem(KEY, asked);
    return asked;
  }
  const kept = store?.getItem(KEY);
  return kept === "windows" || kept === "linux" || kept === "mac" ? kept : null;
}

export const windowChrome: WindowChrome | null = readChrome();

/**
 * The frameless window's title strip: a drag region the width of the window. Windows and Linux
 * overlay their native minimise/maximise/close (with snap layouts) on its right end; macOS insets
 * its traffic lights on the left. Renders nothing outside the desktop shell.
 */
export function TitleBar() {
  if (!windowChrome) return null;
  return (
    <View style={[s.bar, windowChrome === "mac" ? s.mac : s.controlsRight]} testID="title-bar">
      <T v="label" style={s.title} numberOfLines={1}>
        Frogg Next
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    height: HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    ...web({ WebkitAppRegion: "drag", userSelect: "none" }),
  },
  // Three 46px caption buttons on Windows; the Linux overlay is narrower, so this covers both.
  controlsRight: { paddingLeft: 14, paddingRight: 138 },
  mac: { paddingLeft: 80, paddingRight: 14 },
  title: { color: color.faint, fontSize: 10 },
});
