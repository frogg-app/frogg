import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { describeHostConnectionError } from "./host-connection-error";

describe("describeHostConnectionError", () => {
  it("renders a serverId mismatch as translated copy with both ids", async () => {
    const snapshot = {
      lastError:
        "This address is now answered by a different daemon (srv_b), not this host (srv_a).",
      lastErrorInfo: {
        code: "server_identity_mismatch" as const,
        expectedServerId: "srv_a",
        actualServerId: "srv_b",
      },
    };
    await i18n.changeLanguage("en");
    expect(describeHostConnectionError(snapshot)).toBe(
      "A different daemon (srv_b) is answering at this host's address, not this host (srv_a). Stop the other daemon or check the address. Reconnecting keeps trying.",
    );
    await i18n.changeLanguage("fr");
    expect(describeHostConnectionError(snapshot)).toContain("Un autre daemon (srv_b)");
    await i18n.changeLanguage("en");
  });

  it("falls back to the raw transport text, and nothing for blank", () => {
    expect(describeHostConnectionError({ lastError: " Connection timed out " })).toBe(
      "Connection timed out",
    );
    expect(describeHostConnectionError({ lastError: "  ", lastErrorInfo: null })).toBeNull();
    expect(describeHostConnectionError(null)).toBeNull();
  });
});

describe("describeHostConnectionError pairing_required", () => {
  it("renders a rejected credential and a missing pairing as translated copy", async () => {
    await i18n.changeLanguage("en");
    expect(
      describeHostConnectionError({
        lastError: "Device access revoked",
        lastErrorInfo: {
          code: "pairing_required",
          credentialRejected: true,
          reason: "Device access revoked",
        },
      }),
    ).toBe(
      "This host no longer accepts this device's saved credential (Device access revoked). It has been removed. Pair this device again to reconnect.",
    );
    expect(
      describeHostConnectionError({
        lastError: "Password required",
        lastErrorInfo: {
          code: "pairing_required",
          credentialRejected: false,
          reason: "Password required",
        },
      }),
    ).toBe("This host needs this device to be paired before it can connect (Password required).");
  });
});
