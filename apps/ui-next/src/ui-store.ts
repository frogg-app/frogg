import { create } from "zustand";

export type Tool =
  | "sessions" | "search" | "files" | "scm" | "prs" | "terminals" | "tasks"
  | "hosts" | "usage" | "plugins" | "inbox" | "companion" | "settings";

interface UiState {
  tool: Tool;
  selected: string | null;
  /** Tablet/phone: the session list is a drawer over the chat. */
  listOpen: boolean;
  /** Source control: the file whose diff fills the main pane. */
  diffPath: string | null;
  openDiff: (path: string | null) => void;
  /** Terminals: the one filling the main pane. */
  terminalId: string | null;
  openTerminal: (id: string | null) => void;
  /** Inbox: the session whose notification fills the main pane. */
  inboxId: string | null;
  openInbox: (id: string | null) => void;
  settingsPage: string | null;
  openSettings: (id: string | null) => void;
  newSessionOpen: boolean;
  newSessionPrompt: string;
  setNewSession: (open: boolean, prompt?: string) => void;
  paletteOpen: boolean;
  setPalette: (open: boolean) => void;
  setTool: (tool: Tool) => void;
  select: (id: string | null) => void;
  setListOpen: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  tool: "sessions",
  selected: null,
  listOpen: false,
  diffPath: null,
  openDiff: (diffPath) => set({ diffPath, listOpen: false }),
  terminalId: null,
  openTerminal: (terminalId) => set({ terminalId, listOpen: false }),
  inboxId: null,
  openInbox: (inboxId) => set({ inboxId, listOpen: false }),
  settingsPage: null,
  openSettings: (settingsPage) => set({ settingsPage, listOpen: false }),
  newSessionOpen: false,
  newSessionPrompt: "",
  setNewSession: (newSessionOpen, prompt) => set(prompt === undefined ? { newSessionOpen } : { newSessionOpen, newSessionPrompt: prompt }),
  paletteOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setTool: (tool) => set({ tool, listOpen: true }),
  select: (selected) => set({ selected, listOpen: false }),
  setListOpen: (listOpen) => set({ listOpen }),
}));
