import { useEffect, useState } from "react";
import {
  fetchReleaseBuildStatus,
  RELEASE_BUILD_STATUS_POLL_MS,
  type ReleaseBuildStatus,
} from "@/desktop/updates/release-build-status";

/**
 * Polls the shell for the CI job building `version` for this platform. Pass a
 * null version to stop polling (the download is published, or there is no
 * update). The shell caches, so this poll is cheap and stops once the job ends.
 */
export function useReleaseBuildStatus(version: string | null): ReleaseBuildStatus | null {
  const [status, setStatus] = useState<ReleaseBuildStatus | null>(null);

  useEffect(() => {
    if (!version) {
      setStatus(null);
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      let next: ReleaseBuildStatus | null = null;
      try {
        next = await fetchReleaseBuildStatus(version);
      } catch {
        // Build progress is decoration on the update card; a host without the
        // command, or an offline machine, simply shows no bar.
        if (!cancelled) setStatus(null);
        return;
      }
      if (cancelled) return;
      setStatus(next);
      // A finished job will not change again; stop asking.
      if (next?.state !== "succeeded" && next?.state !== "failed") {
        timer = setTimeout(() => void poll(), RELEASE_BUILD_STATUS_POLL_MS);
      }
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [version]);

  return status;
}
