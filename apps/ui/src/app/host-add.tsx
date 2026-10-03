import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { hostAddDeepLinkEndpoint } from "@frogg/protocol/host-add-deep-link";
import { BackHeader } from "@/components/headers/back-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatConnectionFailureMessage } from "@/components/add-host-connection-errors";
import { useDirectConnectionErrorLabels } from "@/components/use-direct-connection-error-labels";
import { takePendingHostAdd } from "@/host-add/pending-host-add";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import { buildHostRootRoute, buildOpenProjectRoute } from "@/utils/host-routes";
import type { Theme } from "@/styles/theme";

const ThemedSpinner = withUnistyles(LoadingSpinner);
const mutedSpinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[4],
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
  },
}));

type HostAddState =
  | { status: "idle" }
  | { status: "adding"; endpoint: string }
  | { status: "error"; endpoint: string; message: string };

/**
 * Registers a host handed to the app by a `host/add` deep link (see
 * `HostAddLinkListener`): the daemon is probed, added if absent, and selected.
 * A host that is already registered is upserted rather than duplicated, so
 * repeating the link is a no-op beyond reconnecting and selecting it.
 */
export default function HostAddScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const hosts = useHosts();
  const { probeAndUpsertDirectConnection } = useHostMutations();
  const errorLabels = useDirectConnectionErrorLabels();
  const [state, setState] = useState<HostAddState>({ status: "idle" });
  const startedRef = useRef(false);

  const add = useCallback(
    async (target: { host: string; port: number; useTls: boolean; label?: string }) => {
      const endpoint = hostAddDeepLinkEndpoint({
        type: "directTcp",
        ...target,
      });
      setState({ status: "adding", endpoint });
      try {
        const { serverId } = await probeAndUpsertDirectConnection({
          endpoint,
          useTls: target.useTls,
          ...(target.label ? { label: target.label } : {}),
        });
        router.replace(buildHostRootRoute(serverId) as Href);
      } catch (error) {
        setState({
          status: "error",
          endpoint,
          message: formatConnectionFailureMessage({
            endpoint,
            error,
            labels: errorLabels,
            detailsLabel: (detail) => t("pairing.direct.errors.details", { detail }),
          }),
        });
      }
    },
    [errorLabels, probeAndUpsertDirectConnection, router, t],
  );

  const pendingRef = useRef<Parameters<typeof add>[0] | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const target = takePendingHostAdd();
    if (!target) return;
    pendingRef.current = target;
    void add(target);
  }, [add]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace((hosts.length > 0 ? buildOpenProjectRoute() : "/welcome") as Href);
  }, [hosts.length, router]);

  const handleRetry = useCallback(() => {
    const target = pendingRef.current;
    if (target) void add(target);
  }, [add]);

  // The safe-area inset is runtime-only, so it rides on margin; the theme padding stays in the sheet.
  const bodyStyle = useMemo(() => [styles.body, { marginBottom: insets.bottom }], [insets.bottom]);

  return (
    <View style={styles.container} testID="host-add-screen">
      <BackHeader title={t("hostAdd.title")} onBack={goBack} />
      <View style={bodyStyle}>
        {state.status === "idle" ? (
          <Text style={styles.helper}>{t("hostAdd.noPendingLink")}</Text>
        ) : null}
        {state.status === "adding" ? (
          <>
            <ThemedSpinner uniProps={mutedSpinnerMapping} />
            <Text style={styles.helper}>
              {t("hostAdd.connecting", { endpoint: state.endpoint })}
            </Text>
          </>
        ) : null}
        {state.status === "error" ? (
          <>
            <Text style={styles.error}>{state.message}</Text>
            <Button onPress={handleRetry}>{t("common.actions.retry")}</Button>
          </>
        ) : null}
      </View>
    </View>
  );
}
