import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { color } from "../../theme/tokens";
import { Button } from "../Button";
import { Toggle } from "../settings/controls";
import { copyText } from "../shell/copy";
import { T } from "../Text";
import { Dialog } from "../tools/Dialog";

type How = "browser" | "copy";
const KEY = "frogg-next.service-url.how";

/** Remembered choice, or null when the dialog should ask. */
export async function savedServiceUrlChoice(): Promise<How | null> {
  const v = await AsyncStorage.getItem(KEY).catch(() => null);
  return v === "browser" || v === "copy" ? v : null;
}

/** Opens or copies a service URL the way the user chose. */
export async function openServiceUrl(url: string, how: How): Promise<void> {
  if (how === "copy") await copyText(url);
  else await Linking.openURL(url);
}

/**
 * "Open <service>?" for a URL a session's service is published on. Frogg has no
 * in-app browser tab in this prototype, so the choices are the default browser or
 * copying the URL.
 */
export function ServiceUrlDialog({
  url,
  service,
  port,
  onClose,
}: {
  url: string | null;
  service?: string;
  port?: number;
  onClose: () => void;
}) {
  const [how, setHow] = useState<How>("browser");
  const [remember, setRemember] = useState(false);
  const host = url ? url.replace(/^\w+:\/\//, "").replace(/\/.*$/, "") : "";
  const open = useCallback(() => {
    if (!url) return;
    if (remember) void AsyncStorage.setItem(KEY, how);
    void openServiceUrl(url, how);
    onClose();
  }, [url, how, remember, onClose]);
  return (
    <Dialog
      open={!!url}
      onClose={onClose}
      eyebrow="Service URL"
      title={`Open ${host}?`}
      footer={
        <>
          <Button label="Cancel" onPress={onClose} />
          <Button kind="primary" label="Open" onPress={open} />
        </>
      }
    >
      <T style={s.body}>
        {service ? (
          <>
            The <T style={s.strong}>{service}</T> service for this session is running
            {port ? ` on :${port}` : ""} behind the reverse proxy.
          </>
        ) : (
          url
        )}
      </T>
      <Choice id="browser" on={how === "browser"} label="In your default browser" pick={setHow} />
      <Choice id="copy" on={how === "copy"} label="Copy URL" pick={setHow} />
      <View style={s.remember}>
        <Toggle value={remember} onChange={setRemember} />
        <T style={s.label}>Don&apos;t ask again</T>
      </View>
    </Dialog>
  );
}

function Choice({
  id,
  on,
  label,
  pick,
}: {
  id: How;
  on: boolean;
  label: string;
  pick: (h: How) => void;
}) {
  const press = useCallback(() => pick(id), [pick, id]);
  const state = useMemo(() => ({ checked: on }), [on]);
  return (
    <Pressable
      onPress={press}
      style={[s.choice, on && s.choiceOn]}
      accessibilityRole="radio"
      accessibilityState={state}
    >
      <View style={[s.diamond, on && s.diamondOn]} />
      <T style={s.label}>{label}</T>
    </Pressable>
  );
}

const s = StyleSheet.create({
  body: { color: color.muted, fontSize: 13.5, lineHeight: 20 },
  strong: { color: color.text, fontWeight: "600" },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: color.line,
  },
  choiceOn: { borderColor: color.cyan, backgroundColor: "rgba(37,181,200,0.08)" },
  diamond: {
    width: 8,
    height: 8,
    borderWidth: 1,
    borderColor: color.muted,
    transform: [{ rotate: "45deg" }],
  },
  diamondOn: { backgroundColor: color.cyan2, borderColor: color.cyan2 },
  label: { fontSize: 13.5 },
  remember: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
});
