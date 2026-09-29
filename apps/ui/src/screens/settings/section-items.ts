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
  Smartphone,
  MonitorSmartphone,
  Rocket,
  ShieldCheck,
  Wrench,
  Sparkles,
  Globe,
} from "lucide-react-native";
import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";

/** Runtime facts that decide which app settings sections are shown. */
export interface SettingsSectionContext {
  isDesktopApp: boolean;
  shortcutsAvailable: boolean;
  /** The About screen's "Developer options" switch. */
  developerOptions: boolean;
}

export interface SidebarSectionItem {
  id: SettingsSectionSlug;
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
  { id: "general", labelKey: "settings.sections.general", icon: Settings },
  { id: "appearance", labelKey: "settings.sections.appearance", icon: Palette },
  {
    id: "shortcuts",
    labelKey: "settings.sections.shortcuts",
    icon: Keyboard,
    isVisible: (context) => context.shortcutsAvailable,
  },
  {
    id: "notifications",
    labelKey: "settings.sections.notifications",
    icon: Bell,
    isVisible: (context) => context.isDesktopApp,
  },
  {
    id: "permissions",
    labelKey: "settings.sections.permissions",
    icon: Shield,
    isVisible: (context) => context.isDesktopApp,
  },
  {
    id: "developer",
    labelKey: "settings.sections.developer",
    icon: Wrench,
    isVisible: (context) => context.developerOptions,
  },
  { id: "about", labelKey: "settings.sections.about", icon: Info },
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
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
}

export const HOST_SECTION_ITEMS: HostSectionItem[] = [
  { id: "host", labelKey: "settings.hostSections.host", icon: Server },
  {
    id: "security",
    labelKey: "settings.hostSections.security",
    icon: ShieldCheck,
  },
  { id: "deploy", labelKey: "settings.hostSections.deploy", icon: Rocket },
  {
    id: "projects",
    labelKey: "settings.hostSections.projects",
    icon: FolderGit2,
  },
  {
    id: "pair-device",
    labelKey: "openProject.tiles.pairDevice.title",
    icon: Smartphone,
  },
  {
    id: "devices",
    labelKey: "settings.hostSections.devices",
    icon: MonitorSmartphone,
  },
  { id: "agents", labelKey: "settings.hostSections.agents", icon: Bot },
  { id: "providers", labelKey: "settings.hostSections.providers", icon: Boxes },
  { id: "skills", labelKey: "settings.hostSections.skills", icon: Sparkles },
  {
    id: "terminals",
    labelKey: "settings.hostSections.terminals",
    icon: SquareTerminal,
  },
  { id: "web-client", labelKey: "settings.hostSections.webClient", icon: Globe },
  { id: "developer", labelKey: "settings.sections.developer", icon: Wrench },
];
