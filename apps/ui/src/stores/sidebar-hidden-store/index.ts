import AsyncStorage from "@/storage/brand-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  mergePersistedSidebarHidden,
  PersistedSidebarHiddenSchema,
  serializeSidebarHidden,
  toggleProjectHidden,
  toggleWorkspaceHidden,
  type PersistedSidebarHidden,
  type SidebarHiddenState,
} from "./state";

export { countHidden, filterHiddenProjects, type SidebarHiddenState } from "./state";

interface SidebarHiddenStore extends SidebarHiddenState {
  toggleProjectHidden: (viewKey: string) => void;
  toggleWorkspaceHidden: (workspaceKey: string) => void;
  setShowHidden: (showHidden: boolean) => void;
}

export const useSidebarHiddenStore = create<SidebarHiddenStore>()(
  persist<SidebarHiddenStore, [], [], PersistedSidebarHidden>(
    (set) => ({
      hiddenProjectKeys: new Set(),
      hiddenWorkspaceKeys: new Set(),
      showHidden: false,
      toggleProjectHidden: (viewKey) => set((state) => toggleProjectHidden(state, viewKey)),
      toggleWorkspaceHidden: (workspaceKey) =>
        set((state) => toggleWorkspaceHidden(state, workspaceKey)),
      setShowHidden: (showHidden) => set({ showHidden }),
    }),
    {
      name: "sidebar-hidden",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSidebarHiddenSchema),
      partialize: (state) => serializeSidebarHidden(state),
      merge: (persisted, current) => mergePersistedSidebarHidden(persisted, current),
    },
  ),
);
