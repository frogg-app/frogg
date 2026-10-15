// Simulated session presence for the lab: two other devices have every chat open, and one of them
// starts and stops typing, pushed as `presence.update` like a real host (features.sessionPresence).
import { latency, labWait } from "./time";

type Emit = (event: unknown) => void;

let epoch = 0;
const watching = new Set<string>();

function snapshot(agentId: string, typing: boolean) {
  const at = new Date().toISOString();
  const base = { deviceId: null, activityAt: at, isSelf: false };
  return {
    target: { kind: "agent", agentId },
    participants: [
      {
        ...base,
        participantId: "lab-self",
        deviceName: "Frogg Next on web",
        clientType: "browser",
        clientKey: "k-self",
        activity: "viewing",
        isSelf: true,
      },
      {
        ...base,
        participantId: "lab-pixel",
        deviceName: "Pixel 8",
        clientType: "mobile",
        clientKey: "k-pixel",
        activity: typing ? "typing" : "viewing",
      },
      {
        ...base,
        participantId: "lab-mac",
        deviceName: "MacBook Pro",
        clientType: "browser",
        clientKey: "k-mac",
        activity: "viewing",
      },
    ],
  };
}

/** Stops typing loops from an earlier demo (every lab reseed). */
export function resetPresence(): void {
  epoch += 1;
  watching.clear();
}

async function typingLoop(agentId: string, emit: Emit, mine: number): Promise<void> {
  for (let typing = true; ; typing = !typing) {
    await labWait(4000);
    if (epoch !== mine || !watching.has(agentId)) return;
    emit({ type: "presence.update", payload: snapshot(agentId, typing) });
  }
}

export function presenceRpcs(emit: Emit) {
  return {
    getPresence: async (target: { kind: string; agentId?: string }) => {
      await latency(160);
      return { requestId: "lab", snapshot: snapshot(target.agentId ?? "", false), error: null };
    },
    reportPresence: async (input: { target: { agentId?: string }; state: string }) => {
      const id = input.target.agentId ?? "";
      if (input.state === "left") watching.delete(id);
      else if (!watching.has(id)) {
        watching.add(id);
        void typingLoop(id, emit, epoch);
      }
      return { requestId: "lab", error: null };
    },
  };
}
