import { HostPage } from "./host-state";
import { useHostRpc as useRpc } from "./host-state";
import { useHostAction as useAction } from "./host-state";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { color } from "../../../theme/tokens";
import { useUi } from "../../../ui-store";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Row, Section, Toggle } from "../controls";
import { Finding, need } from "./hostkit";
import { Block, ErrorLine, Field, Status, Value, useFeature } from "./kit";

type Settings = NonNullable<Awaited<ReturnType<DaemonClient["getAuthSettings"]>>["settings"]>;
type FindingT = NonNullable<
  Awaited<ReturnType<DaemonClient["getDaemonSecurityPosture"]>>["posture"]
>["findings"][number];

const loadAuth = (c: DaemonClient) => c.getAuthSettings();
const loadPosture = (c: DaemonClient) => c.getDaemonSecurityPosture();
const loadStatus = (c: DaemonClient) => c.getDaemonStatus();

const COPY: Record<string, { title: string; body: (listen: string) => string }> = {
  unclaimed: {
    title: "Nobody owns this host yet",
    body: () => "The first device to pair becomes its owner. Pair one of yours now.",
  },
  exposed_without_password: {
    title: "Listening on all interfaces without a password",
    body: (l) => `This host binds ${l}. Anyone on this network can request pairing.`,
  },
  trust_lan_diverges: {
    title: "Trusting the local network",
    body: () => "Clients on the LAN connect without pairing or a password.",
  },
  bind_diverges: {
    title: "Listen address differs from the default",
    body: (l) => `This host binds ${l}.`,
  },
  claim_mode_diverges: {
    title: "Claim mode is off",
    body: () => "New devices can connect without the owner approving them.",
  },
};

export function Security() {
  return <HostPage body={PageBody} />;
}
function PageBody() {
  const supported = useFeature("deviceAccess");
  const auth = useRpc(loadAuth, { enabled: supported !== false });
  const status = useRpc(loadStatus);
  if (supported === false)
    return <T style={s.muted}>This daemon is too old for security settings. Update it first.</T>;
  const set = auth.data?.settings ?? null;
  const listen = status.data?.listen ?? "—";
  return (
    <>
      <Section title="Findings">
        <Status rpc={auth} what="security settings">
          {set ? <Findings settings={set} listen={listen} onChange={auth.reload} /> : null}
        </Status>
      </Section>
      <Section title="Password">
        {set && (
          <PasswordForm
            enabled={set.passwordEnabled}
            pinned={pinned(set, "password")}
            onChange={auth.reload}
          />
        )}
      </Section>
      <Section title="Network">
        <Row label="Listen address" hint="Set in config.json; takes effect after a restart">
          <Value>{listen}</Value>
        </Row>
        {set && <AuthToggles settings={set} onChange={auth.reload} />}
      </Section>
    </>
  );
}

function pinned(set: Settings | null, key: string): boolean {
  return !!set?.overrideControlledPaths.some((p) => p.toLowerCase().includes(key.toLowerCase()));
}

function Findings({
  settings,
  listen,
  onChange,
}: {
  settings: Settings;
  listen: string;
  onChange: () => void;
}) {
  const hasPosture = useFeature("securityPosture");
  const posture = useRpc(loadPosture, { enabled: hasPosture === true });
  const reloadPosture = posture.reload;
  useEffect(() => {
    reloadPosture();
  }, [reloadPosture, settings.passwordEnabled, settings.trustLan, settings.claimMode]);
  const findings = posture.data?.posture?.findings ?? [];
  const oks: string[] = [];
  if (settings.claimMode && settings.claimed) oks.push("Claim mode on, owner set");
  if (!settings.lanTrustEffective) oks.push("Not trusting the local network");
  if (settings.passwordEnabled) oks.push("Password set");
  const reload = useCallback(() => {
    posture.reload();
    onChange();
  }, [posture, onChange]);
  return (
    <>
      {posture.error ? <ErrorLine text={posture.error} /> : null}
      {findings.map((f) => (
        <FindingRow key={f.id} finding={f} listen={listen} onChange={reload} />
      ))}
      {oks.map((t) => (
        <Finding key={t} tone="ok" title={t} last={t === oks.at(-1)} />
      ))}
    </>
  );
}

function FindingRow({
  finding,
  listen,
  onChange,
}: {
  finding: FindingT;
  listen: string;
  onChange: () => void;
}) {
  const act = useAction();
  const canAck = useFeature("securityAcknowledge");
  const copy = COPY[finding.id] ?? { title: finding.id.replace(/_/g, " "), body: () => "" };
  const run = useCallback(
    (key: string, fn: () => Promise<unknown>) =>
      void act.run(key, fn).then((ok) => ok && onChange()),
    [act, onChange],
  );
  const ack = useCallback(
    () =>
      run("ack", () =>
        need().setSecurityFindingAcknowledged({ findingId: finding.id, acknowledged: true }),
      ),
    [run, finding.id],
  );
  const noLan = useCallback(
    () => run("fix", () => need().updateAuthSettings({ trustLan: false })),
    [run],
  );
  const claim = useCallback(
    () => run("fix", () => need().updateAuthSettings({ claimMode: true })),
    [run],
  );
  const toDevices = useCallback(() => useUi.getState().openSettings("devices"), []);
  const fix = finding.fixAction;
  return (
    <Finding
      tone={finding.severity === "critical" ? "bad" : "warn"}
      title={copy.title}
      body={act.error ?? copy.body(listen)}
    >
      {fix === "set_password" && <T style={s.hintInline}>Set a password below</T>}
      {fix === "claim" && <Button kind="primary" label="Pair a device" onPress={toDevices} />}
      {fix === "disable_trust_lan" && (
        <Button
          kind="primary"
          label="Stop trusting the LAN"
          onPress={noLan}
          disabled={!!act.pending}
        />
      )}
      {fix === "enable_claim_mode" && (
        <Button
          kind="primary"
          label="Turn on claim mode"
          onPress={claim}
          disabled={!!act.pending}
        />
      )}
      {fix === "bind_loopback" && (
        <T style={s.hintInline}>Bind to 127.0.0.1 in config.json, then restart</T>
      )}
      {canAck && finding.severity !== "critical" && (
        <Button label="This is intended" onPress={ack} disabled={!!act.pending} />
      )}
    </Finding>
  );
}

function PasswordForm({
  enabled,
  pinned: isPinned,
  onChange,
}: {
  enabled: boolean;
  pinned: boolean;
  onChange: () => void;
}) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();
  let problem: string | null = null;
  if (pw && pw.length < 8) problem = "At least 8 characters";
  else if (again && again !== pw) problem = "Passwords don’t match";
  const save = useCallback(() => {
    void act
      .run("set", () => need().setDaemonPassword(pw))
      .then((ok) => {
        if (!ok) return false;
        setPw("");
        setAgain("");
        setDone("Password set. New connections need it.");
        onChange();
        return true;
      });
  }, [act, pw, onChange]);
  const clear = useCallback(() => {
    void act
      .run("clear", () => need().setDaemonPassword(null))
      .then((ok) => {
        if (ok) {
          setDone("Password turned off.");
          onChange();
        }
        return ok;
      });
  }, [act, onChange]);
  if (isPinned)
    return (
      <Row label="Daemon password" hint="Set by FROGG_PASSWORD in the daemon’s environment" last />
    );
  return (
    <>
      <Row
        label="Daemon password"
        hint={problem ?? (enabled ? "Set · change it here" : "At least 8 characters")}
      >
        <View style={s.fields}>
          <Field value={pw} onChangeText={setPw} placeholder="New password" secureTextEntry />
          <Field value={again} onChangeText={setAgain} placeholder="Confirm" secureTextEntry />
        </View>
      </Row>
      <Block last>
        <View style={s.end}>
          {done ? <T style={s.ok}>{done}</T> : null}
          <ErrorLine text={act.error} />
          {enabled && (
            <Button label="Turn off" kind="danger" onPress={clear} disabled={!!act.pending} />
          )}
          <Button
            kind="primary"
            label={act.pending === "set" ? "Setting…" : "Set password"}
            onPress={save}
            disabled={!pw || pw.length < 8 || pw !== again || !!act.pending}
          />
        </View>
      </Block>
    </>
  );
}

function AuthToggles({ settings, onChange }: { settings: Settings; onChange: () => void }) {
  const act = useAction();
  const update = useCallback(
    (patch: { trustLan?: boolean; claimMode?: boolean }) =>
      void act.run("u", () => need().updateAuthSettings(patch)).then((ok) => ok && onChange()),
    [act, onChange],
  );
  const setLan = useCallback((v: boolean) => update({ trustLan: v }), [update]);
  const setClaim = useCallback((v: boolean) => update({ claimMode: v }), [update]);
  return (
    <>
      <Row
        label="Trust local network"
        hint={
          settings.claimMode ? "Ignored while claim mode is on" : "Skip pairing for LAN clients"
        }
      >
        <Toggle
          value={settings.trustLan}
          onChange={setLan}
          disabled={!!act.pending || pinned(settings, "trust")}
        />
      </Row>
      <Row label="Claim mode" hint={act.error ?? "First device to pair becomes owner"} last>
        <Toggle
          value={settings.claimMode}
          onChange={setClaim}
          disabled={!!act.pending || pinned(settings, "claim")}
        />
      </Row>
    </>
  );
}

const s = StyleSheet.create({
  muted: { color: color.muted },
  hintInline: { color: color.faint, fontSize: 12.5, alignSelf: "center" },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: 8, maxWidth: "100%", flexShrink: 1 },
  end: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  ok: { color: color.mint, fontSize: 12.5 },
});
