import { useEffect, useMemo } from "react";
import type { DirectPairingLink } from "@frogg/protocol/device-access";
import {
  PairConfirmationPanel,
  type PairConfirmationVerification,
} from "@/components/pair-confirmation-panel";
import type { PairConfirmationDetails } from "./pair-confirmation";
import { useDirectPairing, type DirectPairingState } from "./use-direct-pairing";

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
 * (a read-only check), and only then is the Pair or Claim button offered.
 */
export function DirectPairConfirmation({
  link,
  details,
  onCancel,
  onPaired,
}: DirectPairConfirmationProps) {
  const { state, retryVerification, confirm } = useDirectPairing(link);

  useEffect(() => {
    if (state.status === "success") onPaired(state.serverId);
  }, [onPaired, state]);

  const verification = useMemo(() => toVerification(state), [state]);
  const errorMessage = state.status === "error" ? state.message : null;

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
