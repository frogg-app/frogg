# {{name}}

Frogg plugin `{{id}}` (API v1, daemon scope).

## Develop

```bash
npm install
npm run build
frogg plugins link .        # needs developer mode; hot-reloads on rebuild
```

Invoke **{{name}}: hello** from the Command Center.

## Publish

```bash
frogg plugins pack          # validates frogg-plugin.json, writes <id>-<version>.tgz + sha256
```

To ship through a repository, move this directory to `plugins/<category>/{{id}}/` in a repo forked
from Frogg's plugin-repo template; its CI packs, indexes and signs on push to `main`.

## Notes

- Each capability in `frogg-plugin.json` is shown in the install consent dialog; request only what
  `src/daemon.ts` uses. Adding one later forces users to re-consent.
- Command ids in `contributes.commands` are the plugin RPC method they invoke.
- `scope: "hybrid"` adds `entry.client`; `scope: "client"` drops `entry.daemon`.
