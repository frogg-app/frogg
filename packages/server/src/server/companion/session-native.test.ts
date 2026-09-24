import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanionDeferredJobs } from "./deferred-jobs.js";
import type { CompanionNativeVoiceOptions } from "./native-voice.js";
import { CompanionSession, type CompanionRuntime } from "./session.js";
import { CompanionNotebookStore } from "./store.js";

const native = vi.hoisted(() => ({
  options: null as CompanionNativeVoiceOptions | null,
  appended: [] as string[],
}));

vi.mock("./native-voice.js", () => ({
  createCompanionNativeVoice(options: CompanionNativeVoiceOptions) {
    native.options = options;
    return {
      async start() {
        return "answer-sdp";
      },
      async appendSpeech(text: string) {
        native.appended.push(text);
      },
      async close() {},
    };
  },
}));

const logger = pino({ level: "silent" });
let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "frogg-companion-native-"));
  native.options = null;
  native.appended = [];
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function connect(jobs: CompanionDeferredJobs) {
  const runtime: CompanionRuntime = {
    capability: { enabled: true, reason: "" },
    modelConfig: { status: "available", backend: "codex", model: "gpt" },
    nativeVoicePreview: true,
    notebook: new CompanionNotebookStore({ filePath: path.join(home, "notebook.json") }),
    fillers: {
      async prewarm() {},
      async take() {
        return null;
      },
    },
    createTools: () => [],
    runDeferredJob: async () => "unused",
    createBackend: () => {
      throw new Error("native sessions do not use the text backend");
    },
    jobs,
  };
  return new CompanionSession({
    sessionId: "native",
    logger,
    runtime,
    stt: { id: "local", createSession: () => ({}) as never },
    turnDetection: { id: "local", createSession: () => ({}) as never },
    sttLanguage: "en",
    host: { emit() {} },
  });
}

async function startNative(session: CompanionSession) {
  await session.handleSessionStart({
    type: "companion.session.start.request",
    requestId: "start",
    voiceTransport: { kind: "codex-webrtc", sdp: "offer-sdp" },
  });
}

function loadJobs() {
  return new CompanionDeferredJobs({
    logger,
    filePath: path.join(home, "jobs.json"),
    run: async () => "The change is complete.",
  });
}

describe("native voice job results", () => {
  it("marks a result announced only after the reply that follows it is spoken", async () => {
    const jobs = loadJobs();
    const session = connect(jobs);
    await startNative(session);
    const { jobId } = jobs.start({
      kind: "think",
      label: "Change",
      question: "Do it",
      agentId: null,
    });
    await jobs.drain();
    await expect.poll(() => native.appended.length).toBe(1);
    expect(jobs.get(jobId)?.announced).not.toBe(true);

    native.options?.onTranscript("assistant", "Your change is done.", true);
    expect(jobs.get(jobId)?.announced).toBe(true);
    await session.cleanup();
  });

  it("replays a result that was handed over but never spoken", async () => {
    const jobs = loadJobs();
    const first = connect(jobs);
    await startNative(first);
    const { jobId } = jobs.start({
      kind: "think",
      label: "Change",
      question: "Do it",
      agentId: null,
    });
    await jobs.drain();
    await expect.poll(() => native.appended.length).toBe(1);
    // The connection drops before Codex speaks.
    await first.cleanup();
    expect(jobs.get(jobId)?.announced).not.toBe(true);

    const second = connect(loadJobs());
    await startNative(second);
    await expect.poll(() => native.appended.length).toBe(2);
    await second.cleanup();
  });
});
