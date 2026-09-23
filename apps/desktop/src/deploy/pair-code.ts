import type { Brand } from "@frogg/branding/schema";

/**
 * Obtains a pairing code from a deployed daemon by running its CLI over the
 * deploy SSH session. The SSH channel is the trust anchor: whatever the CLI
 * prints here is what the app then verifies the network endpoint against.
 *
 * Adapter contract (source `pair-code`, the short-lived code command landing
 * separately): `<cli> pair --json` prints, undecorated when stdout is not a
 * TTY, `{code, host, port, fingerprint, deeplink, expiresAt, role}`, where
 * `deeplink` is `<scheme>://pair#offer=…` and `fingerprint` pins the daemon
 * public key (`SHA256:<base64>`).
 * Until that command exists the script falls back to source `pair`,
 * `<cli> daemon pair --json`, which prints `deepLink` (no fingerprint) only
 * for an unclaimed daemon.
 */
export type PairCodeSource = "pair-code" | "pair";

export interface PairCodeResult {
  source: PairCodeSource;
  deepLink: string;
  host?: string;
  port?: number;
  fingerprint?: string;
  expiresAt?: string;
  /** The role the code grants, as the daemon names it. */
  role?: string;
}

export interface PairCodeAdapter {
  script(brand: PairCodeBrand): string;
  parse(stdout: string): PairCodeResult;
}

export type PairCodeBrand = Pick<Brand, "id" | "envPrefix" | "cliName">;

const BEGIN = "FROGG_PAIR_BEGIN";
const END = "FROGG_PAIR_END";

export function buildPairCodeScript(brand: PairCodeBrand): string {
  return [
    "set +e",
    `root="\${${brand.envPrefix}_INSTALL_DIR:-$HOME/.local/share/${brand.id}}"`,
    `cli="$root/current/bin/${brand.cliName}"`,
    `[ -x "$cli" ] || cli=$(command -v ${brand.cliName} 2>/dev/null)`,
    `[ -n "$cli" ] || { echo "${brand.cliName} is not installed on this host" >&2; exit 127; }`,
    `if "$cli" pair --help >/dev/null 2>&1; then source=pair-code; set -- pair --json; else source=pair; set -- daemon pair --json; fi`,
    // stderr passes straight through so the app can show the CLI's own reason.
    `out=$("$cli" "$@" </dev/null); code=$?`,
    `[ "$code" = 0 ] || exit "$code"`,
    `printf '${BEGIN} %s\\n%s\\n${END}\\n' "$source" "$out"`,
    "",
  ].join("\n");
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parsePairCodeOutput(stdout: string): PairCodeResult {
  const lines = stdout.split(/\r?\n/u);
  const begin = lines.findLastIndex((line) => line.startsWith(`${BEGIN} `));
  const end = lines.findIndex((line, index) => index > begin && line.trim() === END);
  if (begin < 0 || end < 0) throw new Error("The daemon printed no pairing code.");
  const source = lines[begin]!.slice(BEGIN.length + 1).trim();
  if (source !== "pair-code" && source !== "pair")
    throw new Error("The pairing code came from an unknown command.");
  let raw: unknown;
  try {
    raw = JSON.parse(lines.slice(begin + 1, end).join("\n"));
  } catch {
    throw new Error("The pairing code could not be parsed.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("The pairing code could not be parsed.");
  const value = raw as Record<string, unknown>;
  const deepLink = optionalText(value.deeplink) ?? optionalText(value.deepLink);
  if (!deepLink) throw new Error("The daemon printed no pairing link.");
  const port = value.port;
  const host = optionalText(value.host);
  const fingerprint = optionalText(value.fingerprint);
  const expiresAt = optionalText(value.expiresAt);
  const role = optionalText(value.role);
  return {
    source,
    deepLink,
    ...(role ? { role } : {}),
    ...(host ? { host } : {}),
    ...(typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535
      ? { port }
      : {}),
    ...(fingerprint ? { fingerprint } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export const cliPairCodeAdapter: PairCodeAdapter = {
  script: buildPairCodeScript,
  parse: parsePairCodeOutput,
};
