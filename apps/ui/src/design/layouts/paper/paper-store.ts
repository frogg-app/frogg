import AsyncStorage from "@/storage/brand-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface PaperSidebarState {
  /** Desktop only: the sidebar folds to an icon rail instead of hiding, like Claude's. */
  collapsed: boolean;
  toggleCollapsed: () => void;
}

const PersistedSchema = z.strictObject({ collapsed: z.boolean().optional() });

export const usePaperSidebarStore = create<PaperSidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    {
      name: "design-paper-sidebar",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: (state) => ({ collapsed: state.collapsed }),
      version: 1,
    },
  ),
);
