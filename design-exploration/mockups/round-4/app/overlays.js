/* Modals, sheets, popovers and context menus, keyed by data-act. */
window.O = (function () {
  const F = Frogg,
    { ic, tg, sel, seg, inp, area, btn, badge, row, modal, menu, pop, toast } = U;
  const at = (q) => document.querySelector(q);
  const O = {};
  // ---- menus ----
  O["scope-menu"] = (a) =>
    menu(
      a || at(".scope-btn"),
      [
        "Scope",
        {
          t: "All projects",
          glyph: R3.facet("frogg-all", ["#7fd9e6", "#045b9d"], 14),
          on: S.scope === "all",
          act: "scope:all",
          d: "13 sessions · 3 hosts",
        },
        ...F.projects.map((p) => ({
          t: p.name,
          glyph: R3.projFacet(p.id, 14),
          on: S.scope === p.id,
          act: "scope:" + p.id,
          d: `${F.sessions.filter((s) => s.project === p.id).length} sessions · ${p.host}`,
        })),
        "-",
        { t: "Chats", ic: "chat", act: "scope:chats", d: "Project-less, read-only sandbox" },
        {
          t: "History",
          ic: "history",
          act: "scope:archived",
          d: "Archived and past sessions, all hosts",
        },
        "-",
        { t: "Add project…", ic: "plus", act: "add-project" },
        { t: "Import conversations…", ic: "upload", act: "import" },
      ],
      { cls: "wide" },
    );
  O["display-menu"] = (a) =>
    pop(
      a || at('[data-act="display-menu"]'),
      `<div class="popf"><h4>Display</h4>${row("Group", "", seg(["Attention", "Project", "Labels"], 0))}${row("Sort", "", sel("Recent activity"))}${row("Title", "", seg(["Title", "Branch"], 0))}<h4>Show</h4><span class="chips">${["Project", "Branch", "Host", "Labels", "PR", "Checks", "Services", "Account", "Diff stats", "Subagents"].map((x, i) => `<button class="tchip ${[0, 1, 3, 4, 8, 9].includes(i) ? "on" : ""}">${x}</button>`).join("")}</span><h4>Filter</h4>${row("Host", "", sel("All hosts"))}${row("Label", "", sel("Any"))}${row("Show hidden (2)", "", tg(false))}</div>`,
      { right: true },
    );
  O["session-menu"] = (a) =>
    menu(
      a || at('[data-act="session-menu"]'),
      [
        { t: "New agent in this session", ic: "plus", k: "⌘O" },
        { t: "New terminal", ic: "terminal", k: "⌘⇧T" },
        { t: "New browser tab", ic: "globe", k: "⌘⇧B" },
        { t: "Import conversation…", ic: "upload", act: "import" },
        "-",
        { t: "Rename…", ic: "edit" },
        { t: "Labels", ic: "tag", sub: 1, act: "labels" },
        { t: "Pin to top", ic: "pin", k: "⌘⇧P" },
        { t: "Voice alerts for this session", ic: "voice", on: true },
        { t: "Copy path · branch · ID", ic: "copy", sub: 1 },
        { t: "Show setup log", ic: "terminal" },
        "Plugins",
        {
          t: "Sentry: attach release issues",
          glyph: R3.facet("sentry", ["#8b7cf6", "#362d59"], 14),
        },
        "-",
        { t: "Hide from list", ic: "eye" },
        { t: "Archive session…", ic: "archive", danger: true, act: "archive" },
      ],
      { right: true },
    );
  O["row-menu"] = (a) => O["session-menu"](a);
  O["git-more"] = (a) =>
    menu(
      a || at('[data-act="git-more"]'),
      [
        { t: "Commit", k: "⌘⏎" },
        { t: "Commit and push" },
        { t: "Pull" },
        { t: "Push", d: "3 commits ahead" },
        { t: "Pull and push" },
        "-",
        { t: "Update from main", d: "merge main into this branch" },
        {
          t: "Merge into main locally",
          dis: true,
          d: "Uncommitted changes · commit or stash first",
        },
        "-",
        { t: "Create pull request", dis: true, d: "PR #1284 already open" },
        { t: "View pull request", act: "tool:prs" },
        "-",
        { t: "Switch branch…", act: "branch" },
        { t: "Stash changes" },
        { t: "Archive session…", danger: true, act: "archive" },
      ],
      { right: true },
    );
  O["commit-menu"] = (a) =>
    menu(
      a,
      [
        { t: "Commit", k: "⌘⏎" },
        { t: "Commit and push", k: "⌘⇧⏎" },
        { t: "Amend last commit" },
        { t: "Generate message", ic: "bolt" },
      ],
      { right: true },
    );
  O["merge-menu"] = (a) =>
    menu(
      a || at('[data-act="merge-menu"]'),
      [
        "Merge",
        { t: "Squash and merge", on: true },
        { t: "Create a merge commit" },
        { t: "Rebase and merge" },
        "-",
        "Auto-merge when checks pass",
        { t: "Enable auto-merge (squash)" },
        "-",
        { t: "Merge disabled", dis: true, d: "Draft · 1 failing check · 0 of 1 approvals" },
      ],
      { right: true },
    );
  O.branch = (a) =>
    pop(
      a || at('[data-act="branch"]'),
      `<div class="popf br-pop">${inp("", "Filter branches and PRs")}<div class="mh">Recent</div>${["feat/session-store", "main", "fix/draft-loss", "feat/plugin-media"].map((b, i) => `<button class="mi ${i === 0 ? "on" : ""}">${ic("branch", 13)}<span class="mi-t">${b}${i === 0 ? "<small>current · ↑3 ↓0</small>" : ""}</span></button>`).join("")}<div class="mh">Pull requests</div><button class="mi">${ic("pr", 13)}<span class="mi-t">#1279 fix/draft-loss<small>Codex · open</small></span></button><div class="warnline">${R3.glyph("permission")} 2 uncommitted files. Switching will offer <b>Stash &amp; switch</b>.</div></div>`,
    );
  O["files-menu"] = (a) =>
    menu(
      a,
      [
        "Sort by",
        { t: "Name", on: true },
        { t: "Modified" },
        { t: "Size" },
        "-",
        { t: "Show hidden files", on: false },
        { t: "Collapse all" },
      ],
      { right: true },
    );
  O["file-menu"] = (a) =>
    menu(a, [
      { t: "Open", k: "⏎" },
      { t: "Open to the side", ic: "split" },
      { t: "Open in VS Code", ic: "ext", sub: 1 },
      { t: "Add to chat", ic: "chat" },
      "-",
      { t: "Copy path" },
      { t: "Copy relative path" },
      { t: "Reveal in Finder" },
      { t: "Download" },
      "-",
      { t: "Rename…", k: "F2" },
      { t: "Duplicate" },
      { t: "Discard changes…", danger: true },
      { t: "Delete…", danger: true, k: "⌫" },
    ]);
  O["editor-menu"] = (a) =>
    menu(
      a,
      [
        "Open in",
        ...["VS Code", "Cursor", "Zed", "WebStorm", "IntelliJ IDEA", "Finder"].map((t, i) => ({
          t,
          on: i === 0,
        })),
        "-",
        { t: "Change default…" },
      ],
      { right: true },
    );
  O["tab-menu"] = (a) =>
    menu(a, [
      { t: "Rename…" },
      { t: "Reload agent", d: "Picks up new skills, MCPs or login" },
      { t: "Copy resume command" },
      { t: "Copy agent ID" },
      "-",
      { t: "Split right", k: "⌘\\" },
      { t: "Move to side pane" },
      "-",
      { t: "Close", k: "⌘W" },
      { t: "Close others" },
      { t: "Close tabs to the right" },
    ]);
  O["new-tab"] = (a) =>
    menu(a || at('[data-act="new-tab"]'), [
      { t: "New agent", ic: "sessions", k: "⌘⇧A" },
      { t: "New terminal", ic: "terminal", k: "⌘⇧T", sub: 1 },
      { t: "New browser", ic: "globe", k: "⌘⇧B", d: "Desktop only" },
      "Terminal profiles",
      { t: "zsh" },
      { t: "psql staging" },
      { t: "Edit profiles…", act: "page:terminals" },
    ]);
  O["term-new"] = O["new-tab"];
  O["host-menu"] = (a) =>
    menu(
      a,
      [
        { t: "Rename…" },
        { t: "Restart daemon" },
        { t: "Open logs" },
        { t: "Copy pairing link" },
        "-",
        { t: "Redeploy over SSH…", act: "deploy" },
        { t: "Remove host…", danger: true, act: "remove-host" },
      ],
      { right: true },
    );
  O["svc-url"] = (a) =>
    modal({
      eyebrow: "Service URL",
      title: "Open session-store.frogg.local?",
      body: `<p>The <b>dev</b> service for this session is running on :5173 behind the reverse proxy.</p><div class="choice">${["In a Frogg browser tab", "In your default browser", "Copy URL"].map((x, i) => `<button class="opt ${i === 0 ? "on" : ""}"><span class="radio"></span>${x}</button>`).join("")}</div><label class="chk">${tg(false)} Don’t ask again</label>`,
      foot: btn("Cancel", "ghost") + btn("Open", "approve"),
      size: "sm",
    });
  // composer popovers
  O.model = (a) =>
    pop(
      a || at(".chip-model"),
      `<div class="popf mdl">${inp("", "Search models")}${D.models.map(([p, ms]) => `<div class="mh">${p}</div>` + ms.map(([m, d, on]) => `<button class="mi ${on ? "on" : ""}"><span class="mi-t">${m}<small>${d}</small></span>${on ? ic("check", 13) : ""}</button>`).join("")).join("")}<div class="mh">Thinking</div>${seg(["Off", "Low", "Medium", "High", "Max"], 3, "full")}<div class="mh">Features</div>${row("Fast mode", "", tg(false))}<button class="link">Open Claude Code settings</button></div>`,
      { up: true },
    );
  O.mode = (a) =>
    menu(
      a || at(".chip-mode"),
      [
        "Permission mode · ⇧Tab cycles",
        ...D.modes.map(([m, d, map]) => ({
          t: `${m} <span class="native">${map["Claude Code"]}</span>`,
          d,
          on: m === "Auto-edit",
          ic: m === "Unattended" ? "bolt" : m === "Plan" ? "tasks" : "shield",
          danger: m === "Unattended",
        })),
      ],
      { up: true, cls: "wide" },
    );
  O.attach = (a) =>
    menu(
      a || at('[data-act="attach"]'),
      [
        { t: "Image or file", ic: "image", k: "⌘U" },
        { t: "Paste image", ic: "copy", k: "⌘V" },
        { t: "Issue or pull request…", ic: "pr" },
        { t: "CI log…", ic: "terminal", d: "test (windows) failed 52m ago" },
        { t: "Review comments (2)", ic: "chat" },
        { t: "Browser element", ic: "globe", d: "Desktop only" },
        "Plugins",
        { t: "Sentry: insert stack trace", glyph: R3.facet("sentry", ["#8b7cf6", "#362d59"], 14) },
      ],
      { up: true },
    );
  O.account = (a) =>
    menu(
      a || at(".chip-account"),
      [
        "Account · locked once the agent started",
        { t: "steve@work", d: "Max 20× · week 86%", on: true },
        { t: "personal", d: "Pro · week 31%" },
        "-",
        { t: "Move conversation to personal…", act: "transfer" },
        { t: "Clean cut to personal", d: "Summarise, then continue there" },
      ],
      { up: true },
    );
  O.provider = (a) =>
    menu(
      a || at(".chip-agent"),
      [
        "Provider",
        ...["Claude Code", "Codex", "Copilot", "Oh My Pi"].map((t, i) => ({ t, on: i === 0 })),
        { t: "OpenCode", dis: true, d: "Error · bun not found" },
        "-",
        { t: "Switch provider with clean cut…" },
      ],
      { up: true },
    );
  O.slash = () => {
    const c = at(".composer");
    const el = pop(
      c,
      `<div class="popf slash"><div class="mh">Commands</div>${[
        ["/compact", "Summarise context now"],
        ["/clear", "Archive and start a fresh draft"],
        ["/review", "Review the working diff"],
        ["/plan", "Switch to Plan mode"],
        ["/exit", "Archive this agent"],
      ]
        .map(
          ([c2, d], i) =>
            `<button class="mi ${i === 2 ? "on" : ""}"><span class="mi-t"><code>${c2}</code><small>${d}</small></span></button>`,
        )
        .join("")}<div class="mh">Skills</div>${[
        ["frogg-dev", "Build, run and test"],
        ["frogg-docs", "Update docs"],
      ]
        .map(
          ([c2, d]) =>
            `<button class="mi"><span class="mi-t"><code>/${c2}</code><small>${d}</small></span></button>`,
        )
        .join("")}</div>`,
      { up: true },
    );
    return el;
  };
  // ---- modals and sheets ----
  O["new-session"] = () =>
    modal({
      eyebrow: "⌘N",
      title: "New session",
      size: "lg",
      body: `<div class="form">${row("Project", "", `<button class="sel wide">${R3.projFacet("frogg", 14)}<span>frogg-app</span>${ic("down", 12)}</button>`)}${row("Host", "", sel("devbox · relay", true))}${row("Isolation", "", seg(["New worktree", "Local checkout"], 0))}${row("Start from", "", `<button class="sel wide">${ic("branch", 13)}<span>main</span><span class="mut sm">or a branch / PR</span>${ic("down", 12)}</button>`)}${row("Launch", "", seg(["Agent", "Terminal"], 0))}
      <div class="np"><div class="composer-input big" contenteditable="true">Make the session cache cap configurable via config.json (<code>sessionCache.max</code>) and log evictions at debug.</div>
      <div class="composer-bar"><button class="chip chip-agent"><span class="agent-swatch"></span>Claude Code</button><button class="chip">Opus 5.5 <span class="sub">· high</span></button><button class="chip">${ic("shield", 11)} Auto-edit</button><button class="chip">steve@work</button><span class="bar-spacer"></span><button class="link">Title (optional)</button></div></div></div>`,
      foot: `<span class="mut sm">Worktree <code>~/.frogg/worktrees/frogg-app/cache-cap</code> · setup: pnpm install</span><span class="sp"></span>${btn("Cancel", "ghost")}${btn("Create session <kbd>⌘⏎</kbd>", "approve")}`,
    });
  O.archive = () =>
    modal({
      eyebrow: "Archive session",
      title: "Archive “Session store persistence refactor”?",
      danger: true,
      body: `<p>The agent stops and the worktree is removed. The branch and its commits stay; you can restore from History.</p><div class="warnbox"><b>Not saved anywhere else</b><div class="ck">${R3.glyph("permission")}<span>2 uncommitted files</span><span class="mono add">+31</span><span class="mono del">−46</span></div><div class="ck">${R3.glyph("permission")}<span>3 unpushed commits on feat/session-store</span></div></div>`,
      foot:
        btn("Cancel", "ghost") +
        btn("Commit &amp; push first", "ghost") +
        btn("Archive anyway", "danger-b"),
      size: "sm",
    });
  O["remove-host"] = () =>
    modal({
      eyebrow: "Danger",
      title: "Remove ci-runner-2?",
      danger: true,
      body: `<p>This device forgets the host and its 2 sessions disappear from your lists. The daemon on ci-runner-2 keeps running; nothing on disk changes.</p><label class="lbl-f">Type <code>ci-runner-2</code> to confirm</label>${inp("ci-runner-", "", "mono full")}`,
      foot: btn("Cancel", "ghost") + btn("Remove host", "danger-b"),
      size: "sm",
    });
  O.revoke = () =>
    modal({
      eyebrow: "Devices",
      title: "Revoke Pixel 9?",
      danger: true,
      body: "<p>Pixel 9 disconnects now and needs to pair again. It is currently viewing “Invoice PDF renderer”.</p>",
      foot: btn("Cancel", "ghost") + btn("Revoke", "danger-b"),
      size: "sm",
    });
  O.rewind = () =>
    modal({
      eyebrow: "Rewind",
      title: "Rewind to “Keep the public API stable”?",
      danger: true,
      body: `<div class="choice">${["Conversation and files", "Conversation only", "Files only"].map((x, i) => `<button class="opt ${i === 0 ? "on" : ""}"><span class="radio"></span>${x}</button>`).join("")}</div><p class="mut">Removes 14 messages and reverts 4 files. This cannot be undone; fork first if unsure.</p>`,
      foot: btn("Fork instead", "ghost") + btn("Rewind", "danger-b"),
      size: "sm",
    });
  O.labels = () =>
    modal({
      eyebrow: "Session labels · devbox",
      title: "Labels",
      size: "sm",
      body: `${inp("", "Search or create a label", "full")}<div class="lblist">${D.labels.map(([n, c, hex, k], i) => `<button class="mi ${i === 0 ? "on" : ""}"><span class="lbl" style="--c:${hex}">${n}</span><span class="mut sm">${k} sessions</span>${i === 0 ? ic("check", 13) : ""}</button>`).join("")}</div>`,
      foot: `<button class="link" data-act="page:labels">Manage labels…</button><span class="sp"></span>${btn("Done", "approve")}`,
    });
  O.transfer = () =>
    modal({
      eyebrow: "Account",
      title: "Move this conversation to personal?",
      body: `<div class="choice">${[
        ["Move with full history", "Re-sends 46k tokens of context on the next turn (~$0.70)"],
        ["Clean cut to personal", "Summarise into ~3k tokens first (~$0.05)", true],
        ["Switch provider", "Continue in Codex with a clean cut"],
      ]
        .map(
          ([t, d, on]) =>
            `<button class="opt ${on ? "on" : ""}"><span class="radio"></span><span><b>${t}</b><small>${d}</small></span></button>`,
        )
        .join("")}</div>`,
      foot: btn("Cancel", "ghost") + btn("Clean cut and move", "approve"),
      size: "sm",
    });
  O.import = () =>
    modal({
      eyebrow: "Sessions",
      title: "Import conversations",
      size: "lg",
      body: `${seg(["From devbox", "From files"], 0)}<div class="ib-filter wide">${seg(["All", "Claude Code", "Codex", "Copilot"], 0)}${btn(ic("refresh", 13) + " Refresh", "ghost sm")}</div><div class="imp">${[
        [
          "Claude Code",
          "Investigate flaky e2e on Windows",
          "~/projects/frogg-app · 2h ago · 84 messages",
          true,
        ],
        ["Claude Code", "Draft blog post: inbox", "~/notes · yesterday", false],
        ["Codex", "Port retry helper to Rust", "~/projects/billing-api · 3d ago", true],
        ["Copilot", "untitled", "~/projects/docs-site · 5d ago", false],
      ]
        .map(
          ([p, t, m, on]) =>
            `<label class="imr">${tg(on)}<span><b>${t}</b><small>${p} · ${m}</small></span></label>`,
        )
        .join("")}<p class="mut sm">Already imported: 12 conversations are hidden.</p></div>`,
      foot: `<span class="mut sm">Provider sessions stay resumable; others come in as text history.</span><span class="sp"></span>${btn("Cancel", "ghost")}${btn("Import 2", "approve")}`,
    });
  O["add-host"] = () =>
    modal({
      eyebrow: "Hosts",
      title: "Add a host",
      size: "lg",
      sub: "Every method ends in the same confirm step: check the fingerprint, then pair.",
      body: `<div class="methods">${[
        [
          "qr",
          "Scan or paste a pairing offer",
          "QR, link or 8-character code shown on the host",
          true,
        ],
        ["globe", "Found on your network", "studio-mini.local · 0.9.14"],
        ["key", "Connect over SSH", "Pick from ~/.ssh/config; Frogg tunnels the daemon"],
        ["upload", "Install on a server", "Deploy the daemon over SSH, then pair"],
        ["link", "Direct address", "host:port, optional password and TLS"],
      ]
        .map(
          ([i, t, d, on]) =>
            `<button class="meth ${on ? "on" : ""}">${ic(i, 18)}<span><b>${t}</b><small>${d}</small></span></button>`,
        )
        .join("")}</div>
      <div class="methp"><label class="lbl-f">Paste a link or enter the code</label>${inp("frogg://pair#offer=eyJ2IjoyLCJoIjoiZGV2Ym94Ii…", "", "mono full")}<div class="codebox">${"7KQ4M2XD"
        .split("")
        .map((c) => `<span>${c}</span>`)
        .join(
          "",
        )}</div><p class="mut sm">On the host: Hosts › Pair a device, or run <code>frogg pair</code>.</p></div>`,
      foot: btn("Cancel", "ghost") + btn("Continue", "approve", 'data-act="pair-confirm"'),
    });
  O["pair-confirm"] = () =>
    modal({
      eyebrow: "Add a host · confirm",
      title: "Pair with devbox?",
      size: "sm",
      body: `<div class="kv">${[
        ["Address", "relay.frogg.dev → devbox"],
        ["Host key", "<code>SHA256:9F2A·C41E·77B0·D3A8</code> " + badge("verified", "ok")],
        ["Your role", "Operator (set by the host)"],
        ["Offer expires", "in 9:41"],
        ["Server ID", '<code class="mut">srv_01J9X…H4</code>'],
      ]
        .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
        .join(
          "",
        )}</div><p class="mut sm">If this host has no owner yet you can claim it instead, which makes this device its owner.</p>`,
      foot: btn("Cancel", "ghost") + btn("Claim as owner", "ghost") + btn("Pair", "approve"),
    });
  O["pair-device"] = () =>
    modal({
      eyebrow: "devbox · Devices",
      title: "Pair a device",
      size: "lg",
      body: `<div class="pairgrid"><div class="qr">${qr()}</div><div><label class="lbl-f">Role for the new device</label>${seg(["Owner", "Operator", "Viewer"], 1)}<label class="lbl-f">Code</label><div class="codebox">${"7KQ4M2XD"
        .split("")
        .map((c) => `<span>${c}</span>`)
        .join(
          "",
        )}</div><label class="lbl-f">Link</label>${inp("https://app.frogg.dev/pair#offer=eyJ2IjoyLCJoIjoiZGV2Ym94Ii…", "", "mono full")}<div class="acts">${btn("Copy link", "ghost sm")}${btn("Copy code", "ghost sm")}${btn("New code", "ghost sm")}</div><p class="mut sm">Expires in 9:41 · fingerprint <code>9F2A·C41E</code> · reached through relay.frogg.dev. Anyone with this link can request access; you still approve on this host.</p></div></div>`,
      foot: `<span class="mut sm">QR, link and code are the same offer.</span><span class="sp"></span>${btn("Done", "approve")}`,
    });
  O.deploy = () =>
    modal({
      eyebrow: "Hosts · Install on a server",
      title: "Deploy to ci-runner-2",
      size: "lg",
      body: `<div class="form">${row("SSH target", "", sel("ci-runner-2 (from ~/.ssh/config)", true))}${row("Method", "Docker found", seg(["Native (systemd)", "Docker"], 0))}${row("Reach the daemon", "", seg(["SSH tunnel (recommended)", "Network"], 0))}${row("Version", "", sel("0.9.14 stable"))}</div><pre class="term steps">${[
        ["done", "Connect steve@ci-runner-2:22"],
        ["done", "Probe: Debian 13 · x64 · systemd · Docker 27"],
        ["done", "Upload frogg-daemon 0.9.14 (38 MB)"],
        ["running", "Install service frogg-daemon.service"],
        ["idle", "Start and health check"],
        ["idle", "Pair this device as owner"],
      ]
        .map(([k, t]) => `${R3.glyph(k)} ${t}`)
        .join("\n")}</pre>`,
      foot: btn("Cancel", "ghost") + btn("Deploying…", "approve"),
    });
  O["provider-detail"] = () =>
    modal({
      eyebrow: "Providers · devbox",
      title: "Codex",
      size: "lg",
      body: `<div class="tabsx">${["Overview", "Models", "Accounts", "Diagnostics"].map((t, i) => `<button class="${i === 0 ? "on" : ""}">${t}</button>`).join("")}</div>${row("Enabled", "", tg(true))}${row("Version", "0.71.0 installed · 0.73.0 available", `${btn("Update", "approve sm")}`)}${row("Update automatically", "", tg(true))}${row("Default model", "", sel("GPT-5.3 Codex"))}${row("Default mode", "Shown as Frogg’s shared mode names", seg(["Plan", "Ask", "Auto-edit", "Unattended"], 1))}${row("Custom models", "", btn("Add model by ID", "ghost sm"))}<div class="dz">${row("Remove provider", "Deletes the config.json entry", btn("Remove…", "ghost sm danger"))}${row("Uninstall", "Removes the codex binary from devbox", btn("Uninstall…", "ghost sm danger"))}</div>`,
    });
  O["provider-catalog"] = () =>
    modal({
      eyebrow: "Providers",
      title: "Add a provider",
      body: `${inp("", "Search providers", "full")}<div class="imp">${[
        ["Cursor", "Not installed", "Install"],
        ["Kiro", "Not installed", "Install"],
        ["Gemini CLI", "ACP", "Add"],
        ["Claude Code", "Installed", "Installed"],
      ]
        .map(
          ([n, s, b]) =>
            `<div class="imr"><span><b>${n}</b><small>${s}</small></span><span class="sp"></span>${btn(b, b === "Installed" ? "ghost sm" : "sm")}</div>`,
        )
        .join("")}</div>`,
      size: "sm",
    });
  O["add-account"] = () =>
    modal({
      eyebrow: "Accounts · Claude Code",
      title: "Add an account",
      size: "sm",
      body: `<label class="lbl-f">Account name</label>${inp("client-acme", "", "mono full")}<p class="mut sm">Config folder <code>~/.frogg/accounts/claude/client-acme</code></p><label class="lbl-f">Share from your default account</label>${["Skills", "Agents", "Commands", "settings.json"].map((x, i) => `<label class="chk">${tg(i < 3)} ${x}</label>`).join("")}`,
      foot: btn("Cancel", "ghost") + btn("Add and sign in", "approve"),
    });
  O.consent = () =>
    modal({
      eyebrow: "Install plugin · GitLab · Official",
      title: "GitLab wants to",
      size: "sm",
      body: `<div class="caps">${[
        ["globe", "Reach the network", "gitlab.com and your self-hosted URL"],
        ["files", "Read workspace files", "To map MR diffs to files"],
        ["sessions", "Read and message agents", "To send MR comments to the agent"],
        ["plugins", "Add panels, commands and session actions", ""],
      ]
        .map(
          ([i, t, d]) =>
            `<div class="ck">${ic(i, 15)}<span><b>${t}</b><small>${d}</small></span></div>`,
        )
        .join(
          "",
        )}</div><div class="warnbox"><b>Runs on devbox without a sandbox</b><p>Host plugins run with the daemon’s permissions.</p></div>`,
      foot: btn("Cancel", "ghost") + btn("Install on devbox", "approve"),
    });
  O.shortcuts = () =>
    modal({
      eyebrow: "?",
      title: "Keyboard shortcuts",
      size: "lg",
      body: `<div class="kgrid">${[
        [
          "Rail",
          [
            ["Sessions", "⌘1"],
            ["Search", "⌘⇧F"],
            ["Files", "⌘⇧E"],
            ["Source control", "⌘⇧G"],
            ["PRs & CI", "⌘⇧R"],
            ["Terminals", "⌃`"],
            ["Inbox", "⌘⇧I"],
            ["Settings", "⌘,"],
          ],
        ],
        [
          "Sessions",
          [
            ["Next / previous", "J K"],
            ["Approve", "A"],
            ["New session", "⌘N"],
            ["Palette", "⌘K"],
            ["Changes drawer", "\\"],
            ["Tab 1–9", "⌘⌥1–9"],
          ],
        ],
        [
          "Composer",
          [
            ["Steer", "⏎"],
            ["Queue", "⌘⏎"],
            ["Interrupt", "Esc"],
            ["Mode", "⇧Tab"],
            ["Dictation", "⌘D"],
          ],
        ],
      ]
        .map(
          ([g, l]) =>
            `<div><h4>${g}</h4>${l.map(([n, k]) => `<div class="kr"><span>${n}</span><kbd>${k}</kbd></div>`).join("")}</div>`,
        )
        .join("")}</div>`,
    });
  O.companion = () =>
    modal({
      kind: "comp",
      eyebrow: "Companion · preview",
      title: "Listening…",
      size: "sm",
      body: `<div class="orb"><span></span><span></span><span></span></div><p class="said">“What’s blocking the invoice PDF session?”</p><div class="topics">${["Invoice PDF renderer", "Stripe webhook retries", "CI on i18n"].map((x) => `<span>${x}</span>`).join("")}</div>`,
      foot: btn("Mute", "ghost") + btn("Type instead", "ghost") + btn("End", "danger-b"),
    });
  O["todo-new"] = () =>
    modal({
      eyebrow: "Project to-dos · frogg-app",
      title: "New to-do",
      size: "sm",
      body: `<label class="lbl-f">Title</label>${inp("Expose openInSidePane flags in Settings", "", "full")}<label class="lbl-f">Description</label>${area("Five device flags are stored but have no control.", "", 3)}<div class="form">${row("Category", "", sel("ui"))}${row("Priority", "", seg(["Low", "Medium", "High", "Urgent"], 1))}${row("Allow parallel claims", "", tg(false))}</div>`,
      foot: btn("Cancel", "ghost") + btn("Create", "approve"),
    });
  O.restore = () =>
    toast("Restoring “Plugin API: panel refresh hooks”", {
      d: "Re-creating worktree on feat/panel-refresh",
      k: "running",
    });
  O.merge = () =>
    toast("Merge blocked", { d: "Draft · 1 failing check · 0 of 1 approvals", k: "error" });
  O["add-project"] = () =>
    modal({
      eyebrow: "Projects",
      title: "Add a project",
      size: "lg",
      body: `<div class="dirb"><div class="pathbar">${ic("folder", 14)}<span class="mono">devbox:~/projects</span><span class="sp"></span>${btn("Up", "ghost sm")}${btn(ic("refresh", 12), "ghost sm")}${btn("New folder", "ghost sm")}</div>${["frogg-app", "billing-api", "docs-site", "infra", "playground", "rust-retry"].map((d, i) => `<button class="mi ${i === 4 ? "on" : ""}">${ic("folder", 14)}<span class="mi-t">${d}${i < 4 ? "<small>already added</small>" : i === 4 ? "<small>git · main · no frogg.json</small>" : ""}</span></button>`).join("")}</div>`,
      foot: `<span class="mut sm">Host: devbox</span><span class="sp"></span>${btn("Cancel", "ghost")}${btn("Add playground", "approve")}`,
    });
  function qr() {
    let h = 7,
      s = "";
    for (let y = 0; y < 25; y++)
      for (let x = 0; x < 25; x++) {
        h = (h * 1103515245 + 12345) >>> 0;
        const f = (x < 7 && y < 7) || (x > 17 && y < 7) || (x < 7 && y > 17);
        const on = f
          ? x % 6 === 0 ||
            y % 6 === 0 ||
            (x > 17 ? x - 18 : x) % 6 === 0 ||
            (y > 17 ? y - 18 : y) % 6 === 0 ||
            (x % 18 >= 2 && x % 18 <= 4 && y % 18 >= 2 && y % 18 <= 4)
          : (h >> 16) & 1;
        if (on) s += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    return `<svg viewBox="-2 -2 29 29" width="200" height="200"><rect x="-2" y="-2" width="29" height="29" fill="#f2f6f7"/><g fill="#080b0d">${s}</g></svg>`;
  }
  return O;
})();
