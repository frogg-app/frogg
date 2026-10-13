import { HostPage } from "./host-state";
import { useHostRpc as useRpc } from "./host-state";
import { useHostAction as useAction } from "./host-state";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useCallback } from "react";
import { version } from "../../../../package.json";
import { useDaemon } from "../../../daemon/store";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Note, Row, Section } from "../controls";
import { need } from "./hostkit";
import { Block, Confirm, ErrorLine, Status, useFeature } from "./kit";

const loadBeta = async (c: DaemonClient) => {
  const r = await c.getBetaChannelStatus();
  if (r.error) throw new Error(r.error);
  return r;
};
const loadDev = async (c: DaemonClient) => {
  const r = await c.getDevDaemonStatus();
  if (r.error) throw new Error(r.error);
  return r;
};
type Dev = Awaited<ReturnType<typeof loadDev>>;
export function Developer() {
  return <HostPage body={PageBody} />;
}
function PageBody() {
  return (
    <>
      <Section title="Channels">
        <Row label="This app" hint={`Frogg Next · ${version}`} last />
      </Section>
      <Note>
        Beta and development daemons run separately from the selected host. App installation is
        managed outside this prototype.
      </Note>
      <Beta />
      <DevBuilds />
    </>
  );
}
function Beta() {
  const supported = useFeature("betaChannelManagement");
  const control = useFeature("daemonChannelControl");
  const rpc = useRpc(loadBeta, { enabled: supported === true, pollMs: 10000 });
  const host = useDaemon((s) => s.serverName) ?? "Selected host";
  const act = useAction();
  const run = useCallback(
    (key: string, fn: (c: DaemonClient) => Promise<unknown>) => {
      void act.run(key, () => fn(need())).then((ok) => ok && rpc.reload());
    },
    [act, rpc],
  );
  const install = useCallback(() => run("install", (c) => c.installBetaChannel()), [run]);
  const uninstall = useCallback(() => run("uninstall", (c) => c.uninstallBetaChannel()), [run]);
  const start = useCallback(() => run("start", (c) => c.startBetaChannel()), [run]);
  const stop = useCallback(() => run("stop", (c) => c.stopBetaChannel()), [run]);
  const b = rpc.data;
  const busy = !!act.pending || !!b?.run;
  return (
    <Section title="Beta daemon on this host">
      {supported === false ? (
        <Block last>
          <T>Update this daemon to manage its beta channel.</T>
        </Block>
      ) : (
        <Status rpc={rpc} what="beta daemon">
          {b && (
            <>
              <Row
                label={host}
                hint={
                  b.installed
                    ? `${b.installedVersion ?? "Unknown version"} · ${b.running ? `running on :${b.port}` : "stopped"}`
                    : "Not installed"
                }
              >
                {b.supported && (
                  <Button
                    label={b.installed ? "Update beta" : "Install"}
                    onPress={install}
                    disabled={busy || b.selfIsBeta}
                  />
                )}
                {b.installed &&
                  control &&
                  !b.selfIsBeta &&
                  (b.running ? (
                    <Confirm
                      label="Stop…"
                      confirm="Stop beta daemon"
                      onConfirm={stop}
                      disabled={busy}
                    />
                  ) : (
                    <Button label="Start" onPress={start} disabled={busy} />
                  ))}
                {b.installed && !b.selfIsBeta && (
                  <Confirm
                    label="Uninstall…"
                    confirm="Uninstall beta"
                    onConfirm={uninstall}
                    disabled={busy}
                  />
                )}
              </Row>
              {b.run && <Row label={b.run.phase} hint={b.run.message ?? "Working…"} />}
              <Row label="Latest beta" hint={b.latestError ?? b.latestVersion ?? "Unknown"} last />
              {!b.supported && (
                <Note>{b.reason ?? "Beta installation is unavailable on this host."}</Note>
              )}
            </>
          )}
        </Status>
      )}
      <ErrorLine text={act.error} />
    </Section>
  );
}
function DevBuilds() {
  const supported = useFeature("daemonChannelControl");
  const rpc = useRpc(loadDev, { enabled: supported === true, pollMs: 10000 });
  return (
    <Section title="Dev builds">
      {supported === false ? (
        <Block last>
          <T>Update this daemon to manage development builds.</T>
        </Block>
      ) : (
        <Status rpc={rpc} what="development builds">
          {rpc.data && (
            <>
              {!rpc.data.supported && (
                <Block last>
                  <T>{rpc.data.reason ?? "Development builds unavailable on this host."}</T>
                </Block>
              )}
              {rpc.data.supported && !rpc.data.checkouts.length && (
                <Block last>
                  <T>No source checkouts found on this host.</T>
                </Block>
              )}
              {rpc.data.checkouts.map((checkout) => (
                <DevRow
                  key={checkout.cwd}
                  checkout={checkout}
                  status={rpc.data!}
                  reload={rpc.reload}
                />
              ))}
            </>
          )}
        </Status>
      )}
    </Section>
  );
}
function DevRow({
  checkout,
  status,
  reload,
}: {
  checkout: Dev["checkouts"][number];
  status: Dev;
  reload: () => void;
}) {
  const act = useAction();
  const canRebuild = useFeature("devDaemonRebuild");
  const instance = status.instances?.find((i) => i.cwd === checkout.cwd);
  const running = !!instance || (status.running && status.cwd === checkout.cwd);
  const run = useCallback(
    (key: string, fn: (c: DaemonClient) => Promise<unknown>) => {
      void act.run(key, () => fn(need())).then((ok) => ok && reload());
    },
    [act, reload],
  );
  const launch = useCallback(
    () => run("launch", (c) => c.startDevDaemon(checkout.cwd)),
    [run, checkout.cwd],
  );
  const rebuild = useCallback(
    () => run("rebuild", (c) => c.rebuildDevDaemon("daemon", checkout.cwd)),
    [run, checkout.cwd],
  );
  const stop = useCallback(
    () => run("stop", (c) => c.stopDevDaemon(checkout.cwd)),
    [run, checkout.cwd],
  );
  const busy = !!act.pending || !!instance?.busy;
  return (
    <>
      <Row
        label={checkout.name}
        hint={`${checkout.cwd} · ${checkout.branch ?? "Unknown branch"} · ${running ? "running" : "stopped"}`}
      >
        {!running && (
          <Button label="Launch" onPress={launch} disabled={busy || !status.supported} />
        )}
        {running && canRebuild && (
          <Confirm
            label="Rebuild & restart…"
            confirm="Rebuild daemon"
            onConfirm={rebuild}
            disabled={busy || !(instance?.canRebuild ?? status.canRebuild)}
          />
        )}
        {running &&
          status.selfCwd !== checkout.cwd &&
          !(status.isSelf && status.cwd === checkout.cwd) && (
            <Confirm label="Stop…" confirm="Stop dev build" onConfirm={stop} disabled={busy} />
          )}
      </Row>
      <ErrorLine text={act.error ?? instance?.lastError ?? null} />
    </>
  );
}
