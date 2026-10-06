import { create } from "zustand";

export type Tool =
  | "sessions" | "search" | "files" | "scm" | "prs" | "terminals" | "tasks"
  | "hosts" | "usage" | "plugins" | "inbox" | "companion" | "settings";

interface UiState {
  tool: Tool;
  selected: string | null;
  /** Tablet/phone: the session list is a drawer over the chat. */
  listOpen: boolean;
  setTool: (tool: Tool) => void;
  select: (id: string | null) => void;
  setListOpen: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  tool: "sessions",
  selected: null,
  listOpen: false,
  setTool: (tool) => set({ tool, listOpen: true }),
  select: (selected) => set({ selected, listOpen: false }),
  setListOpen: (listOpen) => set({ listOpen }),
}));
