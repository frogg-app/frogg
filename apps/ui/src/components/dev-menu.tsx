/**
 * COMPAT(devDaemonRebuild): added in v1.6.7.
 *
 * The development daemon at a glance, for developer options: a "Dev" menu at the top of the main
 * panel whose trigger carries a status dot each for the dev daemon and its web app (running, out
 * of date, rebuilding, stopped), and whose sections start, stop, rebuild and restart them. It talks to the first connected host that manages a
 * development daemon, which is the development daemon itself when this is its web app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DaemonDevDaemonStatusPayload } from "@frogg/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { siblingDaemonWebUrl } from "@/screens/settings/developer/daemon-web-url";
import { useSessionStore } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";
import { isBetaBuild } from "@/utils/app-version";
import { openExternalUrl } from "@/utils/open-external-url";

const POLL_MS = 4000;

type Tone = "running" | "stale" | "busy" | "stopped";

interface DevMenuItem {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  onSelect?: () => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DevMenu() {
  const developerOptions = useSettings((settings) => settings.developerOptions) || isBetaBuild();
  const hosts = useHosts();
  const serverId = useSessionStore((state) => {
    for (const host of hosts) {
      const session = state.sessions[host.serverId];
      if (session?.serverInfo?.features?.devDaemonRebuild === true) return host.serverId;
    }
    return null;
  });
  const host = hosts.find((candidate) => candidate.serverId === serverId) ?? null;
  if (!developerOptions || !host) return null;
  return <DevMenuForHost host={host} />;
}

function DevMenuForHost({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(host.serverId);
  const [status, setStatus] = useState<DaemonDevDaemonStatusPayload | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const next = await client.getDevDaemonStatus();
      if (mounted.current) setStatus(next);
    } catch {
      // A rebuild restarts the daemon this may be talking to; the next poll catches up.
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = useCallback(
    async (id: string, action: () => Promise<{ error: string | null }>) => {
      setPending(id);
      setActionError(null);
      try {
        const result = await action();
        if (mounted.current && result.error) setActionError(result.error);
      } catch (error) {
        if (mounted.current) setActionError(errorText(error));
      }
      if (!mounted.current) return;
      setPending(null);
      void refresh();
    },
    [refresh],
  );

  // dev:live runs the daemon and its web app together, so one block starts and stops both.
  const lifecycleItems = useMemo<DevMenuItem[]>(() => {
    if (!status || !client || status.isSelf) return [];
    if (status.running) {
      return [
        {
          id: "stop",
          label: t("devBar.stop"),
          onSelect: () => void run("daemon", () => client.stopDevDaemon()),
        },
      ];
    }
    if (status.checkouts.length === 0) {
      return [{ id: "no-checkouts", label: t("devBar.noCheckouts"), disabled: true }];
    }
    return status.checkouts.map((checkout) => ({
      id: `start-${checkout.cwd}`,
      label: t("devBar.startIn", { name: checkout.name }),
      description: checkout.branch ?? checkout.cwd,
      onSelect: () => void run("daemon", () => client.startDevDaemon(checkout.cwd)),
    }));
  }, [client, run, status, t]);

  const daemonItems = useMemo<DevMenuItem[]>(() => {
    if (!status || !client) return [];
    const items: DevMenuItem[] = [];
    if (status.canRebuild) {
      items.push({
        id: "rebuild-daemon",
        label: t("devBar.rebuildDaemon"),
        disabled: Boolean(status.busy),
        onSelect: () => void run("daemon", () => client.rebuildDevDaemon("daemon")),
      });
    }
    return items;
  }, [client, run, status, t]);

  const webUrl = status?.webReady ? siblingDaemonWebUrl(host, status.webPort) : null;
  const webItems = useMemo<DevMenuItem[]>(() => {
    if (!status || !client) return [];
    const items: DevMenuItem[] = [];
    if (webUrl) {
      items.push({
        id: "open-web",
        label: t("devBar.openWeb"),
        onSelect: () => void openExternalUrl(webUrl),
      });
    }
    if (status.canRebuild) {
      items.push({
        id: "restart-web",
        label: t("devBar.restartWeb"),
        disabled: Boolean(status.busy),
        onSelect: () => void run("web", () => client.rebuildDevDaemon("web")),
      });
    }
    return items;
  }, [client, run, status, t, webUrl]);

  if (!status?.supported) return null;

  const busy = status.busy ?? pending;
  const daemonTone: Tone = toneOf({
    busy: busy === "daemon",
    running: status.running && Boolean(status.ready),
    stale: (status.daemonStale ?? []).length > 0,
  });
  const webTone: Tone = toneOf({
    busy: busy === "web",
    running: Boolean(status.webReady),
    stale: (status.webStale ?? []).length > 0,
  });
  const notes = [
    ...(status.lastError ? [t("devBar.lastError", { error: status.lastError })] : []),
    ...(actionError ? [actionError] : []),
    ...(status.behindMain ? [t("devBar.behindMain", { count: status.behindMain })] : []),
  ];

  const daemonDotStyle = [styles.dot, dotTones[daemonTone]];
  const webDotStyle = [styles.dot, dotTones[webTone]];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={`${t("devBar.daemon")}: ${t(`devBar.tone.${daemonTone}`)}, ${t("devBar.web")}: ${t(`devBar.tone.${webTone}`)}`}
        testID="dev-menu"
        style={styles.trigger}
      >
        <View style={daemonDotStyle} />
        <View style={webDotStyle} />
        <Text style={styles.triggerText} numberOfLines={1}>
          {t("devBar.menu")}
        </Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" offset={6} minWidth={260} sheetTitle={t("devBar.menu")}>
        <DevMenuSection
          testID="dev-menu-daemon"
          label={status.branch ? `${t("devBar.daemon")} · ${status.branch}` : t("devBar.daemon")}
          tone={daemonTone}
          stale={status.daemonStale ?? []}
          notes={notes}
          items={daemonItems}
        />
        <DropdownMenuSeparator />
        <DevMenuSection
          testID="dev-menu-web"
          label={t("devBar.web")}
          tone={webTone}
          stale={status.webStale ?? []}
          notes={[]}
          items={webItems}
        />
        {lifecycleItems.length > 0 ? <DropdownMenuSeparator /> : null}
        {lifecycleItems.map((item) => (
          <DropdownMenuItem
            key={item.id}
            testID={`dev-menu-${item.id}`}
            disabled={item.disabled}
            description={item.description}
            onSelect={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function toneOf(input: { busy: boolean; running: boolean; stale: boolean }): Tone {
  if (input.busy) return "busy";
  if (!input.running) return "stopped";
  return input.stale ? "stale" : "running";
}

function DevMenuSection({
  testID,
  label,
  tone,
  stale,
  notes,
  items,
}: {
  testID: string;
  label: string;
  tone: Tone;
  stale: string[];
  notes: string[];
  items: DevMenuItem[];
}) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuLabel testID={testID}>{label}</DropdownMenuLabel>
      <DropdownMenuItem disabled description={stale.join(" · ") || undefined}>
        {t(`devBar.tone.${tone}`)}
      </DropdownMenuItem>
      {notes.map((note) => (
        <DropdownMenuItem key={note} disabled>
          {note}
        </DropdownMenuItem>
      ))}
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          testID={`${testID}-${item.id}`}
          disabled={item.disabled}
          description={item.description}
          onSelect={item.onSelect}
        >
          {item.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  triggerText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
}));

const dotTones = StyleSheet.create((theme) => ({
  running: { backgroundColor: theme.colors.statusDotSuccess },
  stale: { backgroundColor: theme.colors.statusDotWarning },
  busy: { backgroundColor: theme.colors.statusDotRunning },
  stopped: { backgroundColor: theme.colors.foregroundMuted },
}));
