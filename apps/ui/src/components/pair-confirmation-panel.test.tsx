// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PairConfirmationDetails } from "@/pairing/pair-confirmation";
import {
  PairConfirmationPanel,
  type PairConfirmationVerification,
} from "./pair-confirmation-panel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const BASE: PairConfirmationDetails = {
  kind: "direct",
  endpoint: "192.168.1.10:9999",
  endpoints: [],
  fingerprint: "sha256:abcd",
  formattedFingerprint: "abcd",
  expiresAt: null,
  isClaim: false,
  role: null,
  serverId: "srv-1",
  hostname: null,
  requiresIdentityCheck: true,
};

const VERIFIED: PairConfirmationVerification = { status: "verified" };
const CLAIMING: PairConfirmationDetails = { ...BASE, isClaim: true };
const SPACED_FINGERPRINT: PairConfirmationDetails = { ...BASE, formattedFingerprint: "ab cd ef" };
const KEY_CHANGED: PairConfirmationVerification = {
  status: "refused",
  reason: "keyChanged",
  message: "known under a different key",
  actualFingerprint: "sha256:other",
};
const VERIFYING: PairConfirmationVerification = { status: "verifying" };
const UNREACHABLE: PairConfirmationVerification = { status: "unverified", message: "no answer" };

function renderPanel(
  details: PairConfirmationDetails,
  verification: PairConfirmationVerification = VERIFIED,
  handlers: { onConfirm?: () => void; onCancel?: () => void } = {},
) {
  const onConfirm = handlers.onConfirm ?? vi.fn();
  const onCancel = handlers.onCancel ?? vi.fn();
  render(
    <PairConfirmationPanel
      details={details}
      verification={verification}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onRetryVerification={vi.fn()}
    />,
  );
  return { onConfirm, onCancel };
}

describe("PairConfirmationPanel", () => {
  afterEach(cleanup);

  it("warns about ownership for a claiming link", () => {
    renderPanel(CLAIMING);
    expect(screen.getByTestId("pair-confirm-claim-warning")).toBeTruthy();
    expect(screen.getByTestId("pair-confirm-submit").textContent).toContain(
      "pairConfirm.actions.claim",
    );
  });

  it("shows no ownership warning for a pairing-code link", () => {
    renderPanel(BASE);
    expect(screen.queryByTestId("pair-confirm-claim-warning")).toBeNull();
    expect(screen.getByTestId("pair-confirm-submit").textContent).toContain(
      "pairConfirm.actions.pair",
    );
  });

  it("shows the address and fingerprint before the action", () => {
    renderPanel(SPACED_FINGERPRINT);
    const details = screen.getByTestId("pair-confirm-details");
    expect(details.textContent).toContain("192.168.1.10:9999");
    expect(details.textContent).toContain("ab cd ef");
  });

  it("offers no pair button when the daemon's identity was refused", () => {
    renderPanel(CLAIMING, KEY_CHANGED);
    expect(screen.getByTestId("pair-confirm-refused")).toBeTruthy();
    expect(screen.queryByTestId("pair-confirm-submit")).toBeNull();
    expect(screen.getByTestId("pair-confirm-cancel")).toBeTruthy();
  });

  it("holds the action back while the identity check runs", () => {
    const { onConfirm } = renderPanel(BASE, VERIFYING);
    expect(screen.getByTestId("pair-confirm-verifying")).toBeTruthy();
    fireEvent.click(screen.getByTestId("pair-confirm-submit"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("offers a retry, and no action, while the daemon is unreachable", () => {
    const { onConfirm } = renderPanel(BASE, UNREACHABLE);
    expect(screen.getByTestId("pair-confirm-retry-verify")).toBeTruthy();
    fireEvent.click(screen.getByTestId("pair-confirm-submit"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms and cancels through the buttons only", () => {
    const { onConfirm, onCancel } = renderPanel(BASE);
    fireEvent.click(screen.getByTestId("pair-confirm-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("pair-confirm-submit"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
