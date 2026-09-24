import { brandIdentity } from "@frogg/branding";
import { installedSkillName } from "@frogg/branding/skills";
import { brand } from "@frogg/branding";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { removeRetiredSkills } from "./retired-skills.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

async function install(root: string, name: string, owner: unknown = brandIdentity) {
  const dir = path.join(root, installedSkillName(brand, name));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), "skill");
  await writeFile(
    path.join(dir, ".frogg-managed-files.json"),
    JSON.stringify({ version: 1, brand: owner, files: { "SKILL.md": sha("skill") } }),
  );
  return dir;
}

describe("removeRetiredSkills", () => {
  it("removes untouched installs and keeps everything else", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "retired-skills-"));
    const untouched = await install(root, "frogg-dev");
    const edited = await install(root, "frogg-help");
    await writeFile(path.join(edited, "SKILL.md"), "my notes");
    const extra = await install(root, "frogg-rpc");
    await writeFile(path.join(extra, "mine.md"), "user file");
    await install(root, "frogg", { id: "other", applicationId: "other.app" });
    await mkdir(path.join(root, "my-own-skill"));

    expect(await removeRetiredSkills([root])).toEqual([untouched]);
    expect((await readdir(root)).sort()).toEqual(
      [
        installedSkillName(brand, "frogg"),
        installedSkillName(brand, "frogg-help"),
        installedSkillName(brand, "frogg-rpc"),
        "my-own-skill",
      ].sort(),
    );
  });

  it("ignores missing roots", async () => {
    expect(await removeRetiredSkills([path.join(os.tmpdir(), "does-not-exist-skills")])).toEqual(
      [],
    );
  });
});
