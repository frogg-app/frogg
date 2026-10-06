// Pieces shared by the Host, Project and App pages built on top of kit.tsx: findings,
// label chips, colour swatches, a project picker and the project frogg.json hook.
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { FroggConfigRaw } from "@frogg/protocol/frogg-config-schema";
import { AlertTriangle, Check, ShieldAlert, type LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { getClient, useDaemon } from "../../../daemon/store";
import { color, font, labelTint, web } from "../../../theme/tokens";
import { T } from "../../Text";
import { useDirectory } from "../../sessions/directory";
import { Select } from "../../Select";
import { errText } from "./kit";

export function need(): DaemonClient {
  const c = getClient();
  if (!c) throw new Error("Not connected to a host");
  return c;
}

/** One security or health finding: tinted icon, title, optional body and actions. */
export function Finding({
  tone,
  title,
  body,
  children,
  last,
}: {
  tone: "ok" | "warn" | "bad";
  title: string;
  body?: string;
  children?: ReactNode;
  last?: boolean;
}) {
  let Icon: LucideIcon = Check;
  let tint: string = color.mint;
  if (tone === "warn") {
    Icon = ShieldAlert;
    tint = color.amber;
  } else if (tone === "bad") {
    Icon = AlertTriangle;
    tint = color.coral;
  }
  return (
    <View style={[s.find, !last && s.line]}>
      <Icon size={16} color={tint} strokeWidth={1.8} />
      <View style={s.findText}>
        <T style={s.findT}>{title}</T>
        {body ? <T style={s.findB}>{body}</T> : null}
        {children ? <View style={s.findActs}>{children}</View> : null}
      </View>
    </View>
  );
}

const chipCache = new Map<string, { box: object; text: object }>();
function chipStyle(tint: string) {
  let st = chipCache.get(tint);
  if (!st) {
    const made = StyleSheet.create({
      box: { backgroundColor: `${tint}26`, paddingHorizontal: 7, paddingVertical: 2 },
      text: { color: tint, fontFamily: font.mono, fontSize: 11.5 },
    });
    st = { box: made.box, text: made.text };
    chipCache.set(tint, st);
  }
  return st;
}

/** A workspace label as the session list draws it. */
export function LabelChip({ name, tone }: { name: string; tone: string }) {
  const st = chipStyle(labelTint[tone] ?? color.muted);
  return (
    <View style={st.box}>
      <T style={st.text}>{name}</T>
    </View>
  );
}

const swatchCache = new Map<string, object>();
function swatchFill(hex: string): object {
  let st = swatchCache.get(hex);
  if (!st) {
    st = StyleSheet.create({ f: { backgroundColor: hex } }).f;
    swatchCache.set(hex, st);
  }
  return st;
}

/** A row of colour swatches; `colors` maps a value to its hex. */
export function Swatches({
  colors,
  value,
  onChange,
}: {
  colors: Array<[string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={s.sws}>
      {colors.map(([v, hex]) => (
        <Swatch key={v} value={v} hex={hex} on={v === value} onPick={onChange} />
      ))}
    </View>
  );
}

function Swatch({
  value,
  hex,
  on,
  onPick,
}: {
  value: string;
  hex: string;
  on: boolean;
  onPick: (v: string) => void;
}) {
  const press = useCallback(() => onPick(value), [onPick, value]);
  return (
    <Pressable
      onPress={press}
      accessibilityLabel={value}
      accessibilityState={useMemo(() => ({ selected: on }), [on])}
      style={[s.sw, swatchFill(hex), on && s.swOn]}
    />
  );
}

// ---- project-scoped pages: pick a project, read and write its frogg.json ----

export interface ProjectRef {
  id: string;
  name: string;
  root: string;
}

/** The host's git projects and the one picked; the picker is shared across project pages. */
let picked: string | null = null;
export function useProjects(): {
  projects: ProjectRef[];
  current: ProjectRef | null;
  pick: (id: string) => void;
} {
  const raw = useDirectory((st) => st.projects);
  const projects = useMemo(
    () =>
      raw
        .filter((p) => p.projectKind === "git")
        .map((p) => ({
          id: p.projectId,
          name: p.projectCustomName ?? p.projectDisplayName,
          root: p.projectRootPath,
        })),
    [raw],
  );
  const [id, setId] = useState<string | null>(picked);
  const pick = useCallback((v: string) => {
    picked = v;
    setId(v);
  }, []);
  const current = projects.find((p) => p.id === id) ?? projects[0] ?? null;
  return { projects, current, pick };
}

/** All projects remain reachable without overflowing a narrow settings page. */
export function ProjectPicker({
  projects,
  current,
  onPick,
}: {
  projects: ProjectRef[];
  current: ProjectRef | null;
  onPick: (id: string) => void;
}) {
  const options = useMemo(() => projects.map((p) => ({ value: p.id, label: p.name })), [projects]);
  if (!current) return null;
  return (
    <View style={s.picker}>
      <T v="label">project</T>
      {options.length > 1 ? (
        <Select
          options={options}
          value={current.id}
          onChange={onPick}
          width="100%"
          label="Project"
        />
      ) : (
        <T v="mono">{current.name}</T>
      )}
    </View>
  );
}

type Revision = Extract<
  Awaited<ReturnType<DaemonClient["readProjectConfig"]>>,
  { ok: true }
>["revision"];

export interface ProjectConfig {
  config: FroggConfigRaw | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  /** Merge `next` over the file's current contents and write it, guarded by revision. */
  save: (update: (cfg: FroggConfigRaw) => FroggConfigRaw) => Promise<boolean>;
  reload: () => void;
}

function rpcError(code: string): string {
  if (code === "project_not_found") return "Project not found on this host";
  if (code === "invalid_project_config") return "frogg.json is not valid; fix it in the editor";
  if (code === "stale_project_config")
    return "frogg.json changed on disk. Reload configuration before saving again.";
  return "Couldn’t write frogg.json";
}

export function useProjectConfig(root: string | null): ProjectConfig {
  const conn = useDaemon((st) => st.conn);
  const url = useDaemon((st) => st.url);
  const [config, setConfig] = useState<FroggConfigRaw | null>(null);
  const [revision, setRevision] = useState<Revision>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setConfig(null);
    setRevision(null);
    setError(null);
    const c = getClient();
    if (!root || !c || conn !== "online") return;
    let live = true;
    setLoading(true);
    c.readProjectConfig(root).then(
      (res) => {
        if (!live) return;
        setLoading(false);
        if (!res.ok) {
          setError(rpcError(res.error.code));
          return false;
        }
        setConfig(res.config ?? {});
        setRevision(res.revision);
        setError(null);
        return true;
      },
      (e: unknown) => {
        if (!live) return;
        setLoading(false);
        setError(errText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [root, conn, url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const save = useCallback(
    async (update: (cfg: FroggConfigRaw) => FroggConfigRaw) => {
      if (!root || !config || saveLock.current || conn !== "online") return false;
      saveLock.current = true;
      const next = update(config);
      setSaving(true);
      try {
        const res = await need().writeProjectConfig({
          repoRoot: root,
          config: next,
          expectedRevision: revision,
        });
        if (!res.ok) {
          setError(rpcError(res.error.code));
          return false;
        }
        setConfig(res.config ?? next);
        setRevision(res.revision);
        setError(null);
        return true;
      } catch (e) {
        setError(errText(e));
        return false;
      } finally {
        saveLock.current = false;
        setSaving(false);
      }
    },
    [root, config, revision, conn],
  );
  return { config, loading, error, saving, save, reload };
}

/** frogg.json setup commands arrive as a string or a list; edit them as lines. */
export const linesOf = (v: unknown): string =>
  (Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string" && x).join("\n");
export const listOf = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const s = StyleSheet.create({
  find: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  line: { borderBottomWidth: 1, borderBottomColor: color.line },
  findText: { flex: 1 },
  findT: { fontWeight: "500" },
  findB: { color: color.muted, marginTop: 4, lineHeight: 19 },
  findActs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  sws: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sw: { width: 18, height: 18, borderWidth: 2, borderColor: "transparent" },
  swOn: { borderColor: color.text, ...web({ boxShadow: "0 0 0 1px #080b0d inset" }) },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
});
