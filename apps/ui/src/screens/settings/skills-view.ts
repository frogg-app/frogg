import type { SkillEntry } from "@frogg/protocol/messages";

/** Providers that load any copy of the skill, in a stable order. */
export function skillProviders(skill: SkillEntry): string[] {
  const all = new Set(skill.locations.flatMap((location) => location.providers));
  return [...all].sort();
}

export function stripFrontMatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
}
