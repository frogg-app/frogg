import type { Brand } from "@frogg/branding/schema";

/**
 * Locks down a freshly deployed daemon over the same SSH session that
 * installed it, by turning `daemon.auth.trustLan` off.
 *
 * A daemon starts with trusted LAN on, which makes every peer on the remote
 * host's network an owner without pairing. A deploy that binds all interfaces
 * would hand that network ownership of the box, and the pairing step does not
 * take it back: pairing adds a credential, it does not stop unauthenticated
 * clients. So the deploy flow turns trusted LAN off before it mints a pairing
 * code, and from then on a network client must present a device credential.
 *
 * Adapter contract: `<cli> daemon trust-lan off --json` writes
 * `daemon.auth.trustLan=false` to config.json and asks a running daemon to
 * reload, printing `{action, trustLan, configPath, applied, message}`. An
 * older daemon without the command reports `unsupported` rather than failing
 * the deploy, so the modal can say the host was left LAN-trusted.
 */
export interface HardenResult {
  /** `false` once the daemon no longer trusts its LAN unauthenticated. */
  trustLan: boolean;
  /** How the change reached the daemon, as the CLI reports it. */
  applied: string;
  /** True when the installed CLI has no `daemon trust-lan` command. */
  unsupported: boolean;
}

export type HardenBrand = Pick<Brand, "id" | "envPrefix" | "cliName">;

const BEGIN = "FROGG_HARDEN_BEGIN";
const END = "FROGG_HARDEN_END";
const UNSUPPORTED = "FROGG_HARDEN_UNSUPPORTED";

export function buildHardenScript(brand: HardenBrand): string {
  return [
    "set +e",
    `root="\${${brand.envPrefix}_INSTALL_DIR:-$HOME/.local/share/${brand.id}}"`,
    `cli="$root/current/bin/${brand.cliName}"`,
    `[ -x "$cli" ] || cli=$(command -v ${brand.cliName} 2>/dev/null)`,
    `[ -n "$cli" ] || { echo "${brand.cliName} is not installed on this host" >&2; exit 127; }`,
    `if ! "$cli" daemon trust-lan --help >/dev/null 2>&1; then printf '${UNSUPPORTED}\\n'; exit 0; fi`,
    // stderr passes straight through so the app can show the CLI's own reason.
    `out=$("$cli" daemon trust-lan off --json </dev/null); code=$?`,
    `[ "$code" = 0 ] || exit "$code"`,
    `printf '${BEGIN}\\n%s\\n${END}\\n' "$out"`,
    "",
  ].join("\n");
}

export function parseHardenOutput(stdout: string): HardenResult {
  const lines = stdout.split(/\r?\n/u);
  if (lines.some((line) => line.trim() === UNSUPPORTED)) {
    return { trustLan: true, applied: "unsupported", unsupported: true };
  }
  const begin = lines.findLastIndex((line) => line.trim() === BEGIN);
  const end = lines.findIndex((line, index) => index > begin && line.trim() === END);
  if (begin < 0 || end < 0) throw new Error("The daemon did not report its LAN trust setting.");
  let raw: unknown;
  try {
    raw = JSON.parse(lines.slice(begin + 1, end).join("\n"));
  } catch {
    throw new Error("The LAN trust result could not be parsed.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("The LAN trust result could not be parsed.");
  const value = raw as Record<string, unknown>;
  // The CLI only ever prints `trustLan: false` here, but trust what it says:
  // a daemon pinned by FROGG_TRUST_LAN reports the env override in `applied`.
  const trustLan = value.trustLan === true;
  const applied =
    value.applied && typeof value.applied === "object" && "status" in value.applied
      ? String((value.applied as Record<string, unknown>).status)
      : "unknown";
  return { trustLan, applied, unsupported: false };
}

export const cliHardenAdapter = {
  script: buildHardenScript,
  parse: parseHardenOutput,
};
