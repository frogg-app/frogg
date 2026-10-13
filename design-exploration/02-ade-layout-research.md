# 02 — ADE / IDE layout research for the Frogg redesign

Scope: how agentic development environments lay out chat, sessions, review, terminal and status, so that Frogg (chat-first, many parallel sessions/worktrees, desktop + mobile + web) can adopt familiar conventions and pick a layout archetype.

Confidence key: **[S]** = stated in cited source; **[O]** = observed/common knowledge of the product, not re-verified for this doc; verify before relying on detail.

---

## 1. Per-product survey

### Cursor (2.x, Agents window)

- **Skeleton:** two modes. _Agents_ layout: agent list sidebar, central prompt/chat, right-hand inspection panel (diff/files/browser). _Editor_ layout: classic VS Code, file tree left, chat panel right. Toggle via "Agents" button top-left [S: changelog, learncursor].
- **Sessions:** each agent is a list item with status (running / done / waiting) and progress; up to 8 in parallel, isolated via git worktrees or remote machines; multi-repo workspaces in one window [S].
- **Review:** per-agent diff in right panel; "review all changes" multi-file view; cloud agents hand off as PRs [S/O].
- **Terminal:** standard integrated terminal; agent runs commands inline in chat with approve/skip [O].
- **Palette:** Cmd+Shift+P (VS Code), Cmd+K inline edit, Cmd+L/I chat [O].
- **Praise:** parallel agents + worktrees without setup; best-of-N comparisons.
- **Complaints:** confusing duplicated labels ("Agents, Search Agents, New Agent, Agent, New Agent"); sidebar flips sides between modes; three names for the same mode toggle; ongoing layout megathread [S: forum].
- **Mobile:** web/Slack launch of background agents; no full native client [O].
- **Lesson:** a mode switch that moves chrome around is disorienting. Keep the session list in one fixed place.

### Windsurf → Devin Desktop (Cascade + Agent Command Center)

- **Skeleton:** VS Code fork; Cascade chat in a right panel. Since the 2026 rebrand the default surface is the **Agent Command Center**: a Kanban of local + cloud sessions; the editor is one click deeper [S: aicoderscope].
- **Sessions:** multiple Cascade sessions as panes/tabs; "rounded pill session tabs with state/PR icons"; **Spaces** group sessions, PRs, touched files and persistent context per task [S: changelog].
- **Review:** inline diffs with accept/reject per hunk; browser preview pane beside the agent, captured elements/console land in the composer as pending context [S].
- **Praise:** fleet visibility for leads; preview-to-context loop.
- **Complaints:** solo devs found Kanban-first "unnecessary complexity"; adjustment cost for editor-first users [S].
- **Lesson:** Kanban is a great _overview_, a poor _home_ for a single active conversation.

### Zed (Agent Panel)

- **Skeleton:** dockable agent panel (default right) + a **threads sidebar** with configurable width; editor centre [S: docs].
- **Sessions:** threads; Cmd+N new thread; agent selector (Zed agent or external ACP agents: Claude Code, Codex, Gemini) [S]. Zed now markets "parallel agents" [S].
- **Review:** accordion above the composer summarises edited files/line counts; **Review Changes** opens a multibuffer with all hunks, keep/reject per hunk [S]. This is the best-in-class compact "what changed" pattern.
- **Palette:** Cmd+Shift+P; everything keyboard-reachable [O].
- **Praise:** speed, the multibuffer review, ACP openness. **Complaints:** review multibuffer hangs/bugs, single-file review overriding git diff (now off by default) [S: issues].
- **Mobile:** none.
- **Lesson:** a _changed-files strip pinned above the composer_ is a cheap, familiar entry point to review.

### VS Code + Copilot agent mode

- **Skeleton:** Chat view in secondary sidebar (right); **Agent Sessions** sidebar in activity bar; newer standalone **Agents window** with sessions grouped by workspace [S: code.visualstudio.com].
- **Sessions:** list shows name, last-active timestamp, and an **unreviewed file-change count** that clears on accept/undo [S]. Local, background (CLI) and cloud (Copilot coding agent → PR) sessions in one list [S].
- **Review:** inline diff decorations with Keep/Undo per file and hunk; cloud sessions review as PRs [O].
- **Praise:** "mission control" for local+cloud; familiarity. **Complaints:** proliferation of chat entry points and modes [O].
- **Lesson:** an _unreviewed-changes badge_ on each session row is a strong, low-noise status signal.

### JetBrains (Junie / AI Assistant)

- **Skeleton:** Junie is a tool window docked right; AI Assistant chat separate tool window [S: junie docs]. GA rebuilt on ACP [S].
- **Sessions:** task history inside tool window; plan/steps view showing what Junie intends then does [O].
- **Review:** changes land in IDE's standard diff/VCS tooling [O].
- **Complaints:** tool window discoverability ("cannot see Junie in sidebar"), quota visibility requests [S: YouTrack].
- **Mobile:** none.
- **Lesson:** don't hide the agent inside generic chrome; quota/usage should be visible in-surface.

### Claude Code desktop / web

- **Skeleton (desktop, April 2026 redesign):** left **sessions sidebar** (filter by status/project/environment, group by project); centre chat; **drag-and-drop panes** for terminal, file editor, diff viewer, preview (HTML/PDF/local servers); multiple sessions side by side in one window [S: docs, MacRumors].
- **Sessions:** each session = own history + folder, optional worktree under `.claude/worktrees/` [S].
- **Review:** rebuilt diff viewer for large changesets, **inline comments that feed back to the agent** [S].
- **Web:** cloud sessions with repo picker, list on left, chat centre, diff/PR on completion [O].
- **Mobile:** Claude app Code tab; **Remote Control** drives a local CLI session from the phone: send prompts, watch output, approve permissions, push on "actions required" or task done [S: remote-control docs].
- **Lesson:** this is the closest analogue to Frogg; its "approve from phone + push when blocked" loop is the mobile story users now expect.

### Codex app / web

- **Skeleton:** desktop app (Feb 2026, folded into ChatGPT desktop July 2026): left sidebar of projects → threads; centre thread; diff review pane; worktree per agent [S: Wikipedia, intuitionlabs].
- **Sessions:** threads with pinning and ordering; subagent/task/worktree progress surfaced inline [S: changelog].
- **Web:** task list home ("what are we coding next?" composer on top, tasks below with status and +/− line counts); open a task → logs + diff → Create PR [O].
- **Mobile:** Codex in ChatGPT iOS/Android: start tasks, review diffs, open PRs [O].
- **Lesson:** "composer on top, task list beneath" is an efficient web/mobile home.

### Conductor

- **Skeleton:** three panels: left workspaces (one per worktree/branch, grouped by repo), middle chat (Claude Code/Codex, @file, slash commands), right diff/files/terminal [S].
- **Sessions:** each workspace row shows branch, status (working / needs input / done) and diff stats; create workspace = new worktree [S/O].
- **Review:** diff-first; create PR / merge from UI [S].
- **Praise:** "beautiful UI", handles worktrees for you; sweet spot 3–8 parallel features [S]. **Complaints:** Mac-only, local-only [S].
- **Lesson:** the 3-pane _workspace list / chat / changes_ layout is the de-facto standard for multi-agent desktop apps.

### Devin (web)

- **Skeleton:** left session list; centre chat; right "Devin's workspace" with tabs for Shell, Browser, Editor, Planner [O].
- **Sessions:** list with status; sessions started from Slack/Linear appear too [O].
- **Review:** PR-centric; diff in GitHub plus in-app [O].
- **Complaints:** opaque long runs, cost [O].
- **Lesson:** a tabbed "agent's machine" pane is a clear way to show tools without crowding chat.

### Replit Agent

- **Skeleton:** chat/agent left, preview/workspace right with tool tabs (console, shell, DB, secrets) [S: Lovable/Bolt comparisons].
- **Mobile:** full native mobile app with agent; chat-first with preview toggle [O].
- **Lesson:** on mobile, chat and preview are a _toggle_, not a split.

### Lovable / Bolt / v0

- **Skeleton:** chat left, live preview right (code view toggle); Bolt mimics VS Code with code + preview [S].
- **Status:** version history / checkpoints in chat; restore points [O].
- **Lesson:** checkpoints-in-timeline and "Preview | Code" segmented control are now familiar to non-specialists.

### Warp (2.0 ADE)

- **Skeleton:** terminal tabs with agent conversations inline in blocks; **Agent Management Panel** lists all agents across tabs (running / waiting / finished) [S].
- **Status:** in-app + system notifications on complete or needs-help [S]. Interactive code review pane for agent diffs [S]. Hosts third-party harnesses (Claude Code, Codex, Droid, Amp...) [S].
- **Lesson:** a cross-tab "all agents" overlay complements tab-per-session.

### Amp

- **Skeleton:** CLI + editor extension; threads are durable, shareable, continuable on another device [S]. Agents panel shows concurrent threads [S]; Block built a local web thread manager for the same need [S].
- **Lesson:** even terminal-first tools grow a session dashboard once users run more than a couple of agents.

### Factory (Droids)

- **Skeleton:** desktop: sessions in a sidebar (filter/group/organise), conversation centre, artifacts (docs, diffs, live sites) open **beside** the session [S]. Web + mobile with live session URLs: teammates watch, comment, take over [S].
- **Lesson:** shareable session URLs and cross-device sync are table stakes for web/mobile.

### Terragon (shut down Feb 2026) and similar managers

- Web dashboard of background tasks in cloud sandboxes, each a branch → auto PR; accessible from any device [S]. Others in this niche: Crystal, Claude Squad, Vibe Kanban, CCC iOS app [S/O].
- **Lesson:** "task inbox → PR" is a valid model but users migrated to first-party tools; differentiate on UX, not orchestration alone.

### Non-IDE polish references

- **Linear:** dense, low-noise left sidebar; inbox with **split view** (notification list beside the item); Cmd+K everything; consistent header/actions; personalisable sidebar [S].
- **Raycast:** keyboard-first palette, sub-actions via Cmd+K inside results, crisp list rows with accessories (status, shortcut) [O].
- **Arc:** vertical sidebar of tabs/spaces, pinned vs ephemeral, split view, Cmd+T command bar, spaces colour-coded [O].
- **Lesson:** list rows with right-aligned accessories, split inbox, and one universal palette are what "polish" means to this audience.

---

## 2. Common conventions (users will find these familiar)

| Area              | Convention                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Session list      | Left sidebar, grouped by project/repo, rows show title + branch + status dot + diff stats (+N −M) / unreviewed count       |
| Status vocabulary | Running, Needs input / Waiting, Done / Ready to review, Error; "needs input" sorts or highlights first                     |
| Chat              | Centre column, max readable width, composer pinned bottom with model/agent picker, @-mentions, slash commands, attachments |
| Changes summary   | Collapsible "N files changed" strip above composer → opens full review                                                     |
| Review            | Multi-file diff with per-hunk keep/reject, inline comments sent back to agent, then commit / PR / merge                    |
| Tool output       | Collapsed tool-call cards in the timeline; expand for detail                                                               |
| Right pane        | Tabbed: Changes, Files, Terminal, Preview/Browser; dockable/resizable                                                      |
| Isolation         | One worktree/branch per session, created implicitly                                                                        |
| Notifications     | System notification + badge when blocked or done; mobile push for approvals                                                |
| Palette           | Cmd+K / Cmd+Shift+P universal palette; Cmd+N new session; Cmd+1..9 or Ctrl+Tab to switch sessions                          |
| Mobile            | Chat-first single column; list → detail navigation; approve/deny actions; diff readable but not primary                    |

---

## 3. Layout archetypes

### A. Three-pane workspace (Conductor / Claude Code desktop / Codex / Factory)

```
+-----------+---------------------------+----------------+
| Sessions  |  Chat timeline            | [Changes|Term| |
| ▸ repo-a  |                           |  Files|Preview]|
|  ● feat-x |  ...                      |                |
|  ◐ fix-y  |                           |  diff / term   |
| ▸ repo-b  |  [3 files changed ▾]      |                |
|  ✓ docs   |  [ composer ............] |                |
+-----------+---------------------------+----------------+
```

- - Most familiar; scales 1–15 sessions; right pane collapsible to pure chat.
- − Gets crowded on small laptops; overview of many sessions limited to list rows.

### B. Editor-centric with agent side panel (VS Code, Zed, JetBrains, classic Cursor/Windsurf)

```
+--+----------+--------------------------+-------------+
|Ac| Files    |  editor tabs             | Agent chat  |
|ti|          |                          | threads ▾   |
|vi|          |                          |             |
|ty|          +--------------------------+ [composer]  |
|  |          |  terminal                |             |
+--+----------+--------------------------+-------------+
```

- - Best for hands-on coding. − Chat is a sidecar; multi-session management bolted on. Wrong fit for chat-first.

### C. Kanban / mission control (Devin Agent Command Center, Vibe Kanban)

```
+----------------------------------------------------------+
| Needs input      | Running         | Review     | Done   |
| [card fix-y  !]  | [card feat-x ●] | [docs +40] | [...]  |
| [card api    !]  | [card ui    ●]  |            |        |
+----------------------------------------------------------+
        click card → full-screen session (archetype A)
```

- - Great fleet overview at 10+ agents. − Extra click to reach a conversation; solo users find it heavy [S].

### D. Inbox / split list (Linear inbox, Codex web, Terragon)

```
+------------------------------+---------------------------+
| [ composer: new task...    ] |  Selected session         |
| ! fix-y   needs approval     |  chat + inline diff       |
| ● feat-x  running  +120 -8   |                           |
| ✓ docs    ready    +40       |                           |
+------------------------------+---------------------------+
```

- - Triage-optimised; maps 1:1 to mobile (list → detail). − Less room for terminal/preview side by side.

### E. Tiled / multi-pane conversations (Windsurf panes, Claude Code side-by-side, Warp tabs, tmux-style)

```
+-------------------+-------------------+
| feat-x chat       | fix-y chat        |
|                   |                   |
| [composer]        | [composer]        |
+-------------------+-------------------+
| api chat          | terminal          |
+-------------------+-------------------+
```

- - Watch several agents live. − Cognitively expensive; each pane too narrow for diffs; poor on mobile.

### F. Chat + artifact canvas (Lovable / Bolt / v0 / Replit / Claude artifacts)

```
+-----------------------+----------------------------------+
| Chat                  |  [Preview | Code | Diff]          |
|                       |                                  |
| [composer]            |  live app / artifact             |
+-----------------------+----------------------------------+
```

- - Excellent for visual output. − Single-session by nature; no fleet management.

### Fit for chat-first + multi-session

| Archetype        | Chat-first | Many sessions | Review | Mobile mapping           | Familiarity           |
| ---------------- | ---------- | ------------- | ------ | ------------------------ | --------------------- |
| A Three-pane     | High       | Medium-high   | High   | Good (collapse panes)    | Very high             |
| B Editor-centric | Low        | Low           | High   | Poor                     | Very high (IDE users) |
| C Kanban         | Low        | Very high     | Medium | Medium (columns→filters) | Medium                |
| D Inbox/split    | High       | High          | Medium | Excellent                | High                  |
| E Tiled          | Medium     | Medium        | Low    | Poor                     | Medium                |
| F Canvas         | High       | Low           | Medium | Medium                   | High (non-devs)       |

---

## 4. Recommendation

**Archetype A as the shell, with D's triage behaviour baked into the sidebar, C as an optional overview view, and E as opt-in split.**

- **Left: session sidebar** — fixed position, never moves between modes (Cursor's main complaint). Group by project; rows = title, branch, status dot, `+N −M`, unreviewed badge. Pin a "Needs you" section at top (Linear inbox / Warp panel semantics).
- **Centre: chat** — readable width, tool calls as collapsed cards, Zed-style "N files changed" strip above composer, composer with agent/model picker.
- **Right: tabbed context pane** — Changes (multi-file diff, per-hunk keep/reject, inline comments → agent), Terminal, Files, Preview. Collapsible to pure chat; remembers per-session.
- **Overview view** (Cmd+Shift+O or sidebar toggle): board/grid of all sessions by status — for fleet moments, not the default home.
- **Split** two sessions side by side as an explicit action, capped at 2–4.
- **Palette:** single Cmd+K for sessions, commands, files, agents (Raycast/Linear style); Cmd+N new session (auto worktree); Cmd+1..9 jump.
- **Notifications:** status dot + badge + OS notification on needs-input/done; mobile push for approvals.
- **Mobile/web:** same information architecture collapsed to archetype D: home = composer on top + "Needs you" then active list; tap → chat; Changes/Terminal as a bottom sheet or tab; approve/deny inline in timeline and from push.

Why: A is what Conductor, Claude Code desktop, Codex and Factory converged on, so it is the lowest-learning-curve choice for the target audience; D's ordering solves the multi-session attention problem and gives a clean mobile mapping; Kanban-as-home is a documented friction point for solo users.

---

## Sources

- Cursor 2.0 changelog — https://cursor.com/changelog/2-0
- Cursor Agents window guide — https://www.learncursor.dev/learn/cursor-agents/agents-window
- Cursor forum: "Cursor 2.0 UI is absurd" — https://forum.cursor.com/t/cursor-2-0-ui-is-absurd-agents-search-agents-new-agent-agent-new-agent/139840
- Cursor layout feedback megathread — https://forum.cursor.com/t/megathread-cursor-layout-and-ui-feedback/146790?page=15
- Thurrott on Cursor 2.0 — https://www.thurrott.com/a-i/328997/cursor-2-0-arrives-with-multi-agent-interface
- Devin Desktop / Windsurf changelog — https://windsurf.com/changelog
- Cascade docs — https://docs.windsurf.com/windsurf/cascade/cascade
- Windsurf → Devin Desktop, Agent Command Center — https://aicoderscope.com/blog/windsurf-devin-desktop-rebrand-acp-2026/
- Zed Agent Panel docs — https://zed.dev/docs/ai/agent-panel
- Zed parallel agents — https://zed.dev/parallel-agents
- Zed review issues — https://github.com/zed-industries/zed/issues/49856 , https://github.com/zed-industries/zed/issues/34415
- VS Code Agents window — https://code.visualstudio.com/docs/agents/run/agents-window
- VS Code agent sessions — https://code.visualstudio.com/learn/foundations/agent-sessions-and-where-agents-run
- GitHub changelog, coding agent in VS Code — https://github.blog/changelog/2025-11-13-manage-copilot-coding-agent-tasks-in-visual-studio-code/
- Junie IDE plugin — https://junie.jetbrains.com/docs/junie-ide-plugin.html
- Junie GA — https://blog.jetbrains.com/junie/2026/06/junie-coding-agent-out-of-beta/
- Junie sidebar support article — https://youtrack.jetbrains.com/articles/SUPPORT-A-2032/Cannot-see-Junie-in-sidebar
- Junie quota issue — https://youtrack.jetbrains.com/projects/JUNIE/issues/JUNIE-294/Show-remaining-quota-in-the-Junie-Toolwindow
- Claude Code desktop docs — https://code.claude.com/docs/en/desktop
- MacRumors on Claude Code desktop redesign — https://www.macrumors.com/2026/04/15/anthropic-rebuilds-claude-code-desktop-app/
- Claude Code Remote Control — https://code.claude.com/docs/en/remote-control
- Remote Control push request — https://github.com/anthropics/claude-code/issues/29438
- Codex app announcement — https://openai.com/index/introducing-the-codex-app/
- Codex changelog — https://developers.openai.com/codex/changelog
- Codex overview — https://en.wikipedia.org/wiki/OpenAI_Codex_(AI_agent)
- Codex app guide — https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents
- Conductor overviews — https://www.mattcullerton.com/tokdocs/first-look-at-conductor-parallel-coding-agents-with-git-worktrees/ , https://rustman.org/wiki/conductor-parallel-agents/ , https://chatgate.ai/post/conductor
- Addy Osmani, Code Agent Orchestra — https://addyosmani.com/blog/code-agent-orchestra/
- Warp multiple agents — https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents/
- Warp 2.0 ADE — https://www.warp.dev/blog/reimagining-coding-agentic-development-environment
- Warp interactive code review — https://docs.warp.dev/agent-platform/local-agents/interactive-code-review/
- Amp agents panel — https://ampcode.com/news/agents-panel
- Amp guide — https://sidbharath.com/blog/amp-code-guide/
- Block thread manager for Amp — https://github.com/block/thread-manager-for-amp
- Factory desktop — https://factory.ai/news/factory-desktop
- Factory web and mobile — https://factory.ai/product/web
- Terragon OSS / shutdown — https://github.com/terragon-labs/terragon-oss , https://www.terragonlabs.com/
- Parallel agent tools roundup — https://www.codeagentswarm.com/en/guides/best-tools-to-run-multiple-ai-coding-agents
- Lovable/Bolt/v0/Replit comparisons — https://zapier.com/blog/lovable-vs-bolt/ , https://www.xda-developers.com/tried-vibe-coding-a-real-app-in-bolt-v0-and-lovable/
- Linear UI redesign — https://linear.app/now/how-we-redesigned-the-linear-ui
- Linear UI refresh — https://linear.app/changelog/2026-03-12-ui-refresh
- Linear new UI / split inbox — https://linear.app/changelog/2024-03-20-new-linear-ui
