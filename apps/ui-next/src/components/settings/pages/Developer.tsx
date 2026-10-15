import { HostPage } from "./host-state";
import { useHostRpc as useRpc } from "./host-state";
import { useHostAction as useAction } from "./host-state";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useCallback } from "react";
import { version } from "../../../../package.json";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Note, Row, Section } from "../controls";
import { need } from "./hostkit";
import { Block, Confirm, ErrorLine, Status, useFeature } from "./kit";

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
      <Note>Development daemons run separately from the selected host.</Note>
      <DevBuilds />
    </>
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
