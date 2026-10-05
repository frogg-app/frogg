import { MessageChannel } from "node:worker_threads";
import { generateKeyPairSync, sign } from "node:crypto";
import { gzipSync } from "node:zlib";
import { indexedDB } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createClientPluginBridge } from "./bridge";
import { ClientPluginChannel, type PortLike } from "./channel";
import { ClientPluginError } from "./errors";
import { CLIENT_PLUGIN_BOOTSTRAP, sandboxCsp } from "./sandbox-bootstrap";
import { createIndexedDbStorage } from "./storage";
import type { ClientPluginRecord } from "./records";
import type { ClientPluginContext } from "@frogg/protocol/plugins/api-v1";
import { fetchVerifiedClientPlugin, sha256Hex } from "./verify";

// ---------------------------------------------------------------------------- fixtures

function tarGz(files: Record<string, string>): Uint8Array {
  const parts: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.fill(0x20, 148, 156);
    h.write("0", 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(parts)));
}

const manifest = {
  id: "acme.clock",
  name: "Clock",
  version: "1.0.0",
  apiVersion: 1,
  scope: "client",
  entry: { client: "dist/client.js" },
  capabilities: ["rpc", "ui.contribute"],
  contributes: { commands: [{ id: "acme.clock.now", title: "Clock: now" }] },
};

async function repoFixture(opts: {
  manifest?: object;
  tamperTarball?: boolean;
  tamperIndex?: boolean;
  otherKey?: boolean;
}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const tgz = tarGz({
    "frogg-plugin.json": JSON.stringify(opts.manifest ?? manifest),
    "dist/client.js": "export default function activate() {}",
  });
  const sha = await sha256Hex(tgz);
  const index = JSON.stringify({
    schemaVersion: 1,
    name: "Test",
    generatedAt: "2026-01-01T00:00:00Z",
    plugins: [
      {
        id: "acme.clock",
        versions: [
          {
            version: "1.0.0",
            apiVersion: 1,
            scope: "client",
            capabilities: ["rpc", "ui.contribute"],
            tarball: "https://repo.test/acme.clock-1.0.0.tgz",
            sha256: sha,
          },
        ],
      },
    ],
  });
  const sig = sign(null, Buffer.from(index), privateKey).toString("base64");
  const served = opts.tamperIndex ? index.replace('"Test"', '"Evil"') : index;
  const body = opts.tamperTarball ? tgz.slice().fill(1, 40, 60) : tgz;
  const rawKey = (opts.otherKey ? other.publicKey : publicKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64");
  const fetchImpl = vi.fn(async (url: string) => {
    if (url.endsWith("index.json")) return new Response(served);
    if (url.endsWith(".sig")) return new Response(sig);
    if (url.endsWith(".tgz")) return new Response(body as BodyInit);
    return new Response("", { status: 404 });
  });
  return { fetch: fetchImpl, repo: { url: "https://repo.test/index.json", publicKey: rawKey } };
}

// ---------------------------------------------------------------------------- verification

describe("fetchVerifiedClientPlugin", () => {
  it("accepts a correctly signed and hashed plugin", async () => {
    const f = await repoFixture({});
    const result = await fetchVerifiedClientPlugin({ ...f, id: "acme.clock" });
    expect(result.manifest.id).toBe("acme.clock");
    expect(result.entrySource).toContain("activate");
  });

  it.each([
    ["tampered index", { tamperIndex: true }, "signature_invalid"],
    ["wrong repository key", { otherKey: true }, "signature_invalid"],
    ["tampered tarball", { tamperTarball: true }, "hash_mismatch"],
    [
      "manifest that disagrees with the index",
      { manifest: { ...manifest, capabilities: ["rpc", "ui.contribute", "network"] } },
      "manifest_mismatch",
    ],
    [
      "manifest with another id",
      { manifest: { ...manifest, id: "acme.other" } },
      "manifest_mismatch",
    ],
  ])("rejects a %s", async (_label, opts, code) => {
    const f = await repoFixture(opts);
    await expect(fetchVerifiedClientPlugin({ ...f, id: "acme.clock" })).rejects.toMatchObject({
      code,
    });
  });

  it("reports an unreachable repository as fetch_failed", async () => {
    const f = await repoFixture({});
    const failing = async () => {
      throw new TypeError("network down");
    };
    await expect(
      fetchVerifiedClientPlugin({ repo: f.repo, fetch: failing, id: "acme.clock" }),
    ).rejects.toMatchObject({ code: "fetch_failed" });
  });
});

// ---------------------------------------------------------------------------- storage

describe("IndexedDB storage", () => {
  it("puts, lists and removes records, dropping malformed ones", async () => {
    const storage = createIndexedDbStorage(indexedDB);
    const record: ClientPluginRecord = {
      id: "acme.clock",
      version: "1.0.0",
      source: "official",
      repoUrl: "https://repo.test/index.json",
      devPath: null,
      enabled: true,
      grantedCapabilities: ["rpc"],
      manifest: manifest as ClientPluginRecord["manifest"],
      entrySource: "export default () => {}",
      settings: { a: 1 },
      installedAt: "2026-01-01T00:00:00Z",
    };
    await storage.put(record);
    await storage.put({ id: "acme.broken" } as unknown as ClientPluginRecord);
    expect((await storage.list()).map((r) => r.id)).toEqual(["acme.clock"]);
    await storage.remove("acme.clock");
    expect(await storage.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------- bridge

function bridgeWith(capabilities: string[]) {
  let settings: Record<string, unknown> = {};
  const notify = vi.fn();
  const rpcCall = vi.fn(async () => ({ count: 2 }));
  const emitEvent = vi.fn();
  const media = {
    startCapture: vi.fn(async () => undefined),
    stopCapture: vi.fn(),
    play: vi.fn(async () => undefined),
    stopPlayback: vi.fn(),
  };
  const insertComposerText = vi.fn(async () => true);
  const closeView = vi.fn();
  const bridge = createClientPluginBridge({
    pluginId: "acme.clock",
    capabilities,
    log: vi.fn(),
    settings: {
      read: () => settings,
      write: async (next) => {
        settings = next;
      },
    },
    rpcCall,
    notify,
    emitEvent,
    media,
    insertComposerText,
    closeView,
  });
  return {
    bridge,
    notify,
    rpcCall,
    emitEvent,
    media,
    insertComposerText,
    closeView,
    settings: () => settings,
  };
}

describe("capability bridge", () => {
  it("refuses calls the plugin was not granted", async () => {
    const { bridge, notify } = bridgeWith([]);
    await expect(bridge.handle("ui.notify", { message: "hi" })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(bridge.handle("settings.set", { key: "a", value: 1 })).rejects.toBeInstanceOf(
      ClientPluginError,
    );
    await expect(bridge.handle("rpc.call", { method: "x" })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(notify).not.toHaveBeenCalled();
    await expect(bridge.handle("log", { message: "ok" })).resolves.toBeNull();
  });

  it("rejects unknown operations", async () => {
    const { bridge } = bridgeWith(["rpc"]);
    await expect(bridge.handle("fs.read", {})).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("gates media, composer, events and view ops on their capabilities", async () => {
    const denied = bridgeWith(["rpc"]);
    for (const op of ["media.capture.start", "media.play", "composer.insert", "view.close"]) {
      await expect(denied.bridge.handle(op, {})).rejects.toMatchObject({ code: "forbidden" });
    }
    const { bridge, media, insertComposerText, emitEvent, closeView } = bridgeWith([
      "rpc",
      "media.microphone",
      "media.audio",
      "composer",
      "ui.view",
    ]);
    await bridge.handle("media.capture.start", {});
    expect(media.startCapture).toHaveBeenCalled();
    await bridge.handle("media.play", { data: "AA==", format: "audio/mpeg" });
    expect(media.play).toHaveBeenCalledWith("AA==", "audio/mpeg");
    await expect(
      bridge.handle("media.play", { data: "AA==", format: "text/html" }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(bridge.handle("composer.insert", { text: "hi" })).resolves.toBe(true);
    expect(insertComposerText).toHaveBeenCalledWith("hi");
    await bridge.handle("events.emit", { event: "state", data: { a: 1 } });
    expect(emitEvent).toHaveBeenCalledWith("state", { a: 1 });
    await bridge.handle("view.close", {});
    expect(closeView).toHaveBeenCalled();
  });

  it("stores JSON settings device-locally and serialises writes", async () => {
    const { bridge, settings } = bridgeWith(["settings.store"]);
    await Promise.all([
      bridge.handle("settings.set", { key: "a", value: 1 }),
      bridge.handle("settings.set", { key: "b", value: { c: [1] } }),
    ]);
    expect(settings()).toEqual({ a: 1, b: { c: [1] } });
    await bridge.handle("settings.delete", { key: "a" });
    expect(await bridge.handle("settings.all", {})).toEqual({ b: { c: [1] } });
  });
});

// ---------------------------------------------------------------------------- message bridge

type Boot = (
  port: unknown,
  load: (code: string) => Promise<unknown>,
  getRoot?: () => unknown,
) => void;
const boot = new Function(`${CLIENT_PLUGIN_BOOTSTRAP}; return __froggBoot;`)() as Boot;

function nodePort(port: import("node:worker_threads").MessagePort): PortLike {
  return {
    postMessage: (m) => port.postMessage(m),
    addEventListener: (_type, listener) => port.on("message", (data) => listener({ data })),
    close: () => port.close(),
  };
}

/** Wires the real bootstrap to a channel over a Node MessageChannel; `activate` is the plugin. */
function sandboxPair(
  activate: (ctx: ClientPluginContext) => unknown,
  capabilities: string[],
  extra: { views?: Record<string, (root: unknown, ctx: ClientPluginContext) => unknown> } = {},
) {
  const { port1, port2 } = new MessageChannel();
  const inner = {
    postMessage: (m: unknown) => port2.postMessage(m),
    set onmessage(fn: (e: { data: unknown }) => void) {
      port2.on("message", (data) => fn({ data }));
    },
  };
  boot(
    inner,
    async () => ({ default: activate, views: extra.views }),
    () => "ROOT",
  );
  const deps = bridgeWith(capabilities);
  const channel = new ClientPluginChannel(nodePort(port1), deps.bridge);
  const info = { id: "acme.clock", version: "1.0.0", dev: false, capabilities };
  return { channel, deps, info, close: () => (channel.close(), port2.close()) };
}

async function clockNow(ctx: ClientPluginContext) {
  const daemon = (await ctx.rpc.call("acme.clock.count", {})) as { count: number };
  ctx.ui.notify(`count ${daemon.count}`, "success");
  return { ok: true };
}
function activateClock(ctx: ClientPluginContext) {
  ctx.rpc.handle("acme.clock.now", () => clockNow(ctx));
}
function throwNope(): never {
  throw new Error("nope");
}
function activateBad(ctx: ClientPluginContext) {
  ctx.rpc.handle("bad", throwNope);
}
const never = () => new Promise(() => undefined);
function activateSlow(ctx: ClientPluginContext) {
  ctx.rpc.handle("slow", never);
}

describe("sandbox message bridge", () => {
  it("activates, routes contribution invokes, and reaches ctx APIs", async () => {
    const pair = sandboxPair(activateClock, ["rpc", "ui.contribute"]);
    await pair.channel.activate("", pair.info);
    expect(pair.channel.handles("acme.clock.now")).toBe(true);
    await expect(pair.channel.invoke("acme.clock.now", {})).resolves.toEqual({ ok: true });
    expect(pair.deps.rpcCall).toHaveBeenCalledWith("acme.clock.count", {});
    expect(pair.deps.notify).toHaveBeenCalledWith("count 2", "success");
    pair.close();
  });

  it("does not expose APIs for capabilities that were not granted", async () => {
    let seen: Partial<ClientPluginContext> = {};
    const pair = sandboxPair((ctx) => {
      seen = ctx;
    }, []);
    await pair.channel.activate("", pair.info);
    expect(seen.rpc).toBeUndefined();
    expect(seen.ui).toBeUndefined();
    expect(seen.settings).toBeUndefined();
    expect(typeof seen.log?.info).toBe("function");
    pair.close();
  });

  it("surfaces activation failures and handler errors", async () => {
    const failing = sandboxPair(() => {
      throw new Error("boom");
    }, []);
    await expect(failing.channel.activate("", failing.info)).rejects.toMatchObject({
      code: "plugin_error",
      message: "boom",
    });
    failing.close();

    const pair = sandboxPair(activateBad, ["rpc"]);
    await pair.channel.activate("", pair.info);
    await expect(pair.channel.invoke("bad", {})).rejects.toMatchObject({ message: "nope" });
    await expect(pair.channel.invoke("missing", {})).rejects.toMatchObject({
      code: "plugin_error",
    });
    pair.close();
  });

  it("times out an unanswered invoke and rejects pending calls on close", async () => {
    const pair = sandboxPair(activateSlow, ["rpc"]);
    await pair.channel.activate("", pair.info);
    await expect(pair.channel.invoke("slow", {}, 20)).rejects.toMatchObject({ code: "timeout" });
    const pending = pair.channel.invoke("slow", {});
    pair.close();
    await expect(pending).rejects.toMatchObject({ code: "not_active" });
  });
});

function recordingPlugin(seen: unknown[]) {
  const onState = (data: unknown) => seen.push(["event", data]);
  const onAudio = (chunk: { sampleRate: number }) => seen.push(["audio", chunk.sampleRate]);
  return (ctx: ClientPluginContext) => {
    ctx.events.on("state", onState);
    ctx.media.onAudio(onAudio);
    ctx.rpc.handle("go", () => {
      ctx.events.emit("ping", { n: 1 });
      return ctx.media.startCapture();
    });
  };
}

describe("sandbox events, audio and views", () => {
  it("delivers events and audio chunks to listeners and emits through the bridge", async () => {
    const seen: unknown[] = [];
    const pair = sandboxPair(recordingPlugin(seen), ["rpc", "media.microphone"]);
    await pair.channel.activate("", pair.info);
    pair.channel.deliverEvent("state", { phase: "listening" });
    pair.channel.deliverAudio({ pcm16: "", sampleRate: 16000, level: 0 });
    await pair.channel.invoke("go", {});
    expect(seen).toEqual([
      ["event", { phase: "listening" }],
      ["audio", 16000],
    ]);
    expect(pair.deps.emitEvent).toHaveBeenCalledWith("ping", { n: 1 });
    expect(pair.deps.media.startCapture).toHaveBeenCalled();
    pair.close();
  });

  it("renders the named view into the root instead of activating", async () => {
    const activate = vi.fn();
    const render = vi.fn((_root: unknown, ctx: ClientPluginContext) => {
      ctx.view?.close();
    });
    const pair = sandboxPair(activate, ["rpc", "ui.view"], { views: { main: render } });
    await pair.channel.activate("", { ...pair.info, view: "main" });
    expect(activate).not.toHaveBeenCalled();
    expect(render.mock.calls[0]?.[0]).toBe("ROOT");
    await vi.waitFor(() => expect(pair.deps.closeView).toHaveBeenCalled());
    pair.close();

    const missing = sandboxPair(activate, ["ui.view"]);
    await expect(
      missing.channel.activate("", { ...missing.info, view: "nope" }),
    ).rejects.toMatchObject({
      code: "plugin_error",
    });
    missing.close();
  });
});

describe("sandbox CSP", () => {
  it("blocks network unless granted", () => {
    expect(sandboxCsp([])).toContain("connect-src 'none'");
    expect(sandboxCsp(["network"])).toContain("connect-src http: https:");
  });
});
