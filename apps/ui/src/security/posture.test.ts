import { describe, expect, it } from "vitest";
import { EMPTY_SECURITY_POSTURE, readSecurityPosture } from "./posture";

const finding = (id: string, severity: string, fixAction: string) => ({ id, severity, fixAction });

describe("readSecurityPosture", () => {
  it("shows nothing for a daemon without the feature, even if it sent findings", () => {
    expect(
      readSecurityPosture({
        features: {},
        security: { findings: [finding("unclaimed", "critical", "claim")] },
      }).severity,
    ).toBeNull();
    expect(readSecurityPosture(null).findings).toEqual([]);
  });

  it("shows nothing to operators and viewers", () => {
    for (const callerRole of ["operator", "viewer"] as const) {
      expect(
        readSecurityPosture({
          features: { securityPosture: true },
          callerRole,
          security: { findings: [finding("unclaimed", "critical", "claim")] },
        }).severity,
      ).toBeNull();
    }
  });

  it("reports the worst severity and treats unknown severities as warnings", () => {
    const posture = readSecurityPosture({
      features: { securityPosture: true },
      callerRole: "owner",
      security: {
        findings: [
          finding("trust_lan_diverges", "warning", "disable_trust_lan"),
          finding("unclaimed", "critical", "claim"),
        ],
      },
    });
    expect(posture.severity).toBe("critical");
    expect(
      readSecurityPosture({
        features: { securityPosture: true },
        security: { findings: [finding("bind_diverges", "notice", "bind_loopback")] },
      }).severity,
    ).toBe("warning");
  });

  it("keeps unknown findings and actions with generic handling", () => {
    const [view] = readSecurityPosture({
      features: { securityPosture: true },
      security: { findings: [finding("future_thing", "critical", "do_magic")] },
    }).findings;
    expect(view).toEqual({
      id: "future_thing",
      knownId: null,
      severity: "critical",
      fixAction: null,
    });
  });

  it("is empty when the daemon reports no findings", () => {
    expect(
      readSecurityPosture({ features: { securityPosture: true }, security: { findings: [] } }),
    ).toEqual({ ...EMPTY_SECURITY_POSTURE, available: true });
  });

  it("keeps acknowledged warnings out of the severity that drives the dot", () => {
    const view = readSecurityPosture({
      features: { securityPosture: true, securityAcknowledge: true },
      security: {
        findings: [],
        acknowledged: [{ id: "bind_diverges", severity: "warning", fixAction: "bind_loopback" }],
      },
    });
    expect(view.severity).toBeNull();
    expect(view.acknowledged.map((item) => item.id)).toEqual(["bind_diverges"]);
    expect(view.canAcknowledge).toBe(true);
  });

  it("only offers acknowledging when the daemon advertises it", () => {
    const view = readSecurityPosture({
      features: { securityPosture: true },
      security: {
        findings: [{ id: "bind_diverges", severity: "warning", fixAction: "bind_loopback" }],
      },
    });
    expect(view.severity).toBe("warning");
    expect(view.canAcknowledge).toBe(false);
  });
});
