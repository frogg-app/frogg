# Plugins

Frogg's own plugin system. Upstream Paseo's was removed (see
`docs/divergence-from-paseo.md`); this is a fresh design, not a restoration.

Goals: plugins published and shared through signed repositories, brand-controlled
distribution, quick local development, and a narrow versioned API so internal
refactors don't break plugins.

## Concepts

- **Plugin**: a directory with `frogg-plugin.json` plus built code.
- **Scope** (manifest `scope`):

  | Scope    | Runs on                                      | Installed per                  |
  | -------- | -------------------------------------------- | ------------------------------ |
  | `daemon` | Host (daemon process)                        | Host                           |
  | `client` | Desktop/web client                           | Device                         |
  | `hybrid` | Both; halves talk over plugin RPC            | Host; client half auto-fetched |
  | `build`  | Brand build pipeline (mobile/native changes) | Brand config only              |

- **Repository**: an HTTPS URL serving a signed `index.json`. Tiers: `official`
  (Frogg's `frogg-plugins`), `brand` (declared in `brand.json`), `user` (added in
  the app; off by default).
- **Developer mode**: a setting that unlocks linking local plugin folders. Linked
  plugins skip integrity checks, hot-reload and show a DEV badge. Brands can
  forbid it.

## Manifest: `frogg-plugin.json`

```json
{
  "id": "acme.jira-links",
  "name": "Jira links",
  "version": "1.2.0",
  "apiVersion": 1,
  "scope": "daemon",
  "description": "Link agent sessions to Jira issues",
  "author": "Acme",
  "homepage": "https://example.com",
  "entry": { "daemon": "dist/daemon.js", "client": "dist/client.js" },
  "capabilities": ["network", "agent.read", "ui.contribute"],
  "contributes": {}
}
```

- `id`: reverse-DNS-ish, `^[a-z0-9]+(\.[a-z0-9-]+)+$`.
- `apiVersion`: integer; the host refuses plugins whose `apiVersion` it doesn't
  support. v1 is the only version.
- `capabilities` (v1): `network`, `filesystem.workspace`, `process.spawn`,
  `agent.read`, `agent.write`, `settings.store`, `ui.contribute`, `rpc`.
  Shown in the consent dialog. Re-consent only when an update adds any.
- `contributes`: declarative UI (see below).
- Schema lives in `packages/protocol/src/plugins/manifest.ts` (zod), shared by
  daemon, client, CLI and repo CI.

## Plugin API v1 (daemon)

Entry module default-exports `activate(ctx)` and optionally `deactivate()`.
`ctx` exposes only what the granted capabilities allow:

- `ctx.log`, `ctx.plugin` (id, version, dataDir)
- `ctx.settings` — per-plugin key/value store (`settings.store`)
- `ctx.agents.list()/get()/onEvent()` (`agent.read`); `sendMessage()` (`agent.write`)
- `ctx.rpc.handle(method, fn)` — callable from the client half (`rpc`)
- `ctx.ui.setBadge()/notify()` — updates declarative contributions (`ui.contribute`)

Plugins run in the daemon process, each loaded via dynamic `import()` with an
error boundary. v1 is **not** a sandbox: capability gating limits the API
surface, and trust comes from consent plus signed repos. Process isolation is a
later hardening step, not v1.

Types ship as `@frogg/plugin-api` (types only), generated from the host's
implementation.

## Declarative UI contributions (v1)

No arbitrary React. `contributes` may declare:

- `commands`: `{ id, title }` → Command Center entries; invoke plugin RPC.
- `sessionActions`: buttons in the session header; invoke plugin RPC.
- `panels`: `{ id, title, kind: "list" | "markdown" | "form" }`; content returned
  by plugin RPC `panel.<id>.render` as a typed JSON tree.
- `settings`: a JSON-schema-ish field list rendered in the plugin's settings page.

A sandboxed webview panel kind may come later; not in v1.

## Repository index: `index.json`

```json
{
  "schemaVersion": 1,
  "name": "Frogg plugins",
  "generatedAt": "2026-09-27T00:00:00Z",
  "plugins": [
    {
      "id": "acme.jira-links",
      "category": "integrations",
      "versions": [
        {
          "version": "1.2.0",
          "apiVersion": 1,
          "scope": "daemon",
          "capabilities": ["network", "agent.read"],
          "tarball": "https://…/acme.jira-links-1.2.0.tgz",
          "sha256": "<hex>",
          "commit": "<git sha>"
        }
      ]
    }
  ]
}
```

Served alongside `index.json.sig`: a detached ed25519 signature over the exact
bytes of `index.json`, base64. Each repo has a public key (base64 raw 32 bytes).

## Integrity

1. Fetch `index.json` + `.sig`; verify with the repo's pinned public key. Reject
   on failure (official key compiled in; brand keys from `brand.json`; user repos
   pin the key on first add, TOFU, shown to the user).
2. Download tarball; verify `sha256` before extracting. Reject on mismatch.
3. Extract to `$FROGG_HOME/plugins/<id>/<version>/`; the manifest inside must
   match the index entry (id, version, scope, capabilities).
4. Dev-linked plugins skip 1–3.

Implementation: Node `crypto` (`ed25519` verify, `sha256`) on the daemon; the
client verifies client-scope tarballs the same way (desktop via Node, web via
WebCrypto).

## Brand policy: `brand.json` `plugins` block

```json
"plugins": {
  "enabled": true,
  "officialRepo": true,
  "repos": [{ "name": "Acme internal", "url": "https://…/index.json", "publicKey": "…" }],
  "allowUserRepos": false,
  "developerMode": "allowed",
  "allow": ["acme.*"],
  "deny": [],
  "preinstalled": [{ "id": "acme.jira-links", "version": "^1" }],
  "autoUpdate": "brand-repos"
}
```

- `developerMode`: `allowed` | `forbidden`. `autoUpdate`: `off` | `brand-repos` | `all`.
- Defaults when block absent: plugins enabled, official repo on,
  `allowUserRepos: false`, dev mode allowed, auto-update `brand-repos`.
- The default `frogg` brand sets `allowUserRepos: true`.
- `build`-scope plugins listed in `preinstalled` are applied by the brand build
  pipeline, not at runtime.

## Daemon storage and RPCs

State in `$FROGG_HOME/plugins/state.json`: installed plugins (id, version, source
repo, granted capabilities, enabled), user repos (url, pinned key), dev links.

Session RPCs (gated on `server_info.features.plugins`):

- `plugins.list` → installed + dev-linked, with status/errors
- `plugins.repos.list` / `plugins.repos.add` / `plugins.repos.remove`
- `plugins.catalog` → merged repo indexes, filtered by brand allow/deny
- `plugins.install { id, version, repo, grantedCapabilities }`
- `plugins.uninstall`, `plugins.setEnabled`, `plugins.update`
- `plugins.dev.link { path }` / `plugins.dev.unlink` (dev mode only)
- `plugins.rpc { pluginId, method, params }` → plugin RPC
- `plugins.contributions` → merged declarative contributions
- Push event `plugins.changed`

## CLI

- `frogg plugins list|install|uninstall|enable|disable|update`
- `frogg plugins repos list|add|remove`
- `frogg plugins link <dir>` / `unlink <id>`
- `frogg plugins new <id>` — scaffold
- `frogg plugins pack` — validate manifest, produce tarball + sha256
- `frogg plugins index build|sign|verify` — repo tooling (used by repo CI)
- `frogg plugins keygen` — ed25519 keypair for a repo

## App UI

- Sidebar entry **Plugins** between Add Project and Hosts; hidden when the brand
  disables plugins or no connected host reports the feature.
- Plugins modal: target selector (This client / each host); tabs **Installed**,
  **Browse**, **Repositories** (only when user repos allowed).
- Install shows a consent dialog listing capabilities and the repo tier.
- Hybrid plugins installed on a host show "needs client component" on clients
  missing it.
- Settings: Developer mode toggle (hidden when brand forbids); "Add local folder".
- Uses Frogg's in-app modal; confirmation only for uninstall.

## Repo template

`templates/plugin-repo/`: `plugins/<category>/<id>/` layout, GitHub Actions
workflow that builds each plugin, runs `frogg plugins pack`, builds `index.json`,
signs with `PLUGIN_REPO_SIGNING_KEY` secret and deploys to Pages. Forking it is
how brands run an internal repo.

## Phases

1. Manifest schema, API v1 types, daemon runtime, dev link. (M/L)
2. Repo index, signing/verification, install/update, RPCs, CLI, plugins modal. (M)
3. `brand.json` `plugins` block and enforcement. (S/M)
4. Repo template, scaffold, pack/index/sign tooling, docs. (S/M)
5. Declarative UI contributions rendered in the app. (M)

## Implementation decisions

Judgement calls made while implementing, where the design above was silent or had to bend to
existing conventions.

- **RPC names follow the protocol conventions** (`<ns>.<verb>.request` / `.response`, verb as the
  operation segment). So `plugins.catalog` is `plugins.get_catalog`, `plugins.contributions` is
  `plugins.get_contributions`, `plugins.rpc` is `plugins.rpc.call`, `plugins.setEnabled` is
  `plugins.set_enabled`. Push events carry no direction suffix (`plugins.changed`).
- **Added RPCs**: `plugins.dev.set_enabled` (the developer-mode setting lives on the host, since
  linking is a host operation), `plugins.settings.get` / `plugins.settings.set` (the plugin
  settings page), and a `plugins.notify` push event for `ctx.ui.notify()`.
- **Contribution → RPC method**: command and session-action ids _are_ the RPC method invoked
  (so ids may contain dots and are conventionally prefixed with the plugin id). Session actions
  receive `{ agentId, cwd }`. Panels call `panel.<id>.render` and forms submit to
  `panel.<id>.submit` with `{ values }`. Panel content is validated by `PluginPanelContentSchema`.
- **Settings fields** use `title` (not `label`) for the display name; the store holds any JSON
  value, settings-page fields are string/secret/number/boolean/select.
- **Consent is all-or-nothing**: `grantedCapabilities` must cover every capability the version
  requests; install fails with `forbidden` otherwise. An update adding capabilities fails with
  `consent_required` (listing them) unless the new set is granted.
- **TOFU for user repos**: if `plugins.repos.add` omits `publicKey`, the daemon fetches
  `<index url>.pub` (base64 raw key), verifies the index with it, pins it and returns it for
  display. Repo CI should publish `index.json.pub` next to `index.json.sig`.
- **Wire enums are open strings** (status, source, tier, scope, capabilities) so older clients
  parse newer daemons; manifests and indexes themselves are validated strictly.
- **`@frogg/plugin-api`** lives in `packages/plugin-api`; its `index.d.ts` is generated from
  `packages/protocol/src/plugins/api-v1.ts`, and the daemon implements `PluginContext` against
  that file so drift fails typecheck.
- **Version ranges** (`preinstalled[].version`, install `version`): exact, `^x[.y[.z]]`,
  `~x.y`, `x`/`x.y`, `*`/`latest`. Prereleases only match an exact version.
- **Allow/deny**: `*` globs over plugin ids; deny wins; an empty `allow` allows everything.

## RPC contract (v1)

Schemas: `packages/protocol/src/plugins/rpc-schemas.ts` (re-exported from
`@frogg/protocol/messages`). Gate: `server_info.features.plugins === true`. Every request has
`requestId`; every response payload has `requestId` and `error: { code, message,
capabilities? } | null`. Error codes: `not_found`, `invalid_request`, `forbidden`,
`consent_required`, `signature_invalid`, `hash_mismatch`, `manifest_mismatch`, `fetch_failed`,
`incompatible`, `already_installed`, `plugin_error`, `not_active`, `timeout`, `internal`.

| Request (`.request`)        | Params                                             | Response payload                         | Permission / role          |
| --------------------------- | -------------------------------------------------- | ---------------------------------------- | -------------------------- |
| `plugins.list`              | —                                                  | `plugins: PluginInstalled[]`, `policy`   | daemon.read / viewer       |
| `plugins.repos.list`        | —                                                  | `repos: PluginRepo[]`                    | daemon.read / viewer       |
| `plugins.repos.add`         | `url`, `publicKey?`, `name?`                       | `repo: PluginRepo \| null`               | daemon.manage / owner      |
| `plugins.repos.remove`      | `url`                                              | `success`                                | daemon.manage / owner      |
| `plugins.get_catalog`       | `refresh?`                                         | `plugins: PluginCatalogEntry[]`, `repos` | daemon.read / viewer       |
| `plugins.install`           | `id`, `version?`, `repoUrl`, `grantedCapabilities` | `plugin: PluginInstalled \| null`        | daemon.manage / owner      |
| `plugins.uninstall`         | `id`                                               | `success`                                | daemon.manage / owner      |
| `plugins.set_enabled`       | `id`, `enabled`                                    | `plugin`                                 | daemon.manage / owner      |
| `plugins.update`            | `id`, `version?`, `grantedCapabilities?`           | `plugin`                                 | daemon.manage / owner      |
| `plugins.dev.link`          | `path` (absolute, on the host)                     | `plugin`                                 | daemon.manage / owner      |
| `plugins.dev.unlink`        | `id`                                               | `success`                                | daemon.manage / owner      |
| `plugins.dev.set_enabled`   | `enabled`                                          | `policy`                                 | daemon.manage / owner      |
| `plugins.rpc.call`          | `pluginId`, `method`, `params?`                    | `result?`                                | workspace.write / operator |
| `plugins.get_contributions` | —                                                  | `contributions: PluginContributionSet[]` | daemon.read / viewer       |
| `plugins.settings.get`      | `id`                                               | `fields`, `values`                       | daemon.read / viewer       |
| `plugins.settings.set`      | `id`, `values` (null deletes)                      | `success`                                | daemon.manage / owner      |

Push events (daemon.read): `plugins.changed { pluginId | null, reason }` — refetch list /
contributions; `plugins.notify { pluginId, message, level }` — toast.

`policy`: `{ enabled, allowUserRepos, developerMode: "allowed"|"forbidden",
developerModeEnabled, apiVersions }`. `PluginInstalled.status`: `active`, `disabled`, `error`,
`incompatible`, `blocked`, `inactive` (client/build scope — nothing runs on the daemon).
`source`: `official`, `brand`, `user`, `dev`.
