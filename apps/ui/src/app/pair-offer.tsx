import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { BackHeader } from "@/components/headers/back-header";
import { Alert } from "@/components/ui/alert";
import { ClaimOfferPanel } from "@/components/claim-offer-panel";
import { PairConfirmationPanel } from "@/components/pair-confirmation-panel";
import { DirectPairConfirmation } from "@/pairing/direct-pair-confirmation";
import { describePairTarget, isPairTargetExpired } from "@/pairing/pair-confirmation";
import { rememberDaemonFingerprint } from "@/pairing/known-daemon-keys";
import { usePairWithOffer } from "@/pairing/use-pair-with-offer";
import { takePendingPairTarget, type PendingPairTarget } from "@/pairing/pending-offer";
import { useHosts } from "@/runtime/host-runtime";
import { buildHostRootRoute, buildOpenProjectRoute } from "@/utils/host-routes";

const NO_VERIFICATION = { status: "none" } as const;

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
}));

/**
 * The confirmation gate for every pairing link that arrives from outside the
 * app (see `OfferLinkListener`). The link is taken from the pending slot once
 * and nothing contacts the daemon to pair until the user presses the button —
 * a link that arrives by message or web page must never silently pair, and for
 * a claim it must never silently take ownership of a machine.
 */
export default function PairOfferScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const hosts = useHosts();
  const { state, pair, retryWithEndpoint, reset } = usePairWithOffer();
  const [confirmed, setConfirmed] = useState(false);

  // Taken once per mount: the slot holds a single-use secret.
  const targetRef = useRef<PendingPairTarget | null | undefined>(undefined);
  if (targetRef.current === undefined) targetRef.current = takePendingPairTarget();
  const target = targetRef.current;

  const described = useMemo(() => (target ? describePairTarget(target) : null), [target]);

  const goBack = useCallback(() => {
    reset();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace((hosts.length > 0 ? buildOpenProjectRoute() : "/welcome") as Href);
  }, [hosts.length, reset, router]);

  const leaveToHost = useCallback(
    (serverId: string) => {
      reset();
      router.replace(hosts.length > 1 ? buildOpenProjectRoute() : buildHostRootRoute(serverId));
    },
    [hosts.length, reset, router],
  );

  const handleDone = useCallback(() => {
    if (state.status !== "success") return;
    leaveToHost(state.serverId);
  }, [leaveToHost, state]);

  const handleConfirmOffer = useCallback(() => {
    if (target?.kind !== "offer") return;
    setConfirmed(true);
    void pair(target.url);
  }, [pair, target]);

  // Relay offers need no confirmation step of their own: the user already
  // approved this pair, so land in the app as soon as the host is saved.
  useEffect(() => {
    if (state.status !== "success") return;
    void rememberDaemonFingerprint(state.serverId, described?.details.fingerprint);
    if (state.offer.v === 2) handleDone();
  }, [described, handleDone, state]);

  const handleRetry = useCallback(
    (endpoint: string) => {
      void retryWithEndpoint(endpoint);
    },
    [retryWithEndpoint],
  );

  // The safe-area inset is runtime-only, so it rides on margin; the theme padding stays in the sheet.
  const bodyStyle = useMemo(() => [styles.body, { marginBottom: insets.bottom }], [insets.bottom]);

  let content;
  if (!target) {
    content = <Text style={styles.helper}>{t("pairing.claim.noPendingOffer")}</Text>;
  } else if (!described) {
    content = (
      <Alert
        variant="error"
        title={t("pairConfirm.invalidTitle")}
        description={t("pairConfirm.invalidBody")}
        testID="pair-confirm-invalid"
      />
    );
  } else if (target.kind === "direct") {
    content = (
      <DirectPairConfirmation
        link={target.link}
        details={described.details}
        onCancel={goBack}
        onPaired={leaveToHost}
      />
    );
  } else if (!confirmed) {
    content = (
      <PairConfirmationPanel
        details={described.details}
        verification={NO_VERIFICATION}
        expired={isPairTargetExpired(described.details)}
        onConfirm={handleConfirmOffer}
        onCancel={goBack}
      />
    );
  } else {
    content = (
      <ClaimOfferPanel
        state={state}
        onRetryWithEndpoint={handleRetry}
        onDone={handleDone}
        onDismiss={goBack}
      />
    );
  }

  return (
    <View style={styles.container} testID="pair-offer-screen">
      <BackHeader title={t("pairing.claim.title")} onBack={goBack} />
      <View style={bodyStyle}>{content}</View>
    </View>
  );
}
