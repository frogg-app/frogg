import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresenceReportState, PresenceTarget } from "@frogg/protocol/device-access";
import { PRESENCE_REPORT_INTERVAL_MS } from "./snapshot";
import { PresenceReporter, PresenceReporterRegistry, resolveReportedState } from "./reporter";

const TARGET: PresenceTarget = { kind: "agent", agentId: "agent-1" };

function createTransport(result: { error: string | null } = { error: null }) {
  const states: PresenceReportState[] = [];
  return {
    states,
    result,
    reportPresence: vi.fn(async (input: { target: PresenceTarget; state: PresenceReportState }) => {
      states.push(input.state);
      return result;
    }),
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveReportedState", () => {
  it("lets the loudest claim on a target win", () => {
    expect(resolveReportedState([null, "viewing", "typing"])).toBe("typing");
    expect(resolveReportedState([null, "idle", "viewing"])).toBe("viewing");
    expect(resolveReportedState(["idle", null])).toBe("idle");
    expect(resolveReportedState([null, null])).toBeNull();
  });
});

describe("PresenceReporter", () => {
  it("re-reports on the daemon's cadence so the entry never expires", async () => {
    const transport = createTransport();
    const reporter = new PresenceReporter({ transport, target: TARGET });

    reporter.setState("viewing");
    await flush();
    expect(transport.states).toEqual(["viewing"]);

    await vi.advanceTimersByTimeAsync(PRESENCE_REPORT_INTERVAL_MS);
    expect(transport.states).toEqual(["viewing", "viewing"]);

    await vi.advanceTimersByTimeAsync(PRESENCE_REPORT_INTERVAL_MS);
    expect(transport.states).toEqual(["viewing", "viewing", "viewing"]);
    reporter.stop();
  });

  it("re-reports at once after a reconnect, because the daemon forgot the target", async () => {
    const transport = createTransport();
    const reporter = new PresenceReporter({ transport, target: TARGET });
    reporter.setState("viewing");
    await flush();
    transport.states.length = 0;

    reporter.handleReconnect();
    await flush();
    expect(transport.states).toEqual(["viewing"]);
    reporter.stop();
  });

  it("reports left when it stops", async () => {
    const transport = createTransport();
    const reporter = new PresenceReporter({ transport, target: TARGET });
    reporter.setState("viewing");
    await flush();
    reporter.stop();
    await flush();
    expect(transport.states).toEqual(["viewing", "left"]);
  });

  it("reports left when the surface stops looking, without unmounting", async () => {
    const transport = createTransport();
    const reporter = new PresenceReporter({ transport, target: TARGET });
    reporter.setState("viewing");
    await flush();
    reporter.setState(null);
    await flush();
    expect(transport.states).toEqual(["viewing", "left"]);

    reporter.setState("viewing");
    await flush();
    expect(transport.states).toEqual(["viewing", "left", "viewing"]);
    reporter.stop();
  });

  it("stops heartbeating a daemon that keeps refusing, instead of retry-storming it", async () => {
    const transport = createTransport({ error: "presence unavailable" });
    const failures: string[] = [];
    const reporter = new PresenceReporter({
      transport,
      target: TARGET,
      onFailure: (error) => failures.push(error),
    });

    reporter.setState("viewing");
    await flush();
    await vi.advanceTimersByTimeAsync(PRESENCE_REPORT_INTERVAL_MS * 5);
    expect(transport.reportPresence.mock.calls.length).toBe(3);
    expect(reporter.isSuspended).toBe(true);
    expect(failures).toHaveLength(3);
    reporter.stop();
  });
});

describe("PresenceReporterRegistry", () => {
  it("keeps one heartbeat for two surfaces on the same target", async () => {
    const registry = new PresenceReporterRegistry();
    const transport = createTransport();
    const bar = registry.acquire({ serverId: "host", target: TARGET, transport });
    const composer = registry.acquire({ serverId: "host", target: TARGET, transport });

    bar.setState("viewing");
    composer.setState("viewing");
    await flush();
    expect(transport.states).toEqual(["viewing"]);

    composer.setState("typing");
    await flush();
    expect(transport.states).toEqual(["viewing", "typing"]);

    composer.release();
    await flush();
    expect(transport.states).toEqual(["viewing", "typing", "viewing"]);

    bar.release();
    await flush();
    expect(transport.states).toEqual(["viewing", "typing", "viewing", "left"]);
  });

  it("re-reports every live target on a host after it reconnects", async () => {
    const registry = new PresenceReporterRegistry();
    const transport = createTransport();
    const handle = registry.acquire({ serverId: "host", target: TARGET, transport });
    handle.setState("viewing");
    await flush();
    transport.states.length = 0;

    registry.handleReconnect("other-host");
    await flush();
    expect(transport.states).toEqual([]);

    registry.handleReconnect("host");
    await flush();
    expect(transport.states).toEqual(["viewing"]);
    handle.release();
  });
});
