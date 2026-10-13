import { PluginRequestError } from "@frogg/client/internal/daemon-client";
import { isRemoteControlCapability } from "@frogg/protocol/plugins/manifest";
import { useEffect } from "react";
import { create } from "zustand";
import { setPref } from "../prefs";
import { getClient, onHostSwitch, useDaemon } from "./store";

/** The plugin that switches the host's built-in Companion on (daemon: `contributes.features`). */
export const COMPANION_PLUGIN_ID = "frogg.companion";

interface PluginGate {
  /** Whether the connected host runs the Companion (its plugin is in, or plugins are off). */
  companion: boolean;
  /** The plugin to install before the host runs the Companion, or null when none is missing. */
  companionPlugin: { id: string; repoUrl: string } | null;
}

const LOCKED: PluginGate = { companion: false, companionPlugin: null };
export const usePluginGate = create<PluginGate>(() => LOCKED);
onHostSwitch(() => usePluginGate.setState(LOCKED));

interface CompanionCapability {
  enabled: boolean;
  reason: string;
  plugin?: { id: string; repoUrl: string };
}

/**
 * Reads the gate from `server_info.capabilities.companion`, as apps/ui does: the daemon decides
 * (an enabled official or brand plugin contributing the `companion` feature, or plugins switched
 * off by the brand) and names the plugin while it is missing. No capability, no Companion.
 */
export function refreshPluginGate(): void {
  const info = getClient()?.getLastServerInfoMessage() as {
    capabilities?: { companion?: CompanionCapability };
  } | null;
  const cap = info?.capabilities?.companion;
  usePluginGate.setState({ companion: !!cap && !cap.plugin, companionPlugin: cap?.plugin ?? null });
}

/** Keeps the gate current while mounted: on connect and on every server_info push. */
export function useWatchPluginGate(): void {
  const conn = useDaemon((s) => s.conn);
  useEffect(() => {
    const c = getClient();
    if (conn !== "online" || !c) return;
    refreshPluginGate();
    return c.subscribeRawMessages((m) => {
      if (m.type === "status" || m.type === "plugins.changed") refreshPluginGate();
    });
  }, [conn]);
}

/** Installing the Companion plugin is the opt-in, so this device turns the Companion on too. */
export function noteInstalled(plugin: { features?: string[] } | null | undefined): void {
  if (plugin?.features?.includes("companion")) setPref("companion", true);
}

/** Installs the plugin the host names for the Companion (it asks for no capabilities). */
export async function installCompanionPlugin(): Promise<void> {
  const c = getClient();
  const plugin = usePluginGate.getState().companionPlugin;
  if (!c || !plugin) return;
  const r = await c.pluginsInstall({
    id: plugin.id,
    repoUrl: plugin.repoUrl,
    grantedCapabilities: [],
  });
  noteInstalled(r.plugin);
}

/** Plain-English capability names, matching apps/ui's `plugins.capabilities` copy. */
const CAPABILITY_LABELS: Record<string, string> = {
  network: "Make network requests",
  "filesystem.workspace": "Read and write files in workspaces",
  "process.spawn": "Run programs on the host",
  "agent.read": "Read agent sessions and their events",
  "agent.write": "Send messages to agents",
  "settings.store": "Store its own settings",
  "ui.contribute": "Add commands, buttons and panels",
  rpc: "Answer requests from the app",
  "ui.view": "Show its own views in the app",
  "media.microphone": "Use the microphone",
  "media.audio": "Play audio",
  composer: "Add composer buttons and insert text",
  speech: "Use the host's speech recognition and voices",
  "agent.manage": "Start, stop and archive agents",
  "agent.permissions": "Approve or deny agents' permission requests",
  "workspaces.read": "See projects and workspaces",
  "todos.read": "Read project to-dos",
  "todos.write": "Create and update project to-dos",
  "ui.external": "Open links in your browser",
};

/** A capability's label; one this build doesn't know shows its id. */
export const describeCapability = (c: string): string => CAPABILITY_LABELS[c] ?? c;
export { isRemoteControlCapability };

/** True when the plugin was granted a capability that only works with remote control on. */
export function wantsRemoteControl(p: {
  remoteControl?: boolean;
  grantedCapabilities: string[];
}): boolean {
  return p.remoteControl !== undefined && p.grantedCapabilities.some(isRemoteControlCapability);
}

const ERRORS: Record<string, string> = {
  not_found: "Not found.",
  invalid_request: "The request was invalid.",
  forbidden: "Not allowed.",
  consent_required: "This update needs new permissions.",
  signature_invalid: "The repository signature did not verify.",
  hash_mismatch: "The download did not match its checksum.",
  manifest_mismatch: "The plugin did not match its repository entry.",
  fetch_failed: "Could not download from the repository.",
  incompatible: "Not compatible with this host.",
  already_installed: "Already installed.",
  plugin_error: "The plugin reported an error.",
  not_active: "The plugin is not running.",
  timeout: "The request timed out.",
  internal: "Something went wrong on the host.",
  already_resolved: "Already answered elsewhere.",
};

/** A plugin RPC failure in plain words, with the host's detail after it. */
export function describePluginError(e: unknown): string {
  if (e instanceof PluginRequestError) {
    const summary = ERRORS[e.code];
    if (!summary) return e.message;
    return e.message && e.message !== summary ? `${summary} ${e.message}` : summary;
  }
  return e instanceof Error ? e.message : String(e);
}
