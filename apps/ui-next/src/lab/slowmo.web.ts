import { useEffect } from "react";

/**
 * Sets the playback rate of every running CSS animation and transition on the page, including
 * ones that start later (checked each frame). The durations in code stay untouched; this is a
 * viewing aid, like the browser devtools animation panel.
 */
export function useSlowMotion(rate: number): void {
  useEffect(() => {
    const doc = globalThis.document;
    if (!doc?.getAnimations) return;
    let frame = 0;
    const apply = () => {
      for (const a of doc.getAnimations()) if (a.playbackRate !== rate) a.playbackRate = rate;
      frame = requestAnimationFrame(apply);
    };
    apply();
    return () => {
      cancelAnimationFrame(frame);
      for (const a of doc.getAnimations()) a.playbackRate = 1;
    };
  }, [rate]);
}
