// $FROGG_HOME/plugins/state.json: installed plugins, user repos, dev links, developer mode.
// Writes are serialized and atomic; a corrupt file is moved aside rather than crashing the daemon.
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type pino from "pino";
import { writeJsonFileAtomic } from "../atomic-file.js";

const InstalledRecordSchema = z.object({
  id: z.string(),
  version: z.string(),
  /** official | brand | user */
  tier: z.string(),
  repoUrl: z.string(),
  grantedCapabilities: z.array(z.string()),
  enabled: z.boolean(),
  installedAt: z.string(),
  preinstalled: z.boolean().optional(),
});
export type InstalledPluginRecord = z.infer<typeof InstalledRecordSchema>;

const UserRepoSchema = z.object({
  url: z.string(),
  name: z.string(),
  publicKey: z.string(),
  addedAt: z.string(),
});
export type UserRepoRecord = z.infer<typeof UserRepoSchema>;

const DevLinkSchema = z.object({ path: z.string(), enabled: z.boolean().optional() });
export type DevLinkRecord = z.infer<typeof DevLinkSchema>;

const PluginStateSchema = z.object({
  version: z.literal(1),
  developerMode: z.boolean().default(false),
  installed: z.record(z.string(), InstalledRecordSchema).default({}),
  userRepos: z.array(UserRepoSchema).default([]),
  devLinks: z.array(DevLinkSchema).default([]),
});
export type PluginState = z.infer<typeof PluginStateSchema>;

export function emptyPluginState(): PluginState {
  return { version: 1, developerMode: false, installed: {}, userRepos: [], devLinks: [] };
}

export class PluginStateStore {
  private state: PluginState = emptyPluginState();
  private writing: Promise<void> = Promise.resolve();
  readonly file: string;

  constructor(
    readonly pluginsDir: string,
    private readonly logger?: pino.Logger,
  ) {
    this.file = path.join(pluginsDir, "state.json");
  }

  async load(): Promise<PluginState> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch {
      this.state = emptyPluginState();
      return this.state;
    }
    try {
      this.state = PluginStateSchema.parse(JSON.parse(text));
    } catch (err) {
      const aside = `${this.file}.corrupt-${Date.now()}`;
      this.logger?.warn({ err, aside }, "plugins/state.json is invalid; starting empty");
      await fs.rename(this.file, aside).catch(() => undefined);
      this.state = emptyPluginState();
    }
    return this.state;
  }

  get(): PluginState {
    return this.state;
  }

  /** Applies `mutate` to a copy and persists it. Serialized with other updates. */
  async update(mutate: (draft: PluginState) => void): Promise<PluginState> {
    const next = structuredClone(this.state);
    mutate(next);
    this.state = next;
    const write = this.writing.then(() => writeJsonFileAtomic(this.file, next));
    this.writing = write.catch(() => undefined);
    await write;
    return next;
  }
}
