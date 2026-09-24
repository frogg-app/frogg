import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  PairingAuthError,
  resolveDirectClaimOffer,
  pairingQrEnabled,
  runPairCommand,
  type PairCommandOutput,
  type PairingOffer,
} from "./pair.js";
import { tryConnectToDaemon } from "../../utils/client.js";

const disabledOffer: PairingOffer = { relayEnabled: false, url: null, qr: null };
const enabledOffer: PairingOffer = {
  relayEnabled: true,
  url: "https://pair.frogg.app/code/test",
  qr: null,
};

const resolveAccessMode = async () => "lan_trusted" as const;

interface RecordedPairCommandOutput extends PairCommandOutput {
  stdout: string[];
  stderr: string[];
  successes: string[];
  exitCode: number | undefined;
}

function createRecordedOutput(): RecordedPairCommandOutput {
  return {
    columns: 80,
    stdout: [],
    stderr: [],
    successes: [],
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
    success(message) {
      this.successes.push(message);
    },
  };
}

describe("daemon pair workflow", () => {
  test("interactive decline prints direct guidance and creates no pairing output", async () => {
    const resolveOffer = vi.fn(async () => disabledOffer);
    const confirmRelay = vi.fn(async () => false);
    const printDirectGuidance = vi.fn();
    const output = createRecordedOutput();

    await runPairCommand(
      {},
      {
        resolveOffer,
        resolveAccessMode,
        confirmRelay,
        printDirectGuidance,
        isInteractive: () => true,
        output,
      },
    );

    expect(confirmRelay).toHaveBeenCalledOnce();
    expect(printDirectGuidance).toHaveBeenCalledOnce();
    expect(output.stderr.join("")).toContain("No pairing QR was created");
    expect(output.exitCode).toBe(1);
  });

  test("interactive consent enables relay and prints the refreshed offer", async () => {
    const resolveOffer = vi
      .fn<(options: { froggHome: string; enableRelay?: boolean }) => Promise<PairingOffer>>()
      .mockResolvedValueOnce(disabledOffer)
      .mockResolvedValueOnce(enabledOffer);
    const output = createRecordedOutput();

    await runPairCommand(
      {},
      {
        resolveOffer,
        resolveAccessMode,
        confirmRelay: async () => true,
        printDirectGuidance: vi.fn(),
        isInteractive: () => true,
        output,
      },
    );

    expect(resolveOffer).toHaveBeenNthCalledWith(2, expect.objectContaining({ enableRelay: true }));
    expect(output.stdout.join("")).toContain(enabledOffer.url ?? "");
    expect(output.successes).toEqual(["Relay enabled"]);
  });

  test("JSON mode never prompts and returns a structured relay-disabled error", async () => {
    const confirmRelay = vi.fn(async () => true);
    const output = createRecordedOutput();

    await runPairCommand(
      { json: true },
      {
        resolveOffer: async () => disabledOffer,
        confirmRelay,
        printDirectGuidance: vi.fn(),
        isInteractive: () => true,
        output,
      },
    );

    expect(confirmRelay).not.toHaveBeenCalled();
    expect(output.stderr.join("")).toContain('"code":"RELAY_DISABLED"');
    expect(output.exitCode).toBe(1);
  });

  test("explicit relay opts in without prompting", async () => {
    const resolveOffer = vi.fn(async () => enabledOffer);
    const confirmRelay = vi.fn(async () => false);
    const output = createRecordedOutput();

    await runPairCommand(
      { relay: true, json: true },
      {
        resolveOffer,
        resolveAccessMode,
        confirmRelay,
        printDirectGuidance: vi.fn(),
        isInteractive: () => false,
        output,
      },
    );

    expect(resolveOffer).toHaveBeenCalledWith(expect.objectContaining({ enableRelay: true }));
    expect(confirmRelay).not.toHaveBeenCalled();
    expect(output.exitCode).toBeUndefined();
  });

  test("surfaces launch-override rejection", async () => {
    await expect(
      runPairCommand(
        { relay: true },
        {
          resolveOffer: async () => {
            throw new Error("Relay is controlled by a daemon launch override");
          },
          resolveAccessMode,
          confirmRelay: vi.fn(),
          printDirectGuidance: vi.fn(),
          isInteractive: () => false,
          output: createRecordedOutput(),
        },
      ),
    ).rejects.toThrow("launch override");
  });

  test("prints the access mode alongside the pairing link", async () => {
    const output = createRecordedOutput();

    await runPairCommand(
      {},
      {
        resolveOffer: async () => enabledOffer,
        resolveAccessMode: async () => "password",
        confirmRelay: vi.fn(),
        printDirectGuidance: vi.fn(),
        isInteractive: () => false,
        output,
      },
    );

    const stdout = output.stdout.join("");
    expect(stdout).toContain("https://pair.frogg.app/code/test");
    expect(stdout).toContain("Access: password set");
  });

  test("an auth refusal is reported as an error with exit 1", async () => {
    const output = createRecordedOutput();

    await runPairCommand(
      { json: true },
      {
        resolveOffer: async () => {
          throw new PairingAuthError(401);
        },
        resolveAccessMode,
        confirmRelay: vi.fn(),
        printDirectGuidance: vi.fn(),
        isInteractive: () => false,
        output,
      },
    );

    expect(output.stderr.join("")).toContain('"code":"PAIRING_UNAUTHORIZED"');
    expect(output.stdout).toEqual([]);
    expect(output.exitCode).toBe(1);
  });

  test("FROGG_PAIRING_QR=0 turns the terminal QR off", () => {
    expect(pairingQrEnabled({})).toBe(true);
    expect(pairingQrEnabled({ FROGG_PAIRING_QR: "1" })).toBe(true);
    expect(pairingQrEnabled({ FROGG_PAIRING_QR: "0" })).toBe(false);
    expect(pairingQrEnabled({ FROGG_PAIRING_QR: "off" })).toBe(false);
  });
});

describe("direct claim offer over loopback HTTP", () => {
  const TOKEN = "flt1.test-token";
  let home: string;
  let server: Server;
  let listen: string;
  let seenAuth: Array<string | undefined>;

  beforeEach(async () => {
    vi.stubEnv("FROGG_PASSWORD", "");
    home = mkdtempSync(path.join(tmpdir(), "frogg-pair-"));
    seenAuth = [];
    // Mimics a claimed daemon: /api/setup/offer needs the local token.
    server = createServer((req, res) => {
      seenAuth.push(req.headers.authorization);
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          url: "https://pair.example/claim#t",
          expiresAt: "2099-01-01T00:00:00Z",
          endpoints: ["127.0.0.1"],
          qr: null,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    listen = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  });

  test("claimed daemon + local token -> direct offer", async () => {
    writeFileSync(path.join(home, "local-token"), `${TOKEN}\n`, { mode: 0o600 });
    const offer = await resolveDirectClaimOffer(listen, home);
    expect(seenAuth).toEqual([`Bearer ${TOKEN}`]);
    expect(offer).toMatchObject({ mode: "direct", url: "https://pair.example/claim#t" });
  });

  test("claimed daemon without a token -> PairingAuthError, not a silent null", async () => {
    await expect(resolveDirectClaimOffer(listen, home)).rejects.toBeInstanceOf(PairingAuthError);
    expect(seenAuth).toEqual([undefined]);
  });

  test("the daemon WebSocket connection sends the --home local token", async () => {
    writeFileSync(path.join(home, "local-token"), `${TOKEN}\n`, { mode: 0o600 });
    vi.stubEnv("FROGG_HOME", mkdtempSync(path.join(home, "other-")));
    const upgradeAuth: Array<string | undefined> = [];
    server.on("upgrade", (req, socket) => {
      upgradeAuth.push(req.headers.authorization);
      socket.destroy();
    });
    expect(await tryConnectToDaemon({ host: listen, home, timeout: 500 })).toBeNull();
    expect(upgradeAuth).toEqual([`Bearer ${TOKEN}`]);
  });
});

describe("daemon pair --home", () => {
  test("resolves every lookup against --home without touching the environment", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "frogg-pair-home-"));
    const other = mkdtempSync(path.join(tmpdir(), "frogg-pair-env-"));
    vi.stubEnv("FROGG_HOME", other);
    try {
      const resolveOffer = vi.fn(async () => enabledOffer);
      const accessMode = vi.fn(resolveAccessMode);
      await runPairCommand(
        { home, json: true },
        {
          resolveOffer,
          resolveAccessMode: accessMode,
          isInteractive: () => false,
          output: createRecordedOutput(),
        },
      );
      expect(resolveOffer).toHaveBeenCalledWith({ froggHome: home, enableRelay: false });
      expect(accessMode).toHaveBeenCalledWith(home);
      expect(process.env.FROGG_HOME).toBe(other);
    } finally {
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });
});
