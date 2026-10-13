# Frogg menus, options and surfaces: content inventory

Structure-agnostic list of every user-facing surface's **content**: menus, settings, dialogs, popovers, actions, empty/error states, shortcuts, options with values and defaults. Written for an IA rebuild: "Src" is only a pointer to where the content is defined, not a recommendation for where it goes.

Conventions

- **Plat**: D = Electron desktop, W = web (browser client), M = mobile (Android; iOS shares code). "all" = D/W/M.
- **Scope**: device (stored on this client), host (stored in the daemon's `config.json`), project (`frogg.json` in the repo), session, agent.
- **Gate**: many items are hidden or show "Update the host…" when the daemon lacks a feature (`server_info.features`), or "Only an owner can…" for operator/viewer roles. Assume every host-scoped item has three extra states: offline, host too old, not permitted.
- Strings paths: `en.ts` = `apps/ui/src/localisation/resources/en.ts`. Keys given as `ns.key`.
- Nine UI locales (ar, en, es, fr, ja, ko, pt-BR, ru, zh-CN); ar is RTL.

---

## 1. Sessions, agents and chats

### 1.1 Entities and their states

| Entity              | States / badges                                                                                                                                            | Src                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Agent               | Starting, Idle, Running, Error, Closed; badges Archived, "{n} pending", Attention                                                                          | `agentList.status`, `agentList.badges` |
| Session (workspace) | Creating…, draft ("New session (draft)"), pinned, hidden, archived; service running/unhealthy; checks passed/failed/warning/action required/manual/pending | `sidebar.workspace.*`                  |
| Chat (project-less) | Read-only sandbox badge: reads anywhere, writes only to own chat folder, no shell, no skills/plugins/MCP                                                   | `chats.sandbox`                        |
| Subagent            | working / failed / needs input / ready to review counts; offline "showing saved activity"                                                                  | `subagents.*`                          |

### 1.2 New session form

| Field                       | Options / default                                            | Notes                                                           | Src                                    |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------- |
| Project                     | project picker (search, Browse…, Open path)                  | —                                                               | `newWorkspace.fields`, `projectPicker` |
| Host                        | host chooser (search hosts)                                  | multi-host only                                                 | `screens/new-workspace-screen.tsx`     |
| Isolation                   | Local / New worktree                                         | Base shows "Not applicable" for Local                           | `newWorkspace.isolation`               |
| Starting ref ("Start from") | branches and PRs/MRs search; shown "into {base}"             | —                                                               | `newWorkspace.refPicker`               |
| Title                       | optional free text                                           | —                                                               | `newWorkspace.titlePlaceholder`        |
| What to launch              | Agent / Terminal; Manage profiles link                       | Agent: prompt field "Prompt {name}"; Terminal: command or blank | `newWorkspace.launch`                  |
| Agent controls              | provider, model, thinking, mode, account, features (see 2.3) | —                                                               | —                                      |
| Submit                      | Create / Launch                                              | errors: host disconnected, worktree failed, select a model      | `newWorkspace.errors`                  |

### 1.3 New chat (project-less)

- Rotating heading (12 variants, e.g. "What do you want to know?"), placeholder "Ask anything…", button "Start chat".
- Feature toggle **Web** ("Let this chat search and fetch web pages"); default off. Claude models only ("Chats can't use this provider yet. Pick a Claude model.").
- Sidebar chats list: New chat, Search chats, Delete chat; groups Today / Yesterday / Previous 7 days / Older; empty "No chats yet".
- Src: `newChat`, `chats.web`, `sidebar.chats`, `screens/new-chat-screen.tsx`, server `agent/providers/claude/chat-options.ts`.

### 1.4 Session actions (per session menu, hover card, header)

| Action                                                                  | Notes                        | Src                                                 |
| ----------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------- |
| New agent / New agent in this worktree / New terminal / New browser tab | browser D only               | `workspace.header.actions`                          |
| Import conversation                                                     | opens import sheet (1.8)     | same                                                |
| Copy session path / branch name / session ID                            | toast on copy                | `workspace.hoverCard`, `sidebar.workspace.actions`  |
| Show setup                                                              | setup log tab                | `workspace.header.actions.showSetup`                |
| Rename session                                                          | validates branch name        | `sidebar.workspace.rename`                          |
| Pin to top / Unpin                                                      | shortcut Mod+Shift+P         | `sidebar.workspace.actions`                         |
| Hide from sidebar (confirm) / Unhide; "Show hidden ({n})", Undo toast   | files untouched              | `sidebar.hidden`, `sidebar.workspace.confirmations` |
| Archive session (confirm, lists uncommitted lines + unpushed commits)   | restore via History          | `workspace.git.actions.archiveWarning`              |
| Voice alerts on/off for this session                                    | —                            | `spokenAlerts.workspaceToggle`                      |
| Labels: assign, Create label, Manage labels…                            | see 1.6                      | `workspaceLabels`                                   |
| Plugin session actions                                                  | puzzle menu "Plugin actions" | `plugins.sessionActions`                            |
| Scripts menu                                                            | see 5.4                      | `workspace.scripts`                                 |

### 1.5 Project actions

| Action                                                                                | Src                       |
| ------------------------------------------------------------------------------------- | ------------------------- |
| Open project settings, To-dos, Show archived sessions                                 | `sidebar.project.actions` |
| Open in new window (D), Open in file manager (D)                                      | same                      |
| Hide / Unhide project; Remove project (confirm: "Files on disk will not be changed.") | same + `.confirmations`   |
| New session for project; "Set up worktree scripts" callout → project settings         | `sidebar.worktreeSetup`   |
| Edit project sheet: Name, Icon (Choose image / Use automatic / Image or website URL)  | `settings.project.edit`   |

### 1.6 Session labels

- Fields: Name, Color ∈ Violet, Sky, Emerald, Orange, Pink, Indigo, Teal, Red, Amber, Blue.
- Manage labels dialog: search, edit, save, delete (confirm "removes the label from {n} sessions on this host"). Host-scoped. Filter "Clear filter". Src: `workspaceLabels`.

### 1.7 Agent actions

| Action                                                                                      | Where content lives              | Src                                             |
| ------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| Interrupt / Stop agent                                                                      | composer, Esc                    | `composer.cancel`                               |
| Archive (confirm if running: "will stop the agent") / Unarchive                             | tab menu, archive sheet, callout | `agentList.archiveSheet`, `agentPanel.archived` |
| Reload agent ("to update skills, MCPs or login status")                                     | tab menu                         | `workspace.tabs.menu.reloadAgent`               |
| Rename agent                                                                                | tab menu                         | same                                            |
| Copy agent id / resume command                                                              | tab menu                         | same                                            |
| Fork chat from here: in new tab / in new session                                            | turn footer                      | `message.actions`                               |
| Clean cut (fresh conversation, same account)                                                | turn footer, composer            | `composer.cleanCut`                             |
| Rewind: conversation / files / both ("cannot be undone")                                    | per user message                 | `rewind`                                        |
| Copy turn / message / code                                                                  | turn footer                      | `message.actions`                               |
| Subagent: Detach (becomes standalone), Copy session ID, Archive, Archive finished subagents | subagent rows                    | `subagents`                                     |
| Slash client commands `/exit` (archive), `/clear` (archive + fresh draft)                   | composer                         | `apps/ui/src/client-slash-commands/index.ts`    |

### 1.8 Import conversation(s)

- **Import conversation sheet** (from host provider sessions): filter by provider (All + each), refresh, rows with preview/untitled; states: connect host, update host, no importable providers, loading, failures per provider; empty "already imported". Src: `importSession`, `components/import-session-sheet.tsx`.
- **Import project and conversations**: source = This computer (D/W) or On {host}; Project directory on host; Choose project files; Choose Claude/Codex JSONL; optional exported conversation directory; Preview import → select → Import selected; progress bytes; result "Provider session" (resumable) vs "Text history"; failures retry. M: host only. Src: `resources/project-import.ts`.

### 1.9 History

- Cross-host history list: search, Load more, Clear search; date sections Recent/Today/Yesterday/This week/This month/Older; per-host load error; "Too many matches". Per-project variant. Src: `sessions`, `screens/sessions-screen.tsx`.

### 1.10 Session recovery states

- Loading / Connecting / host offline / cannot reach / "Update your host to restore this session" / Manage host.
- Archived: Restore (re-creates worktree on branch) or Unarchive; Restoring; Session unavailable; Couldn't check. Src: `workspace.route`.

---

## 2. Composer and input

### 2.1 Input

| Item                            | Values                                                                                          | Src                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| Placeholder                     | D "Message the agent, tag @files, or use /commands and /skills"; M "Message, @files, /commands" | `composer.placeholders`                 |
| Send behaviour while agent runs | Interrupt / **Steer** (default) / Queue; Mod+Enter does the other                               | `settings.general.defaultSend` (device) |
| Buttons                         | Send, Queue, Send and steer, Send and interrupt, Interrupt agent                                | `composer.input`                        |
| Queued messages                 | edit queued, send now                                                                           | `composer.attachments`                  |
| Autocomplete                    | `@` files/dirs, `/` commands & skills; loading/empty states                                     | `agentAutocomplete`                     |
| Offline                         | "Daemon offline. You can send once it reconnects."                                              | `agentPanel.connectionNotice`           |

### 2.2 Attachments

- Add image, Paste image, Upload file, Add issue or PR/MR (search dialog), drop images/files, browser element (D), review comments, CI log, text attachments. Remove/open each. Errors: too large, no clipboard image, upload failed, photo-library permission (M). Src: `composer.attachments`, `composer.github`, `imageAttachmentPicker`.

### 2.3 Agent controls (per agent; also in command center)

| Control               | Options                                                                                                                                                                                                                 | Src                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Provider              | enabled providers on host (Claude, Codex, Copilot, OpenCode, Cursor, Kimi, Kiro, Oh My Pi, Pi, generic ACP…)                                                                                                            | `agentControls.provider`, `packages/server/src/server/agent/providers/`                                                           |
| Model                 | searchable browser, grouped by provider, "Default", custom models; "Open {provider} settings"                                                                                                                           | `modelSelector`                                                                                                                   |
| Thinking              | provider-defined (e.g. Pi: Off, Minimal, Low, Medium\*, High, XHigh, Max; others incl. "Extra high")                                                                                                                    | `agentControls.thinking`                                                                                                          |
| Mode (permission)     | Claude: Plan Mode, Always Ask, Accept File Edits, Auto mode, Bypass. Codex: Default Permissions, Auto-review, Full Access. Copilot: Agent, Plan, Allow All. OpenCode: Build, Plan. ACP: + Auto Accept. Shift+Tab cycles | server provider files `claude/agent.ts`, `codex-app-server-agent.ts`, `copilot-acp-agent.ts`, `opencode-agent.ts`, `acp-agent.ts` |
| Features              | per provider toggles: Fast (Claude/Codex/Cursor), Plan (Codex), Web (chats)                                                                                                                                             | `agentControls.features`, `*feature-definitions.ts`                                                                               |
| Plan mode / Fast mode | command-center groups                                                                                                                                                                                                   | `shell.commandCenter`                                                                                                             |
| Account               | Default / named accounts; locked after start; "Move this conversation"                                                                                                                                                  | see 7.2                                                                                                                           |

### 2.4 Composer notices and meters

| Notice                | Content                                                        | Src                     |
| --------------------- | -------------------------------------------------------------- | ----------------------- |
| Stale cache           | "Cache expired: sending re-bills {n} input tokens" + Clean cut | `composer.staleContext` |
| Auto-resume countdown | "Auto-resume in {t}"; dialog Cancel auto-resume / Keep         | `composer.autoResume`   |
| Clean cut progress    | Summarising {s}s; Queue while pending; subagent cut outcomes   | `composer.cleanCut`     |
| Context window meter  | % used, tokens used/max, session cost                          | `contextWindow`         |
| Usage rings           | per account plan windows, balances; tooltip refresh            | `provider-usage/`       |
| Presence              | "{name} is typing here" etc.                                   | `presence`              |
| Task list             | "{done}/{total} tasks"                                         | `message.todo`          |

### 2.5 Voice in composer

- Dictation start/stop/cancel/retry, insert, insert and send; Voice mode enable/mute/unmute; "Interrupt the agent before starting voice mode". Src: `composer.voice`, `message.dictation`.

### 2.6 Plugin composer actions

- Menu "Plugin composer actions" (≤10 per plugin; insert text or run action). Src: `plugins/composer-actions-button.tsx`.

---

## 3. Timeline and messages

| Item                    | Options / actions                                                                                              | Src                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Tool call display       | **Full detail** (default) / Summary (device)                                                                   | `settings.general.toolCallDetail`          |
| Always expand reasoning | off default (device)                                                                                           | `settings.general.autoExpandReasoning`     |
| Chat outline            | on default (device)                                                                                            | `settings.appearance.chatOutline`          |
| Tool group summaries    | "edited/ran/read/searched/used/called {brand}" counts                                                          | `toolCallGroup`                            |
| Tool call details       | Input, Output, Error, Sub-agent activity                                                                       | `toolCallDetails`                          |
| Permission card         | Accept / Deny; plan: Implement / Reject; provider extras (Allow once / Allow always / Deny, Dismiss)           | `agentStream.permission`, server providers |
| Question card           | options, "Other…", Next, Submit                                                                                | `message.question`                         |
| Diagram (Mermaid)       | Zoom in/out, Reset view, View source/diagram                                                                   | `message.diagram`                          |
| Compaction markers      | auto/manual/with tokens                                                                                        | `message.compaction`                       |
| Clean-cut divider       | summary, model, cost, replaced context, Copy previous conversation ID                                          | `agentStream.cleanCut`                     |
| Spoke header            | for spoken messages                                                                                            | `message.speak`                            |
| Archived callout        | Unarchive                                                                                                      | `agentPanel.archived`                      |
| States                  | empty "Start chatting with this agent...", history load failed, message capped, scroll to bottom, reconnecting | `agentStream`, `agentPanel.states`         |

---

## 4. Approvals, permissions and access roles

| Item                      | Content                                                                        | Src                                           |
| ------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| Inline permission request | see §3; also via notifications and voice reply (Allow/Deny/Send as message)    | `spokenAlerts.reply`                          |
| Agent permission mode     | §2.3                                                                           | —                                             |
| Device roles              | Owner (everything), Operator (drive work; ≈ owner on host), Viewer (read-only) | `deviceAccess.roles`                          |
| Host security fixes       | see §8.6                                                                       | —                                             |
| OS permissions (D)        | Notifications status, Microphone status; Request / Refresh / Granted           | `settings.permissions`, `desktop.permissions` |
| CLI equivalents           | `permissions ls/allow/deny`                                                    | `apps/cli/src/commands/permissions`           |

---

## 5. Workspace shell: tabs, panes, files, terminal, browser

### 5.1 Tab kinds

new_tab, draft, agent, provider_subagent, terminal, browser (D), changes_tree, files, pull_request, ci_runs, release_streams, plugin_panel, file, working_diff, commit_diff, setup. Src: `apps/ui/src/panels/panel-manifest.ts`.

### 5.2 Tab and pane menus

- Tab menu: Copy resume command / agent id / terminal id / file path; Rename; Reload agent; Close; Close tabs above/below/left/right/others; Move to main panel.
- Confirms: Unsaved changes (Close without saving), Close terminal ("process stopped"), Archive running agent, bulk close summaries (archive N agents, close N terminals, N tabs).
- Pane: Split right/down, Maximize/Restore, Close pane, Exit focus mode; tab switcher "Switch tabs ({n} open)" with search.
- New tab launcher: New agent, New terminal (+ terminal profiles menu, Edit profiles), New browser.
- Device prefs (no UI found): open-in-side-pane for explorer files/diffs/chat files/diff files/subagents (all false).
- Src: `workspace.tabs`, `hooks/use-settings/storage.ts`.

### 5.3 Files

| Item                            | Options                                                                                                                                                                                                                                   | Src                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Explorer                        | sort Name/Modified/Size; show/hide hidden files; refresh; collapse                                                                                                                                                                        | `workspace.fileExplorer`                           |
| File actions                    | Open, Open in {editor}, Open to the side, Copy path/relative path, Reveal in {file manager}, Download, Add to chat, New file/folder, Rename, Duplicate, Discard changes (confirm), Delete (confirm)                                       | `workspace.fileActions`                            |
| Editor                          | Preview/Source, Vim mode indicator, cursor, save states, changed on disk → Overwrite/Reload (confirm) , deleted on disk                                                                                                                   | `panels.file.editor`                               |
| Editor targets (D)              | VS Code, VS Code Insiders, VSCodium, Cursor, Zed, Kiro, Trae, Antigravity, JetBrains (IntelliJ, WebStorm, PyCharm, GoLand, PhpStorm, RubyMine, Rider, CLion, RustRover, DataGrip, DataSpell, Aqua, Android Studio), Finder/Explorer/Files | `apps/desktop/src/features/editor-targets/targets` |
| Source editing                  | web and desktop only (M read-only)                                                                                                                                                                                                        | `file-pane/editor/view.tsx`                        |
| Downloads                       | D: Ask every time (default) / Save to a folder + folder; M: share sheet                                                                                                                                                                   | `settings.general.downloads`, `downloads`          |
| Directory browser (add project) | path bar, Up, Refresh, show hidden, filter, create folder                                                                                                                                                                                 | `directoryBrowser`                                 |

### 5.4 Scripts and services (per session)

- Per script: Run, Stop, Restart, View terminal, View service, Copy URL, Choose URL (routes: Reverse proxy / Memorable / Direct); exit code, start/stop failed.
- Service URL open behaviour: **Ask** (default) / In {brand} / External browser; dialog with "Don't ask again". Src: `workspace.scripts`, `serviceUrl`, `settings.general.serviceUrls`.

### 5.5 Terminal

| Option                                           | Values                                                                  | Src                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------- |
| Scrollback                                       | 0–1,000,000 lines, default 10,000 (device)                              | `settings.general.terminalScrollback`         |
| Legacy terminal renderer                         | off default (device; Diagnostics)                                       | `settings.diagnostics.legacyTerminalRenderer` |
| Copy / Paste actions, "Bottom" follow button (M) | —                                                                       | `components/terminal-*`                       |
| Terminal profiles (host)                         | Name, Command, Arguments; reorder, edit, remove (confirm); empty state  | `settings.host.terminalProfiles`              |
| Terminal agent hooks (host)                      | off default; "installs hooks in your agent config files" (hardcoded EN) | `screens/settings/host-page.tsx`              |

### 5.6 Browser (D only)

- Back/Forward/Stop/Refresh, URL bar, dev tools, element selector → Annotate element (message + Attach) or Screenshot element; device size (Responsive + presets). Errors: failed to load, invalid URL, blocked protocol. Non-D: "Browser is desktop-only".
- Browser data: Clear cookies and site data (confirm). Browser tools for agents (host, off default, warning). Src: `workspace.browser`, `settings.general.browserData`, `screens/settings/browser-tools-config.ts`.

---

## 6. Changes, git, PR/MR, CI, release streams

### 6.1 Diff / changes

- Mode: Uncommitted / Committed (vs base); Unified / Side-by-side; Inline diff; Hide/show whitespace; Wrap/scroll long lines; expand/collapse all files/folders; refresh git + forge state; commits list ("{n} session commits"); empty/too-large/binary/not-a-repo states. Src: `workspace.git.diff`.
- Review comments: Add/Edit/Delete comment on lines → attaches to chat. Src: `review.comment`.

### 6.2 Git actions (primary + "More options")

Commit, Pull, Push, Pull and push, Create PR/MR, View PR/MR, Merge locally (variants: moved/reused/partial/conflict/failed), Update from {base}, Merge PR (squash/merge/rebase), Auto merge (squash/merge/rebase) enable/disable, Archive session. Every action has a disabled-reason tooltip (≈25 reasons: no remote, dirty, up to date, draft, conflicts, merge queue, forge not connected…). Src: `workspace.git.actions`.

### 6.3 Branch switcher

- Filter branches; uncommitted changes → Stash & Switch; restore stash prompt. Src: `branchSwitcher`.

### 6.4 PR/MR panel

- State Draft/Open/Merged/Closed; sections Checks, Pipeline, Reviews, Activity; approvals "{given} of {required}"; check statuses (Passed, Failed, Warning, Action required, Manual, Pending, Skipped, Cancelled); Resolved/Outdated threads; Open on {forge}. Forge setup prompts (install CLI / sign in). Device pref `pullRequestOpenLocation` default "explorer" (no UI found). Src: `workspace.git.pr`, `git/pull-request-panel/pane.tsx`.

### 6.5 CI

- GitHub Actions + Jenkins runs; filter "Show only {branch}" / every branch; runners busy/queued, hosted/self-hosted; Open run, Open logs, Add log to chat; empty/not-configured ("Add a ci.jenkins entry to frogg.json"). Src: `ciMonitor`.

### 6.6 Release streams (niche, dev-facing)

- Streams Development/Stable/Upstream beta/Upstream stable; flows promote / forward-port / merge upstream / contribute with copyable command; changes list filter All/Features/Fixes/Waiting + text search; setup prompt. Src: `releaseStreams`.

### 6.7 Host / project automation

| Option                                                           | Default      | Scope                  | Src                            |
| ---------------------------------------------------------------- | ------------ | ---------------------- | ------------------------------ |
| Archive merged PR sessions                                       | off          | host                   | `host-page.tsx` (hardcoded EN) |
| Resume after usage limits                                        | daemon value | host                   | same                           |
| Metadata generation model: Automatic / Manual (+model, fallback) | Automatic    | host                   | `settings.metadataGeneration`  |
| Metadata instructions: branch names, commit messages, PRs        | empty        | project (`frogg.json`) | `settings.project.metadata`    |

---

## 7. Providers, accounts, usage and quotas

### 7.1 Providers (host)

| Item                                                                              | Options                                                                                                                                  | Src                                        |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Provider list                                                                     | status Disabled/Loading/Error/Available/Not installed; Enable toggle; "{n} models"                                                       | `settings.providers`                       |
| Add provider (catalog)                                                            | search, Add, Installed, Install instructions                                                                                             | `providerCatalog`                          |
| Remove provider (confirm, deletes config.json entry)                              | —                                                                                                                                        | `settings.providers.remove`                |
| Models                                                                            | discovered + custom (Add model by ID, remove), search, refresh                                                                           | `settings.providers.models`                |
| Version                                                                           | Installed/latest, Update/Install, Update automatically, statuses (up to date, update available, not installed, managed outside, unknown) | `settings.providers.settingsModal.version` |
| Diagnostic                                                                        | run/copy/refresh                                                                                                                         | `settings.providers.diagnostic`            |
| Uninstall provider (danger zone)                                                  | —                                                                                                                                        | `settingsModal.uninstallTitle`             |
| Agent definitions (read-only list, user/project scope; Open in editor, Copy path) | —                                                                                                                                        | `settings.host.agentDefinitions`           |

### 7.2 Provider accounts (host, per provider)

| Item                                                              | Options                                                                                                         | Src                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Add account                                                       | Account name (slug, lowercase/digits/hyphens), config dir preview, Shared folders checkboxes                    | `settings.host.providerAccounts`                                   |
| Sign in / Sign in again                                           | opens a terminal running provider login (needs a session)                                                       | same + `settingsModal.account`                                     |
| Set as default                                                    | new agents start here                                                                                           | `settingsModal.account`                                            |
| New agent defaults                                                | Default model, Default thinking (Provider default)                                                              | same                                                               |
| Model access                                                      | All models / some / none; Allow all                                                                             | same                                                               |
| Account system prompt                                             | appended to every agent on account; max length                                                                  | same                                                               |
| Identity                                                          | Nickname, Color                                                                                                 | same                                                               |
| Move account                                                      | Export bundle (plaintext creds warning, Copy) / Import (paste JSON)                                             | `settingsModal.accounts`                                           |
| Sign out (confirm) / Delete account (confirm, removes config dir) | —                                                                                                               | same                                                               |
| Per-agent account                                                 | pill; locked once running; Transfer: Move to account (cost warning) or Clean cut to account, or switch provider | `agentControls.account.transfer`, `agentControls.cleanCutProvider` |

### 7.3 Usage

- Host page: plan usage per provider/account (windows, balances), Refresh. Strings hardcoded in `provider-usage/copy.ts`.
- Usage meters (device): Refresh on a timer (on), interval seconds (30; 0 = off), Refresh on hover (on), Refresh after a reply (on), Warning level % (65), Critical level % (90), Animate changes (on). Src: `settings.appearance.usage`, `provider-usage/meter-preferences.ts`.

### 7.4 Clean cut (host)

| Option                                | Values/default                                                  | Src                           |
| ------------------------------------- | --------------------------------------------------------------- | ----------------------------- |
| Cut before resuming after usage limit | bool                                                            | `settings.cleanCut.auto`      |
| Cut before resuming after a restart   | bool                                                            | same                          |
| Idle threshold                        | minutes 1–43,200; empty = provider cache TTL (1 h Claude/Codex) | `settings.cleanCut.threshold` |
| Summary model                         | Automatic (cheapest on same provider) or model                  | `.summaryModel`               |
| Per provider overrides                | threshold + summary model                                       | `.providers`                  |

---

## 8. Hosts, connection, pairing, devices, security

### 8.1 Host list / switcher

- Hosts menu: Your hosts (status dot), Add a host; badges Relay / Local / Remote SSH; host filter "All hosts"; Switch host search. Src: `sidebar.hostsMenu`, `settings.host.badges`.

### 8.2 Add connection methods

| Method               | Fields                                                                                                                                                          | Plat        | Src                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------- |
| Direct connection    | Host, Port, Password (opt), Use SSL; Advanced: Connection URI (host, host:port, http(s)/ws(s)/tcp)                                                              | all         | `pairing.direct`      |
| Remote SSH           | SSH config tab (pick host) / Manual (ssh:// target); Daemon port, Daemon password, SSH password + "Remember for this session"                                   | D           | `pairing.remoteSsh`   |
| Scan QR code         | camera permission                                                                                                                                               | M (not web) | `pairing.scan`        |
| Paste pairing link   | link `…/pair#offer=…`                                                                                                                                           | all         | `pairing.link`        |
| Deploy to host       | SSH config/Manual; Host, User, SSH port, Key file, Password, Private key, Passphrase, Daemon port; Connect through SSH tunnel (recommended) / Network; step log | D           | `pairing.deployHost`  |
| Enter a pairing code | Host address, 8-char code, Connect with TLS, Check this host (fingerprint)                                                                                      | all         | `deviceAccess.entry`  |
| Network scan         | "Servers on your network", Connect / Needs pairing / Update daemon, Scan again                                                                                  | D/M         | `pairing.networkScan` |
| Deep link host-add   | "Add a host" auto flow                                                                                                                                          | all         | `hostAdd`             |

### 8.3 Pair / claim confirmation

- Fields: Address, Name, Host key fingerprint, Link expires, This device's role, Server ID. Verify states: pending/verified/unreachable/refused (fingerprint mismatch, proof invalid, key changed). Actions Pair / Claim this host (owner warning) / Cancel. Auto-pair for local machine. Expired/invalid link states. Manual endpoint fallback "Try address". Src: `pairConfirm`, `pairing.claim`.

### 8.4 Pair a device (offer side)

- QR + link with security warning; relay not enabled → "Enable relay?" (Enable relay / Not now / How relay works); relay endpoint missing. Src: `pairing.device`.
- Pairing code card: Role for new device (owner warning), Generate / Generate new, expiry, fingerprint, Copy code/link, Hide. Src: `deviceAccess.code`.

### 8.5 Devices (host)

- Your access (role), Your name (nickname), Connected now (clients, nicknames, where they are), Paired devices (rename, revoke, change role, last seen), Waiting for approval (Approve as role / Deny, match code). Confirms: revoke, revoke self, last owner, self-demote. Src: `deviceAccess`.

### 8.6 Security (host)

- Findings (Critical/Warning): unclaimed, exposed without password, trusts LAN, bind wider than loopback, claim mode off, unknown. Fixes: Pair a device, Set password (≥8 chars, confirm), Stop trusting the local network, Turn on claim mode, Open devices, This is intended / Warn me again; bind instructions text. Src: `settings.host.security`.
- Relay endpoint: host:port, Use TLS; may be overridden by env. Src: `settings.host.relayEndpoint`.

### 8.7 Host overview

- Rename host (label), Color (Default + 10), Sidebar badge (Name / Icon only / Hidden), connection list with latency + Remove connection, connection errors (SSH tunnel failed, credential rejected → Pair again, pairing required, identity mismatch), daemon conflict (Shut down other daemon), Remove host / Remove localhost (danger). Src: `settings.host.appearance`, `.connections`, `.connectionErrors`, `.daemonConflict`, `.daemon.remove`.

### 8.8 Connection notices

- Lost connection, Reconnecting · offline for {d}, Reconnected; host offline/unreachable states; App/daemon version mismatch warning. Src: `agentPanel.connectionNotice`, `desktop.daemon.versionMismatch`.

### 8.9 Web client (host; hidden in the browser app itself)

- Running/Stopped port, Start with the daemon (may be pinned), Interface: This machine only / All interfaces. Src: `settings.host.webClient`.

---

## 9. Voice, Companion and spoken alerts

| Setting                                | Default                                                                         | Scope                   | Src                              |
| -------------------------------------- | ------------------------------------------------------------------------------- | ----------------------- | -------------------------------- |
| Enable Companion (preview)             | off                                                                             | device                  | `companion.settings.enabled`     |
| Codex voice (preview)                  | off                                                                             | device                  | `.nativeVoice`                   |
| Animate voice graphics                 | on                                                                              | device                  | `.animated`                      |
| Show reply text                        | on                                                                              | device                  | `.replyText`                     |
| Conversation model                     | Default ({model}) / list                                                        | host (`companionModel`) | `.model`                         |
| Reply length                           | Brief\* / Detailed                                                              | device                  | `companion.behavior`             |
| Spoken task updates                    | Completions and failures\* / Completions only / Off                             | device                  | same                             |
| Acknowledge tasks before working       | off                                                                             | device                  | same                             |
| Audio mode                             | Call\* / Media                                                                  | device                  | same                             |
| Voice speed                            | 1.3                                                                             | device                  | same                             |
| Pause before replying                  | Quick 0.8 s / Natural 1.4 s\* / Relaxed 2.4 s                                   | device                  | same                             |
| Let me interrupt by speaking           | on; Interrupt after Instantly 0.1 s\* (120 ms) / Short 0.3 s / Deliberate 0.6 s | device                  | same                             |
| Auto-play spoken alerts                | on M, off D/W                                                                   | device                  | `settings.voiceAlerts.autoPlay`  |
| Confirm voice replies (2 s transcript) | on                                                                              | device                  | `.replyConfirm`                  |
| Test audio                             | Play test                                                                       | device                  | `settings.diagnostics.testAudio` |

- Companion surface: states Idle/Listening/Thinking/Speaking, Mute/Unmute/End/Minimize/Open conversation, type instead of speaking, topics strip, setup status (Disabled/Setup required/Ready/Active, subscription vs API billing note), failure reasons (backend missing, busy on another device, speech unavailable…). Src: `companion`.
- Spoken alert banner/toast: Play, Stop, Reply by voice, Dismiss, Open {agent}; voice reply sheet (Listening, Transcribing, Allow/Deny/Send as message, Keep listening). Src: `spokenAlerts`.
- Realtime voice overlay: mute/unmute/stop. Src: `realtimeVoice`.

---

## 10. Notifications

| Type                                | Trigger                                                                                                              | Delivery                                          | Src                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Agent finished                      | turn end                                                                                                             | desktop OS, Android push, in-app, optional spoken | `packages/protocol/src/agent-attention-notification.ts`   |
| Agent error                         | error                                                                                                                | same                                              | same                                                      |
| Permission / question / plan review | needs decision                                                                                                       | same; spoken text varies                          | `packages/server/src/server/notifications/spoken-text.ts` |
| Storage growing / very large        | storage alert thresholds                                                                                             | notification + banner                             | `settings.host.resources.alerts`                          |
| Update available / ready            | app/daemon updates                                                                                                   | callouts                                          | `desktop.updates.callout`, `mobile.updates.callout`       |
| Plugin notify                       | plugin `ui.notify(level)`                                                                                            | toast                                             | `packages/plugin-api/index.d.ts`                          |
| Toasts                              | copy confirmations, git action results, archive/hide failures, reload agent, download complete/failed, to-do actions | in-app                                            | various                                                   |

- Notification settings (D only): permission status + Refresh, Play sound (on), Test notification (Send). Src: `settings.notifications`.
- No notification history / inbox exists.

---

## 11. Plugins

| Surface         | Content                                                                                                                                                                                             | Src                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Plugins manager | tabs Installed / Browse / Repositories (+ Local plugins developer view); target "Install on": This client / Host                                                                                    | `resources/plugins.ts`                      |
| Installed row   | status Active/Disabled/Error/Incompatible/Blocked/Inactive; tier Official/Brand/User/Local; Enable toggle; Update to v; Settings; Unlink; Uninstall (confirm)                                       | same                                        |
| Browse          | search, categories, Install, "Needs client component", incompatible                                                                                                                                 | same                                        |
| Consent         | capability list (13: network, workspace files, spawn, agent read/write, settings, UI contribute, rpc, views, mic, audio, composer, speech); not-sandboxed warning (host plugins); user-repo warning | same                                        |
| Repositories    | Add (Index URL, Name, Public key; TOFU pin), Remove                                                                                                                                                 | same                                        |
| Local plugins   | Add local folder (path); beta daemon only; client: link folder (D)                                                                                                                                  | same                                        |
| Plugin settings | fields string/secret/number/boolean/select with defaults, required                                                                                                                                  | `packages/protocol/src/plugins/manifest.ts` |
| Contributions   | commands (≤50, command center "Plugins"), sessionActions (≤20), panels (≤20; list/markdown/form), views (≤20; sandboxed iframe, D/W), composerActions (≤10), settings (≤100)                        | same                                        |
| Brand policy    | enabled, officialRepo, allowUserRepos, developerMode, allow/deny, preinstalled, autoUpdate off/brand-repos/all                                                                                      | `packages/branding/src/schema.ts`           |

---

## 12. Appearance and display (device)

| Option                                      | Values / default                                                                                                                                                                                                                                                                                                        | Src                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Theme                                       | Light, Dark, Zinc, Midnight, Claude, Ghostty, Pure black, **System**                                                                                                                                                                                                                                                    | `settings.appearance.theme`                                  |
| Interface font / size                       | family (empty = system); size 10–21 (14 or 15 by platform)                                                                                                                                                                                                                                                              | `.fonts`                                                     |
| Content size                                | 10–21 (15/16)                                                                                                                                                                                                                                                                                                           | same                                                         |
| Code font / size                            | family; 9–22 (12)                                                                                                                                                                                                                                                                                                       | same                                                         |
| Syntax highlight theme                      | GitHub, Catppuccin, Dracula, Tokyo Night, **One**, Nord, Gruvbox, Solarized; live preview                                                                                                                                                                                                                               | `packages/highlight/src/themes.ts`                           |
| Reduce motion                               | off (ignores OS)                                                                                                                                                                                                                                                                                                        | `.motion`                                                    |
| Chat outline                                | on                                                                                                                                                                                                                                                                                                                      | `.chatOutline`                                               |
| Sidebar nav items                           | Home, Search, History, Companion; reorder + show/hide                                                                                                                                                                                                                                                                   | `sidebar-nav/model.ts`                                       |
| Sidebar display menu                        | Grouping Project/Status/Labels; Sort Recent activity/Date created/Name/Needs attention first/Manual + Reverse; Title: Title*/Branch name; Show: Branch, Project, Host*, Pull request*, Checks, Services*, Labels*, Account*, Diff stats, Last activity; Checks: Icon and text\*/Icon only/Hidden; filters Host, Project | `sidebar.display`, `components/sidebar/display-preferences/` |
| Language                                    | System\* + 9 locales                                                                                                                                                                                                                                                                                                    | `settings.general.language`                                  |
| Show hidden folders in folder pickers       | off                                                                                                                                                                                                                                                                                                                     | `settings.general.hiddenFolders`                             |
| Detail level (title only, no options found) | —                                                                                                                                                                                                                                                                                                                       | `settings.appearance.detailLevel`                            |

---

## 13. Keyboard shortcuts

Rebindable (Bind / Rebind / Clear / Reset / Reset all; "Press shortcut..."); desktop/web only. Mod = Cmd (mac) / Ctrl. Web build uses Alt variants where browsers reserve Ctrl.

| Action                              | Default                                                                                                                      | Section             | Note                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------- |
| Command center                      | Mod+K                                                                                                                        | General             |                                     |
| Search files                        | Mod+P                                                                                                                        | General             |                                     |
| Show shortcuts                      | ?                                                                                                                            | General             | not in text field                   |
| Settings                            | Mod+,                                                                                                                        | General             |                                     |
| Cycle theme                         | Mod+Alt+T                                                                                                                    | General             |                                     |
| New agent (labelled "Open project") | Mod+O                                                                                                                        | Projects & Sessions | label mismatch                      |
| Add host                            | Ctrl+H                                                                                                                       | same                |                                     |
| New session                         | Mod+N                                                                                                                        | same                |                                     |
| Jump to session 1–9                 | Mod+1–9 (web Alt)                                                                                                            | same                |                                     |
| Prev / next session                 | Mod+[ / Mod+] (web Alt)                                                                                                      | same                |                                     |
| Pin session                         | Mod+Shift+P                                                                                                                  | same                |                                     |
| New tab                             | Mod+T                                                                                                                        | Tabs & Panes        |                                     |
| New agent tab                       | Mod+Shift+A                                                                                                                  | same                |                                     |
| New terminal                        | Mod+Shift+T                                                                                                                  | same                |                                     |
| New browser                         | Mod+Shift+B                                                                                                                  | same                |                                     |
| Changes                             | Mod+Shift+G                                                                                                                  | same                |                                     |
| Files                               | Mod+Shift+E                                                                                                                  | same                |                                     |
| Close tab                           | Mod+W (web Alt+Shift+W)                                                                                                      | same                |                                     |
| Jump to tab 1–9                     | Cmd+Alt+1–9 mac / Alt+1–9 / web Alt+Shift                                                                                    | same                |                                     |
| Prev / next tab                     | Alt+Shift+[ / ]                                                                                                              | same                |                                     |
| Split right / down                  | Cmd+\ / Cmd+Shift+\                                                                                                          | same                | mac only                            |
| Focus pane ←→↑↓                     | Cmd+Shift+Arrows                                                                                                             | same                | mac only                            |
| Move tab ←→↑↓                       | Cmd+Alt+Shift+Arrows                                                                                                         | same                | mac only                            |
| Close pane                          | Cmd+Shift+W                                                                                                                  | same                | mac only                            |
| Companion                           | Mod+Shift+K                                                                                                                  | Layout              |                                     |
| Left sidebar / Explorer / both      | Mod+B / Mod+E / Mod+.                                                                                                        | Layout              |                                     |
| Focus mode                          | Mod+Shift+F                                                                                                                  | Layout              |                                     |
| Focus message input                 | Mod+L                                                                                                                        | Agent Input         |                                     |
| Cycle agent mode                    | Shift+Tab                                                                                                                    | Agent Input         | in composer                         |
| Voice mode                          | Mod+Shift+D                                                                                                                  | Agent Input         |                                     |
| Dictation                           | Mod+D                                                                                                                        | Agent Input         |                                     |
| Interrupt                           | Esc                                                                                                                          | Agent Input         |                                     |
| Mute voice                          | Space                                                                                                                        | Agent Input         | outside text                        |
| Desktop menu                        | New Window Mod+Shift+N, Zoom In/Out/Actual Size Mod+= / - / 0, Reload Mod+R, Force Reload Mod+Shift+R, DevTools, Full screen | —                   | `apps/desktop/src/features/menu.ts` |

Src: `apps/ui/src/keyboard/keyboard-shortcuts.ts`, `settings.shortcuts`.

---

## 14. Command center

- Placeholder "Search commands, files, sessions, and agents..."; sections Actions, Keyboard shortcuts, Files, Sessions, Agents, Plugins, Labels.
- Actions: New agent, Add project, Home, Group by project/status, Open {panel} (side/focused pane), tab/pane commands (prev/next/close/rename/reload/copy resume/copy path/close left/right/others, split, focus, move), agent control groups Model/Thinking/Mode/Plan mode/Fast (On/Off). Src: `shell.commandCenter`, `apps/ui/src/command-center/`.

---

## 15. Projects, to-dos and project config

### 15.1 Project settings (`frogg.json`)

| Field                      | UI                                                                                                       | Src                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Worktree setup commands    | textarea                                                                                                 | `settings.project.worktree`                    |
| Worktree teardown commands | textarea                                                                                                 | same                                           |
| Default base branch        | text (placeholder repo default)                                                                          | same                                           |
| Scripts                    | Name, Command, Run as a service ($FROGG_PORT); add/edit/remove (confirm)                                 | `settings.project.scripts`                     |
| Metadata instructions      | branch names, commit messages, PRs                                                                       | `settings.project.metadata`                    |
| Not in UI                  | port ranges/portScript, terminals, ci (githubActions, jenkins url/job/multibranch), streams              | `packages/protocol/src/frogg-config-schema.ts` |
| Errors                     | parse failure, missing, transport, stale on disk (Reload), save failed, "Commit frogg.json changes" hint | `settings.project.readFailures/writeFailures`  |

### 15.2 Project to-dos

- List filter Open/All; group by category; status Backlog/Ready/Claimed/In progress/Review/Done/Blocked; priority Low/Medium/High/Urgent; Parallel; stale claim.
- Detail: description, plan (Markdown), progress log, claims; actions New, Edit, Edit plan, Release claims (confirm), Delete (confirm). Form: Title, Description, Category, Priority, Allow parallel claims. Src: `projectTodos`.

### 15.3 Add project / open project

- Tiles: Add a project, Import conversation, Setup providers, Pair device. Src: `openProject.tiles`.

---

## 16. Host agent orchestration (host)

| Option                                                                 | Default | Src                                        |
| ---------------------------------------------------------------------- | ------- | ------------------------------------------ |
| Enable {brand} tools (MCP inject: manage worktrees, agents, schedules) | daemon  | `settings.host.orchestration.enableTools`  |
| Browser tools for agents                                               | off     | `browser-tools-config.ts`                  |
| Append system prompt (all agents)                                      | ""      | `settings.host.orchestration.systemPrompt` |
| {brand} skills: per-skill toggle + view (Claude/Codex)                 | on      | `settings.host.skills`                     |

---

## 17. Updates, about, diagnostics, developer

### 17.1 App updates

| Platform        | Options                                                                                                                                                                     | Src                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| D               | Check automatically (every 6 h, on), Check for updates, What's new, Download & install (per-installer hint), CI build progress, Restart required; callout Install & restart | `desktop.updates`               |
| M (Android)     | Check automatically on start (on), Download & install, signature mismatch, unknown-apps permission                                                                          | `mobile.updates`                |
| D macOS         | Rosetta warning → Download Apple Silicon build                                                                                                                              | `desktop.rosetta`               |
| Release channel | Stable / Beta (separate side-by-side app)                                                                                                                                   | `settings.about.releaseChannel` |

### 17.2 Daemon management

- Built-in daemon (D): status/PID, Manage built-in daemon (pause confirm), Keep running after quit (off), Log file (Open/Copy path), Full status, Install local daemon bundle (download progress), Advanced settings. Src: `desktop.daemon`.
- Restart daemon; Update daemon (desktop-managed hint); Daemon self-update (check, update, progress phases, outcome applied/rolled back, Update automatically daily when idle). Config `autoUpdate`: enabled, channel stable/beta, checkIntervalHours, quietHours. Src: `settings.host.daemon`.
- SSH deploy (D, SSH hosts): probe (platform, service manager, Docker), Method Native/Docker, Listen address (0.0.0.0), Version; Deploy/Upgrade/Reinstall/Uninstall (confirm). Src: `settings.host.sshDeploy`.

### 17.3 Resources (host)

- CPU, memory, disk, uptime, daemon process; owned storage by category (Logs, Agent state, Projects, Worktrees, Agent worktrees, Provider accounts, Uploads, Import staging, Speech cache, Models, Daemon versions, Temp) with Clean (confirm).
- Storage alerts: enabled (on), Warning 20 GiB, Critical 50 GiB, Notify only at critical (off; `notifyAt`). Owner only. Src: `settings.host.resources`.

### 17.4 About / diagnostics / developer

- About: app version, This device, Connected hosts (version differs → Update), attribution, Developer options toggle (off).
- App diagnostic: Run, copy, refresh (client/desktop/daemon/provider/log). Startup error screen with daemon logs. Root error boundary (Try again, Details).
- Developer section: channels Stable/Beta/Development; Beta app install/open; Beta daemon per host install/uninstall (+purge data), start/stop; Development daemon launch per checkout; Dev bar (Launch dev build, Rebuild and restart, Restart web with clear cache, Open, Stop, behind-main count). Src: `settings.about`, `settings.diagnostics`, `settings.developer`, `devBar`.

---

## 18. Onboarding and entry

| Surface                  | Content                                                                                                                     | Src                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Welcome                  | "Welcome to {brand}"; Run agents on this machine (installs ~180 MB daemon / starts installed) ; Use a remote host; Settings | `onboarding`                              |
| Startup splash / error   | local server failed + logs                                                                                                  | `startup`                                 |
| Open project home        | 4 tiles (§15.3)                                                                                                             | `openProject`                             |
| Pair offer / scan routes | §8                                                                                                                          | `app/pair-offer.tsx`, `app/pair-scan.tsx` |
| Empty projects           | "No projects yet / Add a project to get started"                                                                            | `sidebar.project.empty`                   |
| Quitting overlay (D)     | "Stopping the local daemon."                                                                                                | `desktop.quitting`                        |
| CLI `onboard`            | headless equivalent                                                                                                         | `apps/cli/src/commands/onboard.ts`        |

---

## 19. Empty, error and unavailable states (catalogue)

- Generic: No results, No options match, Daemon unavailable/disconnected, Host not connected, Update the host to…, Connect to this host to manage…
- Agent: not found, failed to load, history load failed, unknown host (add host).
- Sessions: none / none for project / no match / filters empty (Clear filters).
- Files: no files, no visible files, too large, binary, preview unavailable, directory missing.
- Diff: no changes, too large, not a repo, no commits ahead.
- PR: no PR yet, activity/status load failed. CI: none configured, no runs, update daemon.
- Providers: none available, no model, defaults loading. Models: none detected.
- Plugins: none installed/available, panel invalid, view needs client.
- To-dos: empty, filtered empty, offline stale, unsupported.
- Devices: none paired, no requests, stale snapshot.
- Terminal: host disconnected, update host, subscribe failed, "Workspace directory not found." (hardcoded).
- Sessions screen: "Unable to load sessions" (hardcoded).

## 20. Destructive confirmations (catalogue)

Archive session (with uncommitted/unpushed summary); Archive running agent; bulk close tabs; Close terminal; Close unsaved tab; Hide session; Remove project; Delete file/folder; Discard file changes; Reload file from disk; Rewind (no confirm, "cannot be undone"); Delete label; Delete/Release to-do; Remove provider; Uninstall provider; Sign out account; Delete account; Remove terminal profile; Remove script; Revoke device / self / last owner; Change role (last owner, self-demote); Remove connection; Remove host / localhost (stops daemon); Pause built-in daemon; Shut down conflicting daemon; Uninstall daemon (SSH); Uninstall beta daemon (+purge); Stop beta daemon (self); Clean storage category; Clear browser data; Uninstall plugin; Cancel auto-resume; Install desktop update; Stash & switch branch.

---

## 21. Config surfaces with no or partial UI

| Key                                                                                                                                                                                             | Where                   | UI?                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------- |
| `mcp.injectIntoAgents`                                                                                                                                                                          | config.json             | yes (Enable tools)  |
| `hostnames`, `cors.allowedOrigins`, `trustedProxies`, `git.maxProcesses*`, `app.baseUrl`, `catalogRefreshTimeoutMs`                                                                             | config.json             | no                  |
| `hostSettings.hiddenSections` (projects, pair-device, devices, agents, providers, usage, skills, terminals, host, resources)                                                                    | config.json / brand     | no (admin)          |
| `autoUpdate.channel/checkIntervalHours/quietHours`                                                                                                                                              | config.json             | only enabled toggle |
| brand.json: identity, ports, updates mode, pairing autoConfirmLocal, start dir, network bind/claimMode/trustLan/claimScope, provider allow/models, mobile.enabled, plugin policy, beta channel  | build-time              | no                  |
| Device: `vimKeybindings`, `openInSidePane.*`, `pullRequestOpenLocation`, `mobileUpdateChannel`                                                                                                  | client storage          | none found          |
| CLI-only groups: `hub` (Hub), `trigger` (all subcommands disabled), `daemon set-password/trust-lan/claim-mode/listen-target`, `agent wait/logs/inspect`, `terminal capture/send-keys`, `script` | `apps/cli/src/commands` | partial             |

---

## 22. Tool surfaces (rail candidates)

Every tool-like capability that could stand as its own panel. Scope: G = global (all hosts), H = per host, P = per project, S = per session.

| Tool                                                 | Shows                                                       | Actions / options                  | Scope                                   | Plat                     | Src                                             |
| ---------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- | --------------------------------------- | ------------------------ | ----------------------------------------------- |
| Sessions / workspaces list                           | sessions grouped by project/status/labels with row metadata | §1.4, display menu §12             | G (multi-host)                          | all                      | `components/sidebar-workspace-list.tsx`         |
| Chats                                                | project-less chats by date                                  | New, search, delete                | H                                       | all                      | `sidebar.chats`                                 |
| History                                              | archived + past sessions across hosts                       | search, restore, load more         | G / P                                   | all                      | `screens/sessions-screen.tsx`                   |
| Search / command center                              | commands, files, sessions, agents, plugin commands          | §14                                | G + S                                   | D/W (M partial)          | `command-center/`                               |
| Files                                                | session file tree                                           | §5.3                               | S                                       | all (edit D/W)           | `panels/files-panel.tsx`                        |
| Changes / review                                     | working + commit diffs, review comments                     | §6.1                               | S                                       | all                      | `panels/changes`, `panels/diff-panel.tsx`       |
| Source control (git actions, branch, commits)        | branch, ahead/behind, commits                               | §6.2–6.3                           | S                                       | all                      | `git/`                                          |
| Pull request                                         | PR/MR state, checks, reviews, activity                      | §6.4                               | S                                       | all                      | `panels/pull-request-panel.tsx`                 |
| CI                                                   | runs, runners, logs                                         | §6.5                               | P (branch filter)                       | all                      | `ci-monitor/`                                   |
| Release streams                                      | stream graph, waiting changes                               | §6.6                               | P                                       | all                      | `release-streams/`                              |
| Terminals                                            | session terminals, profiles                                 | §5.5                               | S (profiles H)                          | all                      | `panels/terminal-panel.tsx`                     |
| Scripts / services                                   | per-session scripts, ports, URLs                            | §5.4                               | S (defs P)                              | all                      | `workspace.scripts`                             |
| Setup log                                            | worktree setup output                                       | view                               | S                                       | all                      | `panels/setup-panel.tsx`                        |
| Browser                                              | embedded web pages, element annotate                        | §5.6                               | S                                       | D                        | `workspace.browser`                             |
| Project to-dos                                       | to-do board with claims                                     | §15.2                              | P                                       | all                      | `project-todos/`                                |
| Agent task list (todo/plan)                          | agent's own tasks, proposed plan                            | view                               | agent                                   | all                      | `message.todo`, `components/plan-card.tsx`      |
| Subagents                                            | child agents, status counts                                 | detach, archive, open              | agent                                   | all                      | `panels/agent-tracks.tsx`, `subagents`          |
| Hosts                                                | host status, connections, devices, security dot             | §8                                 | G                                       | all                      | `components/hosts/`                             |
| Devices & presence                                   | who is connected, approvals                                 | §8.5                               | H                                       | all                      | `device-access/`, `presence/`                   |
| Usage / quotas                                       | plan windows per account, context meter                     | refresh, thresholds                | H (+agent)                              | all                      | `provider-usage/`                               |
| Providers & accounts                                 | providers, accounts, models                                 | §7                                 | H                                       | all                      | `screens/settings/provider-settings-modal`      |
| Resources / storage                                  | load, storage, cleanup, alerts                              | §17.3                              | H                                       | all                      | `host-resources-section.tsx`                    |
| Notifications / inbox                                | — (only transient toasts, banners, OS notifications)        | missing                            | —                                       | —                        | §10                                             |
| Companion                                            | voice conversation, topics                                  | §9                                 | H (device opt-in)                       | all                      | `companion/`                                    |
| Plugins manager                                      | installed/browse/repos                                      | §11                                | H + device                              | all (client plugins D/W) | `plugins/plugins-modal.tsx`                     |
| Plugin panels                                        | list / markdown / form content from host plugins            | item actions, form submit, refresh | S tab (main or explorer)                | all                      | `plugins/plugin-panel.tsx`, `panel-content.tsx` |
| Plugin views                                         | sandboxed custom UI                                         | plugin-defined                     | S tab / route `h/[serverId]/plugin/...` | D/W                      | `plugins/view-frame.tsx`                        |
| Plugin commands / session actions / composer actions | contributed entries                                         | run                                | S / G                                   | all                      | `plugins/*-button.tsx`                          |
| Agent definitions                                    | provider agents on disk                                     | open, copy path                    | H / P                                   | all                      | `agent-definitions/`                            |
| Skills                                               | built-in {brand} skills                                     | toggle, view                       | H                                       | all                      | `skills-section.tsx`                            |
| Diagnostics                                          | app/provider diagnostics, logs                              | run, copy                          | G / H                                   | all                      | `app-diagnostic-sheet.tsx`                      |
| Dev builds (developer)                               | dev daemon/web per checkout                                 | launch, rebuild, stop              | H                                       | D                        | `components/dev-builds`, `devBar`               |

---

## Observations

1. **Hardcoded English** in localised UI: host "Sessions" cards (Archive merged PR sessions, Resume after usage limits), "Enable terminal agent hooks", Browser tools card, all `provider-usage/copy.ts`, PR panel "Activity/Resolved/Outdated/No activity yet", sidebar "Display preferences", "Filter by host/provider", terminal Copy/Paste, "Unable to load sessions", "Workspace directory not found.", desktop native menu/dialogs (`apps/desktop/src/features/menu.ts`, `dialogs.ts`).
2. **Session vs workspace naming drift**: UI says "session" but strings still say workspace ("Hide workspace", "Workspace hidden from your sidebar", "Archive merged PR workspaces" a11y label, "Workspace directory not found."), and the shortcut section title in code is "Projects & Workspaces" while the locale says "Projects & Sessions".
3. **Shortcut label mismatch**: the `new-agent` binding (Mod+O) is labelled "Open project"; `new-worktree` shortcut is looked up in the sidebar but has no binding; locale keys `newWorktree`, `archiveWorkspace`, `sendMessage`, `queueMessage`, `switchProject` have no live bindings. Split/focus/move-pane shortcuts exist only on mac.
4. **Settings with no UI**: `vimKeybindings`, `openInSidePane.*` (5 flags), `pullRequestOpenLocation`, `mobileUpdateChannel` are stored and read but no control sets them; `settings.appearance.detailLevel` has a title string but no options.
5. **Built-in daemon default conflict**: renderer `manageBuiltInDaemon` defaults true, desktop shell `desktop-settings.ts` defaults false.
6. **Two daemon-update mechanisms** on the same Updates page (Update daemon card vs Daemon self-update with its own auto-update), plus SSH deploy Upgrade, plus Developer beta daemon install: four overlapping "update/install daemon" paths.
7. **Hidden-sections enum lags the section list**: `HostSettingsSectionSchema` cannot hide security, web-client, updates, automation or developer; still carries retired `usage` and `pair-device` (folded into Providers/Devices).
8. **Half-built / disabled**: CLI `trigger` (every subcommand disabled), `hub` CLI with no UI; Companion and Codex voice flagged preview; release streams and dev bar are developer-only but sit beside product surfaces.
9. **No notification inbox**: finished/error/permission/storage/plugin notifications are only transient (OS, toast, banner, spoken); no history or unread state, despite the rail plan listing one.
10. **Platform gaps that change IA**: shortcuts, notifications and permissions settings are desktop-only; browser tab desktop-only; client plugins and views D/W only; QR scan not on web; Remote SSH and Deploy D only; source editing D/W only; scrollback and font settings apply everywhere. Usage settings are split between device (meter refresh/thresholds under Appearance) and host (plan usage under Providers).
11. Duplicate pairing content: pairing link/QR (`pairing.device`), pairing code (`deviceAccess.code`), code entry, claim, deploy-pair and auto-pair are six overlapping flows with separate copy.
12. Permission mode labels vary by provider in casing and meaning ("Always Ask" vs "Default Permissions" vs "Agent"; "Bypass" vs "Full Access" vs "Allow All"), with no shared vocabulary for unattended modes.
