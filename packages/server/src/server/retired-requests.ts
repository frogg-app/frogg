/**
 * Session requests this daemon no longer implements. An older app that still sends one gets a
 * clean `unsupported` rpc_error naming why, instead of the generic "try upgrading the daemon".
 */
// COMPAT(betaChannelManagement): retired in v1.6.14, remove after 2027-09-27.
const RETIRED_REQUEST_PREFIXES: ReadonlyArray<{ prefix: string; error: string }> = [
  {
    prefix: "daemon.beta_channel.",
    error:
      "The side-by-side beta daemon is no longer supported. Prereleases ship as Frogg Next; " +
      "switch the daemon update channel to Beta to run a prerelease daemon.",
  },
];

export function retiredRequestError(requestType: string | undefined): string | null {
  if (!requestType) return null;
  return (
    RETIRED_REQUEST_PREFIXES.find((entry) => requestType.startsWith(entry.prefix))?.error ?? null
  );
}
