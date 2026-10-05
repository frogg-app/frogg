# Frogg Feature Inventory (for redesign)

Frogg runs and monitors coding agents (Claude Code, Codex, Copilot, OpenCode, Oh My Pi, Pi and ACP agents). Clients: Electron desktop, Expo mobile and web, and a CLI, all connecting to separately installed Node daemons. Forked from Paseo v0.7.2 (fork commit `d9b1a4ac`); original Paseo code arrived in `7c3a8952`.

**Legend.** Importance: core / secondary / niche. Origin: [paseo] inherited; [frogg-addon] added after the fork; [paseo+frogg] inherited and substantially extended.

Many features appear only when the daemon reports support (`server_info.features`), so most surfaces need a hidden state, a "host needs an update" state, or a "not permitted for your role" state.

This document describes what the UI must make room for. It deliberately says nothing about current visual styling.

---

## 1. Chat interface

### 1.1 Composer

| Feature                      | Description                                                                                | UI surfaces needed                                                               | Imp.      | Origin                                |
| ---------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------- | ------------------------------------- |
| Multi-line input             | Grows with content; draft kept per agent / new-session form                                | Expanding text area, placeholder, focus state, mobile keyboard dock              | core      | [paseo]                               |
| Send / steer / queue         | While running, Enter steers the current turn, Cmd/Ctrl+Enter queues; swappable in settings | Send button with running state, steer vs queue choice, queued-messages indicator | core      | [paseo]                               |
| Stop / interrupt             | Stops the current turn                                                                     | Stop replaces send while running                                                 | core      | [paseo]                               |
| Model picker                 | Cross-provider model selection, searchable browser                                         | Combined selector, model browser sheet with search + provider grouping           | core      | [paseo+frogg]                         |
| Thinking level               | Reasoning effort where supported                                                           | Small selector beside model                                                      | secondary | [paseo]                               |
| Permission mode              | Plan / ask / accept-edits / auto / bypass etc., per provider; some add "Auto accept"       | Mode dropdown, icon per mode, warning style for unattended modes                 | core      | [paseo]                               |
| Provider account pill        | Which signed-in account runs the agent; read-only once running except transfer             | Account pill + picker with per-account usage, add-account entry, transfer modal  | core      | [frogg-addon]                         |
| Move conversation / transfer | Move a live agent to another account or switch provider                                    | Transfer modal: usage per account, "Move" vs "Clean cut to this account"         | secondary | [frogg-addon]                         |
| Attachments                  | Images/files via picker, paste, drag-drop, clipboard; workspace files draggable            | Attach button, drop-zone overlay, pills with thumbnails + remove, lightbox       | core      | [paseo]                               |
| Attach CI job log            | Failing CI job log into chat                                                               | Action in CI pane; attachment pill                                               | secondary | [frogg-addon]                         |
| Attach review comments       | Inline diff comments become an attachment                                                  | Review-snapshot pill with comment count                                          | secondary | [paseo]                               |
| Slash commands               | Provider + app commands (`/clear`, `/exit`) with autocomplete                              | Autocomplete popover, keyboard nav, descriptions                                 | core      | [paseo]                               |
| `@` file mentions            | Workspace path autocomplete                                                                | Same popover with file icons and paths                                           | core      | [paseo]                               |
| Dictation                    | Daemon-side speech-to-text into composer                                                   | Mic button, recording state, level meter, cancel/confirm                         | secondary | [paseo]                               |
| Voice alerts toggle          | Per-workspace spoken updates toggle beside mic                                             | Toggle icon button                                                               | secondary | [frogg-addon]                         |
| Usage cluster                | Grouped rings for provider quota + context window, lettered; hover shows fresh usage       | Ring cluster, tooltip with plan windows and balances                             | secondary | [frogg-addon] (context meter [paseo]) |
| Stale-cache warning          | Amber notice when prompt cache likely expired, "Clean cut" link                            | Notice bar above composer, inline action                                         | secondary | [frogg-addon]                         |
| Auto-resume countdown        | After usage limit, countdown until auto resume                                             | Countdown chip with cancel / resume-now                                          | secondary | [frogg-addon]                         |
| Workspace context pill       | Target branch/worktree + diff stat                                                         | Context pill, +/- stat                                                           | secondary | [paseo]                               |
| Task list strip              | Agent's to-do progress docked near composer                                                | Collapsible checklist                                                            | secondary | [paseo]                               |
| Presence in composer         | Another device on this agent; outline, "is typing"                                         | Presence banner/outline, avatars                                                 | secondary | [frogg-addon]                         |
| Plugin composer actions      | Plugin buttons that insert text or run actions                                             | Puzzle-icon menu in toolbar                                                      | niche     | [frogg-addon]                         |
| Chat "Web" toggle            | Web search/fetch on/off for project-less chats                                             | Features menu in composer                                                        | niche     | [frogg-addon]                         |
| Mobile toolbar               | Compact controls; account only shown when there's a choice                                 | Narrow-width toolbar row                                                         | core      | [paseo+frogg]                         |

### 1.2 Timeline and message rendering

| Feature                     | Description                                                                                                                   | UI surfaces                                                                                                                      | Imp.      | Origin        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------- |
| User messages               | Text + attachments                                                                                                            | Message block, thumbnails                                                                                                        | core      | [paseo]       |
| Assistant messages          | Streaming markdown, syntax highlighting, file links to file pane, inline images, select/copy                                  | Rich markdown, code blocks with copy, link affordances                                                                           | core      | [paseo]       |
| Reasoning                   | Model thinking text                                                                                                           | Collapsible "thinking" block                                                                                                     | secondary | [paseo]       |
| Tool calls                  | Shell, read, edit, write, search, fetch, worktree setup, sub-agent, plan, text, unknown, plugin kinds; grouping/detail levels | Compact rows with status (running/done/failed), expand to detail, mobile detail sheet, diff for edits, terminal output for shell | core      | [paseo]       |
| Activity grouping           | Runs of tool calls collapse into a summary                                                                                    | Expandable group badge                                                                                                           | core      | [paseo]       |
| Plan card                   | Proposed plan, accept or revise                                                                                               | Card with markdown + actions                                                                                                     | core      | [paseo]       |
| Question form card          | Structured agent questions                                                                                                    | Form card: options, inputs, submit                                                                                               | core      | [paseo]       |
| Permission request card     | Accept/deny (+ extra choices) inline                                                                                          | Prominent card; also lives in notifications, voice, CLI                                                                          | core      | [paseo]       |
| To-do card                  | Agent task list as timeline item                                                                                              | Checklist card                                                                                                                   | secondary | [paseo]       |
| Compaction marker           | Where context was compacted                                                                                                   | Labelled divider                                                                                                                 | secondary | [paseo]       |
| Clean cut divider           | Summary (collapsible), model, copyable previous-conversation ID, context replaced, summary cost                               | Rich expandable divider                                                                                                          | secondary | [frogg-addon] |
| Errors / failed / cancelled | Inline                                                                                                                        | Error row, retry                                                                                                                 | core      | [paseo]       |
| Turn footer                 | Live elapsed time, copy, fork, clean cut, speak                                                                               | Hover/footer action row per turn                                                                                                 | core      | [paseo+frogg] |
| Fork from here              | New agent from conversation up to this point                                                                                  | Fork menu                                                                                                                        | secondary | [paseo]       |
| Rewind                      | Rewind to a message, restore it into composer                                                                                 | Rewind menu, composer restore state                                                                                              | secondary | [paseo]       |
| Chat outline rail           | Jump between your prompts                                                                                                     | Side rail with hover-preview markers                                                                                             | secondary | [paseo]       |
| Scroll behaviour            | Pinned to bottom, jump to latest, paged history, virtualised                                                                  | Jump-to-bottom button, "loading earlier"                                                                                         | core      | [paseo]       |
| Subagent tracks             | Child agents nested under parent; open as tabs; archive/detach                                                                | Nested track rows, open-in-tab, archive-finished                                                                                 | secondary | [paseo+frogg] |
| Linked Claude conversations | Turns from another process on same Claude session appear live; sends wait                                                     | "Other side is mid-turn" waiting state                                                                                           | niche     | [frogg-addon] |
| Archived agent callout      | When viewing an archived agent                                                                                                | Callout with unarchive/resume                                                                                                    | secondary | [paseo]       |
| Sandbox badge               | Project-less chats are read-only/sandboxed                                                                                    | Header badge                                                                                                                     | secondary | [frogg-addon] |

### 1.3 Streaming and agent states

- States: initializing, running, idle, error, closed (resumable). Needs a status dot/ring usable in sidebar rows, tabs, headers, notifications. **core** [paseo]
- Turn liveness: elapsed timer, streaming reveal, "reconnecting" toast. **core** [paseo]
- Per-turn usage/token reporting. **secondary** [paseo+frogg]

### 1.4 Clean cut [frogg-addon]

Summarises a conversation into a fresh one on the same account/model, keeping the workspace.

- Entry points: scissors on a turn, stale-cache notice, account pill, model picker on provider switch ("Clean cut and switch").
- Sends queue while it runs.
- Automatic triggers: usage-limit resume, daemon-restart resume — labelled in timeline; subagent outcomes reported.
- Settings: Host → Clean cut (per-trigger toggles, idle thresholds, summary model global/per provider).
- Importance: secondary.

### 1.5 Voice and speech

| Feature                | Description                                                                       | UI surfaces                                                                                               | Imp.      | Origin        |
| ---------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------- | ------------- |
| Daemon speech runtime  | Local STT/TTS/VAD on the daemon, selectable models                                | Settings model selection                                                                                  | secondary | [paseo]       |
| Speak message          | Read an assistant message aloud                                                   | Speaker in turn footer                                                                                    | niche     | [paseo]       |
| Spoken alerts          | Updates spoken; reply/approve by voice; optional 2s transcript confirm            | Banner/toast with playback, voice-reply sheet, auto-play setting                                          | secondary | [frogg-addon] |
| Realtime voice overlay | Full-screen realtime voice                                                        | Overlay with level meter + controls                                                                       | niche     | [paseo]       |
| Companion (preview)    | Voice conversation that dispatches and tracks agents, creates worktree workspaces | Surface with animated orb, mic, topics strip, mini presence elsewhere, three entry points, settings group | niche     | [frogg-addon] |

---

## 2. Multi-session management

### 2.1 Projects, sessions (workspaces) and agents

| Feature               | Description                                                                                        | UI surfaces                                                                                 | Imp.      | Origin        |
| --------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------- | ------------- |
| Projects              | Registered repos per host: icon, name, default base branch                                         | Project list, edit sheet, project settings                                                  | core      | [paseo+frogg] |
| Add project           | Explorer-style folder browser, path bar, hidden toggle, brandable start dir                        | Multi-step flow, directory browser                                                          | core      | [paseo+frogg] |
| Sessions (workspaces) | Unit of work: `local` or `worktree`; worktree off base, branch, or PR/MR checkout                  | New-session form (isolation, branch/PR picker, provider/model/mode/account), setup progress | core      | [paseo]       |
| Unfinished drafts     | Nested under project; empty hidden; discard bin                                                    | Draft rows, discard control                                                                 | secondary | [frogg-addon] |
| Worktree setup        | Runs `frogg.json` setup scripts                                                                    | Setup panel with live log, failure callout                                                  | secondary | [paseo]       |
| Scripts and services  | Per-workspace scripts/dev servers with own ports                                                   | Scripts menu in header, service status                                                      | secondary | [paseo]       |
| Agents in a session   | Several agents per session as tabs                                                                 | Agent tabs, new-agent action                                                                | core      | [paseo]       |
| Agent lifecycle       | Stop / archive / delete / reload                                                                   | Menus, destructive confirms                                                                 | core      | [paseo]       |
| Session labels        | Coloured labels                                                                                    | Chip, picker, manager modal                                                                 | secondary | [paseo]       |
| Archive & history     | Archived per project; History across hosts                                                         | Archived view, History screen                                                               | secondary | [paseo+frogg] |
| IDs & quick actions   | Copy ID/branch; quick-action rail on Ctrl                                                          | Hover rail, kebab                                                                           | secondary | [frogg-addon] |
| Merge handover        | Hand over a worktree branch for merging                                                            | Action + confirm                                                                            | niche     | [paseo]       |
| Workspace recovery    | Recover broken/missing workspaces                                                                  | Recovery state                                                                              | niche     | [paseo]       |
| Import                | From daemon provider sessions or local JSONL; dedup; limits                                        | Import sheet: source, destination, select, progress, errors                                 | secondary | [paseo+frogg] |
| Project-less chats    | Sandboxed chats in a "chats" project; Projects/Chats switch; rotating headings                     | Segmented switch, chats list, new-chat screen                                               | core      | [frogg-addon] |
| Project to-dos        | Daemon-owned to-dos: status, priority, category, markdown plan, progress log, agent claims via MCP | List with filters, detail, plan editor, release claims, delete                              | secondary | [frogg-addon] |

### 2.2 Sidebar and navigation

| Feature                | Description                                                                       | UI surfaces                                                                                | Imp.      | Origin        |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------- | ------------- |
| Session sidebar        | Group by project/status; sorts; reverse; pin; drag reorder; collapsible groups    | Sidebar with group/sort/display menu, pinned section, drag handles, empty states, skeleton | core      | [paseo+frogg] |
| Row metadata           | Status, title, account, branch, diff stat, Dev badge, presence                    | Dense row with trailing actions + sub-rows                                                 | core      | [paseo+frogg] |
| Hide projects/sessions | With filter for hidden                                                            | Menu actions, show-hidden toggle                                                           | secondary | [frogg-addon] |
| Brand header           | Logo links home; icon-only nav                                                    | Logo slot                                                                                  | secondary | [frogg-addon] |
| Sidebar nav items      | Configurable Show menu                                                            | Nav rows, Appearance settings                                                              | secondary | [frogg-addon] |
| Workspace hover card   | Preview on hover                                                                  | Hover card                                                                                 | niche     | [paseo]       |
| Command center         | Palette: commands, workspace/file search, agent controls, plugin commands, labels | Palette with sections + shortcuts                                                          | core      | [paseo]       |
| Keyboard shortcuts     | Dialog + rebinding; pinned-workspace shortcuts                                    | Shortcuts dialog, rebinding UI                                                             | secondary | [paseo]       |
| Mobile panels          | Gesture panes (sidebar, main, explorer)                                           | Swipe panels, back headers                                                                 | core      | [paseo]       |

### 2.3 Workspace shell (panes and tabs)

| Feature                | Description                                                                                                         | UI surfaces                                                   | Imp.      | Origin        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------- | ------------- |
| Tabs & split panes     | Kinds: agent, draft, file, files, terminal, browser, setup, plugin views; split by drop; resize; rename; bulk close | Tab strip, new-tab launcher, split drop zones, resize handles | core      | [paseo]       |
| Explorer sidebar       | Files, Changes, PR, CI, Streams; collapses to icons                                                                 | Right rail with tab rail                                      | core      | [paseo+frogg] |
| File explorer & pane   | Tree, editor, live file, md/html preview, conflict alert, open externally                                           | Tree, file bar, edit/preview toggle, conflict banner          | core      | [paseo]       |
| Changes / diff         | Working diff, folder tree, too-large state, commits with graph                                                      | Split/unified diff, commit list                               | core      | [paseo]       |
| Inline review comments | Comment on lines, send to agent                                                                                     | Gutter add, inline thread editor                              | secondary | [paseo]       |
| Git actions            | Branch switcher, commit/push/PR split button, PR status, checks ring                                                | Header git controls                                           | core      | [paseo]       |
| PR panel               | PR/MR timeline across GitHub/GitLab/Gitea                                                                           | PR panel                                                      | secondary | [paseo]       |
| Terminals              | Multiple, profiles, copy/paste, links, file drop                                                                    | Terminal pane, profile picker/editor                          | core      | [paseo]       |
| Browser pane (desktop) | Webviews, agent browser automation, data settings                                                                   | Browser tab with URL bar                                      | secondary | [paseo]       |

### 2.4 Hosts, daemons, connection and pairing

| Feature             | Description                                                           | UI surfaces                                       | Imp.      | Origin        |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | --------- | ------------- |
| Multiple hosts      | Many daemons; Hosts menu with status dots + cog                       | Hosts menu, status dots                           | core      | [paseo+frogg] |
| Add host            | Direct, QR, pairing link, LAN scan, SSH config, Remote SSH, deep link | Method chooser, forms, LAN results, QR scanner    | core      | [paseo+frogg] |
| Remote SSH deploy   | Deploy/upgrade/uninstall daemon over SSH, live log, key pinning       | Deploy offer, credentials, progress log, failures | secondary | [paseo+frogg] |
| Pairing codes/links | Codes/QR from `frogg pair`; confirm step; unattended local pairing    | Pair confirmation, code entry, claim offer        | core      | [frogg-addon] |
| Devices & roles     | Owner/operator/viewer, approval queue, revoke, password               | Devices section, approval queue, role picker      | secondary | [frogg-addon] |
| Presence            | Who's viewing/typing/sending on agent or terminal; clients; nicknames | Presence bar/avatars, clients list                | secondary | [frogg-addon] |
| Connection notices  | Reconnecting, offline, different daemon on saved address              | Banners/toasts                                    | core      | [paseo+frogg] |
| Security posture    | Findings per host with fixes, mark intended                           | Security card, findings list, dot                 | secondary | [frogg-addon] |
| Daemon conflict     | Two daemons collide, Shut down                                        | Warning dialog                                    | niche     | [frogg-addon] |

### 2.5 Notifications

- Desktop + push (Android) for attention needed, permissions, finished, storage alerts; settings section, in-app toasts, deep links. **core** [paseo+frogg]
- Plugin notifications as toasts. **niche** [frogg-addon]

---

## 3. Frogg add-ons beyond Paseo

| Feature                | Description                                                                                                                                                      | UI surfaces                                                                                                                                                           | Imp.      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Plugins API v1         | Signed repos; daemon/client/hybrid scopes; commands, session actions, panels, views, composer actions, settings, media, speech, events; consent; status + source | Plugins manager (Installed, Browse, Repositories, Developer), host-vs-client target, consent view, plugin settings, sidebar entry, puzzle menus, sandboxed view frame | secondary |
| CI pane                | GitHub Actions + Jenkins runs per branch, current-branch filter, progress rings, header CI button, log-to-chat                                                   | CI explorer tab, run bars, header button                                                                                                                              | secondary |
| Release streams        | Graph of stable/beta/main with change tracking                                                                                                                   | Streams pane                                                                                                                                                          | niche     |
| Provider accounts      | Multiple accounts per provider, default, per-provider modal with account tabs, model management                                                                  | Provider settings modal, add-account flow                                                                                                                             | core      |
| Usage meters           | Plan usage per account; refresh rate, thresholds, easing                                                                                                         | Usage cards/bars, tooltip, settings                                                                                                                                   | secondary |
| Provider CLI updates   | Check/update/auto-update CLIs                                                                                                                                    | Badges + actions                                                                                                                                                      | secondary |
| Auto-resume            | Resume when limits reset                                                                                                                                         | Composer countdown                                                                                                                                                    | secondary |
| Resources              | Host load, storage sizes, stale worktree cleanup, log/speech cache cleanup, storage alerts                                                                       | Metrics, storage table, clean actions, thresholds, global banner                                                                                                      | secondary |
| Frogg skills           | Built-in `delegate`, `project-config` with switches + viewer                                                                                                     | Skills list                                                                                                                                                           | niche     |
| Web client control     | Start/stop web client, bind interface, start with daemon                                                                                                         | Web client card                                                                                                                                                       | niche     |
| Developer options      | Beta app/daemon, dev daemon, Dev menu (launch/rebuild/restart/open/stop), Dev badges                                                                             | Developer section, Dev menu, progress/logs                                                                                                                            | niche     |
| Branding / white-label | `brand.json`: identity, ports, provider/model locks, hidden sections, plugin policy, pairing, start dir                                                          | Brand logo/name slots everywhere, section hiding                                                                                                                      | secondary |
| Release channels       | Stable + beta side by side                                                                                                                                       | Channel badge, About                                                                                                                                                  | niche     |
| In-app updates         | Desktop auto-update with CI progress, Android updater, daemon self-update with rollback                                                                          | Update banners, progress, Updates section                                                                                                                             | secondary |
| Reduce motion          | App-level, off by default                                                                                                                                        | Appearance toggle                                                                                                                                                     | niche     |
| Download location      | Desktop download folder                                                                                                                                          | Setting + toast                                                                                                                                                       | niche     |
| Removed                | Agent profiles, schedules, heartbeats; Layout/Editor/Integrations settings                                                                                       | Do not design                                                                                                                                                         | —         |

---

## 4. Everything else

- **Settings.** App: General (Companion, Diagnostics), Appearance, Shortcuts, Notifications, Permissions, About (Developer toggle; Developer section above About when on). Host (Daemon group first): Overview, Providers, Agents, Projects, Terminals, Automation (Clean cut), Skills, Resources, Security, Devices, Web client, Updates, Developer; brand can hide some. Resizable modal with sidebar; screen on mobile. **core**
- **Entry/onboarding.** Splash, welcome, first-host onboarding, pairing offer/scan, empty home, Projects and Sessions screens. **core** [paseo+frogg]
- **Desktop shell.** Custom title bar per OS, app menu, quitting overlay, open-project routing, deep links, open in editor, diagnostics sheet. **core** [paseo+frogg]
- **Mobile.** Android (iOS planned), QR, push, gesture panels, keyboard dock, bottom sheets, updater. **core** [paseo+frogg]
- **Web client.** Same UI on its own port. **secondary**
- **CLI (no UI).** Daemon lifecycle, pairing, command groups for agents/workspaces/projects/terminals/providers/permissions/plugins/scripts/hooks; table/JSON/YAML output.
- **Localisation & a11y.** Nine locales — leave room for longer copy; screen-reader labels. **core**
- **Agent-facing MCP surfaces.** Permission, to-do and browser tools whose effects show in timeline and panels.

---

## Designer checklist: regions to make room for

1. **Left sidebar:** brand header, Projects/Chats switch, hosts menu, grouped session list, drafts, pinned, dev badges, presence.
2. **Main header:** title, labels, git branch/actions, CI button, scripts, plugin menu, Dev menu, explorer toggle.
3. **Tab strip and split panes.**
4. **Timeline:** messages, tool-call rows, cards (permission, plan, question, to-do), dividers (compaction, clean cut), turn footer, outline rail, jump-to-bottom.
5. **Composer stack** (top→bottom): notices (stale cache, presence, auto-resume, storage), task list, attachments, input, toolbar (model, thinking, mode, account, usage rings, mic, voice alerts, plugin actions, send/stop).
6. **Right explorer:** Files, Changes, PR, CI, Streams.
7. **Overlays:** command center, settings, plugins manager, import, pairing/add-host, transfer & clean-cut modals, lightbox, companion, realtime voice, confirms, toasts/banners.
8. **Responsive:** mobile gesture-panel equivalents of all the above.
