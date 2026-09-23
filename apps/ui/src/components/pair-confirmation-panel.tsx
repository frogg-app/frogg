import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PairConfirmationDetailsList } from "@/components/pair-confirmation-details";
import type { PairConfirmationDetails } from "@/pairing/pair-confirmation";
import type { Theme } from "@/styles/theme";

const ThemedSpinner = withUnistyles(LoadingSpinner);
const mutedSpinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const FLEX_ONE_STYLE = { flex: 1 } as const;

/** The identity check's outcome, or `none` for links that carry no fingerprint to prove. */
export type PairConfirmationVerification =
  | { status: "none" }
  | { status: "verifying" }
  | { status: "verified" }
  /** Recoverable: the daemon did not answer, the user may try again. */
  | { status: "unverified"; message: string }
  /** Not recoverable: the key is wrong, so no Pair button is offered at all. */
  | {
      status: "refused";
      reason: "fingerprintMismatch" | "proofInvalid" | "keyChanged";
      message: string;
      actualFingerprint: string | null;
    };

export interface PairConfirmationPanelProps {
  details: PairConfirmationDetails;
  verification: PairConfirmationVerification;
  /** The link's own expiry has passed; nothing can be redeemed with it. */
  expired?: boolean;
  pairing?: boolean;
  /** A failed pair or claim, which the user may retry with the same link. */
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onRetryVerification?: () => void;
}

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
  body: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  mono: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  pending: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
}));

function VerificationBlock({ verification }: Pick<PairConfirmationPanelProps, "verification">) {
  const { t } = useTranslation();
  if (verification.status === "none") return null;
  if (verification.status === "verifying") {
    return (
      <View style={styles.pending} testID="pair-confirm-verifying">
        <ThemedSpinner size="small" uniProps={mutedSpinnerMapping} />
        <Text style={styles.body}>{t("pairConfirm.verify.pending")}</Text>
      </View>
    );
  }
  if (verification.status === "verified") {
    return (
      <Alert
        variant="success"
        title={t("pairConfirm.verify.verifiedTitle")}
        description={t("pairConfirm.verify.verifiedBody")}
        testID="pair-confirm-verified"
      />
    );
  }
  if (verification.status === "unverified") {
    return (
      <View style={styles.pending} testID="pair-confirm-unreachable">
        <Alert
          variant="warning"
          title={t("pairConfirm.verify.unreachableTitle")}
          description={verification.message}
        />
      </View>
    );
  }
  return (
    <Alert
      variant="error"
      title={t("pairConfirm.verify.refusedTitle")}
      testID="pair-confirm-refused"
    >
      <Text style={styles.body}>{t(`pairConfirm.verify.reasons.${verification.reason}`)}</Text>
      {verification.actualFingerprint ? (
        <Text style={styles.mono}>{verification.actualFingerprint}</Text>
      ) : null}
    </Alert>
  );
}

/**
 * The gate in front of every pairing link that reaches the app: the host and
 * port, the daemon's key fingerprint, the expiry, the role, and — when the
 * link would make this device the owner of that machine — an unmissable
 * warning. Nothing is paired until `onConfirm` fires from the button, and no
 * button is offered at all when the daemon's identity was refused.
 */
export function PairConfirmationPanel({
  details,
  verification,
  expired = false,
  pairing = false,
  errorMessage = null,
  onConfirm,
  onCancel,
  onRetryVerification,
}: PairConfirmationPanelProps) {
  const { t } = useTranslation();
  const refused = verification.status === "refused";
  const canConfirm =
    !refused &&
    !expired &&
    !pairing &&
    (verification.status === "none" || verification.status === "verified");
  const confirmLabel = details.isClaim
    ? t("pairConfirm.actions.claim")
    : t("pairConfirm.actions.pair");

  return (
    <View style={styles.card} testID="pair-confirm-panel">
      <Text style={styles.heading}>
        {details.isClaim ? t("pairConfirm.titleClaim") : t("pairConfirm.title")}
      </Text>
      {details.isClaim ? (
        <Alert
          variant="warning"
          title={t("pairConfirm.claimWarning.title")}
          description={t("pairConfirm.claimWarning.body")}
          testID="pair-confirm-claim-warning"
        />
      ) : null}
      <PairConfirmationDetailsList details={details} />
      <VerificationBlock verification={verification} />
      {expired ? (
        <Alert
          variant="error"
          title={t("pairConfirm.expiredTitle")}
          description={t("pairConfirm.expiredBody")}
          testID="pair-confirm-expired"
        />
      ) : null}
      {errorMessage ? (
        <Alert
          variant="error"
          title={t("pairConfirm.errorTitle")}
          description={errorMessage}
          testID="pair-confirm-error"
        />
      ) : null}
      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={onCancel}
          testID="pair-confirm-cancel"
        >
          {t("pairConfirm.actions.cancel")}
        </Button>
        {verification.status === "unverified" && onRetryVerification ? (
          <Button
            style={FLEX_ONE_STYLE}
            variant="default"
            onPress={onRetryVerification}
            testID="pair-confirm-retry-verify"
          >
            {t("pairConfirm.actions.retryVerification")}
          </Button>
        ) : null}
        {refused ? null : (
          <Button
            style={FLEX_ONE_STYLE}
            variant={details.isClaim ? "destructive" : "default"}
            disabled={!canConfirm}
            loading={pairing}
            onPress={onConfirm}
            testID="pair-confirm-submit"
          >
            {confirmLabel}
          </Button>
        )}
      </View>
    </View>
  );
}
