import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { patchConfig, useConfig } from "../../../daemon/config";
import { getClient, useDaemon } from "../../../daemon/store";
import { prefSetter, usePrefs } from "../../../prefs";
import { color } from "../../../theme/tokens";
import { Select, type Option } from "../../Select";
import { T } from "../../Text";
import { NumField, Pill, Row, Section, Seg, Toggle } from "../controls";

const LENGTH: Array<["brief" | "detailed", string]> = [
  ["brief", "Brief"],
  ["detailed", "Detailed"],
];
const UPDATES: Array<["both" | "completions" | "off", string]> = [
  ["both", "Completions and failures"],
  ["completions", "Completions"],
  ["off", "Off"],
];
const AUDIO: Array<["call" | "media", string]> = [
  ["call", "Call"],
  ["media", "Media"],
];
const PAUSE: Array<["quick" | "natural" | "relaxed", string]> = [
  ["quick", "Quick"],
  ["natural", "Natural"],
  ["relaxed", "Relaxed"],
];
const BARGE: Array<["instant" | "short" | "deliberate", string]> = [
  ["instant", "Instantly"],
  ["short", "Short"],
  ["deliberate", "Deliberate"],
];
const DEFAULT = "__default__";
const setSpeed = (v: number | null) => prefSetter("voiceSpeed")(v ?? 1);
const setModel = (v: string) => void patchConfig({ companionModel: v === DEFAULT ? null : v });

interface CompanionDetails {
  backend?: "cli" | "codex" | "api" | null;
  model?: string | null;
}

/** The host's Companion backend, from server_info capabilities. */
function useCompanionDetails(): CompanionDetails | null {
  const conn = useDaemon((st) => st.conn);
  return useMemo(() => {
    if (conn !== "online") return null;
    const info = getClient()?.getLastServerInfoMessage() as
      | { capabilities?: { companionDetails?: CompanionDetails } }
      | null
      | undefined;
    return info?.capabilities?.companionDetails ?? null;
  }, [conn]);
}

function ModelPicker() {
  const current = useConfig((st) => st.config?.companionModel);
  const providers = useConfig((st) => st.providers);
  const details = useCompanionDetails();
  const provider = details?.backend === "codex" ? "codex" : "claude";
  const options = useMemo<Array<Option<string>>>(() => {
    const models =
      providers?.entries
        .find((e) => e.provider === provider)
        ?.models?.filter((m) => m.isSelectable !== false)
        .map((m) => ({ value: m.id, label: m.label })) ?? [];
    if (current && !models.some((m) => m.value === current))
      models.unshift({ value: current, label: current });
    const fallback = details?.model ? `Default (${details.model})` : "Default";
    return [{ value: DEFAULT, label: fallback }, ...models];
  }, [providers, provider, current, details]);
  // COMPAT: older daemons do not report companionModel.
  if (current === undefined) return <Pill text="needs a newer daemon" />;
  return <Select value={current ?? DEFAULT} options={options} onChange={setModel} width={220} />;
}

export function VoiceCompanion() {
  const p = usePrefs();
  const host = useDaemon((st) => st.serverName);
  return (
    <>
      <View style={s.head}>
        <T style={s.title}>COMPANION</T>
        <Pill text="preview" tint={color.amber} />
      </View>
      <Section title="">
        <Row label="Enable Companion" hint="Talk to your sessions hands-free">
          <Toggle value={p.companion} onChange={prefSetter("companion")} />
        </Row>
        <Row label="Conversation model" hint={`${host ?? "host"} config.json`}>
          <ModelPicker />
        </Row>
        <Row label="Reply length">
          <Seg options={LENGTH} value={p.replyLength} onChange={prefSetter("replyLength")} />
        </Row>
        <Row label="Spoken task updates">
          <Seg options={UPDATES} value={p.spokenUpdates} onChange={prefSetter("spokenUpdates")} />
        </Row>
        <Row label="Acknowledge tasks before working">
          <Toggle value={p.acknowledge} onChange={prefSetter("acknowledge")} />
        </Row>
        <Row label="Audio mode">
          <Seg options={AUDIO} value={p.audioMode} onChange={prefSetter("audioMode")} />
        </Row>
        <Row label="Voice speed">
          <NumField
            value={p.voiceSpeed}
            onChange={setSpeed}
            unit="×"
            min={0.5}
            max={2}
            step={0.1}
          />
        </Row>
        <Row label="Pause before replying">
          <Seg options={PAUSE} value={p.pause} onChange={prefSetter("pause")} />
        </Row>
        <Row label="Let me interrupt by speaking">
          <Seg options={BARGE} value={p.bargeIn} onChange={prefSetter("bargeIn")} />
        </Row>
        <Row label="Animate voice graphics">
          <Toggle value={p.animateVoice} onChange={prefSetter("animateVoice")} />
        </Row>
        <Row label="Show reply text">
          <Toggle value={p.showReplyText} onChange={prefSetter("showReplyText")} />
        </Row>
        <Row label="Codex voice" hint="Experimental" last>
          <Toggle value={p.codexVoice} onChange={prefSetter("codexVoice")} />
        </Row>
      </Section>
      <Section title="Spoken alerts">
        <Row label="Auto-play spoken alerts">
          <Toggle value={p.autoplayAlerts} onChange={prefSetter("autoplayAlerts")} />
        </Row>
        <Row label="Confirm voice replies" hint="Shows the transcript for 2 s before sending" last>
          <Toggle value={p.confirmReplies} onChange={prefSetter("confirmReplies")} />
        </Row>
      </Section>
    </>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: -18 },
  title: { fontSize: 11, letterSpacing: 1.6, color: color.muted, fontWeight: "600" },
});
