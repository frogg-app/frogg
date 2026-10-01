// Per-plugin JSON key/value store at <dataDir>/settings.json (the `settings.store` capability).
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonFileAtomic } from "../atomic-file.js";

export class PluginSettingsFile {
  private cache: Record<string, unknown> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private listeners = new Set<(key: string) => void>();
  readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "settings.json");
  }

  async all(): Promise<Record<string, unknown>> {
    if (this.cache) return { ...this.cache };
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      this.cache =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      this.cache = {};
    }
    return { ...this.cache };
  }

  async get(key: string): Promise<unknown> {
    return (await this.all())[key];
  }

  async setMany(values: Record<string, unknown>): Promise<void> {
    const current = await this.all();
    for (const [k, v] of Object.entries(values)) {
      if (v === null || v === undefined) delete current[k];
      else current[k] = JSON.parse(JSON.stringify(v)) as unknown;
    }
    this.cache = current;
    const write = this.writing.then(() => writeJsonFileAtomic(this.file, current));
    this.writing = write.catch(() => undefined);
    await write;
    for (const key of Object.keys(values)) {
      for (const l of this.listeners) {
        try {
          l(key);
        } catch {
          // listener errors belong to the plugin; the host ignores them
        }
      }
    }
  }

  onChange(listener: (key: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
