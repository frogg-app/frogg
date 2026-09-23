import { describe, expect, test, vi } from "vitest";

import {
  PAIR_CODE_FAILURE_EXIT_CODE,
  runPairCodeCommand,
  shouldRenderQr,
  type PairCodeOutput,
  type PairCodeResult,
} from "./pair-code.js";

const result: PairCodeResult = {
  code: "ABCD2345",
  host: "192.168.1.10",
  port: 8790,
  fingerprint: "sha256:abc123",
  deeplink: "frogg://pair/direct?v=1&host=192.168.1.10",
  expiresAt: "2026-09-22T10:00:00.000Z",
  role: "operator",
  serverId: "srv_1",
};

interface RecordedOutput extends PairCodeOutput {
  stdout: string[];
  stderr: string[];
  exitCode: number | undefined;
}

function createOutput(tty: boolean): RecordedOutput {
  return {
    stdout: [],
    stderr: [],
    exitCode: undefined,
    writeStdout(message) {
      this.stdout.push(message);
    },
    writeStderr(message) {
      this.stderr.push(message);
    },
    setExitCode(code) {
      this.exitCode = code;
    },
    isTty: () => tty,
  };
}

function deps(output: RecordedOutput, overrides: Record<string, unknown> = {}) {
  return {
    mintCode: vi.fn(async () => result),
    renderQr: vi.fn(async () => "██ QR ██"),
    output,
    mobileEnabled: true,
    ...overrides,
  };
}

describe("pair", () => {
  test("--code-only prints the bare code and nothing else", async () => {
    const output = createOutput(true);
    await runPairCodeCommand({ codeOnly: true }, deps(output));

    expect(output.stdout).toEqual(["ABCD2345\n"]);
    expect(output.stderr).toEqual([]);
    expect(output.exitCode).toBeUndefined();
  });

  test("--json prints exactly the fields a pairing client needs", async () => {
    const output = createOutput(true);
    await runPairCodeCommand({ json: true }, deps(output));

    const parsed = JSON.parse(output.stdout.join(""));
    expect(parsed).toEqual({
      code: "ABCD2345",
      host: "192.168.1.10",
      port: 8790,
      fingerprint: "sha256:abc123",
      deeplink: "frogg://pair/direct?v=1&host=192.168.1.10",
      expiresAt: "2026-09-22T10:00:00.000Z",
      role: "operator",
    });
  });

  test("--json never renders a QR, even on a terminal", async () => {
    const output = createOutput(true);
    const dependencies = deps(output);
    await runPairCodeCommand({ json: true }, dependencies);
    expect(dependencies.renderQr).not.toHaveBeenCalled();
  });

  test("the decorated form shows the code, address, fingerprint, deep link and QR", async () => {
    const output = createOutput(true);
    await runPairCodeCommand({}, deps(output));

    const printed = output.stdout.join("");
    expect(printed).toContain("ABCD-2345");
    expect(printed).toContain("192.168.1.10:8790");
    expect(printed).toContain("sha256:abc123");
    expect(printed).toContain("frogg://pair/direct");
    expect(printed).toContain("██ QR ██");
  });

  test("a redirected stdout gets no QR", async () => {
    const output = createOutput(false);
    const dependencies = deps(output);
    await runPairCodeCommand({}, dependencies);

    expect(dependencies.renderQr).not.toHaveBeenCalled();
    expect(output.stdout.join("")).toContain("ABCD-2345");
  });

  test("a failure exits with the documented code and says nothing on stdout", async () => {
    const output = createOutput(true);
    await runPairCodeCommand(
      {},
      deps(output, {
        mintCode: vi.fn(async () => {
          throw new Error("No running daemon answered");
        }),
      }),
    );

    expect(output.stdout).toEqual([]);
    expect(output.stderr.join("")).toContain("No running daemon answered");
    expect(output.exitCode).toBe(PAIR_CODE_FAILURE_EXIT_CODE);
  });

  test("--code-only reports a failure on stderr, undecorated, with the same exit code", async () => {
    const output = createOutput(true);
    await runPairCodeCommand(
      { codeOnly: true },
      deps(output, {
        mintCode: vi.fn(async () => {
          throw new Error("No running daemon answered");
        }),
      }),
    );

    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual(["No running daemon answered\n"]);
    expect(output.exitCode).toBe(PAIR_CODE_FAILURE_EXIT_CODE);
  });

  test("--json reports a failure as one machine-readable object on stderr", async () => {
    const output = createOutput(true);
    await runPairCodeCommand(
      { json: true },
      deps(output, {
        mintCode: vi.fn(async () => {
          throw new Error("No running daemon answered");
        }),
      }),
    );

    expect(JSON.parse(output.stderr.join(""))).toEqual({
      code: "PAIRING_CODE_FAILED",
      message: "No running daemon answered",
    });
    expect(output.exitCode).toBe(PAIR_CODE_FAILURE_EXIT_CODE);
  });
});

describe("pair QR policy", () => {
  const policy = (tty: boolean, mobileEnabled: boolean) => ({
    output: createOutput(tty),
    mobileEnabled,
  });

  test("a brand without a mobile app hides the QR until --qr asks for it", () => {
    expect(shouldRenderQr({}, policy(true, false))).toBe(false);
    expect(shouldRenderQr({ qr: true }, policy(true, false))).toBe(true);
  });

  test("--qr still never writes a QR into a pipe", () => {
    expect(shouldRenderQr({ qr: true }, policy(false, true))).toBe(false);
  });

  test("a mobile brand shows the QR on a terminal by default", () => {
    expect(shouldRenderQr({}, policy(true, true))).toBe(true);
  });
});
