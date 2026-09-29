import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it } from "vitest";

import { buildClaudeSkillOverrides } from "../agent/providers/claude/agent.js";
import { buildCodexDisabledSkillsConfig } from "../agent/providers/codex-app-server-agent.js";
import { SkillCatalog } from "./catalog.js";

const brand = {
  id: "acme",
  fullName: "Acme",
  cliName: "acme",
  envPrefix: "ACME",
  docsUrl: "https://acme.test/docs/",
};

async function setup() {
  const froggHome = await mkdtemp(path.join(os.tmpdir(), "skill-catalog-"));
  const catalog = new SkillCatalog({ froggHome, brand, logger: pino({ level: "silent" }) });
  await catalog.initialize();
  return { catalog, froggHome };
}

describe("SkillCatalog", () => {
  it("lists only the product's own skills", async () => {
    const { catalog } = await setup();
    expect(catalog.list().map((skill) => [skill.id, skill.enabled])).toEqual([
      ["delegate", true],
      ["project-config", true],
    ]);
  });

  it("renders the skills per brand with no template left over", async () => {
    const { catalog } = await setup();
    const content = await catalog.readContent("project-config");
    expect(content).toContain("$ACME_PORT");
    expect(content).toContain("acme script ls");
    expect(content).toContain("https://acme.test/docs/reference/project-config/");
    expect(content).not.toContain("{{");
    const policy = catalog.launchPolicy();
    const plugin = JSON.parse(
      await readFile(
        path.join(policy.claudePluginDir ?? "", ".claude-plugin", "plugin.json"),
        "utf8",
      ),
    ) as { name: string };
    expect(plugin.name).toBe("acme");
    expect(
      await readFile(path.join(policy.codexRoot ?? "", "acme-delegate", "SKILL.md"), "utf8"),
    ).toContain("name: acme-delegate");
  });

  it("switches skills off for new launches and remembers it across restarts", async () => {
    const { catalog, froggHome } = await setup();
    await catalog.setEnabled("delegate", false);
    const policy = catalog.launchPolicy();
    expect(policy.claudeDisabled).toEqual(["acme:delegate"]);
    expect(policy.codexDisabled).toEqual(["acme-delegate"]);
    expect(policy.claudePluginDir).not.toBeNull();

    const restarted = new SkillCatalog({ froggHome, brand, logger: pino({ level: "silent" }) });
    await restarted.initialize();
    expect(restarted.list().find((skill) => skill.id === "delegate")?.enabled).toBe(false);

    await restarted.setEnabled("project-config", false);
    expect(restarted.launchPolicy().claudePluginDir).toBeNull();
    expect(restarted.launchPolicy().codexRoot).toBeNull();
  });

  it("ignores skills that are not the product's", async () => {
    const { catalog } = await setup();
    expect(await catalog.setEnabled("someone-elses-skill", false)).toBeNull();
    expect(await catalog.readContent("someone-elses-skill")).toBeNull();
  });
});

describe("launch adapters", () => {
  const policy = {
    claudePluginDir: null,
    codexRoot: null,
    claudeDisabled: ["acme:delegate"],
    codexDisabled: ["acme-delegate"],
  };

  it("hides switched-off skills from Claude", () => {
    expect(buildClaudeSkillOverrides(policy)).toEqual({ "acme:delegate": "off" });
    expect(buildClaudeSkillOverrides(undefined)).toBeNull();
  });

  it("hides switched-off skills from Codex", () => {
    expect(buildCodexDisabledSkillsConfig(policy)).toBe(
      'skills.config=[{name="acme-delegate",enabled=false}]',
    );
    expect(buildCodexDisabledSkillsConfig({ ...policy, codexDisabled: [] })).toBeNull();
  });
});
