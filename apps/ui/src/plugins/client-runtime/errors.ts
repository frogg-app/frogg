/**
 * A failure in the client plugin runtime. `code` uses the plugin RPC contract codes
 * (signature_invalid, hash_mismatch, manifest_mismatch, fetch_failed, incompatible, forbidden,
 * not_found, not_active, timeout, plugin_error, invalid_request, internal) so the UI describes
 * device-side failures the same way it describes host ones.
 */
export class ClientPluginError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ClientPluginError";
    this.code = code;
  }
}
