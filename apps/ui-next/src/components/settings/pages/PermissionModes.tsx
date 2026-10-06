import { ScrollView, StyleSheet, View } from "react-native";
import { prefSetter, usePrefs, type Prefs } from "../../../prefs";
import { color } from "../../../theme/tokens";
import { T } from "../../Text";
import { Lede, Row, Section, Seg, Toggle } from "../controls";

const PROVIDERS = ["Claude Code", "Codex", "Copilot", "OpenCode"] as const;

/** Frogg's shared mode vocabulary and each provider's own name for it ("—" = no such level). */
const MODES: Array<{ id: string; name: string; desc: string; map: string[] }> = [
  {
    id: "plan",
    name: "Plan",
    desc: "Read and propose; nothing changes until you approve the plan",
    map: ["Plan Mode", "Plan feature", "Plan", "Plan"],
  },
  {
    id: "ask",
    name: "Ask",
    desc: "Ask before every edit and command",
    map: ["Always Ask", "Default Permissions", "Agent", "—"],
  },
  {
    id: "edits",
    name: "Auto-edit",
    desc: "Edit files freely, ask before commands",
    map: ["Accept File Edits", "Auto-review", "—", "Build"],
  },
  {
    id: "auto",
    name: "Auto",
    desc: "Provider decides what is safe; asks for risky actions",
    map: ["Auto mode", "—", "—", "—"],
  },
  {
    id: "unattended",
    name: "Unattended",
    desc: "Never asks. Use in sandboxes and throwaway worktrees",
    map: ["Bypass", "Full Access", "Allow All", "—"],
  },
];

const START: Array<[Prefs["defaultMode"], string]> = [
  ["plan", "Plan"],
  ["ask", "Ask"],
  ["edits", "Auto-edit"],
  ["auto", "Auto"],
  ["unattended", "Unattended"],
];
const CYCLE: Array<[Prefs["shiftTab"], string]> = [
  ["safe", "Plan → Ask → Auto-edit"],
  ["all", "All modes"],
];

function ModeRow({ mode, last }: { mode: (typeof MODES)[number]; last: boolean }) {
  return (
    <View style={[s.tr, !last && s.line]}>
      <View style={s.modeCell}>
        <T style={s.mode}>{mode.name}</T>
        <T style={s.desc}>{mode.desc}</T>
      </View>
      {PROVIDERS.map((p, i) => (
        <T key={p} v="mono" style={mode.map[i] === "—" ? s.none : s.val}>
          {mode.map[i]}
        </T>
      ))}
    </View>
  );
}

export function PermissionModes() {
  const p = usePrefs();
  const start = p.allowUnattended ? START : START.filter(([v]) => v !== "unattended");
  return (
    <>
      <Lede>
        One vocabulary across providers. Each mode maps to the provider’s own name; providers that
        lack a level skip it in the picker.
      </Lede>
      <Section title="Modes">
        <ScrollView horizontal contentContainerStyle={s.table}>
          <View style={s.tableIn}>
            <View style={[s.tr, s.line]}>
              <T v="label" style={s.modeHead}>
                Mode
              </T>
              {PROVIDERS.map((name) => (
                <T key={name} v="label" style={s.th}>
                  {name}
                </T>
              ))}
            </View>
            {MODES.map((m, i) => (
              <ModeRow key={m.id} mode={m} last={i === MODES.length - 1} />
            ))}
          </View>
        </ScrollView>
      </Section>
      <Section title="Defaults">
        <Row label="New sessions start in">
          <Seg options={start} value={p.defaultMode} onChange={prefSetter("defaultMode")} />
        </Row>
        <Row label="Allow Unattended" hint="Off hides it from the picker on every client">
          <Toggle value={p.allowUnattended} onChange={prefSetter("allowUnattended")} />
        </Row>
        <Row label="Unattended only in worktrees" hint="Never on Local isolation">
          <Toggle
            value={p.unattendedWorktreesOnly}
            onChange={prefSetter("unattendedWorktreesOnly")}
            disabled={!p.allowUnattended}
          />
        </Row>
        <Row label="⇧Tab cycles" last>
          <Seg options={CYCLE} value={p.shiftTab} onChange={prefSetter("shiftTab")} />
        </Row>
      </Section>
    </>
  );
}

const s = StyleSheet.create({
  table: { flexGrow: 1 },
  tableIn: { flex: 1, minWidth: 720 },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 11 },
  line: { borderBottomWidth: 1, borderBottomColor: color.line },
  modeHead: { flex: 2.2 },
  th: { flex: 1 },
  modeCell: { flex: 2.2, paddingRight: 16 },
  mode: { fontWeight: "500" },
  desc: { color: color.faint, fontSize: 12, marginTop: 3, lineHeight: 17 },
  val: { flex: 1, color: color.cyan, fontSize: 12, paddingRight: 8 },
  none: { flex: 1, color: color.faint, fontSize: 12 },
});
