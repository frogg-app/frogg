import { create } from "zustand";

export type Speed = "1" | "0.5" | "0.25";

interface LabState {
  /** Playback rate for every CSS animation and transition, and the fixture client's timers. */
  speed: Speed;
  /** Bumped by Replay: every specimen remounts from fresh fixtures. */
  nonce: number;
}

export const useLab = create<LabState>(() => ({ speed: "1", nonce: 0 }));
export const setSpeed = (speed: Speed) => useLab.setState({ speed });
export const bumpNonce = () => useLab.setState((st) => ({ nonce: st.nonce + 1 }));
