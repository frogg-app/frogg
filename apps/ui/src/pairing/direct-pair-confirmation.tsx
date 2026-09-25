import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DirectPairingLink } from "@frogg/protocol/device-access";
import {
  PairConfirmationPanel,
  type PairConfirmationVerification,
} from "@/components/pair-confirmation-panel";
import { PairConfirmationDetailsList } from "@/components/pair-confirmation-details";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import type { Theme } from "@/styles/theme";
import { canAutoConfirmDirectLink } from "./auto-confirm";
import type { PairConfirmationDetails } from "./pair-confirmation";
import { useDirectPairing, type DirectPairingState } from "./use-direct-pairing";

const ThemedSpinner = withUnistyles(LoadingSpinner);
const mutedSpinnerMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  pending: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  body: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

/** States an automatic pair shows without the confirmation panel and its buttons. */
const AUTO_STATES = new Set<DirectPairingState["status"]>([
  "verifying",
  "ready",
  "pairing",
  "success",
]);

const REFUSAL_REASONS = {
  fingerprint_mismatch: "fingerprintMismatch",
  proof_invalid: "proofInvalid",
  server_key_changed: "keyChanged",
} as const;

/** Maps the flow's state onto what the panel shows, so the panel stays dumb. */
export function toVerification(state: DirectPairingState): PairConfirmationVerification {
  switch (state.status) {
    case "verifying":
      return { status: "verifying" };
    case "unverified":
      return { status: "unverified", message: state.message };
    case "refused":
      return {
        status: "refused",
        reason: REFUSAL_REASONS[state.code as keyof typeof REFUSAL_REASONS] ?? "proofInvalid",
        message: state.message,
        actualFingerprint: state.actualFingerprint,
      };
    default:
      return { status: "verified" };
  }
}

export interface DirectPairConfirmationProps {
  link: DirectPairingLink;
  details: PairConfirmationDetails;
  onCancel: () => void;
  onPaired: (serverId: string) => void;
}

/**
 * A `<scheme>://pair/direct?…` link. The daemon's identity is proved on mount
 * (a read-only check), and only then is the Pair or Claim button offered —
 * unless the link qualifies for `canAutoConfirmDirectLink`, in which case it
 * pairs without a button and falls back to the panel if anything fails.
 */
export function DirectPairConfirmation({
  link,
  details,
  onCancel,
  onPaired,
}: DirectPairConfirmationProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const autoConfirm = useMemo(() => canAutoConfirmDirectLink(link), [link]);
  const { state, retryVerification, confirm } = useDirectPairing(link, {
    autoConfirm,
  });

  useEffect(() => {
    if (state.status !== "success") return;
    if (autoConfirm) {
      // No button was pressed, so say what happened on the way into the host.
      const hostname = state.hostname ?? state.endpoint;
      toast.show(
        state.role
          ? t("pairConfirm.auto.pairedAs", {
              hostname,
              role: t(`pairConfirm.roles.${state.role}`),
            })
          : t("pairConfirm.auto.paired", { hostname }),
        { variant: "success", testID: "pair-confirm-auto-success" },
      );
    }
    onPaired(state.serverId);
  }, [autoConfirm, onPaired, state, t, toast]);

  const verification = useMemo(() => toVerification(state), [state]);
  const errorMessage = state.status === "error" ? state.message : null;

  if (autoConfirm && AUTO_STATES.has(state.status)) {
    return (
      <View style={styles.card} testID="pair-confirm-auto">
        <Text style={styles.heading}>{t("pairConfirm.auto.title")}</Text>
        <PairConfirmationDetailsList details={details} />
        <View style={styles.pending}>
          <ThemedSpinner size="small" uniProps={mutedSpinnerMapping} />
          <Text style={styles.body}>
            {state.status === "verifying"
              ? t("pairConfirm.verify.pending")
              : t("pairConfirm.auto.pairing")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <PairConfirmationPanel
      details={details}
      verification={verification}
      pairing={state.status === "pairing" || state.status === "success"}
      errorMessage={errorMessage}
      onConfirm={confirm}
      onCancel={onCancel}
      onRetryVerification={retryVerification}
    />
  );
}
