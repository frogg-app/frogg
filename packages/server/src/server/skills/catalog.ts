// The product's own skills (see built-in.ts) and which of them the host has switched off.
//
// Only skills that ship with the daemon live here. Skills the user or a project installs for a
// provider CLI are that CLI's business and are neither listed nor touched. Switching a skill off
// is recorded in $FROGG_HOME/skills.json and applied to each launch (Claude `skillOverrides`,
// Codex `skills.config`).
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";

import { writeJsonFileAtomic } from "../atomic-file.js";
import {
  renderBuiltInSkills,
  type BuiltInSkillBrand,
  type RenderedBuiltInSkill,
  type RenderedBuiltInSkills,
} from "./built-in.js";

export type SkillProvider = "claude" | "codex";

export interface SkillLocation {
  scope: "built_in";
  path: string;
  providers: SkillProvider[];
}

export interface SkillEntry {
  /** The skill's short name, e.g. `delegate`. */
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: "built_in";
  /** The copy each provider loads. */
  locations: SkillLocation[];
}

/** What a launch needs to apply the host's choices. */
export interface SkillLaunchPolicy {
  /** Local Claude plugin holding the skills; null when every skill is off. */
  claudePluginDir: string | null;
  /** Extra Codex skill root holding the skills; null when every skill is off. */
  codexRoot: string | null;
  /** Names to hide from Claude (`skillOverrides: { name: "off" }`). */
  claudeDisabled: string[];
  /** Names to hide from Codex (`skills.config`). */
  codexDisabled: string[];
}

interface SkillsState {
  disabled: string[];
}

export interface SkillCatalogOptions {
  froggHome: string;
  brand: BuiltInSkillBrand;
  logger: Logger;
}

export class SkillCatalog {
  private readonly statePath: string;
  private readonly root: string;
  private rendered: RenderedBuiltInSkills | null = null;
  private disabled = new Set<string>();

  constructor(private readonly options: SkillCatalogOptions) {
    this.statePath = path.join(options.froggHome, "skills.json");
    this.root = path.join(options.froggHome, "skills", "built-in");
  }

  async initialize(): Promise<void> {
    this.disabled = new Set(await this.readState());
    try {
      this.rendered = await renderBuiltInSkills(this.root, this.options.brand);
    } catch (error) {
      this.options.logger.warn({ err: error }, "Failed to write built-in skills");
      this.rendered = null;
    }
  }

  /** Synchronous so providers can read it while building launch options. */
  launchPolicy(): SkillLaunchPolicy {
    const skills = this.rendered?.skills ?? [];
    const off = skills.filter((skill) => this.disabled.has(skill.name));
    const anyOn = off.length < skills.length;
    return {
      claudePluginDir: this.rendered && anyOn ? this.rendered.claudePluginDir : null,
      codexRoot: this.rendered && anyOn ? this.rendered.codexRoot : null,
      claudeDisabled: off.map((skill) => skill.claudeName),
      codexDisabled: off.map((skill) => skill.codexName),
    };
  }

  list(): SkillEntry[] {
    return (this.rendered?.skills ?? []).map((skill) => this.toEntry(skill));
  }

  async setEnabled(id: string, enabled: boolean): Promise<SkillEntry | null> {
    const skill = this.find(id);
    if (!skill) return null;
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
    await this.writeState();
    return this.toEntry(skill);
  }

  /** The SKILL.md text agents load, as Claude sees it. */
  async readContent(id: string): Promise<string | null> {
    const skill = this.find(id);
    if (!skill) return null;
    return await fs.readFile(skill.claudePath, "utf8").catch(() => null);
  }

  private find(id: string): RenderedBuiltInSkill | undefined {
    return this.rendered?.skills.find((skill) => skill.name === id);
  }

  private toEntry(skill: RenderedBuiltInSkill): SkillEntry {
    return {
      id: skill.name,
      name: skill.name,
      description: skill.description,
      enabled: !this.disabled.has(skill.name),
      scope: "built_in",
      locations: [
        { scope: "built_in", path: skill.claudePath, providers: ["claude"] },
        { scope: "built_in", path: skill.codexPath, providers: ["codex"] },
      ],
    };
  }

  private async readState(): Promise<string[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, "utf8")) as Partial<SkillsState>;
      return Array.isArray(parsed.disabled)
        ? parsed.disabled.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  }

  private async writeState(): Promise<void> {
    const state: SkillsState = { disabled: [...this.disabled].sort() };
    await writeJsonFileAtomic(this.statePath, state);
  }
}
