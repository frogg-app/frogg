import { create } from "zustand";
import { useUi, type Tool } from "../../ui-store";
import { openSheet, viewHost, type HostSheet } from "../hosts/state";
import type { StepId } from "./model";
import { minimiseOnboarding } from "./store";

/**
 * The step the user left the walkthrough to do in the app. Not persisted: after a restart the
 * resume chip still shows, it just doesn't reopen by itself.
 */
export const useAway = create<{ step: StepId | null }>(() => ({ step: null }));

/** Leave the walkthrough (it stays resumable) to do `step` in the app. */
export function away(step: StepId, run: () => void): void {
  minimiseOnboarding();
  useAway.setState({ step });
  run();
}

/** The Hosts tool with one of its dialogs open: the same pairing UI the app uses everywhere. */
export function openHostSheet(sheet: Exclude<HostSheet, null>): void {
  useUi.getState().setTool("hosts");
  viewHost(null, true);
  openSheet(sheet);
}

export function openSettingsPage(page: string): void {
  useUi.getState().setTool("settings");
  useUi.getState().openSettings(page);
}

export function openTool(tool: Tool): void {
  useUi.getState().setTool(tool);
}
