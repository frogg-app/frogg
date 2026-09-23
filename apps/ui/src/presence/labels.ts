/**
 * COMPAT(sessionPresence): added in v1.6.0. Activity to i18n key. Kept out of
 * the components so the mapping is exhaustive over `PresenceActivity` and can
 * be asserted without rendering anything.
 */
import type { PresenceActivity } from "@frogg/protocol/device-access";

export function presenceActivityLabelKey(activity: PresenceActivity): string {
  switch (activity) {
    case "typing":
      return "presence.activity.typing";
    case "sending":
      return "presence.activity.sending";
    case "input":
      return "presence.activity.input";
    case "idle":
      return "presence.activity.idle";
    case "viewing":
      return "presence.activity.viewing";
  }
}
