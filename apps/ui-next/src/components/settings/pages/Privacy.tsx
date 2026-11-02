import { ChartColumn } from "lucide-react-native";
import { useCallback, useState } from "react";
import { patchConfig, useConfig } from "../../../daemon/config";
import { useDaemon } from "../../../daemon/store";
import {
  setUsageStatsConsent,
  usageStatsAvailable,
  useUsageStats,
} from "../../../usage-stats/store";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Note, Row, Section, Toggle } from "../controls";
import { BugReport } from "./BugReport";
import { Banner, Block, ErrorLine, useAction } from "./kit";

const optIn = () => setUsageStatsConsent(true);
const optOut = () => setUsageStatsConsent(false);

/** What each event carries, as shown to the user before and after opting in. */
const EVENTS: Array<[string, string]> = [
  ["app_opened, app_active", "The app started, and was used today"],
  ["panel_opened, settings_opened", "Which view or settings page you opened, by name"],
  ["session_started", "A session started, and with which provider"],
  ["host_added", "A host was added, and how it connects"],
  ["bug_report_sent", "A bug report was sent, and whether it had a chat"],
];

/**
 * Settings → Privacy & feedback: the opt-in usage statistics ("Help improve Frogg") for this
 * device and for the connected host, exactly what is sent, and Report a bug.
 */
export function Privacy() {
  const available = usageStatsAvailable();
  const consent = useUsageStats((st) => st.consent);
  const sent = useUsageStats((st) => st.sent);
  const host = useDaemon((st) => st.serverName);
  const hostStats = useConfig((st) => st.config?.usageStats);
  const act = useAction();
  const [showSent, setShowSent] = useState(false);
  const toggleSent = useCallback(() => setShowSent((v) => !v), []);
  const setHost = useCallback(
    (v: boolean) => void act.run("host", () => patchConfig({ usageStats: v })),
    [act],
  );
  return (
    <>
      {available && consent === "unset" && (
        <Banner
          icon={ChartColumn}
          title="Help improve Frogg"
          body="Send usage statistics: which features you use and which build you run, so we know what to work on. Never your prompts, code, file paths or other data. Off until you turn it on, and you can see every batch below."
        >
          <Button label="Send usage statistics" kind="primary" onPress={optIn} />
          <Button label="No thanks" onPress={optOut} />
        </Banner>
      )}
      <Section title="Usage statistics">
        <Row
          label="Send usage statistics"
          hint={
            available
              ? "App interactions from this device only. Turning it off deletes this device's statistics id."
              : "This build has no statistics collector, so nothing is ever sent."
          }
        >
          <Toggle
            value={consent === "on"}
            onChange={setUsageStatsConsent}
            disabled={!available}
            label="Send usage statistics"
          />
        </Row>
        <Row
          label={`Send from ${host ?? "this host"}`}
          hint={
            hostStats === undefined
              ? "Needs a newer daemon on this host"
              : "The daemon's version, OS and provider count, once a day. Each batch is logged to usage-stats.log in the host's Frogg home."
          }
          last
        >
          <Toggle
            value={hostStats === true}
            onChange={setHost}
            disabled={!available || hostStats === undefined || act.pending === "host"}
            label="Send usage statistics from this host"
          />
        </Row>
      </Section>
      <ErrorLine text={act.error} />
      <Section title="What is sent">
        {EVENTS.map(([name, what]) => (
          <Row key={name} label={what} hint={name} />
        ))}
        <Row
          label="Every batch also carries"
          hint="A random statistics id, the app's name, version, OS and platform, and times rounded to the minute"
          last={!showSent}
        >
          <Button
            label={showSent ? "Hide sent" : `Show sent (${sent.length})`}
            onPress={toggleSent}
            disabled={sent.length === 0}
          />
        </Row>
        {showSent && (
          <Block last>
            <T v="mono" selectable>
              {Array.from(sent, (_, i) =>
                JSON.stringify(sent[sent.length - 1 - i]!.batch, null, 2),
              ).join("\n\n")}
            </T>
          </Block>
        )}
      </Section>
      <Note>The event list is the whole allowlist: anything else is dropped before sending.</Note>
      <BugReport />
    </>
  );
}
