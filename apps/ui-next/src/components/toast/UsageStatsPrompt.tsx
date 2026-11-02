import { useEffect } from "react";
import { useOnboarding } from "../onboarding/store";
import {
  markUsageStatsPrompted,
  usageStatsAvailable,
  useUsageStats,
} from "../../usage-stats/store";
import { useUi } from "../../ui-store";
import { toast } from "./store";

const review = () => {
  useUi.getState().setTool("settings");
  useUi.getState().openSettings("privacy");
};

/**
 * "Help improve Frogg": asks once, after onboarding is out of the way, whether to send usage
 * statistics. The toast only points at Settings → Privacy & feedback, where the choice is made
 * next to the list of what is sent; dismissing it leaves statistics off. Renders nothing.
 */
export function UsageStatsPrompt() {
  const loaded = useUsageStats((st) => st.loaded);
  const due = useUsageStats((st) => st.consent === "unset" && !st.prompted);
  const onboarding = useOnboarding(
    (st) => st.loaded && (st.status === "new" || st.status === "active"),
  );
  const onboardingLoaded = useOnboarding((st) => st.loaded);
  useEffect(() => {
    if (!usageStatsAvailable() || !loaded || !onboardingLoaded || !due || onboarding) return;
    const t = setTimeout(() => {
      markUsageStatsPrompted();
      toast({
        kind: "info",
        sticky: true,
        title: "Help improve Frogg",
        detail: "Send usage statistics? App interactions only, never your prompts, code or files.",
        action: { label: "Review…", onPress: review },
      });
    }, 4000);
    return () => clearTimeout(t);
  }, [loaded, onboardingLoaded, due, onboarding]);
  return null;
}
