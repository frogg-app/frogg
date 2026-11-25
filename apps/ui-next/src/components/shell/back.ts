import { closeDetail, useSubWorkStore } from "../../daemon/subwork";
import { sessionsTerminal, useUi } from "../../ui-store";
import { openCiRun } from "../ci/model";

/**
 * Back, innermost first: palette, the new-session overlay (tablet; phone uses a Modal that
 * handles back itself), a tool's pushed detail, a sub-work item's details over its parent's chat,
 * the open session, the portrait drawer, then the non-session tab. Null at the root. Shared by
 * Android hardware back and the phone's edge swipe.
 */
export function backAction(
  phone: boolean,
  openRun: string | null | undefined,
): (() => void) | null {
  const ui = useUi.getState();
  const { tool, selected } = ui;
  if (ui.paletteOpen) return () => ui.setPalette(false);
  if (ui.newSessionOpen) return () => ui.setNewSession(false);
  if (tool === "scm" && ui.diffPath) return () => ui.openDiff(null);
  if (tool === "terminals" && ui.terminalId) return () => ui.openTerminal(null);
  if (sessionsTerminal(ui)) return () => ui.openSessionTerminal(null);
  if (tool === "prs" && openRun) return () => openCiRun(null);
  if (tool === "files" && ui.filePath) return () => ui.openFile(null);
  if (tool === "settings" && ui.settingsPage && phone) return () => ui.openSettings(null);
  if (tool === "inbox" && ui.inboxId) return () => ui.openInbox(null);
  if (!phone && ui.listOpen && selected) return () => ui.setListOpen(false);
  if (tool === "sessions" && selected && useSubWorkStore.getState().detail[selected])
    return () => closeDetail(selected);
  if (tool === "sessions" && selected) return () => ui.select(null);
  if (tool !== "sessions") return () => ui.setTool("sessions");
  return null;
}

/** Runs one step of back; false at the root (Android then leaves the app). */
export function popBack(phone: boolean, openRun: string | null | undefined): boolean {
  const pop = backAction(phone, openRun);
  pop?.();
  return !!pop;
}
