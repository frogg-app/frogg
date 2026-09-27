import { create } from "zustand";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

// The Mono dashboard's scope and filters. The header's host and project selectors narrow the
// chats table the way Vercel's team and project switchers narrow its deployments list. Kept in
// memory and local to Mono, so the shipping sidebar's persisted filters are untouched.
interface MonoScopeState {
  serverId: string | null;
  projectName: string | null;
  status: SidebarStateBucket | null;
  branch: string | null;
  query: string;
  setServerId: (serverId: string | null) => void;
  setProjectName: (projectName: string | null) => void;
  setStatus: (status: SidebarStateBucket | null) => void;
  setBranch: (branch: string | null) => void;
  setQuery: (query: string) => void;
  clearFilters: () => void;
}

export const useMonoScope = create<MonoScopeState>()((set) => ({
  serverId: null,
  projectName: null,
  status: null,
  branch: null,
  query: "",
  setServerId: (serverId) => set({ serverId, projectName: null, branch: null }),
  setProjectName: (projectName) => set({ projectName, branch: null }),
  setStatus: (status) => set({ status }),
  setBranch: (branch) => set({ branch }),
  setQuery: (query) => set({ query }),
  clearFilters: () => set({ projectName: null, status: null, branch: null, query: "" }),
}));
