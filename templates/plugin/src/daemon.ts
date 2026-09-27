import type { PluginContext } from "@frogg/plugin-api";

export default function activate(ctx: PluginContext): void {
  ctx.rpc.handle("{{id}}.hello", async function hello() {
    ctx.ui.notify("Hello from {{name}}");
    return { ok: true };
  });
}

export function deactivate(): void {}
