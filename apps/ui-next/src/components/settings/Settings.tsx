import {
  Activity,
  Bell,
  Bot,
  Eye,
  FileCode,
  Gauge,
  HardDrive,
  Keyboard,
  KeyRound,
  Lock,
  MessageSquare,
  RefreshCw,
  Scissors,
  Server,
  Settings as SettingsIcon,
  Shield,
  Smartphone,
  Tag,
  SquareTerminal,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
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
import { ChatComposer } from "./pages/ChatComposer";
import { FilesEditor } from "./pages/FilesEditor";
import { Notifications } from "./pages/Notifications";
import { VoiceCompanion } from "./pages/VoiceCompanion";
import { Accounts } from "./pages/Accounts";
import { PermissionModes } from "./pages/PermissionModes";
import { UsageLimits } from "./pages/UsageLimits";
import { ContextCleanCut } from "./pages/ContextCleanCut";
import { DevicesAccess } from "./pages/DevicesAccess";
import { Security } from "./pages/Security";
import { SessionLabels } from "./pages/SessionLabels";
import { TerminalProfiles } from "./pages/TerminalProfiles";
import { ResourcesStorage } from "./pages/ResourcesStorage";
import { DaemonUpdates } from "./pages/DaemonUpdates";

type Scope = "You" | "Agents" | "Host";
interface Page {
  id: string;
  label: string;
  icon: LucideIcon;
  scope: Scope;
  /** The page body; pages without one are listed but not built yet. */
  body?: ComponentType;
}

const SCOPES: Scope[] = ["You", "Agents", "Host"];

// Config writes from toggles. Module-level, so rows hand stable callbacks down.
const setAutoArchive = (v: boolean) => void patchConfig({ autoArchiveAfterMerge: v });
const setAutoResume = (v: boolean) => void patchConfig({ autoResumeOnUsageLimit: v });
const setMcp = (v: boolean) => void patchConfig({ mcp: { injectIntoAgents: v } });
const setBrowserTools = (v: boolean) => void patchConfig({ browserTools: { enabled: v } });
const setTerminalHooks = (v: boolean) => void patchConfig({ enableTerminalAgentHooks: v });
const noop = () => {};

function useCfg() {
  return useConfig((st) => st.config);
}

const METADATA_OPTIONS: Array<["auto" | "choose", string]> = [
  ["auto", "Automatic"],
  ["choose", "Choose"],
];

function Automation() {
  const cfg = useCfg();
  if (!cfg) return <T v="label">loading…</T>;
  return (
    <>
      <Section title="Sessions">
        <Row
          label="Archive sessions when their PR merges"
          hint="The worktree is kept; the session leaves the list."
        >
          <Toggle value={cfg.autoArchiveAfterMerge} onChange={setAutoArchive} />
        </Row>
        <Row
          label="Resume after a usage limit resets"
          hint="Sends the interrupted turn again once the provider allows it."
          last
        >
          <Toggle
            value={cfg.autoResumeOnUsageLimit ?? false}
            disabled={cfg.autoResumeOnUsageLimit === undefined}
            onChange={setAutoResume}
          />
        </Row>
      </Section>
      <Section title="Generated names, commits and PR text">
        <Row
          label="Model"
          hint="Which provider writes titles, branch names and commit messages."
          last
        >
          <Seg
            options={METADATA_OPTIONS}
            value={cfg.metadataGeneration.providers.length ? "choose" : "auto"}
            onChange={noop}
          />
        </Row>
      </Section>
    </>
  );
}

function ToolsPrompts() {
  const cfg = useCfg();
  const [prompt, setPrompt] = useState<string | null>(null);
  const draft = prompt ?? cfg?.appendSystemPrompt ?? "";
  const save = useCallback(() => {
    patchConfig({ appendSystemPrompt: draft }).then(
      () => setPrompt(null),
      () => {},
    );
  }, [draft]);
  const revert = useCallback(() => setPrompt(null), []);
  if (!cfg) return <T v="label">loading…</T>;
  return (
    <>
      <Section title="Tools given to agents">
        <Row
          label="Frogg MCP tools"
          hint="Lets agents start sub-agents, open terminals and report progress."
        >
          <Toggle value={cfg.mcp.injectIntoAgents} onChange={setMcp} />
        </Row>
        <Row label="Browser tools" hint="A headless browser agents can drive to check their work.">
          <Toggle value={cfg.browserTools.enabled} onChange={setBrowserTools} />
        </Row>
        <Row
          label="Terminal agent hooks"
          hint="Track agents started by hand in a Frogg terminal."
          last
        >
          <Toggle value={cfg.enableTerminalAgentHooks} onChange={setTerminalHooks} />
        </Row>
      </Section>
      <Section title="Appended system prompt">
        <View style={s.promptBox}>
          <T style={s.faintSmall}>Added to every agent’s system prompt on this host.</T>
          <Area
            value={draft}
            onChange={setPrompt}
            placeholder="e.g. Prefer small commits. Run the tests before you finish."
          />
          <View style={s.buttons}>
            <Button
              kind="primary"
              label="Save"
              disabled={prompt === null || prompt === cfg.appendSystemPrompt}
              onPress={save}
            />
            {prompt !== null && <Button label="Revert" onPress={revert} />}
          </View>
        </View>
      </Section>
    </>
  );
}

function statusTint(st: string): string {
  if (st === "ready") return color.mint;
  if (st === "error" || st === "unavailable") return color.coral;
  return color.amber;
}

function Providers() {
  const providers = useConfig((st) => st.providers);
  if (!providers) return <T v="label">loading…</T>;
  const last = providers.entries.at(-1)?.provider;
  return (
    <Section title="Installed providers">
      {providers.entries.map((p) => (
        <Row
          key={p.provider}
          label={p.label ?? providerLabel(p.provider)}
          hint={
            p.error ??
            `${p.models?.length ?? 0} models${
              p.fetchedAt ? ` · checked ${agoText(p.fetchedAt)}` : ""
            }`
          }
          last={p.provider === last}
        >
          <View style={s.pills}>
            {!p.enabled && <Pill text="disabled" />}
            <Pill text={p.status} tint={statusTint(p.status)} />
          </View>
        </Row>
      ))}
    </Section>
  );
}

function Overview() {
  const status = useConfig((st) => st.status);
  const conn = useDaemon((st) => st.conn);
  const url = useDaemon((st) => st.url);
  return (
    <>
      <Section title="This connection">
        <Row label="Endpoint" hint={url}>
          <Pill text={conn} tint={conn === "online" ? color.mint : color.amber} />
        </Row>
        <Row label="Daemon version" last>
          <T v="mono" style={s.value}>
            {status?.version ?? "—"}
          </T>
        </Row>
      </Section>
      {status && (
        <Section title="Daemon">
          <Row label="Listening on">
            <T v="mono" style={s.value}>
              {status.listen ?? "—"}
            </T>
          </Row>
          <Row label="Started">
            <T v="mono">{status.startedAt ? agoText(status.startedAt) : "—"}</T>
          </Row>
          <Row label="Process" last>
            <T v="mono">pid {status.pid}</T>
          </Row>
        </Section>
      )}
    </>
  );
}

const THEME_OPTIONS: Array<["dark", string]> = [["dark", "Dark"]];
const DENSITY_OPTIONS: Array<["compact" | "comfortable", string]> = [
  ["compact", "Compact"],
  ["comfortable", "Comfortable"],
];

function Appearance() {
  const [density, setDensity] = useState<"compact" | "comfortable">("comfortable");
  const [motionOn, setMotionOn] = useState(true);
  return (
    <Section title="Look and feel">
      <Row label="Theme" hint="Light themes come with the theming pass.">
        <Seg options={THEME_OPTIONS} value="dark" onChange={noop} />
      </Row>
      <Row label="Density">
        <Seg options={DENSITY_OPTIONS} value={density} onChange={setDensity} />
      </Row>
      <Row label="Motion" hint="Rail indicator, bracket and panel transitions." last>
        <Toggle value={motionOn} onChange={setMotionOn} />
      </Row>
    </Section>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["Command palette", "⌘K"],
  ["New session", "⌘N"],
  ["Approve permission", "A"],
  ["Deny permission", "Esc"],
  ["Next / previous session", "J / K"],
  ["Filter sessions", "/"],
  ["New terminal", "⌃`"],
];

function Shortcuts() {
  return (
    <Section title="Global">
      {SHORTCUTS.map(([label, k]) => (
        <Row key={label} label={label} last={label === SHORTCUTS.at(-1)?.[0]}>
          <T v="mono" style={s.kbd}>
            {k}
          </T>
        </Row>
      ))}
    </Section>
  );
}

export const PAGES: Page[] = [
  {
    id: "appearance",
    label: "Appearance",
    icon: Eye,
    scope: "You",
    body: Appearance,
  },
  { id: "chat", label: "Chat & composer", icon: MessageSquare, scope: "You", body: ChatComposer },
  {
    id: "files",
    label: "Files, editor & terminal",
    icon: FileCode,
    scope: "You",
    body: FilesEditor,
  },
  {
    id: "keys",
    label: "Keyboard shortcuts",
    icon: Keyboard,
    scope: "You",
    body: Shortcuts,
  },
  { id: "notify", label: "Notifications & inbox", icon: Bell, scope: "You", body: Notifications },
  { id: "voice", label: "Voice & Companion", icon: Bot, scope: "You", body: VoiceCompanion },
  {
    id: "providers",
    label: "Providers & models",
    icon: Zap,
    scope: "Agents",
    body: Providers,
  },
  { id: "accounts", label: "Accounts", icon: KeyRound, scope: "Agents", body: Accounts },
  { id: "modes", label: "Permission modes", icon: Shield, scope: "Agents", body: PermissionModes },
  { id: "usage", label: "Usage & limits", icon: Gauge, scope: "Agents", body: UsageLimits },
  {
    id: "context",
    label: "Context & clean cut",
    icon: Scissors,
    scope: "Agents",
    body: ContextCleanCut,
  },
  {
    id: "tools",
    label: "Tools, skills & prompts",
    icon: Wrench,
    scope: "Agents",
    body: ToolsPrompts,
  },
  {
    id: "overview",
    label: "Overview & connections",
    icon: Server,
    scope: "Host",
    body: Overview,
  },
  {
    id: "devices",
    label: "Devices & access",
    icon: Smartphone,
    scope: "Host",
    body: DevicesAccess,
  },
  { id: "security", label: "Security", icon: Lock, scope: "Host", body: Security },
  {
    id: "automation",
    label: "Automation",
    icon: RefreshCw,
    scope: "Host",
    body: Automation,
  },
  { id: "labels", label: "Session labels", icon: Tag, scope: "Host", body: SessionLabels },
  {
    id: "terminals",
    label: "Terminal profiles",
    icon: SquareTerminal,
    scope: "Host",
    body: TerminalProfiles,
  },
  {
    id: "resources",
    label: "Resources & storage",
    icon: HardDrive,
    scope: "Host",
    body: ResourcesStorage,
  },
  { id: "daemon", label: "Daemon & updates", icon: Activity, scope: "Host", body: DaemonUpdates },
];

export function SettingsNav() {
  const settingsPage = useUi((st) => st.settingsPage);
  const host = useDaemon((st) => st.serverName);
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.toLowerCase();
    return SCOPES.map((scope) => ({
      scope,
      pages: PAGES.filter((p) => p.scope === scope && p.label.toLowerCase().includes(needle)),
    })).filter((g) => g.pages.length);
  }, [q]);
  return (
    <View style={s.root}>
      <View style={s.navHead}>
        <SettingsIcon size={15} color={color.cyan2} />
        <T v="display" style={s.navTitle}>
          Settings
        </T>
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search settings"
        placeholderTextColor={color.faint}
        style={s.search}
      />
      <ScrollView style={s.grow}>
        {groups.map((g) => (
          <View key={g.scope}>
            <View style={s.scopeHead}>
              <T v="label">{g.scope}</T>
              {g.scope !== "You" && (
                <T v="mono" style={s.tiny}>
                  {host ?? ""}
                </T>
              )}
            </View>
            {g.pages.map((p) => (
              <NavItem key={p.id} page={p} on={p.id === settingsPage} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function NavItem({ page, on }: { page: Page; on: boolean }) {
  const Icon = page.icon;
  const open = useCallback(() => useUi.getState().openSettings(page.id), [page.id]);
  return (
    <Pressable onPress={open}>
      {({ hovered }) => (
        <View style={[s.item, hovered && s.hover, on && s.itemOn]}>
          {on && <Brackets />}
          <Icon size={14} color={on ? color.cyan2 : color.faint} strokeWidth={1.6} />
          <T style={page.body ? s.itemT : s.itemTMuted}>{page.label}</T>
        </View>
      )}
    </Pressable>
  );
}

export function SettingsPage({ id, onBack }: { id: string; onBack?: () => void }) {
  const page = PAGES.find((p) => p.id === id) ?? PAGES[0];
  const conn = useDaemon((st) => st.conn);
  const error = useConfig((st) => st.error);
  const saving = useConfig((st) => st.saving);
  const host = useDaemon((st) => st.serverName);
  useEffect(() => {
    if (conn === "online") void loadConfig();
  }, [conn]);
  const Body = page.body;
  return (
    <View style={s.root}>
      <View style={s.head}>
        <View style={s.grow}>
          <T v="label">{page.scope === "You" ? "you · this device" : page.scope}</T>
          <View style={s.titleRow}>
            {onBack && (
              <Pressable onPress={onBack} accessibilityLabel="Back">
                <T style={s.back}>←</T>
              </Pressable>
            )}
            <T v="display" style={s.title}>
              {page.label}
            </T>
          </View>
        </View>
        {saving && (
          <T v="mono" style={s.saving}>
            saving…
          </T>
        )}
        {page.scope !== "You" && !onBack && (
          <View style={s.badge}>
            <T v="mono" style={s.badgeT}>
              {host ?? "host"} · config.json
            </T>
          </View>
        )}
      </View>
      <ScrollView contentContainerStyle={s.body}>
        {error && (
          <T v="mono" style={s.error}>
            {error}
          </T>
        )}
        {Body ? <Body /> : <T v="label">not built yet</T>}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg2 },
  grow: { flex: 1 },
  tiny: { fontSize: 10.5 },
  hover: { backgroundColor: color.wash },
  navHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    paddingBottom: 10,
  },
  navTitle: { fontSize: 15 },
  search: {
    marginHorizontal: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    ...web({ outlineStyle: "none" }),
  },
  scopeHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  itemOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  itemT: { flex: 1, color: color.text },
  itemTMuted: { flex: 1, color: color.muted },
  head: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  back: { color: color.cyan2, fontSize: 18 },
  title: { fontSize: 21 },
  saving: { color: color.cyan2 },
  badge: {
    backgroundColor: "rgba(139,124,246,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeT: { color: color.violet, fontSize: 11 },
  body: { padding: 24, maxWidth: 840 },
  error: { color: color.coral, marginBottom: 16 },
  promptBox: { padding: 14, gap: 10 },
  faintSmall: { color: color.faint, fontSize: 12.5 },
  buttons: { flexDirection: "row", gap: 8 },
  pills: { flexDirection: "row", gap: 6 },
  value: { color: color.text },
  kbd: {
    borderWidth: 1,
    borderColor: color.line2,
    paddingHorizontal: 6,
    color: color.text,
  },
});
