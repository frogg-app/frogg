/**
 * COMPAT(devDaemonRebuild): added in v1.6.7.
 *
 * Dev builds at a glance, for developer options: a "Dev" menu in the main panel's top bar,
 * scoped to the session in view. When that session's worktree is a source checkout it offers to
 * launch a dev build there; once one runs, the trigger carries its daemon and web app status and
 * the menu opens, rebuilds, restarts and stops it. Dev builds running for other sessions are
 * listed below. In a dev build's own web app it manages that build.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { DaemonDevBuild } from "@frogg/protocol/messages";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHosts } from "@/runtime/host-runtime";
import { siblingDaemonWebUrl } from "@/screens/settings/developer/daemon-web-url";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import type { HostProfile } from "@/types/host-connection";
import { openExternalUrl } from "@/utils/open-external-url";
import { devBuildDotTones } from "./dev-builds/dev-build-dot";
import {
  devBuildTone,
  useDevBuilds,
  useDevBuildsEnabled,
  type DevBuildTone,
} from "./dev-builds/use-dev-builds";

type DevAction = "launch" | "stop" | "rebuildDaemon" | "restartWeb";
type Perform = (action: DevAction, cwd: string) => void;
type Pending = { cwd: string; action: DevAction } | null;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invoke(client: DaemonClient, action: DevAction, cwd: string) {
  switch (action) {
    case "launch":
      return client.startDevDaemon(cwd);
    case "stop":
      return client.stopDevDaemon(cwd);
    case "rebuildDaemon":
      return client.rebuildDevDaemon("daemon", cwd);
    case "restartWeb":
      return client.rebuildDevDaemon("web", cwd);
  }
}

function webUrlOf(host: HostProfile, build: DaemonDevBuild): string | null {
  return build.webReady && build.webPort ? siblingDaemonWebUrl(host, build.webPort) : null;
}

export function DevMenu() {
  const enabled = useDevBuildsEnabled();
  const hosts = useHosts();
  const selection = useActiveWorkspaceSelection();
  const workspace = useWorkspace(selection?.serverId ?? null, selection?.workspaceId ?? null);
  // The session's own host when it launches dev builds, else the first that does (in a dev
  // build's web app, the dev build itself).
  const serverId = useSessionStore((state) => {
    const manages = (id: string) =>
      state.sessions[id]?.serverInfo?.features?.devDaemonRebuild === true;
    if (selection && manages(selection.serverId)) return selection.serverId;
    return hosts.find((host) => manages(host.serverId))?.serverId ?? null;
  });
  const host = hosts.find((candidate) => candidate.serverId === serverId) ?? null;
  if (!enabled || !host) return null;
  const cwd = selection?.serverId === host.serverId ? workspace?.workspaceDirectory || null : null;
  return <DevMenuForHost host={host} cwd={cwd} />;
}

function DevMenuForHost({ host, cwd }: { host: HostProfile; cwd: string | null }) {
  const { t } = useTranslation();
  const { snapshot, refresh, client } = useDevBuilds(host.serverId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const perform = useCallback<Perform>(
    (action, target) => {
      if (!client) return;
      setPending({ cwd: target, action });
      setActionError(null);
      void (async () => {
        try {
          const result = await invoke(client, action, target);
          if (mounted.current && result.error) setActionError(result.error);
        } catch (error) {
          if (mounted.current) setActionError(errorText(error));
        }
        if (!mounted.current) return;
        setPending(null);
        refresh();
      })();
    },
    [client, refresh],
  );

  if (!snapshot?.status.supported || !client) return null;
  const { status, instances } = snapshot;
  // In a dev build's web app, the session in view belongs to it; manage the build itself.
  const scope = status.selfCwd ?? cwd;
  const current = instances.find((instance) => instance.cwd === scope) ?? null;
  const launchCwd =
    !current && scope && status.checkouts.some((checkout) => checkout.cwd === scope) ? scope : null;
  const others = instances.filter((instance) => instance !== current);
  if (!current && !launchCwd && others.length === 0) return null;

  return (
    <DropdownMenu>
      <DevMenuTrigger build={current} pending={pending} />
      <DropdownMenuContent align="end" offset={6} minWidth={260} sheetTitle={t("devBar.menu")}>
        {launchCwd ? (
          <LaunchItem
            cwd={launchCwd}
            pending={pending}
            actionError={actionError}
            perform={perform}
          />
        ) : null}
        {current ? (
          <CurrentBuild
            host={host}
            build={current}
            isSelf={status.selfCwd === current.cwd}
            pending={pending}
            actionError={actionError}
            perform={perform}
          />
        ) : null}
        <OtherBuilds
          host={host}
          builds={others}
          selfCwd={status.selfCwd ?? null}
          separate={Boolean(current || launchCwd)}
          perform={perform}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function tonesOf(
  build: DaemonDevBuild,
  pending: Pending,
): { daemon: DevBuildTone; web: DevBuildTone } {
  const pendingTarget = pending?.action === "restartWeb" ? "web" : "daemon";
  const busy = build.busy ?? (pending?.cwd === build.cwd ? pendingTarget : null);
  return {
    daemon: devBuildTone({
      busy: busy === "daemon",
      running: build.ready,
      stale: build.daemonStale.length > 0,
    }),
    web: devBuildTone({
      busy: busy === "web",
      running: build.webReady,
      stale: build.webStale.length > 0,
    }),
  };
}

function DevMenuTrigger({ build, pending }: { build: DaemonDevBuild | null; pending: Pending }) {
  const { t } = useTranslation();
  const tones = build ? tonesOf(build, pending) : null;
  const label = tones
    ? `${t("devBar.daemon")}: ${t(`devBar.tone.${tones.daemon}`)}, ${t("devBar.web")}: ${t(`devBar.tone.${tones.web}`)}`
    : t("devBar.menu");
  return (
    <DropdownMenuTrigger
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="dev-menu"
      style={styles.trigger}
    >
      {tones ? <View style={[styles.dot, devBuildDotTones[tones.daemon]]} /> : null}
      {tones ? <View style={[styles.dot, devBuildDotTones[tones.web]]} /> : null}
      <Text style={styles.triggerText} numberOfLines={1}>
        {t("devBar.menu")}
      </Text>
    </DropdownMenuTrigger>
  );
}

function LaunchItem({
  cwd,
  pending,
  actionError,
  perform,
}: {
  cwd: string;
  pending: Pending;
  actionError: string | null;
  perform: Perform;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ActionItem
        action="launch"
        cwd={cwd}
        perform={perform}
        testID="dev-menu-launch"
        description={t("devBar.launchHint")}
        disabled={pending !== null}
      >
        {pending?.cwd === cwd ? t("devBar.launching") : t("devBar.launch")}
      </ActionItem>
      {actionError ? <DropdownMenuItem disabled>{actionError}</DropdownMenuItem> : null}
    </>
  );
}

function CurrentBuild({
  host,
  build,
  isSelf,
  pending,
  actionError,
  perform,
}: {
  host: HostProfile;
  build: DaemonDevBuild;
  isSelf: boolean;
  pending: Pending;
  actionError: string | null;
  perform: Perform;
}) {
  const { t } = useTranslation();
  const tones = tonesOf(build, pending);
  const webUrl = webUrlOf(host, build);
  const stale = [...new Set([...build.daemonStale, ...build.webStale])].join(" · ");
  const notes = [
    ...(build.lastError ? [t("devBar.lastError", { error: build.lastError })] : []),
    ...(actionError ? [actionError] : []),
    ...(build.behindMain ? [t("devBar.behindMain", { count: build.behindMain })] : []),
  ];
  return (
    <>
      <DropdownMenuLabel testID="dev-menu-current">
        {build.branch ? `${t("devBar.title")} · ${build.branch}` : t("devBar.title")}
      </DropdownMenuLabel>
      <DropdownMenuItem disabled description={stale || undefined}>
        {`${t("devBar.daemon")}: ${t(`devBar.tone.${tones.daemon}`)} · ${t("devBar.web")}: ${t(`devBar.tone.${tones.web}`)}`}
      </DropdownMenuItem>
      {notes.map((note) => (
        <DropdownMenuItem key={note} disabled>
          {note}
        </DropdownMenuItem>
      ))}
      {webUrl ? (
        <OpenItem url={webUrl} description={webUrl} testID="dev-menu-open-web">
          {t("devBar.openWeb")}
        </OpenItem>
      ) : null}
      {build.canRebuild ? (
        <ActionItem
          action="rebuildDaemon"
          cwd={build.cwd}
          perform={perform}
          testID="dev-menu-rebuild-daemon"
          disabled={Boolean(build.busy)}
        >
          {t("devBar.rebuildDaemon")}
        </ActionItem>
      ) : null}
      {build.canRebuild ? (
        <ActionItem
          action="restartWeb"
          cwd={build.cwd}
          perform={perform}
          testID="dev-menu-restart-web"
          disabled={Boolean(build.busy)}
        >
          {t("devBar.restartWeb")}
        </ActionItem>
      ) : null}
      {isSelf ? null : (
        <ActionItem action="stop" cwd={build.cwd} perform={perform} testID="dev-menu-stop">
          {t("devBar.stop")}
        </ActionItem>
      )}
    </>
  );
}

function OtherBuilds({
  host,
  builds,
  selfCwd,
  separate,
  perform,
}: {
  host: HostProfile;
  builds: DaemonDevBuild[];
  selfCwd: string | null;
  separate: boolean;
  perform: Perform;
}) {
  const { t } = useTranslation();
  if (builds.length === 0) return null;
  return (
    <>
      {separate ? <DropdownMenuSeparator /> : null}
      <DropdownMenuLabel testID="dev-menu-others">{t("devBar.others")}</DropdownMenuLabel>
      {builds.map((build) => (
        <OtherBuild
          key={build.cwd}
          host={host}
          build={build}
          canStop={selfCwd !== build.cwd}
          perform={perform}
        />
      ))}
    </>
  );
}

function OtherBuild({
  host,
  build,
  canStop,
  perform,
}: {
  host: HostProfile;
  build: DaemonDevBuild;
  canStop: boolean;
  perform: Perform;
}) {
  const { t } = useTranslation();
  const webUrl = webUrlOf(host, build);
  const description = build.branch ?? build.cwd;
  return (
    <>
      {webUrl ? (
        <OpenItem url={webUrl} description={description}>
          {t("devBar.openNamed", { name: build.name })}
        </OpenItem>
      ) : null}
      {canStop ? (
        <ActionItem
          action="stop"
          cwd={build.cwd}
          perform={perform}
          description={webUrl ? undefined : description}
        >
          {t("devBar.stopNamed", { name: build.name })}
        </ActionItem>
      ) : null}
    </>
  );
}

function ActionItem({
  action,
  cwd,
  perform,
  testID,
  description,
  disabled,
  children,
}: {
  action: DevAction;
  cwd: string;
  perform: Perform;
  testID?: string;
  description?: string;
  disabled?: boolean;
  children: string;
}) {
  const handleSelect = useCallback(() => perform(action, cwd), [action, cwd, perform]);
  return (
    <DropdownMenuItem
      testID={testID}
      description={description}
      disabled={disabled}
      onSelect={handleSelect}
    >
      {children}
    </DropdownMenuItem>
  );
}

function OpenItem({
  url,
  description,
  testID,
  children,
}: {
  url: string;
  description?: string;
  testID?: string;
  children: string;
}) {
  const handleSelect = useCallback(() => void openExternalUrl(url), [url]);
  return (
    <DropdownMenuItem testID={testID} description={description} onSelect={handleSelect}>
      {children}
    </DropdownMenuItem>
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
