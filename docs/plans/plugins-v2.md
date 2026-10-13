# Plugins API v2

Joint plan for the two first heavy integrations, `frogg.discord` (daemon scope) and
`frogg.google-workspace` (hybrid). Builds on [plugins.md](plugins.md); everything there
still holds unless changed here.

## Why a new version

v1 gives plugins agent summaries and content-free events. Both integrations need message
content, attention, permissions, agent control, workspaces and to-dos. Every addition is
additive, but it cannot ship as "still v1":

- Manifest `capabilities` is a strict enum (`packages/protocol/src/plugins/manifest.ts:49`,
  `:178`). A manifest declaring a new capability fails to parse on an old host before the
  `apiVersion` check (`packages/server/src/server/plugins/plugin-service.ts:517`), so it shows
  as invalid rather than `incompatible`.
- Repo index entries use the same strict enum (`repo-index.ts:33`) and the whole index is
  parsed at once (`repo-client.ts:96`, `apps/ui/src/plugins/client-runtime/verify.ts:110`). One
  entry with a new capability in the official `index.json` breaks the catalog for **every**
  plugin on every shipped host and client.

## Versioning rules

- Host `SUPPORTED_PLUGIN_API_VERSIONS = [1, 2]`. v2 is a strict superset of v1; v1 plugins
  run unchanged.
- `ctx.host = { version, apiVersion, features: string[] }`. Later additive work ships as a
  feature flag plus optional members, so it doesn't need v3.
- **Separate index:** v2 plugin versions publish to `index.v2.json` (index `schemaVersion: 2`),
  fetched only by v2-aware hosts and clients. `index.json` stays v1-only for good. Repo
  tooling (`frogg plugins index build`) splits the two by `apiVersion`; repo CI fails if a
  v2 entry reaches `index.json`.
- **Tolerant parsing from now on:** new hosts check `apiVersion` before validating
  capabilities (unsupported → `incompatible`). They parse indexes per entry, treat
  capabilities as open strings and drop entries they can't use, so a future v3 can share an
  index.

## New capabilities

| Capability             | Grants                                    | Gating                 |
| ---------------------- | ----------------------------------------- | ---------------------- |
| `agent.manage`         | Create, cancel and archive agents         | Remote control (below) |
| `agent.permissions`    | Get and answer permission requests        | Remote control         |
| `todos.read`           | List, get and subscribe to project to-dos | Consent                |
| `todos.write`          | Create, update and set status             | Remote control         |
| `workspaces.read`      | List and get workspaces and projects      | Consent                |
| `ui.external` (client) | `ctx.ui.openExternal(url)`                | Consent                |

`agent.read` and `agent.write` keep their names, with wider API surfaces.

## Daemon API additions

**Agents** (`agent.read` unless noted)

- `PluginAgentSummary` gains `model`, `workspaceId`, `branch`, `labels`, `prUrl`, and
  `usage { inputTokens, outputTokens, costUsd? }`. Sources: `agent-manager.ts:421`, `:464`,
  `config.model`.
- `getTimeline(id, { cursor?, limit? }) → { items, cursor }`. Typed items: `user_message`,
  `assistant_message`, `tool_call` (name plus a short summary), `plan`, `error`. The cursor
  survives a daemon restart, so a plugin can catch up after downtime without posting twice.
- `onEvent` `timeline` events carry the new item, not just `agentId`
  (change at `plugins/agent-bridge.ts:41`).
- `onAttention(fn, { force? })`: `{ agentId, reason: AgentAttentionReason }` from
  `@frogg/protocol/agent-attention-notification`. Suppressed while a client is present, the
  same as push, unless `force` is set (log channels, ledgers).
- `getDiffStat(id) → { files: [{ path, added, removed }], totals }`.
- `sendMessage(id, text, { attachments?, actor })` (`agent.write`). Attachments are
  `{ name, mime, data }` (base64, size-capped).

**Agent control** (`agent.manage`)

- `create({ workspaceId | cwd, provider, model?, prompt, mode?, title?, actor })`. Goes
  through the same path as the session RPC: model allowlist (`agent-manager.ts:299`) and
  `frogg.json` setup.
- `cancel(id, { actor })`, `archive(id, { actor })`.

**Permissions** (`agent.permissions`)

- `onPermissionRequest(fn)`: `{ requestId, agentId, tool, inputPreview, options }`, with a
  stable `requestId`. Wraps `pendingPermissions` (`agent-manager.ts:431`) and
  `permission_requested` (`:3414`).
- `respond(requestId, "allow" | "deny" | "always", { actor })` wraps `respondToPermission`
  (`:2981`). It rejects with `already_resolved` if the request was settled elsewhere first,
  e.g. in the app.
- `listPending(agentId?)` for catch-up after a restart.

**Workspaces** (`workspaces.read`)

- `list()`, `get(id)` → `{ id, projectId, title, repoRoot, branch, isolation }`.

**To-dos** (`todos.read` / `todos.write`)

- `list(projectId, filter?)`, `get(id)`, `onChange(fn)` (wraps
  `ProjectTodoService.subscribe`, `project-todos/service.ts:109`).
- `create`, `update`, `setStatus`, all taking `actor`. Claims stay host-controlled; plugins
  can read them but not claim or take over.

**Audit**

- Every `agent.write`, `agent.manage`, `agent.permissions` and `todos.write` call needs an
  `actor` string supplied by the plugin (`discord:<userId>`, `google:<email>`). The host
  logs `{ pluginId, actor, op, target }` and fills in agent and to-do provenance (e.g.
  "sent by Discord · alice").

**Not added**

- **Scheduling:** `setInterval` plus `ctx.signal` (`api-v1.ts:186`) is enough. A jitter
  helper can come later as a feature.
- **Large storage:** use `ctx.plugin.dataDir` for sync maps and cursors.
- **Secrets:** the `secret` settings type already exists (`manifest.ts:108`).
- **Outbound rate limiting:** each plugin batches its own sends; the host stays out of it.

## Client API additions

- `ctx.ui.openExternal(url)` (`ui.external`) routes through
  `apps/ui/src/utils/open-external-url.ts`. https only; desktop and web.
- **Device-code pattern:** for OAuth and bot setup on headless or mobile-only setups, a
  daemon panel (`kind: "markdown"` or `"form"`) shows the code and URL. This needs no new API;
  it gets documented as the recommended pattern because client plugins can't run on mobile.

## Remote-control gating

`agent.manage`, `agent.permissions` and `todos.write` let an outside identity drive agents
that run code, which goes around device registration (`a8af8f21`). Four layers on top of
consent:

1. **Brand:** `plugins.remoteControl: "allowed" | "forbidden"` (default `allowed`;
   `forbidden` refuses to grant these capabilities).
2. **Owner-only grant:** only an owner device can grant or enable them
   (`device-access-service.ts:110-115` roles).
3. **Off after install:** these capabilities install disabled and have their own toggle, so a
   read-only first install is possible. The capability API returns `forbidden` until
   enabled.
4. **External allowlist:** the plugin keeps its own list of permitted Discord user IDs or
   Google accounts. The docs require it, and it's checked in review for official-repo
   plugins.

## What each plugin uses

| API                            | Discord                     | Google                                       |
| ------------------------------ | --------------------------- | -------------------------------------------- |
| Richer summary + diff stat     | Thread status, diff stats   | Ledger rows, report Docs                     |
| `getTimeline` / timeline items | Final answer in thread      | Report Docs, plan → Doc                      |
| `onAttention`                  | Alerts / DMs                | Ledger status (forced)                       |
| `agent.permissions`            | Approve buttons             | Approve from a Doc comment (later)           |
| `agent.manage`                 | `/frogg new`, `stop`        | Start an agent from a Doc or Sheet (later)   |
| `sendMessage` + attachments    | Thread replies, voice notes | Doc comments → agent, Drive files as context |
| `workspaces.read`              | Autocomplete                | Drive folder per project                     |
| `todos.*`                      | Forum to-do sync            | Sheet to-do sync                             |
| `openExternal`                 | Bot invite link             | OAuth consent                                |

## Phases

1. **v2 plumbing (S):** `SUPPORTED_PLUGIN_API_VERSIONS`, `ctx.host`, check `apiVersion`
   before capabilities, per-entry tolerant index parsing, `index.v2.json` in repo tooling and
   CI, `apiVersion` in the scaffold. Both plugins can then build against v2 types.
2. **Read surface (M):** summary fields, `getTimeline` and cursor, timeline items,
   `onAttention`, `getDiffStat`, `workspaces.read`, `todos.read`. This unblocks Discord
   threads and alerts, and the Google ledger and reports.
3. **Gating + audit (M):** brand flag, owner-only grant, separate toggle, `actor` and the
   audit log. Must land before phase 4.
4. **Write surface (M):** `agent.manage`, `agent.permissions`, attachments, `todos.write`.
5. **Client (S):** `openExternal`, docs for the device-code pattern.

Each phase: types in `packages/protocol/src/plugins/api-v2.ts` (with
`@frogg/plugin-api` generated from it), implementation in `packages/server/src/server/plugins/`,
an entry in the authorization exhaustiveness test, a runtime test per capability, and a docs
page update. Plugin work starts in parallel from phase 1: Discord notify-only and Google
OAuth/ledger use v1 surfaces until phase 2 lands.

## Open decisions

- **`api-v2.ts` as a new file versus extending `api-v1.ts` with optional members.**
  Recommend a new file that re-exports v1 and extends it, so v1 types stay frozen.
- **Default for `plugins.remoteControl`.** Recommend `allowed` for the `frogg` brand, with
  the owner-only and off-after-install layers as the real safeguard.
- **`costUsd` source.** Only some providers report cost; leave it optional rather than
  estimating.

## Implementation decisions

Where the build bent the design above.

- **One API file.** v2 types extend `packages/protocol/src/plugins/api-v1.ts` (members tagged "v2")
  instead of a new `api-v2.ts`: the `@frogg/plugin-api` generator copies one self-contained file,
  and the runtime only attaches v2 members when the manifest declares `apiVersion: 2`.
- **v2 capabilities need `apiVersion: 2`** in the manifest schema, so they can never reach the
  v1 `index.json`.
- **Index split by filename, not schema version.** Both files keep `schemaVersion: 1`.
  `frogg plugins index build --out out/index.json` writes `index.json` (v1 versions only) and
  `index.v2.json` (all). Sign and verify both. Hosts and clients fetch `index.v2.json` first and
  fall back to `index.json` only when the v2 file can't be fetched; a bad v2 signature is an error.
  Both are parsed per entry (`parsePluginIndexTolerant`).
- **`getDiffStat` returns totals** (`{ additions, deletions }`) from the workspace git snapshot;
  per-file stats were dropped.
- **`sendMessage` is remote-controlled for v2 plugins** (v1 plugins are unchanged): the text
  almost always comes from an outside identity.
- **Remote control** is per-plugin host state (`plugins/state.json` → `remoteControl`), switched by
  `plugins.set_remote_control` (owner), `frogg plugins remote-control <id> on|off`, or the
  Installed-tab toggle. It is read on every call; `ctx.host.onRemoteControlChange` notifies
  plugins. Permission events are withheld while it is off. Owner-only granting needed no new code:
  install and set_remote_control are already owner RPCs.
- **Audit log**: `$FROGG_HOME/plugins/audit.jsonl`, one `{ at, pluginId, actor, op, target }` line
  per write, plus a daemon log line.
- **Additions from the Discord build**: `cursor` on timeline events, `labels` on `agents.create`,
  `requestedAt` on live permission requests.
- **Not done**: encoded-audio input for `ctx.speech.transcribe` (Discord voice notes are
  OGG/Opus); plugins must decode to PCM16 themselves for now.
