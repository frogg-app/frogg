import type { ComponentType } from "react";
import {
  Settings,
  Palette,
  Server,
  Bot,
  Boxes,
  Keyboard,
  Info,
  Bell,
  Shield,
  FolderGit2,
  SquareTerminal,
  MonitorSmartphone,
  Rocket,
  ShieldCheck,
  Wrench,
  Sparkles,
  Globe,
  Workflow,
} from "lucide-react-native";
import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";

/** Sidebar group a section is listed under; a header shows where the group changes. */
export type SettingsSectionGroup = "app" | "voice" | "system";
export type HostSectionGroup = "workspace" | "access" | "daemon";

export const SETTINGS_SECTION_GROUP_LABEL_KEYS: Record<SettingsSectionGroup, string> = {
  app: "settings.navGroups.app",
  voice: "settings.navGroups.voice",
  system: "settings.navGroups.system",
};

export const HOST_SECTION_GROUP_LABEL_KEYS: Record<HostSectionGroup, string> = {
  workspace: "settings.hostGroups.workspace",
  access: "settings.hostGroups.access",
  daemon: "settings.hostGroups.daemon",
};

/** Runtime facts that decide which app settings sections are shown. */
export interface SettingsSectionContext {
  isDesktopApp: boolean;
  shortcutsAvailable: boolean;
  /** The About screen's "Developer options" switch. */
  developerOptions: boolean;
}

export interface SidebarSectionItem {
  id: SettingsSectionSlug;
  group: SettingsSectionGroup;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
  /** Omit to always show. Add conditional sections (for example a hidden one) here. */
  isVisible?: (context: SettingsSectionContext) => boolean;
}

// The app settings sections, in order. Companion and Diagnostics live inside
// General; Layout, Editor and Integrations were removed. `section-items.test.ts`
// pins this list so a merge cannot quietly bring a section back. Developer only
// shows with About's "Developer options" switch on. About stays last.
export const SIDEBAR_SECTION_ITEMS: SidebarSectionItem[] = [
  { id: "general", group: "app", labelKey: "settings.sections.general", icon: Settings },
  { id: "appearance", group: "app", labelKey: "settings.sections.appearance", icon: Palette },
  {
    id: "shortcuts",
    group: "app",
    labelKey: "settings.sections.shortcuts",
    icon: Keyboard,
    isVisible: (context) => context.shortcutsAvailable,
  },
  {
    id: "notifications",
    group: "voice",
    labelKey: "settings.sections.notifications",
    icon: Bell,
    isVisible: (context) => context.isDesktopApp,
  },
  {
    id: "permissions",
    group: "system",
    labelKey: "settings.sections.permissions",
    icon: Shield,
    isVisible: (context) => context.isDesktopApp,
  },
  {
    id: "developer",
    group: "system",
    labelKey: "settings.sections.developer",
    icon: Wrench,
    isVisible: (context) => context.developerOptions,
  },
  { id: "about", group: "system", labelKey: "settings.sections.about", icon: Info },
];

export function visibleSettingsSections(context: SettingsSectionContext): SidebarSectionItem[] {
  return SIDEBAR_SECTION_ITEMS.filter((item) => item.isVisible?.(context) ?? true);
}

export function isSettingsSectionVisible(
  id: SettingsSectionSlug,
  context: SettingsSectionContext,
): boolean {
  return visibleSettingsSections(context).some((item) => item.id === id);
}

export interface HostSectionItem {
  id: HostSectionSlug;
  group: HostSectionGroup;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
}

export const HOST_SECTION_ITEMS: HostSectionItem[] = [
  {
    id: "projects",
    group: "workspace",
    labelKey: "settings.hostSections.projects",
    icon: FolderGit2,
  },
  { id: "agents", group: "workspace", labelKey: "settings.hostSections.agents", icon: Bot },
  {
    id: "providers",
    group: "workspace",
    labelKey: "settings.hostSections.providers",
    icon: Boxes,
  },
  { id: "skills", group: "workspace", labelKey: "settings.hostSections.skills", icon: Sparkles },
  {
    id: "terminals",
    group: "workspace",
    labelKey: "settings.hostSections.terminals",
    icon: SquareTerminal,
  },
  {
    id: "automation",
    group: "workspace",
    labelKey: "settings.hostSections.automation",
    icon: Workflow,
  },
  {
    id: "devices",
    group: "access",
    labelKey: "settings.hostSections.devices",
    icon: MonitorSmartphone,
  },
  {
    id: "security",
    group: "access",
    labelKey: "settings.hostSections.security",
    icon: ShieldCheck,
  },
  {
    id: "web-client",
    group: "access",
    labelKey: "settings.hostSections.webClient",
    icon: Globe,
  },
  { id: "host", group: "daemon", labelKey: "settings.hostSections.host", icon: Server },
  { id: "updates", group: "daemon", labelKey: "settings.hostSections.updates", icon: Rocket },
  { id: "developer", group: "daemon", labelKey: "settings.sections.developer", icon: Wrench },
];
