import AsyncStorage from "@/storage/brand-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { DesignVariantId } from "@/styles/theme";

export type DesignSchemePreference = "auto" | "light" | "dark";

interface DesignPreviewState {
  variant: DesignVariantId;
  scheme: DesignSchemePreference;
  switcherVisible: boolean;
  setVariant: (variant: DesignVariantId) => void;
  setScheme: (scheme: DesignSchemePreference) => void;
  setSwitcherVisible: (visible: boolean) => void;
}

const PersistedDesignPreviewSchema = z.object({
  variant: z.enum(["current", "inset", "mono", "paper", "focus", "soft"]),
  scheme: z.enum(["auto", "light", "dark"]),
  switcherVisible: z.boolean(),
});

/**
 * Which UI-refresh design direction is being reviewed. `current` defers entirely to the
 * user's theme setting; any other variant takes over the theme until switched back.
 */
export const useDesignPreviewStore = create<DesignPreviewState>()(
  persist(
    (set) => ({
      variant: "current",
      scheme: "auto",
      switcherVisible: true,
      setVariant: (variant) => set({ variant }),
      setScheme: (scheme) => set({ scheme }),
      setSwitcherVisible: (switcherVisible) => set({ switcherVisible }),
    }),
    {
      name: "design-preview",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedDesignPreviewSchema),
      partialize: ({ variant, scheme, switcherVisible }) => ({ variant, scheme, switcherVisible }),
    },
  ),
);
