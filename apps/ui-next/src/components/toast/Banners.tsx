import { X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useHostLink, useHosts } from "../../daemon/hosts";
import { connect, getClient, useDaemon } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";

const APP_VERSION: string = require("../../../package.json").version;

type Tone = "warn" | "run" | "error";
const toneGlyph = { warn: "needs", run: "working", error: "failed" } as const;

/** Host-wide conditions as full-width strips: reconnecting, version mismatch, storage. */
export function Banners() {
  const conn = useDaemon((st) => st.conn);
  const url = useDaemon((st) => st.url);
  const link = useHostLink();
  const hostName = useHosts((st) => st.hosts.find((h) => h.id === st.activeId)?.name ?? "host");
  const offlineFor = useElapsed(conn === "online" ? null : link.droppedAt);
  const [version, setVersion] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ level: string; bytes: number } | null>(null);
  useEffect(() => {
    setStorage(null);
    setVersion(null);
    const client = getClient();
    if (!client || conn !== "online") return;
    const info = client.getLastServerInfoMessage() as { version?: string } | null;
    setVersion(info?.version ?? null);
    return client.subscribe((event) => {
      if (event.type !== "status") return;
      const p = event.payload as { status: string; alert?: { level: string; totalBytes: number } };
      if (p.status === "storage_alert" && p.alert)
        setStorage(
          p.alert.level === "ok" ? null : { level: p.alert.level, bytes: p.alert.totalBytes },
        );
    });
  }, [conn, url]);
  const retry = useCallback(() => void connect(), []);
  const openHosts = useCallback(() => useUi.getState().setTool("hosts"), []);
  const openResources = useCallback(() => {
    useUi.getState().setTool("settings");
    useUi.getState().openSettings("resources");
  }, []);
  const older = conn === "online" && version && compareVersions(version, APP_VERSION) < 0;
  return (
    <View>
      {older && (
        <DismissibleBanner
          key={`version:${url}:${version}:${APP_VERSION}`}
          tone="warn"
          title={`${hostName} runs daemon ${version}`}
          detail={`older than this app (${APP_VERSION}); some features are hidden`}
          action="Update host…"
          onPress={openHosts}
        />
      )}
      {conn !== "online" && (
        <DismissibleBanner
          key={`offline:${url}:${link.droppedAt ?? "initial"}`}
          tone="run"
          title={`${conn === "connecting" ? "Connecting to" : "Disconnected from"} ${hostName}`}
          detail={
            offlineFor
              ? `offline for ${offlineFor} · reconnect before sending messages`
              : "reconnect before sending messages"
          }
          action="Retry now"
          onPress={retry}
        />
      )}
      {storage && (
        <DismissibleBanner
          key={`storage:${url}:${storage.level}`}
          tone={storage.level === "critical" ? "error" : "warn"}
          title={`Frogg storage on ${hostName} is ${formatBytes(storage.bytes)}`}
          detail="clean up worktrees, logs and caches to free space"
          action="Review storage…"
          onPress={openResources}
        />
      )}
    </View>
  );
}

interface BannerProps {
  tone: Tone;
  title: string;
  detail?: string;
  action?: string;
  onPress?: () => void;
  onDismiss?: () => void;
}

/** Dismiss an incident until it resolves or its host/version/severity changes. */
function DismissibleBanner(props: BannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => setDismissed(true), []);
  return dismissed ? null : <Banner {...props} onDismiss={dismiss} />;
}

export function Banner({ tone, title, detail, action, onPress, onDismiss }: BannerProps) {
  return (
    <View style={[s.banner, s[tone]]}>
      <StatusGlyph bucket={toneGlyph[tone]} size={8} still={tone !== "run"} />
      <View style={s.text}>
        <T style={s.title}>
          {title}
          {detail ? (
            <T style={s.detail}>
              {"  "}
              {detail}
            </T>
          ) : null}
        </T>
      </View>
      {action && (
        <Pressable onPress={onPress} style={s.actionButton} accessibilityRole="button">
          {({ hovered }) => <T style={[s.action, hovered && s.actionH]}>{action}</T>}
        </Pressable>
      )}
      {onDismiss && (
        <Pressable
          onPress={onDismiss}
          style={s.dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
        >
          <X size={18} color={color.muted} />
        </Pressable>
      )}
    </View>
  );
}

function useElapsed(since: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return null;
  const sec = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, "0")}`;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

const s = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  warn: { backgroundColor: `${color.amber}12` },
  run: { backgroundColor: `${color.cyan}12` },
  error: { backgroundColor: `${color.coral}14` },
  text: { flex: 1 },
  title: { fontSize: 13, fontWeight: "600" },
  detail: { fontSize: 13, fontWeight: "400", color: color.muted },
  dismiss: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  actionButton: { maxWidth: 100, minHeight: 44, justifyContent: "center" },
  action: { fontSize: 12.5, color: color.muted },
  actionH: { color: color.text },
});
