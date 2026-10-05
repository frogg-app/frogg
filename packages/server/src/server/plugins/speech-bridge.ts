// Adapts the daemon's speech service to the narrow speech API plugins see (`speech`).
import type pino from "pino";
import { STTManager } from "../agent/stt-manager.js";
import type { SpeechService } from "../speech/speech-runtime.js";
import type { PluginSpeechBridge } from "./runtime.js";
import { PluginServiceError } from "./errors.js";

const MAX_TRANSCRIBE_BYTES = 16 * 1024 * 1024;

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

/** Providers report "mp3", "opus", "pcm;rate=24000"...; plugins get a MIME type. */
export function speechFormatToMime(format: string): string {
  const f = format.trim().toLowerCase();
  if (f.startsWith("audio/")) return f;
  if (f.startsWith("pcm")) return `audio/${f}`;
  if (f === "mp3") return "audio/mpeg";
  return `audio/${f}`;
}

/** `resolve` is lazy: the speech service is created after the plugin service at startup. */
export function createPluginSpeechBridge(deps: {
  resolve: () => SpeechService | null;
  logger: pino.Logger;
}): PluginSpeechBridge {
  return {
    available: () => {
      const speech = deps.resolve();
      return { stt: Boolean(speech?.resolveStt()), tts: Boolean(speech?.resolveTts()) };
    },
    transcribe: async (input) => {
      const speech = deps.resolve();
      if (!speech?.resolveStt()) {
        throw new PluginServiceError("not_active", "This host has no speech-to-text backend");
      }
      const audio = Buffer.from(input.pcm16, "base64");
      if (audio.length === 0) return { text: "" };
      if (audio.length > MAX_TRANSCRIBE_BYTES) {
        throw new PluginServiceError("invalid_request", "audio is too long to transcribe");
      }
      const stt = new STTManager("plugin", deps.logger, () => speech.resolveStt(), {
        language: input.language ?? speech.resolveSttLanguage(),
      });
      try {
        const result = await stt.transcribe(audio, `audio/pcm;rate=${input.sampleRate}`, {
          label: "plugin",
        });
        return { text: result.text, ...(result.language ? { language: result.language } : {}) };
      } finally {
        stt.cleanup();
      }
    },
    synthesize: async (text, options) => {
      const tts = deps.resolve()?.resolveTts();
      if (!tts) {
        throw new PluginServiceError("not_active", "This host has no text-to-speech backend");
      }
      const result = await tts.synthesizeSpeech(text, options);
      const audio = await readAll(result.stream);
      return { audio: audio.toString("base64"), format: speechFormatToMime(result.format) };
    },
  };
}
