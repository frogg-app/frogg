// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonIdentityError } from "@frogg/client/internal/device-identity";
import type { DirectPairingLink } from "@frogg/protocol/device-access";
import { useDirectPairing } from "./use-direct-pairing";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  claim: vi.fn(),
  readKnown: vi.fn(),
  remember: vi.fn(),
}));

vi.mock("@frogg/client/internal/device-identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@frogg/client/internal/device-identity")>()),
  verifyDirectPairingLink: mocks.verify,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostMutations: () => ({ claimAndUpsertDirectPairingLink: mocks.claim }),
}));
vi.mock("./known-daemon-keys", () => ({
  readKnownDaemonFingerprint: mocks.readKnown,
  rememberDaemonFingerprint: mocks.remember,
}));

const FINGERPRINT = "sha256:abcdef";
const LINK: DirectPairingLink = {
  v: 1,
  host: "192.168.1.10",
  port: 9999,
  fingerprint: FINGERPRINT,
  claim: true,
  serverId: "srv-1",
};
const IDENTITY = {
  serverId: "srv-1",
  fingerprint: FINGERPRINT,
  daemonPublicKeyB64: "key",
};

describe("useDirectPairing", () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue(IDENTITY);
    mocks.claim.mockReset().mockResolvedValue({
      serverId: "srv-1",
      hostname: "studio",
      endpoint: "192.168.1.10:9999",
      profile: {},
    });
    mocks.readKnown.mockReset().mockResolvedValue(null);
    mocks.remember.mockReset().mockResolvedValue(undefined);
  });

  it("verifies on mount but pairs nothing until the button is pressed", async () => {
    const { result } = renderHook(() => useDirectPairing(LINK));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.claim).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirm();
    });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe("success");
    expect(mocks.remember).toHaveBeenCalledWith("srv-1", FINGERPRINT);
  });

  it("leaves nothing paired when the user never confirms", async () => {
    const { result, unmount } = renderHook(() => useDirectPairing(LINK));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    unmount();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("refuses a link whose fingerprint is not the daemon's key, and offers no pair", async () => {
    mocks.verify.mockRejectedValue(
      new DaemonIdentityError("fingerprint_mismatch", "key does not match", "sha256:other"),
    );
    const { result } = renderHook(() => useDirectPairing(LINK));
    await waitFor(() => expect(result.current.state.status).toBe("refused"));
    await act(async () => {
      await result.current.confirm();
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      status: "refused",
      code: "fingerprint_mismatch",
      actualFingerprint: "sha256:other",
    });
  });

  it("refuses a known daemon that presents a different key", async () => {
    mocks.readKnown.mockResolvedValue("sha256:pinned");
    mocks.verify.mockImplementation(
      async (_link: DirectPairingLink, options: { knownFingerprint?: string | null }) => {
        if (options.knownFingerprint && options.knownFingerprint !== FINGERPRINT) {
          throw new DaemonIdentityError(
            "server_key_changed",
            "already known under a different key",
            FINGERPRINT,
          );
        }
        return IDENTITY;
      },
    );
    const { result } = renderHook(() => useDirectPairing(LINK));
    await waitFor(() => expect(result.current.state.status).toBe("refused"));
    expect(mocks.readKnown).toHaveBeenCalledWith("srv-1");
    expect(result.current.state).toMatchObject({ code: "server_key_changed" });
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("recovers from an unreachable daemon when the check is retried", async () => {
    mocks.verify.mockRejectedValueOnce(
      new DaemonIdentityError("unreachable", "connection refused"),
    );
    const { result } = renderHook(() => useDirectPairing(LINK));
    await waitFor(() => expect(result.current.state.status).toBe("unverified"));
    expect(result.current.state).toMatchObject({ code: "unreachable" });

    act(() => {
      result.current.retryVerification();
    });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(mocks.verify).toHaveBeenCalledTimes(2);
  });

  it("keeps the confirmation usable after a failed pair", async () => {
    mocks.claim.mockRejectedValueOnce(new Error("the daemon rejected the code"));
    const { result } = renderHook(() => useDirectPairing(LINK));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.state).toMatchObject({
      status: "error",
      message: "the daemon rejected the code",
    });

    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.state.status).toBe("success");
  });
});
