import { promises as fs } from "node:fs";
import path from "node:path";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { PluginManifestSchema } from "@frogg/protocol/plugins/manifest";
import { PluginRuntime, type PluginRuntimeHooks, type PluginSpeechBridge } from "./runtime.js";
import { PluginSettingsFile } from "./settings-store.js";
import { speechFormatToMime } from "./speech-bridge.js";
import { tempDir } from "./test-fixtures.js";

async function startRuntime(input: {
  capabilities: string[];
  code: string;
  speech?: PluginSpeechBridge | null;
}) {
  const root = await tempDir("frogg-plugin-runtime-");
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(path.join(root, "dist", "daemon.js"), input.code);
  const manifest = PluginManifestSchema.parse({
    id: "fx.runtime",
    name: "Runtime",
    version: "1.0.0",
    apiVersion: 1,
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
  const runtime = new PluginRuntime({
    manifest,
    rootDir: root,
    dataDir: path.join(root, "data"),
    dev: false,
    granted: input.capabilities,
    settings: new PluginSettingsFile(path.join(root, "data")),
    agents: null,
    speech: input.speech,
    hooks,
    logger: pino({ level: "silent" }),
  });
  await runtime.activate();
  return { runtime, hooks };
}

describe("PluginRuntime events and speech", () => {
  it("forwards ctx.events.emit to the host as JSON", async () => {
    const { runtime, hooks } = await startRuntime({
      capabilities: ["rpc"],
      code: `export default (ctx) => ctx.rpc.handle("go", () => { ctx.events.emit("tick", { n: 1, at: new Date(0) }); return true; });`,
    });
    expect(runtime.status).toBe("active");
    await runtime.call("go", {}, {});
    expect(hooks.emitEvent).toHaveBeenCalledWith("fx.runtime", "tick", {
      n: 1,
      at: "1970-01-01T00:00:00.000Z",
    });
  });

  it("leaves ctx.speech out without the speech capability", async () => {
    const { runtime } = await startRuntime({
      capabilities: ["rpc"],
      code: `export default (ctx) => ctx.rpc.handle("has", () => ctx.speech !== undefined);`,
    });
    expect(await runtime.call("has", {}, {})).toBe(false);
  });

  it("routes ctx.speech to the bridge and validates input", async () => {
    const speech: PluginSpeechBridge = {
      available: () => ({ stt: true, tts: true }),
      transcribe: vi.fn(async () => ({ text: "hello" })),
      synthesize: vi.fn(async () => ({ audio: "AA==", format: "audio/mpeg" })),
    };
    const { runtime } = await startRuntime({
      capabilities: ["rpc", "speech"],
      speech,
      code: `export default (ctx) => {
        ctx.rpc.handle("avail", () => ctx.speech.available());
        ctx.rpc.handle("stt", (p) => ctx.speech.transcribe(p));
        ctx.rpc.handle("tts", () => ctx.speech.synthesize("hi"));
      };`,
    });
    expect(await runtime.call("avail", {}, {})).toEqual({ stt: true, tts: true });
    expect(await runtime.call("stt", { pcm16: "AAAA", sampleRate: 16000 }, {})).toEqual({
      text: "hello",
    });
    await expect(runtime.call("stt", { pcm16: "AAAA", sampleRate: 1 }, {})).rejects.toThrow(
      /sampleRate|rate/,
    );
    expect(await runtime.call("tts", {}, {})).toEqual({ audio: "AA==", format: "audio/mpeg" });
  });

  it("reports no speech when the host has none", async () => {
    const { runtime } = await startRuntime({
      capabilities: ["rpc", "speech"],
      speech: null,
      code: `export default (ctx) => { ctx.rpc.handle("avail", () => ctx.speech.available()); ctx.rpc.handle("tts", () => ctx.speech.synthesize("hi")); };`,
    });
    expect(await runtime.call("avail", {}, {})).toEqual({ stt: false, tts: false });
    await expect(runtime.call("tts", {}, {})).rejects.toThrow(/no speech backend/);
  });
});

describe("speechFormatToMime", () => {
  it("maps provider formats to MIME types", () => {
    expect(speechFormatToMime("mp3")).toBe("audio/mpeg");
    expect(speechFormatToMime("pcm;rate=24000")).toBe("audio/pcm;rate=24000");
    expect(speechFormatToMime("opus")).toBe("audio/opus");
    expect(speechFormatToMime("audio/wav")).toBe("audio/wav");
  });
});
