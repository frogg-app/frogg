import { useCallback } from "react";
import { patchConfig, useConfig } from "../../../daemon/config";
import { useDaemon } from "../../../daemon/store";
import { prefSetter, usePrefs, type Prefs } from "../../../prefs";
import { Select, type Option } from "../../Select";
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
        <Row label="Suggest moving to another account" last>
          <Toggle value={p.suggestSwitch} onChange={prefSetter("suggestSwitch")} />
        </Row>
      </Section>
    </>
  );
}
