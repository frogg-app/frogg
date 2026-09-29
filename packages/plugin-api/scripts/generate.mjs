// Generates index.d.ts from the host's source of truth,
// packages/protocol/src/plugins/api-v1.ts. `--check` fails when the copy is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../protocol/src/plugins/api-v1.ts", import.meta.url));
const out = fileURLToPath(new URL("../index.d.ts", import.meta.url));
const header =
  "// GENERATED from packages/protocol/src/plugins/api-v1.ts by scripts/generate.mjs. Do not edit.\n";
const next = header + readFileSync(src, "utf8");
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {}
  if (current !== next) {
    console.error(
      "@frogg/plugin-api index.d.ts is stale: run npm run generate --workspace=@frogg/plugin-api",
    );
    process.exit(1);
  }
} else {
  writeFileSync(out, next);
}
