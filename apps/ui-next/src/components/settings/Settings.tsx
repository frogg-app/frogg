import {
  Activity, Bell, Bot, Eye, FileCode, Gauge, HardDrive, Keyboard, KeyRound, Lock, MessageSquare,
  RefreshCw, Scissors, Server, Settings as SettingsIcon, Shield, Smartphone, Tag, SquareTerminal, Wrench, Zap,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { loadConfig, patchConfig, useConfig } from "../../daemon/config";
import { useDaemon } from "../../daemon/store";
import { color, font, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { agoText, providerLabel } from "../../util";
import { Button } from "../Button";
import { Brackets } from "../SessionList";
import { T } from "../Text";
import { Area, Pill, Row, Section, Seg, Toggle } from "./controls";

type Scope = "You" | "Agents" | "Host";
interface Page {
  id: string;
  label: string;
  icon: LucideIcon;
  scope: Scope;
  render?: () => ReactNode;
}

export const PAGES: Page[] = [
  { id: "appearance", label: "Appearance", icon: Eye, scope: "You", render: () => <Appearance /> },
  { id: "chat", label: "Chat & composer", icon: MessageSquare, scope: "You" },
  { id: "files", label: "Files, editor & terminal", icon: FileCode, scope: "You" },
  { id: "keys", label: "Keyboard shortcuts", icon: Keyboard, scope: "You", render: () => <Shortcuts /> },
  { id: "notify", label: "Notifications & inbox", icon: Bell, scope: "You" },
  { id: "voice", label: "Voice & Companion", icon: Bot, scope: "You" },
  { id: "providers", label: "Providers & models", icon: Zap, scope: "Agents", render: () => <Providers /> },
  { id: "accounts", label: "Accounts", icon: KeyRound, scope: "Agents" },
  { id: "modes", label: "Permission modes", icon: Shield, scope: "Agents" },
  { id: "usage", label: "Usage & limits", icon: Gauge, scope: "Agents" },
  { id: "context", label: "Context & clean cut", icon: Scissors, scope: "Agents" },
  { id: "tools", label: "Tools, skills & prompts", icon: Wrench, scope: "Agents", render: () => <ToolsPrompts /> },
  { id: "overview", label: "Overview & connections", icon: Server, scope: "Host", render: () => <Overview /> },
  { id: "devices", label: "Devices & access", icon: Smartphone, scope: "Host" },
  { id: "security", label: "Security", icon: Lock, scope: "Host" },
  { id: "automation", label: "Automation", icon: RefreshCw, scope: "Host", render: () => <Automation /> },
  { id: "labels", label: "Session labels", icon: Tag, scope: "Host" },
  { id: "terminals", label: "Terminal profiles", icon: SquareTerminal, scope: "Host" },
  { id: "resources", label: "Resources & storage", icon: HardDrive, scope: "Host" },
  { id: "daemon", label: "Daemon & updates", icon: Activity, scope: "Host" },
];

export function SettingsNav() {
  const { settingsPage, openSettings } = useUi();
  const host = useDaemon((s) => s.serverName);
  const [q, setQ] = useState("");
  const scopes: Scope[] = ["You", "Agents", "Host"];
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 14, paddingBottom: 10 }}>
        <SettingsIcon size={15} color={color.cyan2} />
        <T v="display" style={{ fontSize: 15 }}>Settings</T>
      </View>
      <TextInput value={q} onChangeText={setQ} placeholder="Search settings" placeholderTextColor={color.faint} style={s.search} />
      <ScrollView style={{ flex: 1 }}>
        {scopes.map((scope) => {
          const pages = PAGES.filter((p) => p.scope === scope && p.label.toLowerCase().includes(q.toLowerCase()));
          if (!pages.length) return null;
          return (
            <View key={scope}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 }}>
                <T v="label">{scope}</T>
                {scope !== "You" && <T v="mono" style={{ fontSize: 10.5 }}>{host ?? ""}</T>}
              </View>
              {pages.map((p) => {
                const on = p.id === settingsPage;
                const Icon = p.icon;
                return (
                  <Pressable key={p.id} onPress={() => openSettings(p.id)}>
                    {({ hovered }) => (
                      <View style={[s.item, hovered && { backgroundColor: color.wash }, on && { backgroundColor: "rgba(127,217,230,0.05)" }]}>
                        {on && <Brackets />}
                        <Icon size={14} color={on ? color.cyan2 : color.faint} strokeWidth={1.6} />
                        <T style={{ flex: 1, color: p.render ? color.text : color.muted }}>{p.label}</T>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function SettingsPage({ id, onBack }: { id: string; onBack?: () => void }) {
  const page = PAGES.find((p) => p.id === id) ?? PAGES[0];
  const conn = useDaemon((s) => s.conn);
  const { error, saving } = useConfig();
  const host = useDaemon((s) => s.serverName);
  useEffect(() => {
    if (conn === "online") void loadConfig();
  }, [conn]);
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <T v="label">{page.scope === "You" ? "you · this device" : page.scope}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
            {onBack && <Pressable onPress={onBack}><T style={{ color: color.cyan2, fontSize: 18 }}>←</T></Pressable>}
            <T v="display" style={{ fontSize: 21 }}>{page.label}</T>
          </View>
        </View>
        {saving && <T v="mono" style={{ color: color.cyan2 }}>saving…</T>}
        {page.scope !== "You" && !onBack && (
          <View style={s.badge}><T v="mono" style={{ color: color.violet, fontSize: 11 }}>{host ?? "host"} · config.json</T></View>
        )}
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, maxWidth: 840 }}>
        {error && <T v="mono" style={{ color: color.coral, marginBottom: 16 }}>{error}</T>}
        {page.render ? page.render() : <T v="label">not built yet</T>}
      </ScrollView>
    </View>
  );
}

function useCfg() {
  return useConfig((s) => s.config);
}

function Automation() {
  const cfg = useCfg();
  if (!cfg) return <T v="label">loading…</T>;
  return (
    <>
      <Section title="Sessions">
        <Row label="Archive sessions when their PR merges" hint="The worktree is kept; the session leaves the list.">
          <Toggle value={cfg.autoArchiveAfterMerge} onChange={(v) => void patchConfig({ autoArchiveAfterMerge: v })} />
        </Row>
        <Row label="Resume after a usage limit resets" hint="Sends the interrupted turn again once the provider allows it." last>
          <Toggle
            value={cfg.autoResumeOnUsageLimit ?? false}
            disabled={cfg.autoResumeOnUsageLimit === undefined}
            onChange={(v) => void patchConfig({ autoResumeOnUsageLimit: v })}
          />
        </Row>
      </Section>
      <Section title="Generated names, commits and PR text">
        <Row label="Model" hint="Which provider writes titles, branch names and commit messages." last>
          <Seg
            options={[["auto", "Automatic"], ["choose", "Choose"]]}
            value={cfg.metadataGeneration.providers.length ? "choose" : "auto"}
            onChange={() => {}}
          />
        </Row>
      </Section>
    </>
  );
}

function ToolsPrompts() {
  const cfg = useCfg();
  const [prompt, setPrompt] = useState<string | null>(null);
  if (!cfg) return <T v="label">loading…</T>;
  const draft = prompt ?? cfg.appendSystemPrompt;
  return (
    <>
      <Section title="Tools given to agents">
        <Row label="Frogg MCP tools" hint="Lets agents start sub-agents, open terminals and report progress.">
          <Toggle value={cfg.mcp.injectIntoAgents} onChange={(v) => void patchConfig({ mcp: { injectIntoAgents: v } })} />
        </Row>
        <Row label="Browser tools" hint="A headless browser agents can drive to check their work.">
          <Toggle value={cfg.browserTools.enabled} onChange={(v) => void patchConfig({ browserTools: { enabled: v } })} />
        </Row>
        <Row label="Terminal agent hooks" hint="Track agents started by hand in a Frogg terminal." last>
          <Toggle value={cfg.enableTerminalAgentHooks} onChange={(v) => void patchConfig({ enableTerminalAgentHooks: v })} />
        </Row>
      </Section>
      <Section title="Appended system prompt">
        <View style={{ padding: 14, gap: 10 }}>
          <T style={{ color: color.faint, fontSize: 12.5 }}>Added to every agent's system prompt on this host.</T>
          <Area value={draft} onChange={setPrompt} placeholder="e.g. Prefer small commits. Run the tests before you finish." />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              kind="primary"
              label="Save"
              disabled={prompt === null || prompt === cfg.appendSystemPrompt}
              onPress={() => void patchConfig({ appendSystemPrompt: draft }).then(() => setPrompt(null))}
            />
            {prompt !== null && <Button label="Revert" onPress={() => setPrompt(null)} />}
          </View>
        </View>
      </Section>
    </>
  );
}

function Providers() {
  const providers = useConfig((s) => s.providers);
  if (!providers) return <T v="label">loading…</T>;
  const tint = (st: string) => (st === "ready" ? color.mint : st === "error" || st === "unavailable" ? color.coral : color.amber);
  return (
    <Section title="Installed providers">
      {providers.entries.map((p, i) => (
        <Row
          key={p.provider}
          label={p.label ?? providerLabel(p.provider)}
          hint={p.error ?? `${p.models?.length ?? 0} models${p.fetchedAt ? ` · checked ${agoText(p.fetchedAt)}` : ""}`}
          last={i === providers.entries.length - 1}
        >
          <View style={{ flexDirection: "row", gap: 6 }}>
            {!p.enabled && <Pill text="disabled" />}
            <Pill text={p.status} tint={tint(p.status)} />
          </View>
        </Row>
      ))}
    </Section>
  );
}

function Overview() {
  const status = useConfig((s) => s.status);
  const conn = useDaemon((s) => s.conn);
  const url = useDaemon((s) => s.url);
  return (
    <>
      <Section title="This connection">
        <Row label="Endpoint" hint={url}><Pill text={conn} tint={conn === "online" ? color.mint : color.amber} /></Row>
        <Row label="Daemon version" last><T v="mono" style={{ color: color.text }}>{status?.version ?? "—"}</T></Row>
      </Section>
      {status && (
        <Section title="Daemon">
          <Row label="Listening on"><T v="mono" style={{ color: color.text }}>{status.listen ?? "—"}</T></Row>
          <Row label="Started"><T v="mono">{status.startedAt ? agoText(status.startedAt) : "—"}</T></Row>
          <Row label="Process" last><T v="mono">pid {status.pid}</T></Row>
        </Section>
      )}
    </>
  );
}

function Appearance() {
  const [density, setDensity] = useState<"compact" | "comfortable">("comfortable");
  const [motion, setMotion] = useState(true);
  return (
    <Section title="Look and feel">
      <Row label="Theme" hint="Light themes come with the theming pass."><Seg options={[["dark", "Dark"]]} value="dark" onChange={() => {}} /></Row>
      <Row label="Density"><Seg options={[["compact", "Compact"], ["comfortable", "Comfortable"]]} value={density} onChange={setDensity} /></Row>
      <Row label="Motion" hint="Rail indicator, bracket and panel transitions." last><Toggle value={motion} onChange={setMotion} /></Row>
    </Section>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["Command palette", "⌘K"], ["New session", "⌘N"], ["Approve permission", "A"], ["Deny permission", "Esc"],
  ["Next / previous session", "J / K"], ["Filter sessions", "/"], ["New terminal", "⌃`"],
];

function Shortcuts() {
  return (
    <Section title="Global">
      {SHORTCUTS.map(([label, k], i) => (
        <Row key={label} label={label} last={i === SHORTCUTS.length - 1}>
          <T v="mono" style={{ borderWidth: 1, borderColor: color.line2, paddingHorizontal: 6, color: color.text }}>{k}</T>
        </Row>
      ))}
    </Section>
  );
}

const s = StyleSheet.create({
  search: {
    marginHorizontal: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: color.panel, borderWidth: 1,
    borderColor: color.line, color: color.text, fontFamily: font.body, fontSize: 13, ...web({ outlineStyle: "none" }),
  },
  item: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 8, paddingHorizontal: 10, paddingVertical: 8 },
  head: { flexDirection: "row", alignItems: "flex-end", gap: 12, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: color.line },
  badge: { backgroundColor: "rgba(139,124,246,0.12)", paddingHorizontal: 8, paddingVertical: 4 },
});

