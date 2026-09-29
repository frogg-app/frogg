import { hostname } from "node:os";

/**
 * The name the daemon shows clients. FROGG_HOSTNAME overrides the machine's
 * hostname so a development daemon beside the installed one is unmistakable.
 */
export function daemonHostname(): string {
  return process.env.FROGG_HOSTNAME?.trim() || hostname();
}
