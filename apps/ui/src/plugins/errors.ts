import { PluginRequestError } from "@frogg/client/internal/daemon-client";
import { i18n } from "@/i18n/i18next";
import { ClientPluginError } from "./client-runtime/errors";

/**
 * A readable message for a failed plugin request. Known contract codes get a translated
 * wrapper; the daemon's own message is kept as the detail since it names the plugin/repo.
 */
export function describePluginError(error: unknown): string {
  if (error instanceof PluginRequestError || error instanceof ClientPluginError) {
    const key = `plugins.errors.${error.code}`;
    if (i18n.exists(key)) {
      return i18n.t("plugins.errors.withDetail", {
        summary: i18n.t(key),
        detail: error.message,
      });
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function isPluginErrorCode(error: unknown, code: string): boolean {
  return (
    (error instanceof PluginRequestError || error instanceof ClientPluginError) &&
    error.code === code
  );
}
