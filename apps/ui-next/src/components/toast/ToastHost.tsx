import { Check, X } from "lucide-react-native";
import { useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDaemon } from "../../daemon/store";
import { bucketOf, type Bucket } from "../../daemon/types";
import { useFormFactor } from "../../theme/layout";
import { color, motion, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { Cut } from "../Cut";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import { dismissToast, toast, useToasts, type Toast, type ToastKind } from "./store";

const glyph: Record<Exclude<ToastKind, "ok">, Bucket> = {
  done: "review",
  error: "failed",
  needs: "needs",
  info: "working",
};

/**
 * Bottom-right stack of transient toasts (bottom, full width on phones). Also turns session
 * status changes on sessions you are not looking at into toasts. Mount once, above the shell.
 */
export function ToastHost() {
  const toasts = useToasts((st) => st.toasts);
  const phone = useFormFactor() === "phone";
  const insets = useSafeAreaInsets();
  useSessionToasts();
  const pad = phone ? insets.bottom + 72 : 36;
  const box = [s.box, phone ? s.phone : s.wide, { bottom: pad }];
  if (toasts.length === 0) return null;
  return (
    <View style={box} pointerEvents="box-none">
      {toasts.map((t) => (
        <ToastRow key={t.id} t={t} />
      ))}
    </View>
  );
}

function ToastRow({ t }: { t: Toast }) {
  const close = useCallback(() => dismissToast(t.id), [t.id]);
  const act = useCallback(() => {
    dismissToast(t.id);
    t.action?.onPress();
  }, [t]);
  return (
    <Cut size={8} flip style={s.toast}>
      <View style={s.icon}>
        {t.kind === "ok" ? (
          <Check size={13} color={color.mint} />
        ) : (
          <StatusGlyph bucket={glyph[t.kind]} size={8} still />
        )}
      </View>
      <View style={s.text}>
        <T style={s.title} numberOfLines={2}>
          {t.title}
        </T>
        {t.detail && (
          <T style={s.detail} numberOfLines={2}>
            {t.detail}
          </T>
        )}
      </View>
      {t.action && (
        <Pressable onPress={act} hitSlop={6}>
          <T style={s.action}>{t.action.label}</T>
        </Pressable>
      )}
      <Pressable onPress={close} hitSlop={8} accessibilityLabel="Dismiss">
        <X size={12} color={color.faint} />
      </Pressable>
    </Cut>
  );
}

const verdict: Partial<Record<Bucket, { kind: ToastKind; text: string }>> = {
  review: { kind: "done", text: "is ready" },
  failed: { kind: "error", text: "failed" },
  needs: { kind: "needs", text: "needs you" },
};

/** Status transitions on background sessions become toasts with an Open action. */
function useSessionToasts() {
  const sessions = useDaemon((st) => st.sessions);
  const url = useDaemon((st) => st.url);
  const seen = useRef<Map<string, Bucket> | null>(null);
  const host = useRef(url);
  useEffect(() => {
    if (host.current !== url || !seen.current) {
      // First sight of a host's sessions is a baseline, not news.
      host.current = url;
      seen.current = null;
    }
    const next = new Map<string, Bucket>();
    for (const sess of Object.values(sessions)) {
      const b = bucketOf(sess.agent);
      next.set(sess.agent.id, b);
      const was = seen.current?.get(sess.agent.id);
      if (!seen.current || was === undefined || was === b) continue;
      const v = verdict[b];
      if (!v || useUi.getState().selected === sess.agent.id) continue;
      const id = sess.agent.id;
      toast({
        title: `${sess.agent.title || "Untitled session"} ${v.text}`,
        detail: sess.agent.lastError ?? undefined,
        kind: v.kind,
        action: { label: "Open", onPress: () => openSession(id) },
      });
    }
    seen.current = next;
  }, [sessions, url]);
}

function openSession(id: string) {
  const ui = useUi.getState();
  ui.setTool("sessions");
  ui.select(id);
}

const s = StyleSheet.create({
  box: { position: "absolute", gap: 8, zIndex: 50 },
  wide: { right: 16, width: 380 },
  phone: { left: 10, right: 10 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: color.raise,
    borderWidth: 1,
    borderColor: color.line2,
    paddingHorizontal: 14,
    paddingVertical: 11,
    ...motion.enter,
    ...web({ boxShadow: `0 14px 34px ${color.scrim}` }),
  },
  icon: { width: 14, alignItems: "center" },
  text: { flex: 1 },
  title: { fontSize: 13, fontWeight: "500" },
  detail: { fontSize: 11.5, color: color.faint, marginTop: 2 },
  action: { fontSize: 12.5, color: color.text },
});
