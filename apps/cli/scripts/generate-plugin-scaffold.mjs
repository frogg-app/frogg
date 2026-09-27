// Embeds templates/plugin/ into the CLI so `frogg plugins new` works from an installed CLI.
// `--check` fails when the embedded copy is stale.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../templates/plugin/", import.meta.url));
const out = fileURLToPath(
  new URL("../src/commands/plugins/scaffold-template.generated.ts", import.meta.url),
);

function walk(dir, rel = "") {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const abs = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (["node_modules", "dist"].includes(name)) return [];
      return statSync(abs).isDirectory()
        ? walk(abs, relPath)
        : [[relPath, readFileSync(abs, "utf8")]];
    });
}

const files = Object.fromEntries(walk(root));
const next =
  "// GENERATED from templates/plugin/ by apps/cli/scripts/generate-plugin-scaffold.mjs. Do not edit.\n" +
  "// Placeholders: {{id}}, {{name}}.\n" +
  `export const PLUGIN_SCAFFOLD_FILES: Record<string, string> = ${JSON.stringify(files, null, 2)};\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {}
  // Compare content, not bytes, so the formatter can restyle the generated file.
  const literal = current.slice(current.indexOf("= {") + 2, current.lastIndexOf("};") + 1);
  let embedded = null;
  try {
    embedded = new Function(`return (${literal});`)();
  } catch {}
  if (JSON.stringify(embedded) !== JSON.stringify(files)) {
    console.error(
      "plugin scaffold is stale: run node apps/cli/scripts/generate-plugin-scaffold.mjs",
    );
    process.exit(1);
  }
} else {
  writeFileSync(out, next);
}
