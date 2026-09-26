import AsyncStorage from "@/storage/brand-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/** Which list the sidebar shows: project workspaces, or project-less chats. */
export type SidebarSection = "projects" | "chats";

interface SidebarSectionStoreState {
  section: SidebarSection;
  setSection: (section: SidebarSection) => void;
}

const PersistedStateSchema = z.strictObject({
  section: z.enum(["projects", "chats"]).optional(),
});

export const useSidebarSectionStore = create<SidebarSectionStoreState>()(
  persist(
    (set) => ({
      section: "projects",
      setSection: (section) => set({ section }),
    }),
    {
      name: "sidebar-section",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedStateSchema),
      partialize: (state) => ({ section: state.section }),
      version: 1,
    },
  ),
);
