// Shared pieces for the Host, Project and App settings pages: request state, banners,
// list rows, meters, inline confirms and text fields.
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { getClient, useDaemon } from "../../../daemon/store";
import { color, font, glide, web } from "../../../theme/tokens";
import {
  levelOf,
  useLabelFlash,
  meterMotion,
  useFrom,
  useMeterAlert,
  useReducedMotion,
  useToneFade,
} from "../../Meter";
import { fmt, Num } from "../../CountUp";
import { Button } from "../../Button";
import { T } from "../../Text";

export interface Rpc<D> {
  data: D | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const errText = msg;

/**
 * Runs `load` against the live client whenever the connection comes up and on `reload`.
 * Keeps the last good data while a reload runs, so a failure shows over stale data.
 */
export function useRpc<D>(
  load: (c: DaemonClient) => Promise<D>,
  opts: { pollMs?: number; enabled?: boolean } = {},
): Rpc<D> {
  const conn = useDaemon((st) => st.conn);
  const url = useDaemon((st) => st.url);
  const [data, setData] = useState<D | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const enabled = opts.enabled ?? true;
  useEffect(() => setData(null), [url]);
  useEffect(() => {
    const client = getClient();
    if (conn !== "online" || !client || !enabled) return;
    let live = true;
    setLoading(true);
    loadRef.current(client).then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
        setLoading(false);
        return undefined;
      },
      (e: unknown) => {
        if (!live) return;
        setError(msg(e));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [conn, url, tick, enabled]);
  useEffect(() => {
    if (!opts.pollMs) return;
    const id = setInterval(() => setTick((t) => t + 1), opts.pollMs);
    return () => clearInterval(id);
  }, [opts.pollMs]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Runs one fallible action with pending and error state; `run` resolves true on success. */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (key: string, fn: () => Promise<unknown>): Promise<boolean> => {
    setPending(key);
    setError(null);
    try {
      const res = await fn();
      // Most namespaced RPCs answer with `error: string | null` instead of throwing.
      const err = (res as { error?: unknown } | null)?.error;
      if (typeof err === "string" && err) throw new Error(err);
      return true;
    } catch (e) {
      setError(msg(e));
      return false;
    } finally {
      setPending(null);
    }
  }, []);
  const clear = useCallback(() => setError(null), []);
  return { pending, error, run, clear };
}

/** Reads a `server_info.features` flag; undefined while not connected. */
export function useFeature(name: string): boolean | undefined {
  const conn = useDaemon((st) => st.conn);
  if (conn !== "online") return undefined;
  const info = getClient()?.getLastServerInfoMessage() as {
    features?: Record<string, unknown>;
  } | null;
  return info?.features?.[name] === true;
}

/** Loading, failed or offline placeholder for a page or section body. */
export function Status({
  rpc,
  what,
  children,
}: {
  rpc: Pick<Rpc<unknown>, "data" | "error" | "loading" | "reload">;
  what: string;
  children?: ReactNode;
}) {
  const conn = useDaemon((st) => st.conn);
  if (rpc.data !== null && !rpc.error) return children;
  return (
    <View>
      {rpc.data !== null && children}
      <View style={s.status}>
        {rpc.error ? (
          <>
            <T style={s.statusErr}>
              Couldn’t load {what}: {rpc.error}
            </T>
            <Button label="Retry" onPress={rpc.reload} />
          </>
        ) : (
          <T v="label">{conn === "online" ? `loading ${what}…` : "host offline"}</T>
        )}
      </View>
    </View>
  );
}

export function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <T v="mono" style={s.errLine}>
      {text}
    </T>
  );
}

/** The wide call-out at the top of a page (“Pair a device”, “devbox runs 0.9.14”). */
export function Banner({
  icon: Icon,
  title,
  body,
  tint = color.cyan2,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  tint?: string;
  children?: ReactNode;
}) {
  return (
    <View style={s.banner}>
      <Icon size={22} color={tint} strokeWidth={1.6} />
      <View style={s.bannerText}>
        <T style={s.bannerT}>{title}</T>
        {body ? <T style={s.bannerB}>{body}</T> : null}
      </View>
      {children ? <View style={s.acts}>{children}</View> : null}
    </View>
  );
}

/** One entry in a list section: icon, title, sub-line, trailing actions. */
export function Item({
  icon: Icon,
  title,
  sub,
  subMono,
  last,
  children,
  lead,
}: {
  icon?: LucideIcon;
  title: string;
  sub?: string;
  subMono?: boolean;
  last?: boolean;
  children?: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <View style={[s.item, !last && s.line]}>
      {Icon ? <Icon size={16} color={color.faint} strokeWidth={1.6} /> : null}
      {lead}
      <View style={s.itemText}>
        <T style={s.itemT}>{title}</T>
        {sub ? (
          <T v={subMono ? "mono" : "body"} style={subMono ? s.subMono : s.sub}>
            {sub}
          </T>
        ) : null}
      </View>
      {children ? <View style={s.acts}>{children}</View> : null}
    </View>
  );
}

/** A plain block inside a Section card, for forms and editors. */
export function Block({ children, last }: { children: ReactNode; last?: boolean }) {
  return <View style={[s.block, !last && s.line]}>{children}</View>;
}

export function Acts({ children }: { children: ReactNode }) {
  return <View style={s.acts}>{children}</View>;
}

/**
 * Continuous meter. Width glides in on mount and toward new values; amber (≥ 70) shimmers once
 * then breathes faintly at the edge, coral (≥ 90) pulses three times then keeps an edge pulse.
 */
export function Meter({ pct }: { pct: number | null }) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  let tint: string = color.cyan;
  if (p >= 90) tint = color.coral;
  else if (p >= 70) tint = color.amber;
  const reduced = useReducedMotion();
  const w = useRef(new Animated.Value(0)).current;
  const span = Math.abs(p - useFrom(p));
  const ms = Math.max(160, (span / 100) * meterMotion.fillMs);
  useEffect(() => {
    if (reduced) return w.setValue(p);
    const a = Animated.timing(w, {
      toValue: p,
      duration: ms,
      easing: Easing.bezier(...glide.curve),
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [p, ms, reduced, w]);
  const level = levelOf(tint, pct === null ? null : p);
  const alert = useMeterAlert(level, ms, reduced);
  const fade = useToneFade(tint, reduced);
  const pctStyle = useLabelFlash(alert.flash, level);
  const width = w.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] });
  const bg = fade.tone.interpolate({ inputRange: [0, 1], outputRange: [fade.prevTint, tint] });
  const glow = Animated.multiply(alert.flash, level === "warn" ? 1.4 : 0.55);
  const edge = Animated.multiply(alert.lead, level === "crit" ? 0.85 : 0.5);
  return (
    <View style={s.meterRow}>
      <View style={s.meter}>
        <Animated.View style={[s.fill, { width, backgroundColor: bg }]}>
          <Animated.View style={[s.meterGlow, { opacity: glow }]} />
          <Animated.View style={[s.meterEdge, { opacity: edge }]} />
        </Animated.View>
      </View>
      <Animated.View style={pctStyle}>
        {pct === null ? (
          <T v="mono" style={s.meterT}>
            —
          </T>
        ) : (
          <Num
            value={p}
            format={fmt.pct}
            duration={ms}
            style={[s.meterT, level === "crit" && s.meterCrit]}
          />
        )}
      </Animated.View>
    </View>
  );
}

/** A destructive button that asks once more inline before it acts. */
export function Confirm({
  label,
  confirm,
  onConfirm,
  pending,
  disabled,
}: {
  label: string;
  confirm: string;
  onConfirm: () => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const ask = useCallback(() => setAsking(true), []);
  const cancel = useCallback(() => setAsking(false), []);
  const go = useCallback(() => {
    setAsking(false);
    onConfirm();
  }, [onConfirm]);
  if (pending) return <Button label="Working…" disabled />;
  if (!asking) return <Button label={label} onPress={ask} disabled={disabled} />;
  return (
    <View style={s.acts}>
      <Button label="Cancel" onPress={cancel} />
      <Button kind="danger" label={confirm} onPress={go} />
    </View>
  );
}

export function Field({
  mono,
  short,
  grow,
  style,
  ...rest
}: TextInputProps & { mono?: boolean; short?: boolean; grow?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={color.faint}
      {...rest}
      style={[s.field, mono && s.mono, short && s.short, grow && s.grow, style]}
    />
  );
}

export function Value({ children }: { children: ReactNode }) {
  return (
    <T v="mono" style={s.value}>
      {children}
    </T>
  );
}

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export const s = StyleSheet.create({
  status: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    paddingVertical: 14,
  },
  statusErr: { color: color.coral, flexShrink: 1 },
  errLine: { color: color.coral, marginBottom: 12, fontSize: 12 },
  banner: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 16,
    padding: 18,
    marginBottom: 26,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: "rgba(37,181,200,0.18)",
    ...web({ backgroundImage: "linear-gradient(135deg, rgba(37,181,200,0.08), transparent 60%)" }),
  },
  bannerText: { flex: 1, minWidth: 200 },
  bannerT: { fontWeight: "600", fontSize: 14.5 },
  bannerB: { color: color.muted, marginTop: 4, lineHeight: 20 },
  item: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  line: { borderBottomWidth: 1, borderBottomColor: color.line },
  itemText: { flex: 1, minWidth: 160 },
  itemT: { fontWeight: "500" },
  sub: { color: color.faint, fontSize: 12.5, marginTop: 3 },
  subMono: { color: color.faint, fontSize: 11.5, marginTop: 3 },
  acts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  block: { paddingHorizontal: 16, paddingVertical: 13, gap: 10 },
  meterRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  meter: { width: 140, height: 6, backgroundColor: "rgba(255,255,255,0.08)" },
  fill: { height: 6 },
  meterGlow: { ...StyleSheet.absoluteFillObject, backgroundColor: color.text },
  meterEdge: {
    position: "absolute",
    right: 0,
    top: -2,
    bottom: -2,
    width: 3,
    backgroundColor: color.text,
  },
  meterCrit: { color: color.coral },
  meterT: { width: 36, textAlign: "right", color: color.text },
  field: {
    minWidth: 160,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    ...web({ outlineStyle: "none" }),
  },
  mono: { fontFamily: font.mono, fontSize: 12.5 },
  short: { minWidth: 0, width: 72 },
  grow: { flex: 1 },
  value: { color: color.text, fontSize: 12 },
});
