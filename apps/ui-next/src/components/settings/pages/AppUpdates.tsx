import { useCallback, useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import { version } from "../../../../package.json";
import { desktopBridge, type DesktopUpdateState } from "../../../desktop-bridge";
import { useDaemon } from "../../../daemon/store";
import { useUi } from "../../../ui-store";
import {
  RELEASES_PAGE,
  apkUpdatesSupported,
  checkApkUpdate,
  installApkUpdate,
  useApkUpdater,
} from "../../../updates/android";
import { Button } from "../../Button";
import { Row, Section } from "../controls";
import { ErrorLine, Value, useAction } from "./kit";

const daemonSettings = () => useUi.getState().openSettings("daemon");
const percent = (value: number) => `${Math.round(value)}%`;

/** The desktop shell's updater state, live; null outside the desktop app. */
function useDesktopUpdates(): DesktopUpdateState | null {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    void bridge.updates.get().then(setState);
    return bridge.updates.onState(setState);
  }, []);
  return state;
}

function desktopStatus(s: DesktopUpdateState): string {
  switch (s.status) {
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return "Up to date";
    case "available":
      return s.mode === "download"
        ? `Version ${s.latestVersion} is available. Download it to update.`
        : `Version ${s.latestVersion} is available. Downloading…`;
    case "downloading":
      return `Downloading ${s.latestVersion ?? "the update"}${s.progress ? ` · ${percent(s.progress.percent)}` : ""}`;
    case "ready":
      return `Version ${s.latestVersion} is ready. Restart to finish updating.`;
    case "error":
      return "The last update check failed";
    case "disabled":
      return "Updates run in installed builds only";
    default:
      return "Checks for updates on start and every few hours";
  }
}

/** Restart once downloaded, Download where the app can't install itself, else Check. */
function DesktopAction({ state }: { state: DesktopUpdateState }) {
  const updates = desktopBridge()?.updates;
  const check = useCallback(() => void updates?.check(), [updates]);
  const download = useCallback(() => void updates?.download(), [updates]);
  const install = useCallback(() => void updates?.install(), [updates]);
  if (state.status === "ready")
    return <Button kind="primary" label="Restart to update" onPress={install} />;
  if (state.status === "available" && state.mode === "download")
    return <Button kind="primary" label="Download" onPress={download} />;
  const busy = state.status === "checking" || state.status === "downloading";
  return (
    <Button
      label="Check for updates"
      onPress={check}
      disabled={busy || state.status === "disabled"}
    />
  );
}

function DesktopUpdates({ state }: { state: DesktopUpdateState }) {
  return (
    <>
      <Row label="App updates" hint={desktopStatus(state)} last={!state.error}>
        <DesktopAction state={state} />
      </Row>
      <ErrorLine text={state.error} />
    </>
  );
}

function apkStatus(s: ReturnType<typeof useApkUpdater.getState>): string {
  if (s.status === "checking") return "Checking for updates…";
  if (s.status === "downloading")
    return `Downloading${s.progress !== null ? ` · ${percent(s.progress * 100)}` : "…"}`;
  if (s.status === "installing") return "Waiting for the installer…";
  if (s.status === "up-to-date") return "Up to date";
  if (s.status === "error") return "The last update failed";
  if (s.status === "available") {
    if (s.update?.signatureMismatch)
      return `Version ${s.update.latestVersion} is signed with a different key. Install it from the release page.`;
    if (!s.update?.asset)
      return `Version ${s.update?.latestVersion} has no build for this device yet.`;
    return `Version ${s.update.latestVersion} is available`;
  }
  return "Prerelease builds from GitHub releases";
}

function ApkUpdates() {
  const state = useApkUpdater();
  useEffect(() => {
    void checkApkUpdate();
  }, []);
  const check = useCallback(() => void checkApkUpdate(), []);
  const install = useCallback(() => void installApkUpdate(), []);
  const busy = ["checking", "downloading", "installing"].includes(state.status);
  return (
    <>
      <Row label="App updates" hint={state.notice ?? apkStatus(state)} last={!state.error}>
        {state.status === "available" && state.update?.asset ? (
          <Button kind="primary" label="Download & install" onPress={install} />
        ) : (
          <Button label="Check for updates" onPress={check} disabled={busy} />
        )}
      </Row>
      <ErrorLine text={state.error} />
    </>
  );
}

export function AppUpdates() {
  const host = useDaemon((s) => s.serverName);
  const conn = useDaemon((s) => s.conn);
  const desktop = useDesktopUpdates();
  const act = useAction();
  const releases = useCallback(() => {
    void act.run("releases", () => Linking.openURL(desktop?.releaseUrl ?? RELEASES_PAGE));
  }, [act, desktop?.releaseUrl]);
  return (
    <>
      <Section title="Frogg Next">
        <Row label="Version" hint={Platform.OS}>
          <Value>{version}</Value>
        </Row>
        {desktop && <DesktopUpdates state={desktop} />}
        {!desktop && apkUpdatesSupported && <ApkUpdates />}
        <Row
          label="Release notes"
          hint={
            desktop || apkUpdatesSupported
              ? "Every release on GitHub"
              : "Install a newer build from GitHub releases to update"
          }
          last
        >
          <Button label="Release notes" onPress={releases} />
        </Row>
      </Section>
      <Section title="Hosts">
        <Row
          label={host ?? "No host connected"}
          hint="Daemon updates are managed separately for each host"
          last
        >
          <Button label="Daemon & updates" onPress={daemonSettings} disabled={conn !== "online"} />
        </Row>
      </Section>
      <ErrorLine text={act.error} />
    </>
  );
}
