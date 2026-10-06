import { patchHostConfig as patchConfig } from "./host-state";
import { HostPage } from "./host-state";
import { useHostRpc as useRpc } from "./host-state";
import { useHostAction as useAction } from "./host-state";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useCallback, useMemo } from "react";
import { useConfig } from "../../../daemon/config";
import { removeHost, renameHost, useHosts } from "../../../daemon/hosts";
import { useDaemon } from "../../../daemon/store";
import { Row, Section, Seg, TextField, Toggle } from "../controls";
import { need } from "./hostkit";
import { Confirm, ErrorLine, Status, Value, useFeature } from "./kit";
import { Pill } from "../controls";
import { color } from "../../../theme/tokens";
import { Button } from "../../Button";

type WebUi = Awaited<ReturnType<DaemonClient["getWebUiStatus"]>>;

const loadWeb = (c: DaemonClient) => c.getWebUiStatus();
const setRelay = (v: boolean) => void patchConfig({ relay: { enabled: v } });
const setRelayEndpoint = (v: string) => void patchConfig({ relay: { endpoint: v } });
const setRelayTls = (v: boolean) => void patchConfig({ relay: { useTls: v } });

const IFACES: Array<["127.0.0.1" | "0.0.0.0", string]> = [
  ["127.0.0.1", "This machine only"],
  ["0.0.0.0", "All interfaces"],
];

/** Host › Overview & connections: identity on this device, how it is reached, the web client. */
export function HostOverview() {
  return <HostPage body={PageBody} />;
}
function PageBody() {
  const activeId = useHosts((st) => st.activeId);
  const host = useHosts((st) => st.hosts.find((h) => h.id === st.activeId));
  const serverName = useDaemon((st) => st.serverName);
  const relay = useConfig((st) => st.config?.relay);
  const rename = useCallback((v: string) => activeId && v && renameHost(activeId, v), [activeId]);
  const forget = useCallback(() => activeId && removeHost(activeId), [activeId]);
  const name = host?.name ?? serverName ?? "this host";
  return (
    <>
      <Section title="Identity">
        <Row label="Name" hint="Shown on this device only" last>
          <TextField value={name} onChange={rename} width={200} />
        </Row>
      </Section>
      <Section title="Connections">
        <Row
          label={host?.relay ? "Relay" : "Direct"}
          hint={
            host ? `${host.endpoint}${host.tls ? " · TLS" : ""}` : "Connection address unavailable"
          }
        >
          <Pill text="this device" tint={color.cyan2} />
        </Row>
        {relay && (
          <>
            <Row label="Relay" hint="Reach this host from anywhere, end-to-end encrypted">
              <Toggle value={relay.enabled} onChange={setRelay} />
            </Row>
            <Row
              label="Relay endpoint"
              hint={
                relay.endpointMutable === false
                  ? "Overridden by FROGG_RELAY_ENDPOINT"
                  : "Overridden by FROGG_RELAY_ENDPOINT if set"
              }
              last
            >
              {relay.endpointMutable === false ? (
                <Value>{relay.endpoint ?? "—"}</Value>
              ) : (
                <TextField value={relay.endpoint ?? ""} onChange={setRelayEndpoint} width={200} />
              )}
              <Toggle
                value={relay.useTls ?? true}
                onChange={setRelayTls}
                disabled={relay.endpointMutable === false}
              />
              <Value>TLS</Value>
            </Row>
          </>
        )}
      </Section>
      <WebClient />
      <Section title="Danger zone">
        <Row
          label="Remove host"
          hint={`Forget ${name} on this device. The daemon keeps running`}
          last
        >
          <Confirm label="Remove…" confirm="Remove host" onConfirm={forget} disabled={!activeId} />
        </Row>
      </Section>
    </>
  );
}

function WebClient() {
  const supported = useFeature("webUiControl");
  const web = useRpc(loadWeb, { enabled: supported === true });
  const act = useAction();
  const run = useCallback(
    (fn: (c: DaemonClient) => Promise<WebUi>) => {
      void act
        .run("w", () => fn(need()))
        .then((ok) => {
          if (ok) web.reload();
          return ok;
        });
    },
    [act, web],
  );
  const start = useCallback(() => run((c) => c.startWebUi()), [run]);
  const stop = useCallback(() => run((c) => c.stopWebUi()), [run]);
  const setLaunch = useCallback(
    (v: boolean) => run((c) => c.updateWebUi({ startOnLaunch: v })),
    [run],
  );
  const setIface = useCallback((v: string) => run((c) => c.updateWebUi({ host: v })), [run]);
  const iface = useMemo(
    () => (web.data?.host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1") as "0.0.0.0" | "127.0.0.1",
    [web.data?.host],
  );
  if (!supported) return null;
  const w = web.data;
  return (
    <Section title="Web client">
      <Status rpc={web} what="web client">
        {w && (
          <>
            <Row
              label="Status"
              hint={w.running ? `Running on ${w.host}:${w.port}` : (w.lastError ?? "Stopped")}
            >
              <Pill
                text={w.running ? "running" : "stopped"}
                tint={w.running ? color.mint : color.faint}
              />
              {w.running ? (
                <Button label="Stop" onPress={stop} disabled={!!act.pending} />
              ) : (
                <Button label="Start" onPress={start} disabled={!!act.pending || !w.available} />
              )}
            </Row>
            <Row
              label="Start with the daemon"
              hint={w.startOnLaunchPinned ? "Set by the daemon’s environment" : undefined}
            >
              <Toggle
                value={w.startOnLaunch}
                onChange={setLaunch}
                disabled={w.startOnLaunchPinned}
              />
            </Row>
            <Row label="Interface" last>
              <Seg options={IFACES} value={iface} onChange={setIface} />
            </Row>
          </>
        )}
      </Status>
      <ErrorLine text={act.error} />
    </Section>
  );
}
