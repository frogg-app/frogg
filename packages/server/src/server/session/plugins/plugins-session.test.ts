import { describe, expect, it } from "vitest";
import { SessionOutboundMessageSchema, type SessionOutboundMessage } from "../../messages.js";
import { PluginServiceError } from "../../plugins/errors.js";
import type { PluginService } from "../../plugins/plugin-service.js";
import { PluginsSession } from "./plugins-session.js";

function harness(service: Partial<PluginService> | null) {
  const out: SessionOutboundMessage[] = [];
  const session = new PluginsSession({
    service: service as PluginService | null,
    clientId: "client-1",
    emit: (m) => out.push(m),
  });
  return { session, out };
}

describe("PluginsSession", () => {
  it("ignores non-plugin messages", () => {
    const { session } = harness(null);
    expect(session.dispatch({ type: "ping", requestId: "r" } as never)).toBeUndefined();
  });

  it("answers every request with a schema-valid error when plugins are unavailable", async () => {
    const { session, out } = harness(null);
    const requests = [
      { type: "plugins.list.request" },
      { type: "plugins.get_catalog.request" },
      { type: "plugins.install.request", id: "a.b", repoUrl: "https://x", grantedCapabilities: [] },
      { type: "plugins.uninstall.request", id: "a.b" },
      { type: "plugins.rpc.call.request", pluginId: "a.b", method: "m" },
      { type: "plugins.settings.get.request", id: "a.b" },
      { type: "plugins.dev.set_enabled.request", enabled: true },
      { type: "plugins.repos.add.request", url: "https://x" },
    ];
    for (const [i, r] of requests.entries())
      await session.dispatch({ ...r, requestId: `r${i}` } as never);
    expect(out).toHaveLength(requests.length);
    for (const [i, m] of out.entries()) {
      expect(SessionOutboundMessageSchema.safeParse(m).success).toBe(true);
      expect(m.type).toBe(requests[i]!.type.replace(".request", ".response"));
      expect((m as { payload: { error: { code: string } } }).payload.error.code).toBe("forbidden");
    }
  });

  it("routes to the service and maps service errors", async () => {
    const { session, out } = harness({
      callRpc: async (pluginId: string, method: string, params: unknown, clientId?: string) => ({
        pluginId,
        method,
        params,
        clientId,
      }),
      uninstall: async () => {
        throw new PluginServiceError("not_found", "nope");
      },
    });
    await session.dispatch({
      type: "plugins.rpc.call.request",
      requestId: "1",
      pluginId: "a.b",
      method: "m",
      params: 1,
    });
    await session.dispatch({ type: "plugins.uninstall.request", requestId: "2", id: "a.b" });
    expect(out[0]).toEqual({
      type: "plugins.rpc.call.response",
      payload: {
        requestId: "1",
        error: null,
        result: { pluginId: "a.b", method: "m", params: 1, clientId: "client-1" },
      },
    });
    expect(out[1]).toEqual({
      type: "plugins.uninstall.response",
      payload: { requestId: "2", error: { code: "not_found", message: "nope" }, success: false },
    });
  });
});
