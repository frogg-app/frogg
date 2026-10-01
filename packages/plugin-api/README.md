# @frogg/plugin-api

TypeScript types for Frogg plugins, API v1. Types only.

```ts
import type { PluginContext } from "@frogg/plugin-api";

export default function activate(ctx: PluginContext) {
  ctx.rpc.handle("acme.example.hello", () => ({ ok: true }));
}
```

`index.d.ts` is generated from `packages/protocol/src/plugins/api-v1.ts`; edit that file and
run `npm run generate --workspace=@frogg/plugin-api`. See the plugin docs on frogg.app.
