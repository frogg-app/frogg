import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSshArgs, parseTarget } from "./args.js";
import { DeployManager } from "./manager.js";
import { buildPairCodeScript, parsePairCodeOutput } from "./pair-code.js";

const distribution = {
  envPrefix: "CUSTOM",
  daemonPort: 9999,
  releaseBase: null,
};

describe("SSH key selection", () => {
  it("passes a session key file to ssh and rejects unsafe paths", () => {
    const target = parseTarget({
      host: "box",
      identityFile: "~/.ssh/deploy key",
    });
    expect(buildSshArgs(target, "sh -s")).toEqual(
      expect.arrayContaining(["-i", "~/.ssh/deploy key", "IdentitiesOnly=yes"]),
    );
    expect(buildSshArgs(parseTarget({ host: "box" }), "sh -s")).not.toContain("-i");
    for (const identityFile of ["-oProxyCommand=x", "relative/key", "/tmp/a\nb"])
      expect(() => parseTarget({ host: "box", identityFile })).toThrow("key file");
  });
});

describe("pairing code over SSH", () => {
  const pairBrand = { id: "custom", envPrefix: "CUSTOM", cliName: "custom" };
  const link = "custom://pair#offer=abc";

  function runScript(cliBody: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const home = mkdtempSync(path.join(tmpdir(), "pair-code-"));
    const bin = path.join(home, ".local/share/custom/current/bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "custom"), `#!/bin/sh\n${cliBody}\n`, {
      mode: 0o755,
    });
    return new Promise((resolve) => {
      const child = spawn("sh", ["-s"], {
        env: { PATH: process.env.PATH, HOME: home },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("close", (code) => {
        rmSync(home, { recursive: true, force: true });
        resolve({ stdout, stderr, code: code ?? -1 });
      });
      child.stdin.end(buildPairCodeScript(pairBrand));
    });
  }

  it.skipIf(process.platform === "win32")(
    "prefers pair-code when the CLI has it and falls back to pair",
    async () => {
      const withPairCode = await runScript(
        `[ "$1 $2" = "pair --help" ] && exit 0; [ "$*" = "pair --json" ] || exit 9; echo '{"code":"K7Q2","deeplink":"${link}","host":"10.0.0.2","port":9999,"fingerprint":"SHA256:x","role":"admin"}'`,
      );
      expect(parsePairCodeOutput(`banner\n${withPairCode.stdout}`)).toEqual({
        source: "pair-code",
        deepLink: link,
        role: "admin",
        host: "10.0.0.2",
        port: 9999,
        fingerprint: "SHA256:x",
      });
      const withRole = await runScript(
        `[ "$1 $2" = "pair --help" ] && { echo "  --role <role>  role the redeeming device gets"; exit 0; }; [ "$*" = "pair --json --role owner" ] || { echo "args: $*" >&2; exit 9; }; echo '{"deeplink":"${link}","role":"owner"}'`,
      );
      expect(withRole.code).toBe(0);
      expect(parsePairCodeOutput(withRole.stdout)).toEqual({
        source: "pair-code",
        deepLink: link,
        role: "owner",
      });
      const legacy = await runScript(
        `[ "$1" = pair ] && exit 1; [ "$1 $2 $3" = "daemon pair --json" ] || exit 9; printf '{\\n  "deepLink": "${link}"\\n}\\n'`,
      );
      expect(parsePairCodeOutput(legacy.stdout)).toEqual({
        source: "pair",
        deepLink: link,
      });
      const failed = await runScript(`[ "$1" = pair ] && exit 1; echo claimed >&2; exit 3`);
      expect(failed.code).toBe(3);
      expect(failed.stderr).toContain("claimed");
    },
  );

  it("rejects output without a framed pairing link", () => {
    expect(() => parsePairCodeOutput("nothing")).toThrow("no pairing code");
    expect(() => parsePairCodeOutput("FROGG_PAIR_BEGIN pair\n{}\nFROGG_PAIR_END")).toThrow(
      "no pairing link",
    );
    expect(() => parsePairCodeOutput("FROGG_PAIR_BEGIN evil\n{}\nFROGG_PAIR_END")).toThrow();
  });

  it("returns the parsed code and surfaces the CLI's stderr on failure", async () => {
    let code = 0;
    const manager = new DeployManager({
      brand: distribution,
      defaultVersion: "1",
      probeScript: "probe",
      script: () => "installer",
      emit: () => undefined,
      pairCode: { script: "pair script", parse: parsePairCodeOutput },
      execute: async (input) => {
        expect(input.script).toBe("pair script");
        return {
          stdout: `FROGG_PAIR_BEGIN pair\n{"deepLink":"${link}"}\nFROGG_PAIR_END\n`,
          stderr: "already claimed",
          code,
        };
      },
    });
    await expect(manager.pairCode({ host: "box" })).resolves.toEqual({
      source: "pair",
      deepLink: link,
    });
    code = 1;
    await expect(manager.pairCode({ host: "box" })).rejects.toThrow("already claimed");
  });
});
