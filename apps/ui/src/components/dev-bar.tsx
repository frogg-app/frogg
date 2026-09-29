/**
 * COMPAT(devDaemonRebuild): added in v1.6.7.
 *
 * The development daemon at a glance, for developer options: one pill for the dev daemon and one
 * for its web app, each with a status dot (running, out of date, rebuilding, stopped) and a menu
 * to start, stop, rebuild and restart it. It talks to the first connected host that manages a
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

interface DevBarItem {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  onSelect?: () => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DevBar() {
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
  return <DevBarForHost host={host} />;
}

function DevBarForHost({ host }: { host: HostProfile }) {
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

  const daemonItems = useMemo<DevBarItem[]>(() => {
    if (!status || !client) return [];
    const items: DevBarItem[] = [];
    if (status.canRebuild) {
      items.push({
        id: "rebuild-daemon",
        label: t("devBar.rebuildDaemon"),
        disabled: Boolean(status.busy),
        onSelect: () => void run("daemon", () => client.rebuildDevDaemon("daemon")),
      });
    }
    if (!status.isSelf && status.running) {
      items.push({
        id: "stop",
        label: t("devBar.stop"),
        onSelect: () => void run("daemon", () => client.stopDevDaemon()),
      });
    }
    if (!status.isSelf && !status.running) {
      for (const checkout of status.checkouts) {
        items.push({
          id: `start-${checkout.cwd}`,
          label: t("devBar.startIn", { name: checkout.name }),
          description: checkout.branch ?? checkout.cwd,
          onSelect: () => void run("daemon", () => client.startDevDaemon(checkout.cwd)),
        });
      }
    }
    return items;
  }, [client, run, status, t]);

  const webUrl = status?.webReady ? siblingDaemonWebUrl(host, status.webPort) : null;
  const webItems = useMemo<DevBarItem[]>(() => {
    if (!status || !client) return [];
    const items: DevBarItem[] = [];
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

  return (
    <View style={styles.bar} testID="dev-bar">
      <DevPill
        testID="dev-bar-daemon"
        label={t("devBar.daemon")}
        tone={daemonTone}
        title={status.branch ?? status.cwd ?? t("devBar.daemon")}
        stale={status.daemonStale ?? []}
        notes={notes}
        items={daemonItems}
      />
      <DevPill
        testID="dev-bar-web"
        label={t("devBar.web")}
        tone={webTone}
        title={t("devBar.web")}
        stale={status.webStale ?? []}
        notes={[]}
        items={webItems}
      />
    </View>
  );
}

function toneOf(input: { busy: boolean; running: boolean; stale: boolean }): Tone {
  if (input.busy) return "busy";
  if (!input.running) return "stopped";
  return input.stale ? "stale" : "running";
}

function DevPill({
  testID,
  label,
  tone,
  title,
  stale,
  notes,
  items,
}: {
  testID: string;
  label: string;
  tone: Tone;
  title: string;
  stale: string[];
  notes: string[];
  items: DevBarItem[];
}) {
  const { t } = useTranslation();
  const dotStyle = useMemo(() => [styles.dot, dotTones[tone]], [tone]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${t(`devBar.tone.${tone}`)}`}
        testID={testID}
        style={styles.pill}
      >
        <View style={dotStyle} />
        <Text style={styles.pillText} numberOfLines={1}>
          {label}
        </Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" offset={6} minWidth={240} sheetTitle={title}>
        <DropdownMenuItem disabled description={stale.join(" · ") || undefined}>
          {t(`devBar.tone.${tone}`)}
        </DropdownMenuItem>
        {notes.map((note) => (
          <DropdownMenuItem key={note} disabled>
            {note}
          </DropdownMenuItem>
        ))}
        {items.length > 0 ? <DropdownMenuSeparator /> : null}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pillText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
