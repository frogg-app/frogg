// Shared timing for the lab's simulated daemon RPCs.
import { useLab } from "../store";

/** A delay stretched by the lab's speed control, so simulated RPCs slow down with the CSS. */
export function labWait(ms: number): Promise<void> {
  const rate = Number(useLab.getState().speed) || 1;
  return new Promise((done) => setTimeout(done, ms / rate));
}

/** Small realistic RPC latency: `base` ms plus up to 60% jitter. */
export const latency = (base = 120) => labWait(base * (1 + Math.random() * 0.6));
