import { promises as fs } from "node:fs";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createFroggToolCatalog } from "../agent/tools/frogg-tools.js";
import { agentConnectorSummary } from "./agent-connectors.js";
import { DEFAULT_PLUGIN_POLICY, PluginService } from "./plugin-service.js";
import { startFixtureRepo, tempDir, writeFixturePlugin } from "./test-fixtures.js";

const logger = pino({ level: "silent" });
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).toReversed()) await fn();
});

const historyTool = {
  id: "history",
  title: "Read history",
  description: "Recent messages",
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
};

const toolCode = `export default function activate(ctx) {
  ctx.rpc.handle("tool.history", async (params, context) => ({ params, agentId: context.agentId }));
  ctx.rpc.handle("tool.hidden", async () => "should not be reachable");
}
`;

async function linkedService(
  spec: { capabilities?: string[]; contributes?: Record<string, unknown> } = {},
) {
  const repo = await startFixtureRepo();
  cleanups.push(() => repo.close());
  const home = await tempDir("frogg-connectors-home-");
  cleanups.push(() => fs.rm(home, { recursive: true, force: true }));
  const service = new PluginService({
    froggHome: home,
    logger,
    officialRepo: {
      name: "Official",
      url: repo.url,
      publicKey: repo.keys.publicKey,
    },
    policy: DEFAULT_PLUGIN_POLICY,
    localLinking: true,
    autoUpdateIntervalMs: 0,
  });
  cleanups.push(() => service.stop());
  await service.start();
  const root = await tempDir("frogg-connectors-dev-");
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  const dir = await writeFixturePlugin(root, {
    id: "fx.chat",
    version: "0.2.0",
    apiVersion: 2,
    capabilities: spec.capabilities ?? ["rpc"],
    contributes: spec.contributes ?? { agentTools: [historyTool] },
    code: toolCode,
  });
  await service.devLink(dir);
  return service;
}

describe("agent connectors", () => {
  it("lists running plugins with their agent tools and calls only declared tools", async () => {
    const service = await linkedService();
    expect(service.listAgentConnectors()).toEqual([
      expect.objectContaining({
        id: "fx.chat",
        status: "active",
        capabilities: ["rpc"],
        tools: [
          {
            name: "history",
            title: "Read history",
            description: "Recent messages",
            inputSchema: historyTool.inputSchema,
          },
        ],
      }),
    ]);
    await expect(
      service.callAgentTool("fx.chat", "history", { limit: 5 }, "agent-1"),
    ).resolves.toEqual({
      params: { limit: 5 },
      agentId: "agent-1",
    });
    await expect(service.callAgentTool("fx.chat", "hidden", {}, "agent-1")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(service.callAgentTool("fx.nope", "history", {}, "agent-1")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("offers no tools when rpc is not granted", async () => {
    const service = await linkedService({
      capabilities: ["network"],
      contributes: {},
    });
    expect(service.listAgentConnectors()[0]?.tools).toEqual([]);
  });

  it("summarises running connectors for the hidden system context", async () => {
    const service = await linkedService();
    const summary = agentConnectorSummary(service.listAgentConnectors());
    expect(summary).toContain("Fixture fx.chat (fx.chat; tools: history)");
    expect(summary).toContain("call_connector_tool");
    expect(agentConnectorSummary([])).toBe("");
  });

  it("exposes list_connectors and call_connector_tool on the agent tool catalog", async () => {
    const service = await linkedService();
    const catalog = createFroggToolCatalog({
      agentManager: {} as never,
      agentStorage: {} as never,
      providerSnapshotManager: {} as never,
      connectors: service,
      callerAgentId: "agent-7",
      logger,
    });
    const listed = await catalog.executeTool("list_connectors", {});
    expect(listed.structuredContent).toMatchObject({
      connectors: [{ id: "fx.chat", tools: [{ name: "history" }] }],
    });
    const called = await catalog.executeTool("call_connector_tool", {
      connectorId: "fx.chat",
      tool: "history",
      arguments: { limit: 2 },
    });
    expect(called.structuredContent).toEqual({
      result: { params: { limit: 2 }, agentId: "agent-7" },
    });
    const missing = await catalog.executeTool("call_connector_tool", {
      connectorId: "fx.chat",
      tool: "hidden",
    });
    expect(missing).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "not_found" } },
    });
  });
});
