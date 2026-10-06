import { useCallback, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { patchConfig, useConfig } from "../../../daemon/config";
import { getClient, useDaemon } from "../../../daemon/store";
import {
  accountName,
  groupReports,
  loadUsage,
  usedPct,
  useUsage,
  type ProviderAccount,
  type ProviderUsage,
  type UsageGroup,
} from "../../../daemon/usage";
import { prefSetter, usePrefs, type Prefs } from "../../../prefs";
import { color } from "../../../theme/tokens";
import { Select, type Option } from "../../Select";
import { T } from "../../Text";
import { until, useToneFor } from "../../UsagePanel";
import { Note, NumField, Pill, Row, Section, Toggle } from "../controls";

const COUNTDOWN: Array<Option<Prefs["resumeCountdown"]>> = [
  { value: "reset", label: "Immediately at reset" },
  { value: "1m", label: "1 minute after reset" },
  { value: "5m", label: "5 minutes after reset" },
  { value: "off", label: "No countdown" },
];
const setResume = (v: boolean) => void patchConfig({ autoResumeOnUsageLimit: v });
const pct = (key: "warnPct" | "criticalPct") => (v: number | null) =>
  prefSetter(key)(v ?? PCT_DEFAULT[key]);
const PCT_DEFAULT = { warnPct: 65, criticalPct: 90 };
const setWarn = pct("warnPct");
const setCritical = pct("criticalPct");

export function UsageLimits() {
  const p = usePrefs();
  const host = useDaemon((st) => st.serverName);
  const resume = useConfig((st) => st.config?.autoResumeOnUsageLimit);
  const setSeconds = useCallback((v: number | null) => prefSetter("meterSeconds")(v ?? 30), []);
  const conn = useDaemon((st) => st.conn);
  const groups = useUsage((st) => st.groups);
  useEffect(() => {
    if (conn === "online" && getClient() && !useUsage.getState().groups) void loadUsage();
  }, [conn]);
  const shown = groups?.filter(groupReports) ?? [];
  const multi = shown.filter((g) => g.accounts.length > 1);
  return (
    <>
      <Section title="Meters">
        <Row label="Refresh on a timer">
          <Toggle value={p.meterTimer} onChange={prefSetter("meterTimer")} />
          <NumField value={p.meterSeconds} onChange={setSeconds} unit="s" min={5} max={3600} />
        </Row>
        <Row label="Refresh on hover">
          <Toggle value={p.meterHover} onChange={prefSetter("meterHover")} />
        </Row>
        <Row label="Refresh after a reply">
          <Toggle value={p.meterAfterReply} onChange={prefSetter("meterAfterReply")} />
        </Row>
        <Row label="Warning at">
          <NumField value={p.warnPct} onChange={setWarn} unit="%" min={1} max={100} />
        </Row>
        <Row label="Critical at">
          <NumField value={p.criticalPct} onChange={setCritical} unit="%" min={1} max={100} />
        </Row>
        <Row label="Animate changes" last>
          <Toggle value={p.meterAnimate} onChange={prefSetter("meterAnimate")} />
        </Row>
      </Section>
      <Note>Device settings for the rings in the composer and status bar</Note>
      {shown.length > 0 ? (
        <>
          <Section title="Limits by account">
            {shown.map((g, gi) => (
              <GroupRows key={g.providerId} group={g} last={gi === shown.length - 1} />
            ))}
          </Section>
          <Note>
            Limits come from each sign-in’s plan; the thresholds above apply to all of them
          </Note>
        </>
      ) : null}
      <Section title="When a limit is hit">
        <Row label="Resume after the window resets" hint={host ?? "host"}>
          {/* COMPAT: daemons before autoResumeOnUsageLimit omit the key. */}
          {resume === undefined ? (
            <Pill text="needs a newer daemon" />
          ) : (
            <Toggle value={resume} onChange={setResume} />
          )}
        </Row>
        <Row label="Auto-resume countdown" hint="Shown in the composer; cancel any time">
          <Select
            value={p.resumeCountdown}
            options={COUNTDOWN}
            onChange={prefSetter("resumeCountdown")}
            width={220}
          />
        </Row>
        <Row
          label="Suggest moving to another account"
          hint={
            multi.length > 0
              ? `Offers the ${multi.map((g) => g.displayName).join(" or ")} account with headroom`
              : "Needs a second account on the same provider"
          }
          last
        >
          <Toggle value={p.suggestSwitch} onChange={prefSetter("suggestSwitch")} />
        </Row>
      </Section>
    </>
  );
}

function GroupRows({ group: g, last }: { group: UsageGroup; last: boolean }) {
  if (g.accounts.length === 0)
    return <LimitRow title={g.displayName} usage={g.usage} account={null} last={last} />;
  return (
    <>
      {g.accounts.map((a, i) => (
        <LimitRow
          key={a.account.id}
          title={`${g.displayName} · ${accountName(a.account)}`}
          usage={a.usage}
          account={a.account}
          error={a.error}
          last={last && i === g.accounts.length - 1}
        />
      ))}
    </>
  );
}

function LimitRow({
  title,
  usage,
  account,
  error,
  last,
}: {
  title: string;
  usage: ProviderUsage | null;
  account: ProviderAccount | null;
  error?: string | null;
  last: boolean;
}) {
  const hint = [
    usage?.accountEmail,
    usage?.planLabel,
    account?.isActive ? "used for new sessions" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  let state: string | null = null;
  if (account && !account.authenticated) state = "signed out";
  else if (error || usage?.status === "error") state = "error";
  else if (!usage || usage.status === "unavailable") state = "no usage reported";
  return (
    <Row label={title} hint={hint || undefined} last={last}>
      {state ? (
        <Pill text={state} tint={state === "no usage reported" ? color.muted : color.coral} />
      ) : (
        <View style={s.wins}>
          {usage?.windows.map((w) => (
            <WindowLine key={w.id} label={w.label} used={usedPct(w)} resetsAt={w.resetsAt} />
          ))}
        </View>
      )}
    </Row>
  );
}

function WindowLine({
  label,
  used,
  resetsAt,
}: {
  label: string;
  used: number | null;
  resetsAt?: string | null;
}) {
  const toneFor = useToneFor();
  return (
    <View style={s.win}>
      <T v="mono" style={s.winL} numberOfLines={1}>
        {label}
      </T>
      <T v="mono" style={[s.winP, tone(toneFor(used))]}>
        {used === null ? "—" : `${Math.round(used)}%`}
      </T>
      <T v="mono" style={s.winR} numberOfLines={1}>
        {until(resetsAt)?.replace("resets ", "") ?? ""}
      </T>
    </View>
  );
}

const toneCache = new Map<string, object>();
function tone(tint: string) {
  let st = toneCache.get(tint);
  if (!st) {
    st = StyleSheet.create({ t: { color: tint } }).t;
    toneCache.set(tint, st);
  }
  return st;
}

const s = StyleSheet.create({
  wins: { gap: 3, width: 230, maxWidth: "100%" },
  win: { flexDirection: "row", gap: 10 },
  winL: { flex: 1, fontSize: 11, color: color.faint },
  winP: { fontSize: 11, width: 40, textAlign: "right" },
  winR: { fontSize: 11, width: 52, color: color.faint, textAlign: "right" },
});
