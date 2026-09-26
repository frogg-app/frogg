import { useEffect } from "react";
import { getIsElectronRuntime, HEADER_INNER_HEIGHT } from "@/constants/layout";
import { getDesktopWindow, toggleDesktopMaximize } from "@/desktop/electron/window";
import { isNative } from "@/constants/platform";
import { useCustomDesktopWindowControls } from "@/utils/desktop-window";

/**
 * VS Code-style titlebar drag region for Electron.
 *
 * Copied from VS Code at commit daa0a70:
 *   - titlebarPart.ts:463-464  → prepend(container, $('div.titlebar-drag-region'))
 *   - titlebarpart.css:57-64   → position: absolute, full size, -webkit-app-region: drag
 *   - titlebarpart.css:249-260 → top-edge resizer, no-drag, 4px
 *
 * VS Code's drag region is a static DOM element — no z-index, no pointer-events,
 * no state, no event listeners. Interactive elements get no-drag from their own
 * CSS (global backstop in index.html). The drag region never re-renders.
 *
 * The resizer is Windows/Linux only (titlebarpart.css:249 scopes to .windows/.linux).
 * On macOS, Electron handles edge resize natively.
 */

export const titlebarDragSurfaceStyle: React.CSSProperties = {
  cursor: "default",
  userSelect: "none",
  // @ts-expect-error — WebkitAppRegion is not in CSSProperties
  WebkitAppRegion: "drag",
};

/**
 * Tauri ignores `-webkit-app-region`. The shell's own handler
 * (`apps/desktop/src/drag-region.ts`) walks up from the pressed element and starts a
 * window drag at the first ancestor carrying this attribute, unless it passes an
 * interactive element first (buttons, inputs, links, `role="button"`, ...). Spread it
 * onto plain DOM drag surfaces next to `titlebarDragSurfaceStyle`; use
 * `TITLEBAR_DRAG_SURFACE_DATASET` on React Native `View`s (`dataSet` becomes `data-*`).
 */
export const titlebarDragSurfaceProps = { "data-tauri-drag-region": "" } as const;

/** Same marker for RN `View`s: `<View dataSet={TITLEBAR_DRAG_SURFACE_DATASET} />`. */
export const TITLEBAR_DRAG_SURFACE_DATASET = { tauriDragRegion: "" } as const;

const DRAG_OVERLAY_STYLE: React.CSSProperties = {
  ...titlebarDragSurfaceStyle,
  top: 0,
  left: 0,
  display: "block",
  position: "absolute",
  width: "100%",
  height: "100%",
};

const TOP_RESIZER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  width: "100%",
  height: 4,
  // @ts-expect-error — WebkitAppRegion is not in CSSProperties
  WebkitAppRegion: "no-drag",
};

/**
 * Static drag overlay and top-edge resizer. Returns null on non-Electron.
 * Place as FIRST child of any positioned container that should be draggable.
 */
export function TitlebarDragRegion() {
  if (isNative || !getIsElectronRuntime()) {
    return null;
  }

  return (
    <>
      {/* Drag overlay — VS Code .titlebar-drag-region (titlebarpart.css:57-64) */}
      <div style={DRAG_OVERLAY_STYLE} {...titlebarDragSurfaceProps} />
      {/* Top-edge resizer — VS Code .resizer (titlebarpart.css:249-256) */}
      <div style={TOP_RESIZER_STYLE} />
    </>
  );
}

const WINDOW_DRAG_STRIP_STYLE: React.CSSProperties = {
  ...titlebarDragSurfaceStyle,
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  height: HEADER_INNER_HEIGHT,
};

const WINDOW_TOP_RESIZER_STYLE: React.CSSProperties = { ...TOP_RESIZER_STYLE, position: "fixed" };

/**
 * Window-wide title bar strip for custom chrome (Windows/Linux). Chromium only recomputes
 * `-webkit-app-region` rects when a drag element itself re-lays out, so the per-header
 * overlays go stale when sidebars animate or resize (transforms move them without a
 * layout), leaving only fragments of the top bar draggable. This strip never moves, so
 * its rect stays valid. Render it BEFORE the app content: later no-drag elements (the
 * index.html backstop on buttons, inputs, tabs, ...) punch their holes through it.
 */
export function WindowTitlebarDragStrip() {
  const { visible } = useCustomDesktopWindowControls();
  useEffect(() => {
    if (isNative || !visible) return;
    return installManualDragFallback();
  }, [visible]);
  if (isNative || !visible) {
    return null;
  }

  return (
    <>
      <div style={WINDOW_DRAG_STRIP_STYLE} {...titlebarDragSurfaceProps} />
      <div style={WINDOW_TOP_RESIZER_STYLE} />
    </>
  );
}

function isWindowDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // app-region inherits, so a header's text and icons report "drag" and controls under the
  // index.html backstop report "no-drag".
  const style = getComputedStyle(target) as CSSStyleDeclaration & {
    appRegion?: string;
    webkitAppRegion?: string;
  };
  return (style.appRegion || style.webkitAppRegion) === "drag";
}

/**
 * When the OS honours a drag region it swallows the press, so the page never sees it. A
 * mousedown that does reach a drag surface means the native move failed (Windows can drop
 * regions entirely), so move the window from the main process instead.
 */
function installManualDragFallback(): () => void {
  let dragging = false;
  const end = () => {
    if (!dragging) return;
    dragging = false;
    void getDesktopWindow()?.endDrag?.();
  };
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !isWindowDragTarget(event.target)) return;
    event.preventDefault();
    if (event.detail === 2) {
      end();
      void toggleDesktopMaximize();
      return;
    }
    const win = getDesktopWindow();
    if (typeof win?.startDrag !== "function") return;
    dragging = true;
    void win.startDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      viewportWidth: window.innerWidth,
    });
  };
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mouseup", end, true);
  window.addEventListener("blur", end);
  return () => {
    end();
    window.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("mouseup", end, true);
    window.removeEventListener("blur", end);
  };
}
