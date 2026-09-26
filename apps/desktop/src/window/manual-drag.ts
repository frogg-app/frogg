import { screen, type BrowserWindow } from "electron";

const POLL_MS = 8;
const RESTORE_THRESHOLD_PX = 4;
// A drag the renderer never ends (lost mouseup) must not pin the window to the cursor.
const MAX_DRAG_MS = 60_000;

export interface ManualDragStart {
  /** Pointer position inside the window's client area, in CSS px. */
  clientX: number;
  clientY: number;
  /** Client-area width in CSS px, to keep the grab point proportional when restoring. */
  viewportWidth: number;
}

export function readManualDragStart(input: unknown): ManualDragStart | null {
  if (!input || typeof input !== "object") return null;
  const { clientX, clientY, viewportWidth } = input as Record<string, unknown>;
  if (
    ![clientX, clientY, viewportWidth].every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    return null;
  }
  if ((viewportWidth as number) <= 0) return null;
  return {
    clientX: clientX as number,
    clientY: clientY as number,
    viewportWidth: viewportWidth as number,
  };
}

const activeDrags = new WeakMap<BrowserWindow, () => void>();

/**
 * Moves a frameless window with the cursor. Fallback for when the OS never turned a press on an
 * `app-region: drag` surface into a native move (seen on Windows), in which case the renderer
 * receives the mousedown and asks for this instead. Loses Aero Snap, keeps the window usable.
 */
export function startManualWindowDrag(win: BrowserWindow, start: ManualDragStart): void {
  stopManualWindowDrag(win);
  const zoom = win.webContents.getZoomFactor();
  const origin = screen.getCursorScreenPoint();
  let offsetX = start.clientX * zoom;
  const offsetY = start.clientY * zoom;
  let size = win.getBounds();
  let restorePending = win.isMaximized();
  const startedAt = Date.now();

  const timer = setInterval(() => {
    if (win.isDestroyed() || Date.now() - startedAt > MAX_DRAG_MS) {
      stopManualWindowDrag(win);
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    if (restorePending) {
      if (
        Math.abs(cursor.x - origin.x) < RESTORE_THRESHOLD_PX &&
        Math.abs(cursor.y - origin.y) < RESTORE_THRESHOLD_PX
      ) {
        return;
      }
      restorePending = false;
      win.unmaximize();
      size = win.getBounds();
      offsetX = Math.round((start.clientX / start.viewportWidth) * size.width);
    }
    // setBounds with the captured size: setPosition alone drifts the size across mixed-DPI monitors.
    win.setBounds({
      x: Math.round(cursor.x - offsetX),
      y: Math.round(cursor.y - offsetY),
      width: size.width,
      height: size.height,
    });
  }, POLL_MS);

  activeDrags.set(win, () => clearInterval(timer));
}

export function stopManualWindowDrag(win: BrowserWindow): void {
  activeDrags.get(win)?.();
  activeDrags.delete(win);
}
