import { create } from "zustand";
import { onHostSwitch } from "./daemon/store";
import { track, usageSlug } from "./usage-stats/store";

export type Tool =
  | "sessions"
  | "search"
  | "files"
  | "scm"
  | "prs"
  | "terminals"
  | "tasks"
  | "hosts"
  | "usage"
  | "plugins"
  | "inbox"
  | "companion"
  | "settings";

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
  /**
   * Sessions tool, with terminals listed among sessions: whether the main pane shows the open
   * chat or `terminalId`. Picking a session goes back to the chat.
   */
  sessionsPane: "chat" | "terminal";
  /** Opens a terminal from the Sessions list (terminals merged into it). */
  openSessionTerminal: (id: string | null) => void;
  /** Inbox: the session whose notification fills the main pane. */
  inboxId: string | null;
  openInbox: (id: string | null) => void;
  filePath: string | null;
  openFile: (path: string | null) => void;
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
  sessionsPane: "chat",
  openSessionTerminal: (terminalId) =>
    set({ terminalId, sessionsPane: terminalId ? "terminal" : "chat", listOpen: false }),
  inboxId: null,
  openInbox: (inboxId) => set({ inboxId, listOpen: false }),
  filePath: null,
  openFile: (filePath) => set({ filePath, listOpen: false }),
  settingsPage: null,
  openSettings: (settingsPage) => {
    if (settingsPage) track("settings_opened", { page: usageSlug(settingsPage) });
    set({ settingsPage, listOpen: false });
  },
  newSessionOpen: false,
  newSessionPrompt: "",
  setNewSession: (newSessionOpen, prompt) =>
    set(prompt === undefined ? { newSessionOpen } : { newSessionOpen, newSessionPrompt: prompt }),
  paletteOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setTool: (tool) => {
    track("panel_opened", { panel: tool });
    set({ tool, listOpen: true });
  },
  select: (selected) => set({ selected, listOpen: false, sessionsPane: "chat" }),
  setListOpen: (listOpen) => set({ listOpen }),
}));

// A different host has different sessions and files: drop everything that pointed into the old one.
onHostSwitch(() =>
  useUi.setState({
    selected: null,
    diffPath: null,
    terminalId: null,
    sessionsPane: "chat",
    inboxId: null,
    filePath: null,
    listOpen: false,
  }),
);

/** The terminal the Sessions tool shows in its main pane, when one is open there. */
export const sessionsTerminal = (ui: {
  tool: Tool;
  sessionsPane: UiState["sessionsPane"];
  terminalId: string | null;
}): string | null =>
  ui.tool === "sessions" && ui.sessionsPane === "terminal" ? ui.terminalId : null;
