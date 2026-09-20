import equal from "fast-deep-equal";
import type { AgentUsage } from "@frogg/protocol/agent-types";

interface AgentUpdateValue {
  updatedAt: Date | string;
  lastUsage?: AgentUsage;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function acceptAgentDirectoryUpdate<T extends AgentUpdateValue>(
  current: T | undefined,
  incoming: T,
): T {
  if (!current || timestamp(incoming.updatedAt) >= timestamp(current.updatedAt)) {
    // COMPAT(persistedAgentUsage): added in v1.5.10. Usage is the one field a
    // newer snapshot may simply not carry — a daemon that has not loaded the
    // agent sends none — and forgetting it blanks the context meter on a
    // conversation whose cost is already known. Absent means "no news", not
    // "no usage".
    if (incoming.lastUsage === undefined && current?.lastUsage !== undefined) {
      return { ...incoming, lastUsage: current.lastUsage };
    }
    return incoming;
  }
  if (incoming.lastUsage === undefined) return current;
  if (equal(incoming.lastUsage, current.lastUsage)) return current;
  return { ...current, lastUsage: incoming.lastUsage };
}
