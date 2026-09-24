import { brand } from "@frogg/branding";
import { Command } from "commander";
import chalk from "chalk";
import { renderPairingQr } from "@frogg/server";
import { formatPairingCode } from "@frogg/protocol/device-access";

import { tryConnectToDaemon } from "../../utils/client.js";
import { addJsonOption } from "../../utils/command-options.js";
import { resolveLocalDaemonState } from "./local-daemon.js";

/**
 * `<cli> pair`: mints a short-lived pairing code from the running daemon and
 * prints it in whichever form the caller can consume.
 *
 * The contract is deliberately narrow, because a deployment script reads it:
 *  - `--code-only` writes the bare code and nothing else,
 *  - `--json` writes one object with every field a pairing client needs,
 *  - the decorated form is for a person at a terminal, and its QR never
 *    appears when stdout is not a TTY (a log or a pipe would just be noise).
 */

export interface PairCodeResult {
  code: string;
  host: string | null;
  port: number | null;
  fingerprint: string;
  deeplink: string | null;
  expiresAt: string | null;
  role: string;
  serverId: string;
}

export interface PairCodeOptions {
  home?: string;
  json?: boolean;
  codeOnly?: boolean;
  qr?: boolean;
  role?: string;
  ttl?: string;
}

export interface PairCodeOutput {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  setExitCode(code: number): void;
  isTty(): boolean;
}

export interface PairCodeDependencies {
  mintCode(options: PairCodeOptions): Promise<PairCodeResult>;
  renderQr(value: string): Promise<string | null>;
  output: PairCodeOutput;
  mobileEnabled: boolean;
}

const PAIRING_RPC_TIMEOUT_MS = 5_000;
/** A failure a script can branch on without parsing the message. */
export const PAIR_CODE_FAILURE_EXIT_CODE = 1;
const ROLES = new Set(["owner", "operator", "viewer"]);

function createProcessOutput(): PairCodeOutput {
  return {
    writeStdout: (message) => void process.stdout.write(message),
    writeStderr: (message) => void process.stderr.write(message),
    setExitCode: (code) => {
      process.exitCode = code;
    },
    isTty: () => Boolean(process.stdout.isTTY),
  };
}

export function pairCodeCommand(): Command {
  return addJsonOption(
    new Command("pair").description("Create a pairing code another device can redeem"),
  )
    .option("--home <path>", `${brand.name} home directory (default: ~/${brand.homeDir})`)
    .option("--code-only", "print only the pairing code, with no other output")
    .option("--qr", "print the QR code even when this brand hides it")
    .option("--role <role>", "role the redeeming device gets: owner, operator or viewer")
    .option("--ttl <seconds>", "how long the code stays valid (30-3600, default 600)")
    .action(async (_options: PairCodeOptions, command: Command) => {
      await runPairCodeCommand(command.optsWithGlobals());
    });
}

function parseRole(role: string | undefined): "owner" | "operator" | "viewer" | undefined {
  if (role === undefined) return undefined;
  if (!ROLES.has(role)) {
    throw new Error(`Unknown role "${role}". Use owner, operator or viewer.`);
  }
  return role as "owner" | "operator" | "viewer";
}

function parseTtlSeconds(ttl: string | undefined): number | undefined {
  if (ttl === undefined) return undefined;
  const seconds = Number(ttl);
  if (!Number.isFinite(seconds)) {
    throw new Error(`--ttl must be a number of seconds, not "${ttl}".`);
  }
  return seconds;
}

/** Asks the running daemon for a code over the session RPC. */
export async function mintPairingCode(options: PairCodeOptions): Promise<PairCodeResult> {
  const role = parseRole(options.role);
  const ttlSeconds = parseTtlSeconds(options.ttl);
  const state = resolveLocalDaemonState({ home: options.home });
  const client = await tryConnectToDaemon({
    host: state.listen,
    home: state.home,
    timeout: PAIRING_RPC_TIMEOUT_MS,
  });
  if (!client) {
    throw new Error(
      `No running ${brand.name} daemon answered on ${state.listen}. Start it with \`${brand.cliName} start\`.`,
    );
  }
  try {
    if (client.getLastServerInfoMessage()?.features?.deviceAccess !== true) {
      throw new Error(`Update the ${brand.name} daemon before creating pairing codes.`);
    }
    const payload = await client.createPairingCode({
      ...(role ? { role } : {}),
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    });
    if (payload.error || !payload.code) {
      throw new Error(payload.error ?? "The daemon refused to create a pairing code.");
    }
    const endpoint = payload.endpoints[0] ?? null;
    return {
      code: payload.code,
      host: endpoint?.host ?? null,
      port: endpoint?.port ?? null,
      fingerprint: payload.fingerprint,
      deeplink: endpoint?.deepLink ?? null,
      expiresAt: payload.expiresAt,
      role: payload.role ?? "operator",
      serverId: payload.serverId,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runPairCodeCommand(
  options: PairCodeOptions,
  overrides: Partial<PairCodeDependencies> = {},
): Promise<void> {
  const dependencies: PairCodeDependencies = {
    mintCode: mintPairingCode,
    renderQr: async (value) => {
      try {
        return await renderPairingQr(value);
      } catch {
        return null;
      }
    },
    output: createProcessOutput(),
    mobileEnabled: brand.mobile.enabled !== false,
    ...overrides,
  };
  const { output } = dependencies;

  let result: PairCodeResult;
  try {
    result = await dependencies.mintCode(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      output.writeStderr(`${JSON.stringify({ code: "PAIRING_CODE_FAILED", message })}\n`);
    } else if (!options.codeOnly) {
      output.writeStderr(`${chalk.red(message)}\n`);
    } else {
      output.writeStderr(`${message}\n`);
    }
    output.setExitCode(PAIR_CODE_FAILURE_EXIT_CODE);
    return;
  }

  // Bare code first: anything else on stdout would break `code=$(… --code-only)`.
  if (options.codeOnly) {
    output.writeStdout(`${result.code}\n`);
    return;
  }

  if (options.json) {
    output.writeStdout(
      `${JSON.stringify(
        {
          code: result.code,
          host: result.host,
          port: result.port,
          fingerprint: result.fingerprint,
          deeplink: result.deeplink,
          expiresAt: result.expiresAt,
          role: result.role,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  await writeDecoratedPairing(result, options, dependencies);
}

async function writeDecoratedPairing(
  result: PairCodeResult,
  options: PairCodeOptions,
  dependencies: PairCodeDependencies,
): Promise<void> {
  const { output } = dependencies;
  output.writeStdout(`\nPairing code: ${chalk.bold(formatPairingCode(result.code))}\n`);
  if (result.host && result.port !== null) {
    output.writeStdout(`Daemon address: ${result.host}:${result.port}\n`);
  }
  output.writeStdout(`Daemon fingerprint: ${result.fingerprint}\n`);
  output.writeStdout(`Role: ${result.role}\n`);
  if (result.expiresAt) output.writeStdout(`Expires: ${result.expiresAt}\n`);
  if (result.deeplink) output.writeStdout(`\n${result.deeplink}\n`);

  if (!shouldRenderQr(options, dependencies)) return;
  if (!result.deeplink) return;
  const qr = await dependencies.renderQr(result.deeplink);
  if (qr) output.writeStdout(`\n${qr}\n`);
}

/**
 * A QR is only ever for a phone camera pointed at a real terminal: never into a
 * pipe, and not at all for a brand that ships no mobile app unless `--qr` asks.
 */
export function shouldRenderQr(
  options: PairCodeOptions,
  dependencies: Pick<PairCodeDependencies, "output" | "mobileEnabled">,
): boolean {
  if (!dependencies.output.isTty()) return false;
  if (options.qr === true) return true;
  return dependencies.mobileEnabled;
}
