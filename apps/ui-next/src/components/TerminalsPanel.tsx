import { PanelLeftClose, PanelLeftOpen, Plus, SquareTerminal, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useDaemon } from "../daemon/store";
import { useHosts } from "../daemon/hosts";
import {
  killTerminal,
  killTerminalOnHost,
  openTerminalOnHost,
  refreshFleetTerminals,
  type TerminalInfo,
  newTerminal,
  useFleetTerminals,
  useTerminals,
  watchTerminals,
} from "../daemon/terminals";
import { setPref, usePrefs } from "../prefs";
import { color, ease, web } from "../theme/tokens";
import { useUi } from "../ui-store";
import { Button } from "./Button";
import { GroupHead, PanelHead } from "./PanelHead";
import { useActiveCwd } from "./ScmPanel";
import { Brackets, BracketScope } from "./Brackets";
import { T } from "./Text";
import { useConfirm } from "./tools/Confirm";
import { TerminalSurface } from "./TerminalView";

const short = (cwd: string) => "…/" + cwd.split("/").slice(-2).join("/");

/** Every checkout a session on this host points at, most recently active first, with a label. */
function useCheckouts(): Array<{ cwd: string; label: string }> {
  const sessions = useDaemon((s) => s.sessions);
  return useMemo(() => {
    const seen = new Map<string, string>();
    const sorted = Object.values(sessions).sort(
      (a, b) => Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt),
    );
    for (const s of sorted) {
      const cwd = s.agent.cwd;
      if (!cwd || seen.has(cwd)) continue;
      const p = s.project;
      const name = p ? [p.projectName, p.workspaceName].filter(Boolean).join(" · ") : "";
      seen.set(cwd, name || short(cwd));
    }
    return [...seen].map(([cwd, label]) => ({ cwd, label }));
  }, [sessions]);
}

/**
 * Every terminal on the host, grouped by checkout. The open session's checkout comes first
 * (new terminals start there); other checkouts and terminals no session points at follow, so
 * switching sessions never hides a terminal.
 */
export function TerminalsPanel() {
  const cwd = useActiveCwd();
  const conn = useDaemon((s) => s.conn);
  const checkouts = useCheckouts();
  const { groups, all, error } = useTerminals();
  const [busy, setBusy] = useState(false);
  const { terminalId, openTerminal } = useUi();
  const cwds = useMemo(
    () => [...new Set([...(cwd ? [cwd] : []), ...checkouts.map((c) => c.cwd)])],
    [cwd, checkouts],
  );
  useEffect(() => {
    if (conn === "online")
      void watchTerminals(cwds, cwd).catch((e: unknown) =>
        useTerminals.setState({ error: String(e) }),
      );
  }, [cwds, cwd, conn]);
  const create = useCallback(
    async (dir: string | null) => {
      if (busy || !dir || conn !== "online") return;
      setBusy(true);
      try {
        const id = await newTerminal(dir);
        if (id) openTerminal(id);
      } catch (e) {
        useTerminals.setState({ error: String(e) });
      } finally {
        setBusy(false);
      }
    },
    [openTerminal, busy, conn],
  );
  const onCreate = useCallback(() => void create(cwd), [create, cwd]);
  const labels = useMemo(() => new Map(checkouts.map((c) => [c.cwd, c.label])), [checkouts]);
  const grouped = new Set(Object.values(groups).flatMap((l) => l.map((t) => t.id)));
  const others = (all ?? []).filter((t) => !grouped.has(t.id));
  const active = cwd ? (groups[cwd] ?? null) : null;
  const rest = cwds.filter((c) => c !== cwd && (groups[c]?.length ?? 0) > 0);
  const disabled = busy || !cwd || conn !== "online";
  return (
    <View style={st.fill}>
      <PanelHead title="Terminals">
        <Pressable disabled={disabled} onPress={onCreate} accessibilityLabel="New terminal">
          <Plus size={17} color={color.faint} />
        </Pressable>
      </PanelHead>
      <BracketScope>
        <ScrollView style={st.flex} contentContainerStyle={st.pad}>
          <Group
            title={cwd ? (labels.get(cwd) ?? short(cwd)) : "No checkout"}
            sub={cwd ? `${short(cwd)} · this session` : undefined}
            list={active}
            selected={terminalId}
            onOpen={openTerminal}
          />
          {active?.length === 0 && (
            <View style={st.empty}>
              <T style={st.muted}>No terminals in this checkout yet.</T>
              <Button
                kind="primary"
                label="New terminal"
                kbd="⌃`"
                onPress={onCreate}
                disabled={disabled}
              />
            </View>
          )}
          {rest.map((c) => (
            <Group
              key={c}
              title={labels.get(c) ?? short(c)}
              sub={short(c)}
              list={groups[c]}
              selected={terminalId}
              onOpen={openTerminal}
            />
          ))}
          {others.length > 0 && (
            <Group
              title="Elsewhere on this host"
              sub="checkouts no open session uses"
              list={others}
              selected={terminalId}
              onOpen={openTerminal}
            />
          )}
          <OtherHosts />
          {error && (
            <T v="mono" style={st.error}>
              {error}
            </T>
          )}
        </ScrollView>
      </BracketScope>
    </View>
  );
}

/** How often other hosts' terminal lists refresh while the panel is open. */
const FLEET_REFRESH_MS = 5000;

/**
 * Terminals on the other connected hosts, one group per host (Settings → Terminal can limit the
 * list to the active host). Opening one makes its host active, as opening its session would.
 */
function OtherHosts() {
  const on = usePrefs((p) => p.terminalsAllHosts);
  const fleet = useFleetTerminals();
  const hosts = useHosts((h) => h.hosts);
  const activeId = useHosts((h) => h.activeId);
  useEffect(() => {
    if (!on) return;
    void refreshFleetTerminals();
    const timer = setInterval(() => void refreshFleetTerminals(), FLEET_REFRESH_MS);
    return () => clearInterval(timer);
  }, [on, activeId]);
  if (!on) return null;
  return hosts
    .filter((h) => h.id !== activeId && (fleet[h.id]?.length ?? 0) > 0)
    .map((h) => <HostGroup key={h.id} hostId={h.id} name={h.name} list={fleet[h.id]} />);
}

function HostGroup({ hostId, name, list }: { hostId: string; name: string; list: TerminalInfo[] }) {
  const open = useCallback(
    (id: string) => void openTerminalOnHost(hostId, () => useUi.getState().openTerminal(id)),
    [hostId],
  );
  const kill = useCallback((id: string) => killTerminalOnHost(hostId, id), [hostId]);
  return (
    <Group
      title={name}
      sub="another host · opening a terminal switches to it"
      list={list}
      selected={null}
      onOpen={open}
      onKill={kill}
    />
  );
}

function Group({
  title,
  sub,
  list,
  selected,
  onOpen,
  onKill = killTerminal,
}: {
  title: string;
  sub?: string;
  list: TerminalInfo[] | null;
  selected: string | null;
  onOpen: (id: string) => void;
  onKill?: (id: string) => Promise<void>;
}) {
  return (
    <View>
      <GroupHead label={title} count={list?.length} />
      {sub && (
        <T v="mono" numberOfLines={1} style={st.sub}>
          {sub}
        </T>
      )}
      {list?.map((t) => (
        <TerminalRow key={t.id} t={t} on={t.id === selected} onOpen={onOpen} onKill={onKill} />
      ))}
    </View>
  );
}

function TerminalRow({
  t,
  on,
  onOpen,
  onKill,
}: {
  t: TerminalInfo;
  on: boolean;
  onOpen: (id: string) => void;
  onKill: (id: string) => Promise<void>;
}) {
  const press = useCallback(() => onOpen(t.id), [onOpen, t.id]);
  const confirm = useConfirm();
  const kill = useCallback(
    () =>
      confirm.ask({
        title: `Close ${t.title || t.name}?`,
        body: "This stops the terminal and its running process.",
        action: "Close terminal",
        danger: true,
        run: () => {
          void onKill(t.id).catch((e: unknown) => useTerminals.setState({ error: String(e) }));
        },
      }),
    [confirm, t, onKill],
  );
  return (
    <View>
      {confirm.dialog}
      <Pressable onPress={press}>
        {({ hovered }) => (
          <View style={[st.row, hovered && st.rowHover, on && st.rowOn]}>
            <Brackets on={on} />
            <SquareTerminal size={15} color={on ? color.cyan2 : color.muted} />
            <View style={st.flex}>
              <T numberOfLines={1}>{t.title || t.name}</T>
              <T v="mono" style={st.name}>
                {t.name}
              </T>
            </View>
            {(hovered || on) && (
              <Pressable onPress={kill} accessibilityLabel="Kill terminal">
                <X size={14} color={color.faint} />
              </Pressable>
            )}
          </View>
        )}
      </Pressable>
    </View>
  );
}

/**
 * An open terminal filling the main pane. Phone: a back row to the list. Wider: a header whose
 * toggle collapses the terminals list (docked; remembered) or opens it as a drawer (portrait).
 */
export function TerminalDetail({
  id,
  docked,
  onBack,
}: {
  id: string;
  docked: boolean;
  onBack?: () => void;
}) {
  const hidden = usePrefs((p) => p.terminalListHidden);
  const t = useTerminals((s) => s.all?.find((x) => x.id === id));
  const toggle = useCallback(() => {
    if (docked) setPref("terminalListHidden", !usePrefs.getState().terminalListHidden);
    else useUi.getState().setListOpen(true);
  }, [docked]);
  const shown = docked && !hidden;
  const Icon = shown ? PanelLeftClose : PanelLeftOpen;
  const label = shown ? "Hide terminals list" : "Show terminals list";
  return (
    <View style={st.terminal}>
      {onBack ? (
        <Pressable onPress={onBack} style={st.termBack}>
          <T v="mono" style={st.termBackText}>
            ← terminals
          </T>
        </Pressable>
      ) : (
        <View style={st.termHead}>
          <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={label}>
            {({ hovered }) => (
              <View style={[st.termToggle, hovered && st.rowHover]}>
                <Icon size={15} strokeWidth={1.6} color={hovered ? color.text : color.faint} />
              </View>
            )}
          </Pressable>
          <SquareTerminal size={13} color={color.cyan2} />
          <T numberOfLines={1} style={st.termTitle}>
            {t?.title || t?.name || "terminal"}
          </T>
          {t?.title && t.name !== t.title && (
            <T v="mono" numberOfLines={1} style={st.name}>
              {t.name}
            </T>
          )}
        </View>
      )}
      <TerminalSurface terminalId={id} />
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  flex: { flex: 1 },
  pad: { paddingBottom: 16 },
  sub: { paddingHorizontal: 16, paddingBottom: 4, fontSize: 10.5, color: color.faint },
  empty: { padding: 16, gap: 12, alignItems: "flex-start" },
  muted: { color: color.muted },
  error: { color: color.coral, padding: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 8,
    padding: 10,
  },
  rowHover: { backgroundColor: color.wash },
  rowOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  name: { fontSize: 10.5, color: color.faint },
  terminal: { flex: 1, backgroundColor: color.bg },
  termBack: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  termBackText: { color: color.cyan2 },
  termHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  termToggle: {
    padding: 6,
    ...web({ transition: `background-color 120ms ${ease}` }),
  },
  termTitle: { fontSize: 12.5, color: color.text, flexShrink: 1 },
});
