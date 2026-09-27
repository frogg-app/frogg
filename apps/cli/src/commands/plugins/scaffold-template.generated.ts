// GENERATED from templates/plugin/ by apps/cli/scripts/generate-plugin-scaffold.mjs. Do not edit.
// Placeholders: {{id}}, {{name}}.
export const PLUGIN_SCAFFOLD_FILES: Record<string, string> = {
  ".gitignore": "node_modules/\ndist/\n*.tgz\n",
  "README.md":
    '# {{name}}\n\nFrogg plugin `{{id}}` (API v1, daemon scope).\n\n## Develop\n\n```bash\nnpm install\nnpm run build\nfrogg plugins link .        # needs developer mode; hot-reloads on rebuild\n```\n\nInvoke **{{name}}: hello** from the Command Center.\n\n## Publish\n\n```bash\nfrogg plugins pack          # validates frogg-plugin.json, writes <id>-<version>.tgz + sha256\n```\n\nTo ship through a repository, move this directory to `plugins/<category>/{{id}}/` in a repo forked\nfrom Frogg\'s plugin-repo template; its CI packs, indexes and signs on push to `main`.\n\n## Notes\n\n- Each capability in `frogg-plugin.json` is shown in the install consent dialog; request only what\n  `src/daemon.ts` uses. Adding one later forces users to re-consent.\n- Command ids in `contributes.commands` are the plugin RPC method they invoke.\n- `scope: "hybrid"` adds `entry.client`; `scope: "client"` drops `entry.daemon`.\n',
  "frogg-plugin.json":
    '{\n  "id": "{{id}}",\n  "name": "{{name}}",\n  "version": "0.1.0",\n  "apiVersion": 1,\n  "scope": "daemon",\n  "description": "",\n  "author": "",\n  "entry": { "daemon": "dist/daemon.js" },\n  "capabilities": ["rpc", "ui.contribute"],\n  "contributes": {\n    "commands": [{ "id": "{{id}}.hello", "title": "{{name}}: hello" }]\n  }\n}\n',
  "package.json":
    '{\n  "name": "{{id}}",\n  "version": "0.1.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "build": "esbuild src/daemon.ts --bundle --platform=node --format=esm --target=node20 --outfile=dist/daemon.js",\n    "typecheck": "tsc -p ."\n  },\n  "devDependencies": {\n    "@frogg/plugin-api": "^1.0.0",\n    "esbuild": "^0.25.0",\n    "typescript": "^5.6.0"\n  }\n}\n',
  "src/daemon.ts":
    'import type { PluginContext } from "@frogg/plugin-api";\n\nexport default function activate(ctx: PluginContext): void {\n  ctx.rpc.handle("{{id}}.hello", async function hello() {\n    ctx.ui.notify("Hello from {{name}}");\n    return { ok: true };\n  });\n}\n\nexport function deactivate(): void {}\n',
  "tsconfig.json":
    '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "moduleResolution": "Bundler",\n    "strict": true,\n    "noEmit": true,\n    "skipLibCheck": true,\n    "types": []\n  },\n  "include": ["src"]\n}\n',
};
