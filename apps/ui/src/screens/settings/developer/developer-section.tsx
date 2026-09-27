import { BetaAppCard } from "./beta-app-card";
import { BetaDaemonHostsSection } from "./beta-daemon-hosts";

/** Settings → Developer: shown only with About's "Developer options" switch on. */
export function DeveloperSection() {
  return (
    <>
      <BetaAppCard />
      <BetaDaemonHostsSection />
    </>
  );
}
