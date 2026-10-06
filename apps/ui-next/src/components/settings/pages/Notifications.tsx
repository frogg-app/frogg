import { useCallback } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { color, font } from "../../../theme/tokens";
import { Select, type Option } from "../../Select";
import { T } from "../../Text";
import {
  prefSetter,
  setDelivery,
  usePrefs,
  type ChannelKey,
  type NotifyKind,
} from "../../../prefs";
import { Row, Section, Seg, TextField, Toggle } from "../controls";

const KEEP: Array<Option<string>> = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "forever", label: "Forever" },
];
const BADGE: Array<["attention" | "unread" | "none", string]> = [
  ["attention", "Needs you + failures"],
  ["unread", "All unread"],
  ["none", "Nothing"],
];
const CHANNELS: Array<[ChannelKey, string]> = [
  ["inbox", "Inbox"],
  ["desktop", "Desktop"],
  ["push", "Push"],
  ["spoken", "Spoken"],
  ["sound", "Sound"],
];
const KINDS: Array<[NotifyKind, string]> = [
  ["needsYou", "Needs you (permission, question, plan)"],
  ["failed", "Failed (agent error, CI failed)"],
  ["finished", "Finished"],
  ["host", "Host storage & security"],
  ["updates", "Updates available"],
  ["plugins", "Plugin notifications"],
  ["pairing", "Pairing requests"],
];

function Cell({ kind, channel, on }: { kind: NotifyKind; channel: ChannelKey; on: boolean }) {
  const flip = useCallback((v: boolean) => setDelivery(kind, channel, v), [kind, channel]);
  return (
    <View style={s.cell}>
      <Toggle value={on} onChange={flip} />
    </View>
  );
}

function RuleRow({ kind, label, last }: { kind: NotifyKind; label: string; last: boolean }) {
  const rule = usePrefs((st) => st.deliver[kind]);
  return (
    <View style={[s.tr, !last && s.line]}>
      <T style={s.name}>{label}</T>
      {CHANNELS.map(([c]) => (
        <Cell key={c} kind={kind} channel={c} on={rule[c]} />
      ))}
    </View>
  );
}

export function Notifications() {
  const p = usePrefs();
  return (
    <>
      <Section title="Inbox">
        <Row
          label="Keep notifications for"
          hint="Everything below lands in the Inbox first; toasts and OS alerts are copies"
        >
          <Select value={p.keepDays} options={KEEP} onChange={prefSetter("keepDays")} width={120} />
        </Row>
        <Row label="Badge the rail with" last>
          <Seg options={BADGE} value={p.railBadge} onChange={prefSetter("railBadge")} />
        </Row>
      </Section>
      <Section title="Deliver by type">
        <ScrollView horizontal contentContainerStyle={s.table}>
          <View style={s.full}>
            <View style={[s.tr, s.line]}>
              <View style={s.name} />
              {CHANNELS.map(([c, label]) => (
                <T key={c} style={[s.cell, s.th]}>
                  {label}
                </T>
              ))}
            </View>
            {KINDS.map(([k, label]) => (
              <RuleRow key={k} kind={k} label={label} last={k === "pairing"} />
            ))}
          </View>
        </ScrollView>
      </Section>
      <Section title="This device">
        <Row label="Play sound">
          <Toggle value={p.playSound} onChange={prefSetter("playSound")} />
        </Row>
        <Row label="Quiet hours" hint="Hold desktop and push; Inbox still records" last>
          <View style={s.quiet}>
            <TextField value={p.quietFrom} onChange={prefSetter("quietFrom")} width={70} />
            <T style={s.dash}>–</T>
            <TextField value={p.quietTo} onChange={prefSetter("quietTo")} width={70} />
          </View>
        </Row>
      </Section>
    </>
  );
}

const s = StyleSheet.create({
  table: { flexGrow: 1 },
  full: { flex: 1, minWidth: 600 },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, minHeight: 38 },
  line: { borderBottomWidth: 1, borderBottomColor: color.line },
  name: { flex: 1, minWidth: 220, fontSize: 13 },
  cell: { width: 76, alignItems: "center", textAlign: "center" },
  th: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: color.faint,
    textTransform: "uppercase",
  },
  quiet: { flexDirection: "row", alignItems: "center", gap: 8 },
  dash: { color: color.muted },
});
