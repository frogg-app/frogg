import { promises as fs } from "node:fs";
import path from "node:path";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { PluginAttentionEvent } from "@frogg/protocol/plugins/api-v1";
import { PluginManifestSchema } from "@frogg/protocol/plugins/manifest";
import {
  PluginRuntime,
  type PluginAgentBridge,
  type PluginAuditEntry,
  type PluginRuntimeHooks,
  type PluginTodosBridge,
} from "./runtime.js";
import { PluginSettingsFile } from "./settings-store.js";
import { tempDir } from "./test-fixtures.js";

const SUMMARY = { id: "a1", provider: "claude", cwd: "/w", status: "idle" };

function fakeAgents(): PluginAgentBridge {
  return {
    list: vi.fn(async () => [SUMMARY]),
    get: vi.fn(async () => SUMMARY),
    subscribe: vi.fn(() => () => undefined),
    sendMessage: vi.fn(async () => undefined),
    getTimeline: vi.fn(async () => ({
      entries: [],
      cursor: "e:0",
      reset: false,
      hasMore: false,
    })),
    getLastAssistantMessage: vi.fn(async () => "done"),
    getDiffStat: vi.fn(async () => ({ additions: 3, deletions: 1 })),
    listProviders: vi.fn(async () => [{ id: "claude", label: "claude", available: true }]),
    create: vi.fn(async () => SUMMARY),
    cancel: vi.fn(async () => undefined),
    archive: vi.fn(async () => undefined),
    listPermissions: vi.fn(async () => []),
    subscribePermissions: vi.fn(() => () => undefined),
    respondToPermission: vi.fn(async () => undefined),
  };
}

function fakeTodos(): PluginTodosBridge {
  const todo = {
    id: "t1",
    projectId: "p1",
    title: "T",
    description: "",
    category: null,
    priority: "medium",
    status: "ready",
    claimedBy: [],
    progressCount: 0,
    createdAt: "",
    updatedAt: "",
  };
  return {
    list: vi.fn(async () => [todo]),
    get: vi.fn(async () => ({ ...todo, progress: [], plan: null })),
    subscribe: vi.fn(() => () => undefined),
    create: vi.fn(async () => todo),
    update: vi.fn(async () => todo),
    setStatus: vi.fn(async () => todo),
    addNote: vi.fn(async () => undefined),
  };
}

async function start(input: {
  apiVersion: number;
  capabilities: string[];
  code: string;
  remoteControl?: { on: boolean };
}) {
  const root = await tempDir("frogg-plugin-runtime-v2-");
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(path.join(root, "dist", "daemon.js"), input.code);
  const manifest = PluginManifestSchema.parse({
    id: "fx.v2",
    name: "V2",
    version: "1.0.0",
    apiVersion: input.apiVersion,
    scope: "daemon",
    entry: { daemon: "dist/daemon.js" },
    capabilities: input.capabilities,
  });
  const hooks: PluginRuntimeHooks = {
    notify: vi.fn(),
    emitEvent: vi.fn(),
    badgesChanged: vi.fn(),
    refreshPanel: vi.fn(),
  };
  const agents = fakeAgents();
  const todos = fakeTodos();
  const audit: PluginAuditEntry[] = [];
  const attention = new Set<(e: PluginAttentionEvent) => void>();
  const remote = input.remoteControl ?? { on: false };
  const runtime = new PluginRuntime({
    manifest,
    rootDir: root,
    dataDir: path.join(root, "data"),
    dev: false,
    granted: input.capabilities,
    settings: new PluginSettingsFile(path.join(root, "data")),
    agents,
    hooks,
    host: {
      version: "9.9.9",
      features: ["timeline.cursor"],
      todos,
      workspaces: null,
      subscribeAttention: (l) => {
        attention.add(l);
        return () => attention.delete(l);
      },
      audit: (e) => audit.push(e),
    },
    remoteControl: () => remote.on,
    logger: pino({ level: "silent" }),
  });
  await runtime.activate();
  const fire = (e: PluginAttentionEvent) => attention.forEach((l) => l(e));
  return { runtime, agents, todos, audit, remote, fire, attention };
}

describe("plugin API v2 runtime", () => {
  it("keeps v2 members away from v1 plugins", async () => {
    const { runtime } = await start({
      apiVersion: 1,
      capabilities: ["rpc", "agent.read"],
      code: `export default (ctx) => ctx.rpc.handle("probe", () => ({
        apiVersion: ctx.apiVersion,
        host: ctx.host !== undefined,
        timeline: typeof ctx.agents.getTimeline,
      }));`,
    });
    expect(await runtime.call("probe", {}, {})).toEqual({
      apiVersion: 1,
      host: false,
      timeline: "undefined",
    });
  });

  it("exposes host info and the read surface to v2 plugins", async () => {
    const { runtime, agents } = await start({
      apiVersion: 2,
      capabilities: ["rpc", "agent.read"],
      code: `export default (ctx) => ctx.rpc.handle("probe", async () => ({
        apiVersion: ctx.apiVersion,
        version: ctx.host.version,
        features: ctx.host.features,
        remote: ctx.host.remoteControl,
        diff: await ctx.agents.getDiffStat("a1"),
        page: await ctx.agents.getTimeline("a1", { limit: 5 }),
      }));`,
    });
    expect(await runtime.call("probe", {}, {})).toMatchObject({
      apiVersion: 2,
      version: "9.9.9",
      features: ["timeline.cursor"],
      remote: false,
      diff: { additions: 3, deletions: 1 },
      page: { cursor: "e:0" },
    });
    expect(agents.getTimeline).toHaveBeenCalledWith("a1", { limit: 5 });
  });

  it("gates agent.manage on remote control and audits the actor", async () => {
    const { runtime, agents, audit, remote } = await start({
      apiVersion: 2,
      capabilities: ["rpc", "agent.read", "agent.manage"],
      code: `export default (ctx) => {
        ctx.rpc.handle("cancel", (p) => ctx.agents.cancel("a1", p));
        ctx.rpc.handle("remote", () => ctx.host.remoteControl);
      };`,
    });
    await expect(runtime.call("cancel", { actor: "discord:1" }, {})).rejects.toThrow(
      /remote control is off/,
    );
    expect(agents.cancel).not.toHaveBeenCalled();
    remote.on = true;
    expect(await runtime.call("remote", {}, {})).toBe(true);
    await expect(runtime.call("cancel", {}, {})).rejects.toThrow(/actor/);
    await runtime.call("cancel", { actor: "discord:1" }, {});
    expect(agents.cancel).toHaveBeenCalledWith("a1");
    expect(audit).toEqual([
      expect.objectContaining({
        pluginId: "fx.v2",
        actor: "discord:1",
        op: "agents.cancel",
        target: "a1",
      }),
    ]);
  });

  it("gates sendMessage for v2 plugins only", async () => {
    const v1 = await start({
      apiVersion: 1,
      capabilities: ["rpc", "agent.write"],
      code: `export default (ctx) => ctx.rpc.handle("send", () => ctx.agents.sendMessage("a1", "hi"));`,
    });
    await v1.runtime.call("send", {}, {});
    expect(v1.agents.sendMessage).toHaveBeenCalledWith("a1", "hi", undefined);

    const v2 = await start({
      apiVersion: 2,
      capabilities: ["rpc", "agent.write"],
      code: `export default (ctx) => ctx.rpc.handle("send", () => ctx.agents.sendMessage("a1", "hi", { actor: "google:a@b" }));`,
    });
    await expect(v2.runtime.call("send", {}, {})).rejects.toThrow(/remote control is off/);
    v2.remote.on = true;
    await v2.runtime.call("send", {}, {});
    expect(v2.audit[0]).toMatchObject({
      actor: "google:a@b",
      op: "agents.send_message",
    });
  });

  it("refuses ungranted capabilities", async () => {
    const { runtime } = await start({
      apiVersion: 2,
      capabilities: ["rpc", "agent.read"],
      remoteControl: { on: true },
      code: `export default (ctx) => ctx.rpc.handle("probe", async () => ({
        permissions: ctx.permissions !== undefined,
        todos: ctx.todos !== undefined,
        create: await ctx.agents.create({ workspaceId: "w", provider: "claude", prompt: "x", actor: "a" }).then(() => "ok", (e) => e.code),
      }));`,
    });
    expect(await runtime.call("probe", {}, {})).toEqual({
      permissions: false,
      todos: false,
      create: "forbidden",
    });
  });

  it("filters attention while an app is active unless forced", async () => {
    const { runtime, fire } = await start({
      apiVersion: 2,
      capabilities: ["rpc", "agent.read"],
      code: `const seen = { plain: 0, forced: 0 };
      export default (ctx) => {
        ctx.agents.onAttention(() => { seen.plain++; });
        ctx.agents.onAttention(() => { seen.forced++; }, { force: true });
        ctx.rpc.handle("seen", () => seen);
      };`,
    });
    const event = {
      agentId: "a1",
      reason: "finished" as const,
      agent: SUMMARY,
      message: "m",
    };
    fire({ ...event, clientActive: true });
    fire({ ...event, clientActive: false });
    expect(await runtime.call("seen", {}, {})).toEqual({ plain: 1, forced: 2 });
  });

  it("lets todos.read through without remote control but gates writes", async () => {
    const { runtime, todos, audit, remote } = await start({
      apiVersion: 2,
      capabilities: ["rpc", "todos.read", "todos.write"],
      code: `export default (ctx) => {
        ctx.rpc.handle("list", () => ctx.todos.list("p1"));
        ctx.rpc.handle("done", () => ctx.todos.setStatus("p1", "t1", "done", { actor: "google:a@b" }));
      };`,
    });
    expect(await runtime.call("list", {}, {})).toHaveLength(1);
    await expect(runtime.call("done", {}, {})).rejects.toThrow(/remote control is off/);
    remote.on = true;
    await runtime.call("done", {}, {});
    expect(todos.setStatus).toHaveBeenCalledWith(
      "p1",
      "t1",
      "done",
      "Status set to done by google:a@b",
    );
    expect(audit[0]).toMatchObject({ op: "todos.set_status", target: "p1/t1" });
  });

  it("notifies remote-control changes and stops on deactivate", async () => {
    const { runtime } = await start({
      apiVersion: 2,
      capabilities: ["rpc"],
      code: `const seen = [];
      export default (ctx) => {
        ctx.host.onRemoteControlChange((on) => seen.push(on));
        ctx.rpc.handle("seen", () => seen);
      };`,
    });
    runtime.remoteControlChanged(true);
    runtime.remoteControlChanged(false);
    expect(await runtime.call("seen", {}, {})).toEqual([true, false]);
  });
});
