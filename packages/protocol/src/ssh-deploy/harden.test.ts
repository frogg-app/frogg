import { describe, expect, it } from "vitest";
import { buildHardenScript, parseHardenOutput } from "./harden.js";

const BRAND = { id: "frogg", envPrefix: "FROGG", cliName: "frogg" };

describe("deploy lock-down", () => {
  it("runs the installed CLI, not whatever `frogg` is on PATH first", () => {
    const script = buildHardenScript(BRAND);
    expect(script).toContain('root="${FROGG_INSTALL_DIR:-$HOME/.local/share/frogg}"');
    expect(script).toContain('cli="$root/current/bin/frogg"');
    expect(script).toContain('"$cli" daemon trust-lan off --json');
  });

  it("reads the CLI's result", () => {
    expect(
      parseHardenOutput(
        [
          "FROGG_HARDEN_BEGIN",
          '{"trustLan":false,"applied":{"status":"live"}}',
          "FROGG_HARDEN_END",
        ].join("\n"),
      ),
    ).toEqual({ trustLan: false, applied: "live", unsupported: false });
  });

  it("reports an env-pinned daemon as still trusting its LAN", () => {
    expect(
      parseHardenOutput(
        [
          "FROGG_HARDEN_BEGIN",
          '{"trustLan":true,"applied":{"status":"env_override"}}',
          "FROGG_HARDEN_END",
        ].join("\n"),
      ),
    ).toEqual({ trustLan: true, applied: "env_override", unsupported: false });
  });

  it("reports a CLI without the command instead of throwing", () => {
    expect(parseHardenOutput("FROGG_HARDEN_UNSUPPORTED\n")).toEqual({
      trustLan: true,
      applied: "unsupported",
      unsupported: true,
    });
  });

  it("rejects output with no result", () => {
    expect(() => parseHardenOutput("bash: oops\n")).toThrow(/LAN trust/u);
  });
});
