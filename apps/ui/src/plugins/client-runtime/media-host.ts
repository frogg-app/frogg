import { Buffer } from "buffer";
import { createAudioEngine } from "@/voice/audio-engine";
import type { AudioEngine } from "@/voice/audio-engine-types";
import { ClientPluginError } from "./errors";

/** The app's audio engine captures mono PCM16 at this rate. */
export const PLUGIN_CAPTURE_SAMPLE_RATE = 16_000;

export interface ClientPluginAudioChunk {
  pcm16: string;
  sampleRate: number;
  level: number;
}

export interface ClientPluginMediaHost {
  startCapture(): Promise<void>;
  stopCapture(): void;
  play(data: string, format: string): Promise<void>;
  stopPlayback(): void;
  dispose(): void;
}

/**
 * One plugin's microphone and speaker, on the app's own audio engine: the app owns the permission
 * prompt and the device-wide audio lease, so a plugin cannot capture while another voice feature
 * is live. Chunks go to `onAudio`, which the runtime routes to the sandbox that started capture.
 */
export function createClientPluginMediaHost(input: {
  onAudio: (chunk: ClientPluginAudioChunk) => void;
  createEngine?: typeof createAudioEngine;
}): ClientPluginMediaHost {
  let engine: AudioEngine | null = null;
  let level = 0;
  let disposed = false;
  const make = input.createEngine ?? createAudioEngine;

  async function ready(): Promise<AudioEngine> {
    if (disposed) throw new ClientPluginError("not_active", "Plugin stopped");
    if (!engine) {
      const next = make(
        {
          onCaptureData: (pcm) =>
            input.onAudio({
              pcm16: Buffer.from(pcm).toString("base64"),
              sampleRate: PLUGIN_CAPTURE_SAMPLE_RATE,
              level,
            }),
          onVolumeLevel: (value) => {
            level = Math.max(0, Math.min(1, value));
          },
        },
        { traceLabel: "plugin" },
      );
      await next.initialize();
      engine = next;
    }
    return engine;
  }

  return {
    async startCapture() {
      const current = await ready();
      try {
        await current.startCapture();
      } catch (error) {
        throw new ClientPluginError(
          "forbidden",
          error instanceof Error ? error.message : "Microphone unavailable",
        );
      }
    },
    stopCapture() {
      void engine?.stopCapture().catch(() => undefined);
    },
    async play(data, format) {
      const current = await ready();
      const bytes = Buffer.from(data, "base64");
      current.stop();
      current.clearQueue();
      await current.play({
        size: bytes.byteLength,
        type: format,
        async arrayBuffer() {
          return Uint8Array.from(bytes).buffer;
        },
      });
    },
    stopPlayback() {
      engine?.stop();
      engine?.clearQueue();
    },
    dispose() {
      disposed = true;
      const current = engine;
      engine = null;
      if (current) void current.destroy().catch(() => undefined);
    },
  };
}
