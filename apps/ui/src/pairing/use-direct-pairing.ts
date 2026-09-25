import { useCallback, useEffect, useRef, useState } from "react";
import {
  DaemonIdentityError,
  verifyDirectPairingLink,
  type DaemonIdentityErrorCode,
  type VerifiedDaemonIdentity,
} from "@frogg/client/internal/device-identity";
import type { DeviceRole, DirectPairingLink } from "@frogg/protocol/device-access";
import { useHostMutations } from "@/runtime/host-runtime";
import { readKnownDaemonFingerprint, rememberDaemonFingerprint } from "./known-daemon-keys";

/**
 * The state machine behind the direct pairing confirmation screen.
 *
 * Verification runs on mount because it is read-only: it proves the daemon at
 * the link's address holds the key behind the link's fingerprint. Nothing is
 * paired and no credential is minted until `confirm()` is called from a button
 * press, so a link opened from a message or a web page cannot pair — or claim
 * ownership of a machine — on its own.
 *
 * The one exception is `autoConfirm` (see `canAutoConfirmDirectLink`): a
 * loopback link carrying a pairing code, on a brand that opts in. It confirms
 * by itself once, as soon as the identity check passes; a refused or
 * unreachable daemon, or a failed pair, leaves the usual screen and button.
 */
export type DirectPairingErrorCode = DaemonIdentityErrorCode | "pair_failed";

export type DirectPairingState =
  | { status: "verifying" }
  /** Identity proved; the Pair/Claim button may be offered. */
  | { status: "ready"; identity: VerifiedDaemonIdentity }
  /** The link may be retried (the daemon was simply not reachable). */
  | { status: "unverified"; code: DirectPairingErrorCode; message: string }
  /** The link is dangerous and offers no button at all. */
  | {
      status: "refused";
      code: DirectPairingErrorCode;
      message: string;
      actualFingerprint: string | null;
    }
  | { status: "pairing"; identity: VerifiedDaemonIdentity }
  | {
      status: "success";
      serverId: string;
      hostname: string | null;
      endpoint: string;
      role: DeviceRole | null;
    }
  | {
      status: "error";
      identity: VerifiedDaemonIdentity;
      code: DirectPairingErrorCode;
      message: string;
    };

/** Key substitution and outright impostors are never retryable. */
const REFUSING_CODES = new Set<DaemonIdentityErrorCode>([
  "fingerprint_mismatch",
  "proof_invalid",
  "server_key_changed",
]);

export interface DirectPairingController {
  state: DirectPairingState;
  /** Re-run the read-only identity check after an `unreachable` failure. */
  retryVerification: () => void;
  /** Pair or claim. Only meaningful from `ready` or `error`. */
  confirm: () => Promise<void>;
}

export interface DirectPairingOptions {
  autoConfirm?: boolean;
}

function toState(error: unknown): DirectPairingState {
  if (error instanceof DaemonIdentityError) {
    if (REFUSING_CODES.has(error.code)) {
      return {
        status: "refused",
        code: error.code,
        message: error.message,
        actualFingerprint: error.actualFingerprint,
      };
    }
    return { status: "unverified", code: error.code, message: error.message };
  }
  return {
    status: "unverified",
    code: "unreachable",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function useDirectPairing(
  link: DirectPairingLink | null,
  options: DirectPairingOptions = {},
): DirectPairingController {
  const autoConfirm = options.autoConfirm === true;
  const { claimAndUpsertDirectPairingLink } = useHostMutations();
  const [state, setState] = useState<DirectPairingState>({ status: "verifying" });
  const [attempt, setAttempt] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const busyRef = useRef(false);
  // One automatic attempt per link: after a failure the user decides.
  const autoAttemptedRef = useRef<DirectPairingLink | null>(null);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    setState({ status: "verifying" });
    const run = async () => {
      try {
        const knownFingerprint = await readKnownDaemonFingerprint(link.serverId);
        const identity = await verifyDirectPairingLink(link, { knownFingerprint });
        if (!cancelled) setState({ status: "ready", identity });
      } catch (error) {
        if (!cancelled) setState(toState(error));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [attempt, link]);

  const retryVerification = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const confirm = useCallback(async () => {
    const current = stateRef.current;
    const identity =
      current.status === "ready" || current.status === "error" ? current.identity : null;
    if (!link || !identity || busyRef.current) return;
    busyRef.current = true;
    setState({ status: "pairing", identity });
    try {
      const result = await claimAndUpsertDirectPairingLink(link, {});
      await rememberDaemonFingerprint(result.serverId, identity.fingerprint);
      setState({
        status: "success",
        serverId: result.serverId,
        hostname: result.hostname,
        endpoint: result.endpoint,
        role: result.role ?? null,
      });
    } catch (error) {
      setState({
        status: "error",
        identity,
        code: "pair_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      busyRef.current = false;
    }
  }, [claimAndUpsertDirectPairingLink, link]);

  useEffect(() => {
    if (!autoConfirm || !link || state.status !== "ready") return;
    if (autoAttemptedRef.current === link) return;
    autoAttemptedRef.current = link;
    void confirm();
  }, [autoConfirm, confirm, link, state.status]);

  return { state, retryVerification, confirm };
}
