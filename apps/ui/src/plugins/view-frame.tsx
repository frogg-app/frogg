import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useClientPluginsStore, startClientPluginView } from "./client-runtime/runtime-store";
import { isClientPluginRuntimeSupported } from "./client-runtime/storage";
import { describePluginError } from "./errors";
import { pluginStyles as styles } from "./shared-styles";
import { PluginSpinner } from "./spinner";

/**
 * A plugin's custom view: its client entry's `views[viewId]` rendered in a visible sandboxed
 * iframe that fills the pane. Needs this device's copy of the plugin running.
 */
export function PluginViewFrame({
  pluginId,
  pluginName,
  viewId,
  onClose,
}: {
  pluginId: string;
  pluginName: string;
  viewId: string;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const state = useClientPluginsStore((s) => s.status[pluginId]?.state ?? null);
  const loaded = useClientPluginsStore((s) => s.loaded);
  const hostRef = useRef<View>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const supported = isClientPluginRuntimeSupported();

  useEffect(() => {
    if (!supported || state !== "active") return;
    const container = hostRef.current as unknown as HTMLElement | null;
    if (!container) return;
    let disposed = false;
    let dispose: (() => void) | null = null;
    setError(null);
    setReady(false);
    startClientPluginView({
      pluginId,
      viewId,
      container,
      onClose: () => onCloseRef.current(),
    }).then(
      (view) => {
        if (disposed) {
          view.dispose();
          return undefined;
        }
        dispose = view.dispose;
        setReady(true);
        return undefined;
      },
      (err: unknown) => {
        if (!disposed) setError(describePluginError(err));
      },
    );
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [pluginId, state, supported, viewId]);

  if (!supported) {
    return (
      <View style={viewStyles.notice} testID="plugin-view-unsupported">
        <Text style={styles.meta}>{t("plugins.panel.viewUnsupported")}</Text>
      </View>
    );
  }
  if (loaded && state !== "active" && state !== "starting") {
    return (
      <View style={viewStyles.notice} testID="plugin-view-needs-client">
        <Text style={styles.meta}>
          {t("plugins.panel.viewNeedsClient", { plugin: pluginName })}
        </Text>
      </View>
    );
  }
  return (
    <View style={viewStyles.fill} testID="plugin-view">
      <View ref={hostRef} style={viewStyles.fill} />
      {error ? (
        <View style={viewStyles.overlay}>
          <Text style={styles.error}>{t("plugins.panel.viewFailed", { error })}</Text>
        </View>
      ) : null}
      {!error && !ready ? (
        <View style={viewStyles.overlay}>
          <PluginSpinner />
        </View>
      ) : null}
    </View>
  );
}

const viewStyles = StyleSheet.create((theme) => ({
  fill: {
    flex: 1,
    minHeight: 0,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  notice: {
    padding: theme.spacing[4],
  },
}));
