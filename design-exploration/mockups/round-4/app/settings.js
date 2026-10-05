/* Settings: one surface, grouped by where the setting lives (device, host, project). */
window.Settings = (function () {
  const { ic, tg, sel, seg, inp, area, num, btn, badge, row, sec, meter, scope } = U;
  const TREE = [
    [
      "You",
      "device",
      "Stored on this device",
      [
        ["appearance", "Appearance", "eye"],
        ["chat", "Chat & composer", "chat"],
        ["editor", "Files, editor & terminal", "files"],
        ["keys", "Keyboard shortcuts", "key"],
        ["notify", "Notifications & inbox", "inbox"],
        ["voice", "Voice & Companion", "voice"],
      ],
    ],
    [
      "Agents",
      "host",
      "devbox",
      [
        ["providers", "Providers & models", "bolt"],
        ["accounts", "Accounts", "key"],
        ["modes", "Permission modes", "shield"],
        ["usage", "Usage & limits", "usage"],
        ["context", "Context & clean cut", "history"],
        ["orchestration", "Tools, skills & prompts", "plugins"],
      ],
    ],
    [
      "Host",
      "host",
      "devbox",
      [
        ["host", "Overview & connections", "hosts"],
        ["devices", "Devices & access", "phone"],
        ["security", "Security", "lock"],
        ["automation", "Automation", "refresh"],
        ["labels", "Session labels", "tag"],
        ["terminals", "Terminal profiles", "terminal"],
        ["resources", "Resources & storage", "cpu"],
        ["daemon", "Daemon & updates", "upload"],
      ],
    ],
    [
      "Project",
      "project",
      "frogg-app",
      [
        ["worktrees", "Worktrees", "branch"],
        ["scripts", "Scripts & services", "play"],
        ["ci", "CI & release streams", "pr"],
        ["metadata", "Generated text", "edit"],
      ],
    ],
    [
      "App",
      "",
      "",
      [
        ["plugins", "Plugins", "plugins"],
        ["updates", "App updates", "upload"],
        ["about", "About & diagnostics", "issue"],
        ["developer", "Developer", "terminal"],
      ],
    ],
  ];
  const flat = TREE.flatMap(([g, sc, where, items]) =>
    items.map(([id, t, i]) => ({ id, t, i, g, sc, where })),
  );
  function side() {
    return `<div class="lh"><h2 class="scope">${ic("settings", 15)}Settings</h2></div>
      <div class="ib-filter"><span class="inp">${ic("search", 13)}<input placeholder="Search settings" value="${S.sq || ""}"></span></div>
      <div class="list stree" data-glide><div class="brk"><i></i><i></i><i></i><i></i></div>${TREE.map(([g, sc, where, items]) => `<div class="sec"><span>${g}</span><i>${sc === "host" ? `<button class="hostsw">${where} ▾</button>` : sc === "project" ? `<button class="hostsw">${where} ▾</button>` : ""}</i></div>${items.map(([id, t, i]) => `<button class="row st ${S.page === id ? "on" : ""}" data-page="${id}" data-spot><span class="r1">${ic(i, 14)}<b>${t}</b>${id === "notify" ? badge("new", "new") : ""}${id === "devices" ? '<span class="u">1</span>' : ""}${id === "security" ? R3.glyph("permission") : ""}</span></button>`).join("")}`).join("")}</div>`;
  }
  const P = {};
  P.appearance = () =>
    sec(
      "Theme",
      row(
        "Theme",
        "Follows the OS when set to System",
        `<span class="themes">${["System", "Dark", "Midnight", "Pure black", "Zinc", "Light", "Claude", "Ghostty"].map((t, i) => `<button class="th-sw ${i === 1 ? "on" : ""}" style="--a:${["#888", "#080b0d", "#0b1020", "#000", "#18181b", "#f4f4f1", "#f0e6dc", "#282c34"][i]}"><i></i>${t}</button>`).join("")}</span>`,
        { cls: "stack" },
      ) +
        row("Syntax highlighting", "Live preview below", sel("One")) +
        `<div class="code mini">${'<div class="cl"><span class="ln">1</span><span class="cx"><span class="kw">const</span> cache = <span class="kw">new</span> LRU({ max: <span class="str">500</span> });</span></div>'}</div>` +
        row(
          "Reduce motion",
          "Off follows the OS setting; on removes glides and reveals everywhere",
          tg(false),
        ),
    ) +
    sec(
      "Type",
      row("Interface font", "", inp("Inter")) +
        row("Interface size", "", num(14, "px")) +
        row("Chat text size", "", num(15, "px")) +
        row("Code font", "", inp("JetBrains Mono")) +
        row("Code size", "", num(12, "px")),
    ) +
    sec(
      "Session list",
      row("Group by", "", seg(["Attention", "Project", "Labels"], 0)) +
        row("Sort within groups", "", sel("Recent activity")) +
        row("Row title", "", seg(["Title", "Branch"], 0)) +
        row(
          "Show on rows",
          "",
          `<span class="chips">${["Project", "Branch", "Host", "Labels", "PR", "Checks", "Services", "Account", "Diff stats", "Last activity"].map((x, i) => `<button class="tchip ${[0, 1, 3, 4, 8, 9].includes(i) ? "on" : ""}">${x}</button>`).join("")}</span>`,
          { cls: "stack" },
        ) +
        row(
          "Rail tools",
          "Drag to reorder. Hidden tools stay in ⌘K",
          btn("Customise rail…", "ghost"),
        ),
    );
  P.chat = () =>
    sec(
      "Sending",
      row(
        "While the agent is working, ⏎",
        "⌘⏎ does the other one",
        seg(["Steer", "Queue", "Interrupt"], 0),
      ) + row("Language", "", sel("System (English)")),
    ) +
    sec(
      "Transcript",
      row("Tool calls", "", seg(["Full detail", "Summary"], 0)) +
        row("Expand reasoning", "", tg(false)) +
        row("Chat outline", "Jump list of your messages at the right edge", tg(true)) +
        row("Open subagents", "", seg(["In a tab", "Side pane"], 0)),
    ) +
    sec(
      "Links and files from chat",
      row("Service URLs", "", seg(["Ask", "In Frogg", "External browser"], 0)) +
        row(
          "Pull requests open in",
          "Previously a hidden setting",
          seg(["PRs & CI tool", "Side pane", "Browser"], 0),
          { tag: badge("was hidden", "warn") },
        ) +
        row("Downloads", "", seg(["Ask every time", "Save to folder"], 0)) +
        row("Show hidden folders in pickers", "", tg(false)),
    );
  P.editor = () =>
    sec(
      "Editor",
      row("Vim keybindings", "Previously stored with no control", tg(true), {
        tag: badge("was hidden", "warn"),
      }) +
        row("Open files from the explorer", "", seg(["Main area", "Side pane"], 0)) +
        row("Open diffs", "", seg(["Main area", "Side pane"], 0)) +
        row("Default external editor", "", sel("VS Code")),
    ) +
    sec(
      "Terminal",
      row("Scrollback", "0–1,000,000 lines", num("10,000", "lines")) +
        row("Copy on select", "", tg(false)) +
        row("Legacy renderer", "Use only if text renders incorrectly", tg(false)),
    ) +
    sec(
      "Browser tab (desktop)",
      row(
        "Clear cookies and site data",
        "Signs you out of sites opened in browser tabs",
        btn("Clear…", "ghost danger"),
      ),
    );
  P.keys = () => {
    const g = [
      [
        "General",
        [
          ["Command palette", "⌘K"],
          ["Search files", "⌘P"],
          ["Settings", "⌘,"],
          ["Shortcuts", "?"],
          ["Cycle theme", "⌘⌥T"],
        ],
      ],
      [
        "Rail tools",
        [
          ["Sessions", "⌘1"],
          ["Search", "⌘⇧F"],
          ["Files", "⌘⇧E"],
          ["Source control", "⌘⇧G"],
          ["PRs & CI", "⌘⇧R"],
          ["Terminals", "⌃`"],
          ["Inbox", "⌘⇧I"],
        ],
      ],
      [
        "Sessions",
        [
          ["New session", "⌘N"],
          ["New agent in this session", "⌘O"],
          ["Next / previous needing you", "J / K"],
          ["Approve", "A"],
          ["Pin session", "⌘⇧P"],
          ["Add host", "⌃H"],
        ],
      ],
      [
        "Tabs & panes",
        [
          ["New tab", "⌘T"],
          ["Close tab", "⌘W"],
          ["Split right", "⌘\\"],
          ["Split down", "⌘⇧\\"],
          ["Focus pane", "⌘⇧←→↑↓"],
          ["Toggle changes drawer", "\\"],
        ],
      ],
      [
        "Composer",
        [
          ["Focus input", "⌘L"],
          ["Cycle permission mode", "⇧Tab"],
          ["Dictation", "⌘D"],
          ["Voice mode", "⌘⇧D"],
          ["Interrupt", "Esc"],
        ],
      ],
    ];
    return (
      `<div class="ib-filter wide">${inp("", "Search shortcuts or press keys")}${btn("Reset all", "ghost")}</div>` +
      g
        .map(([t, l]) =>
          sec(
            t,
            l
              .map(([n, k]) =>
                row(
                  n,
                  n === "New agent in this session"
                    ? "Was labelled “Open project”"
                    : n.startsWith("Split") || n.startsWith("Focus pane")
                      ? "Now on every platform"
                      : "",
                  `<span class="keys">${k
                    .split(" / ")
                    .map((x) => `<kbd>${x}</kbd>`)
                    .join(" ")}</span>${btn("Rebind", "ghost sm")}`,
                ),
              )
              .join(""),
          ),
        )
        .join("")
    );
  };
  P.notify = () =>
    sec(
      "Inbox",
      row(
        "Keep notifications for",
        "Everything below lands in the Inbox first; toasts and OS alerts are copies",
        sel("30 days"),
      ) + row("Badge the rail with", "", seg(["Needs you + failures", "All unread", "Nothing"], 0)),
    ) +
    sec(
      "Deliver by type",
      `<table class="tbl rules"><tr><th></th><th>Inbox</th><th>Desktop</th><th>Push</th><th>Spoken</th><th>Sound</th></tr>${[
        ["Needs you (permission, question, plan)", 1, 1, 1, 0, 1],
        ["Failed (agent error, CI failed)", 1, 1, 1, 0, 0],
        ["Finished", 1, 1, 0, 0, 0],
        ["Host storage & security", 1, 1, 0, 0, 0],
        ["Updates available", 1, 0, 0, 0, 0],
        ["Plugin notifications", 1, 0, 0, 0, 0],
        ["Pairing requests", 1, 1, 1, 0, 1],
      ]
        .map(([n, ...c]) => `<tr><td>${n}</td>${c.map((x) => `<td>${tg(x)}</td>`).join("")}</tr>`)
        .join("")}</table>`,
    ) +
    sec(
      "This device",
      row(
        "OS permission",
        "macOS · Notifications allowed",
        `${badge("granted", "ok")}${btn("Refresh", "ghost sm")}`,
      ) +
        row("Play sound", "", tg(true)) +
        row("Test", "", btn("Send test notification", "ghost")) +
        row(
          "Quiet hours",
          "Hold desktop and push; Inbox still records",
          `${inp("22:00", "", "short")}–${inp("07:30", "", "short")}`,
        ),
    );
  P.voice = () =>
    sec(
      "Companion " + badge("preview", "warn"),
      row("Enable Companion", "Talk to your sessions hands-free", tg(true)) +
        row("Conversation model", "devbox config.json", sel("Default (Sonnet 5)")) +
        row("Reply length", "", seg(["Brief", "Detailed"], 0)) +
        row("Spoken task updates", "", seg(["Completions and failures", "Completions", "Off"], 0)) +
        row("Acknowledge tasks before working", "", tg(false)) +
        row("Audio mode", "", seg(["Call", "Media"], 0)) +
        row("Voice speed", "", num("1.3", "×")) +
        row("Pause before replying", "", seg(["Quick", "Natural", "Relaxed"], 1)) +
        row("Let me interrupt by speaking", "", seg(["Instantly", "Short", "Deliberate"], 0)) +
        row("Animate voice graphics", "", tg(true)) +
        row("Show reply text", "", tg(true)) +
        row("Codex voice", "Experimental", tg(false)),
    ) +
    sec(
      "Spoken alerts",
      row("Auto-play spoken alerts", "", tg(false)) +
        row("Confirm voice replies", "Shows the transcript for 2 s before sending", tg(true)) +
        row("Test audio", "", btn("Play test", "ghost")),
    );
  P.providers = () =>
    `<div class="ib-filter wide">${inp("", "Search providers")}${btn("Add provider…", "approve", 'data-act="provider-catalog"')}</div>` +
    sec(
      "On devbox",
      D.providers
        .map(
          (p) =>
            `<div class="prov ${p.st === "Error" ? "err" : ""}" data-act="provider-detail" data-spot><span class="pv-n"><b>${p.name}</b><span class="pst pst-${p.st.toLowerCase().replace(" ", "-")}">${p.st}</span></span><span class="mut">${p.models ? p.models + " models" : ""}</span><span class="mut mono">${p.ver}${p.ver !== p.latest && p.ver !== "—" ? ` → <span class="amber">${p.latest}</span>` : ""}</span><span class="mut">${p.acct ? p.acct + " account" + (p.acct > 1 ? "s" : "") : ""}</span><span class="pv-a">${p.st === "Not installed" ? btn("Install", "ghost sm") : p.ver !== p.latest ? btn("Update", "ghost sm") : ""}${tg(p.on)}${ic("chev", 14)}</span>${p.err ? `<span class="perr">${p.err}</span>` : ""}</div>`,
        )
        .join(""),
      "Defaults for new agents: Claude Code · Opus 5.5 · high thinking · Auto-edit",
    );
  P.accounts = () =>
    sec(
      "Claude Code",
      D.accounts
        .filter((a) => a.prov === "Claude Code")
        .map(acct)
        .join("") +
        `<div class="srow"><div class="sl"></div><div class="sc">${btn("Add Claude Code account", "ghost", 'data-act="add-account"')}</div></div>`,
    ) +
    sec("Codex", acct(D.accounts[2])) +
    sec("Copilot", acct(D.accounts[3])) +
    sec(
      "Move accounts between hosts",
      row("Export bundle", "Contains credentials in plain text", btn("Export…", "ghost")) +
        row("Import bundle", "", btn("Paste JSON…", "ghost")),
    );
  const acct = (a) =>
    `<div class="acrow"><span class="sw" style="background:${a.color}"></span><div class="ac-t"><b>${a.name}</b> ${a.def ? badge("default") : ""}<span class="mut">${a.plan} · ~/.frogg/accounts/${a.id} · signed in</span></div><span class="ac-w">${a.w
      .slice(0, 2)
      .map(([n, p]) => `<span class="wl"><i>${n}</i>${meter(p)}<em>${p}%</em></span>`)
      .join("")}</span>${btn("Manage", "ghost sm")}</div>`;
  P.modes = () =>
    `<p class="lede">One vocabulary across providers. Each mode maps to the provider’s own name; providers that lack a level skip it in the picker.</p>` +
    sec(
      "Modes",
      `<table class="tbl modes"><tr><th>Mode</th><th>Claude Code</th><th>Codex</th><th>Copilot</th><th>OpenCode</th></tr>${D.modes.map(([m, d, map]) => `<tr><td><b>${m}</b><small>${d}</small></td>${["Claude Code", "Codex", "Copilot", "OpenCode"].map((p) => `<td class="${map[p] === "—" ? "mut" : "mono"}">${map[p]}</td>`).join("")}</tr>`).join("")}</table>`,
    ) +
    sec(
      "Defaults",
      row("New sessions start in", "", seg(["Plan", "Ask", "Auto-edit", "Auto", "Unattended"], 2)) +
        row("Allow Unattended", "Off hides it from the picker on every client", tg(true)) +
        row("Unattended only in worktrees", "Never on Local isolation", tg(true)) +
        row("⇧Tab cycles", "", seg(["Plan → Ask → Auto-edit", "All modes"], 0)),
    );
  P.usage = () =>
    sec(
      "Meters",
      row("Refresh on a timer", "", `${tg(true)}${num(30, "s")}`) +
        row("Refresh on hover", "", tg(true)) +
        row("Refresh after a reply", "", tg(true)) +
        row("Warning at", "", num(65, "%")) +
        row("Critical at", "", num(90, "%")) +
        row("Animate changes", "", tg(true)),
      "Device settings for the rings in the composer and status bar",
    ) +
    sec(
      "When a limit is hit",
      row("Resume after the window resets", "devbox", tg(true)) +
        row(
          "Auto-resume countdown",
          "Shown in the composer; cancel any time",
          sel("Immediately at reset"),
        ) +
        row("Suggest moving to another account", "", tg(true)),
    );
  P.context = () =>
    sec(
      "Clean cut",
      row("Before resuming after a usage limit", "", tg(true)) +
        row("Before resuming after a restart", "", tg(false)) +
        row(
          "Idle threshold",
          "Empty uses the provider’s cache lifetime (1 h for Claude and Codex)",
          num("", "min"),
        ) +
        row("Summary model", "", sel("Automatic (cheapest on same provider)")),
    ) +
    sec(
      "Per provider",
      row("Codex", "Threshold 45 min · summary GPT-5.3 Codex Mini", btn("Edit", "ghost sm")) +
        row("Add override", "", btn("Add…", "ghost sm")),
    ) +
    sec(
      "Stale cache warning",
      row(
        "Warn when sending re-bills cached context",
        "Shows “Cache expired: sending re-bills N tokens” with a Clean cut button",
        tg(true),
      ),
    );
  P.orchestration = () =>
    sec(
      "Frogg tools for agents",
      row(
        "Enable Frogg tools",
        "Lets agents create worktrees, start agents and schedule work (MCP)",
        tg(true),
      ) +
        row(
          "Browser tools",
          "Agents can drive browser tabs. Exposes page content to the model",
          tg(false),
        ) +
        row(
          "Terminal agent hooks",
          "Installs hooks in agent config files so terminal agents report status",
          tg(false),
        ),
    ) +
    sec(
      "System prompt for every agent",
      area("Prefer pnpm. Never push to stable. Keep commits small and conventional.", "", 3),
    ) +
    sec(
      "Skills",
      ["frogg-dev", "frogg-daemon-rpc", "frogg-localisation", "frogg-release", "frogg-docs"]
        .map((s, i) =>
          row(
            s,
            [
              "Build, run and test the monorepo",
              "Add a daemon RPC",
              "UI copy in nine locales",
              "Publish builds",
              "Docs alongside code",
            ][i],
            `${btn("View", "ghost sm")}${tg(i !== 3)}`,
          ),
        )
        .join(""),
    ) +
    sec(
      "Agent definitions on disk",
      [
        "reviewer · project · .claude/agents/reviewer.md",
        "explore · user · ~/.claude/agents/explore.md",
        "docs-writer · project · .claude/agents/docs-writer.md",
      ]
        .map((x) =>
          row(
            x.split(" · ")[0],
            x.split(" · ").slice(1).join(" · "),
            `${btn("Open", "ghost sm")}${btn("Copy path", "ghost sm")}`,
          ),
        )
        .join(""),
    );
  P.host = () =>
    sec(
      "Identity",
      row("Name", "", inp("devbox")) +
        row(
          "Colour",
          "",
          `<span class="sws">${["#25b5c8", "#3fcf8e", "#8b7cf6", "#f5b84a", "#ff6b6b", "#38bdf8", "#fb923c"].map((c, i) => `<i class="${i === 0 ? "on" : ""}" style="background:${c}"></i>`).join("")}</span>`,
        ) +
        row("Rail and list badge", "", seg(["Name", "Icon", "Hidden"], 0)),
    ) +
    sec(
      "Connections",
      [
        ["Relay", "relay.frogg.dev:443 · TLS", "18 ms"],
        ["Direct", "devbox.lan:6767", "4 ms"],
        ["SSH tunnel", "steve@devbox:22", "idle"],
      ]
        .map(([n, a, l]) =>
          row(n, a, `<span class="mut mono">${l}</span>${btn("Remove", "ghost sm")}`),
        )
        .join("") +
        row(
          "Relay endpoint",
          "Overridden by FROGG_RELAY_ENDPOINT if set",
          `${inp("relay.frogg.dev:443", "", "mono")}${tg(true)}<span class="mut sm">TLS</span>`,
        ),
    ) +
    sec(
      "Web client",
      row("Status", "Running on :6768", `${badge("running", "ok")}${btn("Stop", "ghost sm")}`) +
        row("Start with the daemon", "", tg(true)) +
        row("Interface", "", seg(["This machine only", "All interfaces"], 0)),
    ) +
    sec(
      "Danger zone",
      row(
        "Remove host",
        "Forget devbox on this device. The daemon keeps running",
        btn("Remove…", "ghost danger", 'data-act="remove-host"'),
      ),
    );
  P.devices = () =>
    `<div class="pairbar">${ic("qr", 22)}<div><b>Pair a device</b><p>One flow for phones, browsers and other computers: a QR, link and 8-character code that all carry the same offer.</p></div>${btn("Pair a device…", "approve", 'data-act="pair-device"')}</div>` +
    sec(
      "Waiting for approval",
      `<div class="req">${R3.glyph("permission")}<div><b>Firefox · ubuntu-ws</b><span>Asks for Operator · match code <code>4F-K2</code> · 5h ago</span></div>${sel("Operator")}${btn("Deny", "ghost sm")}${btn("Approve", "approve sm")}</div>`,
    ) +
    sec(
      "Paired devices",
      D.devices
        .map(
          ([n, r, w, k]) =>
            `<div class="acrow">${ic(k === "phone" ? "phone" : k === "web" ? "globe" : "laptop", 16)}<div class="ac-t"><b>${n}</b><span class="mut">${w}</span></div>${sel(r)}${btn(k === "macbook" ? "Rename" : "Revoke…", "ghost sm", k === "macbook" ? "" : 'data-act="revoke"')}</div>`,
        )
        .join(""),
    ) +
    sec(
      "Roles",
      row("Owner", "Everything, including pairing and security", "") +
        row("Operator", "Drive sessions, approve, run terminals", "") +
        row("Viewer", "Read-only", ""),
    );
  P.security = () =>
    sec(
      "Findings",
      `<div class="find warn">${ic("shield", 16)}<div><b>Listening on all interfaces without a password</b><p>devbox binds 0.0.0.0:6767. Anyone on this network can request pairing.</p><div class="acts">${btn("Set a password", "approve sm")}${btn("Bind to loopback", "ghost sm")}${btn("This is intended", "ghost sm")}</div></div></div><div class="find ok">${ic("check", 16)}<div><b>Claim mode on, owner set</b></div></div><div class="find ok">${ic("check", 16)}<div><b>Not trusting the local network</b></div></div>`,
    ) +
    sec(
      "Password",
      row(
        "Daemon password",
        "At least 8 characters",
        `${inp("", "New password")}${inp("", "Confirm")}`,
      ) + row("", "", btn("Set password", "approve sm")),
    ) +
    sec(
      "Network",
      row("Listen address", "", inp("0.0.0.0:6767", "", "mono")) +
        row("Trust local network", "Skip pairing for LAN clients", tg(false)) +
        row("Claim mode", "First device to pair becomes owner", tg(true)),
    );
  P.automation = () =>
    sec(
      "Sessions",
      row("Archive sessions when their PR merges", "", tg(true)) +
        row("Archive after", "", sel("1 hour")) +
        row("Pin sessions that need you", "", tg(false)),
    ) +
    sec(
      "Generated names, commits and PR text",
      row("Model", "", seg(["Automatic", "Choose"], 0)) +
        row("Fallback", "", sel("Haiku 5")) +
        row(
          "Per-project instructions",
          "Set in Project › Generated text",
          btn("Open", "ghost sm", 'data-page="metadata"'),
        ),
    );
  P.labels = () =>
    `<div class="ib-filter wide">${inp("", "Search labels")}${btn("New label", "approve")}</div>` +
    sec(
      "Labels on devbox",
      D.labels
        .map(
          ([n, c, hex, k]) =>
            `<div class="acrow"><span class="lbl" style="--c:${hex}">${n}</span><span class="mut">${c} · ${k} sessions</span><span class="sp"></span>${btn("Edit", "ghost sm")}${btn("Delete…", "ghost sm danger")}</div>`,
        )
        .join(""),
    );
  P.terminals = () =>
    sec(
      "Profiles",
      [
        ["zsh", "/bin/zsh", "-l"],
        ["Node REPL", "node", "--experimental-repl-await"],
        ["psql staging", "psql", "$STAGING_URL"],
        ["Claude Code (raw)", "claude", "--resume"],
      ]
        .map(
          ([n, c, a]) =>
            `<div class="acrow">${ic("terminal", 15)}<div class="ac-t"><b>${n}</b><span class="mut mono">${c} ${a}</span></div>${btn("Edit", "ghost sm")}${btn("Remove…", "ghost sm danger")}</div>`,
        )
        .join("") +
        `<div class="srow"><div class="sl"></div><div class="sc">${btn("Add profile", "ghost")}</div></div>`,
    );
  P.resources = () =>
    sec(
      "Now",
      [
        ["CPU", 38, "8 cores"],
        ["Memory", 61, "19.5 / 32 GiB"],
        ["Disk", 72, "338 / 470 GiB"],
      ]
        .map(([n, p, d]) => row(n, d, meter(p)))
        .join("") + row("Uptime", "", '<span class="mono">12d 4h · daemon pid 41822</span>'),
    ) +
    sec(
      "Storage owned by Frogg · 31.8 GiB",
      [
        ["Worktrees", "21.4 GiB"],
        ["Agent worktrees", "2.2 GiB"],
        ["Agent state", "4.1 GiB"],
        ["Logs", "3.2 GiB"],
        ["Provider accounts", "180 MiB"],
        ["Uploads", "1.2 GiB"],
        ["Speech cache", "90 MiB"],
        ["Daemon versions", "1.9 GiB"],
        ["Temp", "40 MiB"],
      ]
        .map(([n, s]) => row(n, "", `<span class="mono">${s}</span>${btn("Clean…", "ghost sm")}`))
        .join(""),
    ) +
    sec(
      "Storage alerts",
      row("Alerts", "", tg(true)) +
        row("Warning at", "", num(20, "GiB")) +
        row("Critical at", "", num(50, "GiB")) +
        row("Notify only at critical", "", tg(false)),
    );
  P.daemon = () =>
    `<div class="pairbar">${ic("upload", 22)}<div><b>devbox runs 0.9.14 · up to date</b><p>One update path per host. Frogg picks the method: self-update here, the desktop bundle for the built-in daemon, or SSH redeploy for remote hosts.</p></div>${btn("Check now", "ghost")}</div>` +
    sec(
      "Updates",
      row("Update automatically", "When idle", tg(true)) +
        row("Channel", "Beta lives in Developer", seg(["Stable", "Beta"], 0)) +
        row("Window", "", `${inp("02:00", "", "short")}–${inp("05:00", "", "short")}`) +
        row("Check every", "", num(24, "h")) +
        row("Method", "Detected", '<span class="mono">self-update · systemd</span>'),
    ) +
    sec(
      "Service",
      row("Restart daemon", "Running agents pause and resume", btn("Restart", "ghost sm")) +
        row(
          "Logs",
          "~/.frogg/daemon.log",
          `${btn("Open", "ghost sm")}${btn("Copy path", "ghost sm")}`,
        ) +
        row("Full status", "", btn("Show", "ghost sm")) +
        row("Built-in daemon (this Mac)", "Keep running after quit", tg(false)),
    ) +
    sec(
      "Recent updates",
      [
        ["0.9.14", "applied 3d ago"],
        ["0.9.13", "rolled back · health check failed"],
        ["0.9.12", "applied 11d ago"],
      ]
        .map(([v, o]) => row(v, o, ""))
        .join(""),
    );
  P.worktrees = () =>
    `<div class="fj">${ic("files", 14)}<span>frogg.json · committed on main · changes here edit the file in this session’s worktree</span>${btn("Open file", "ghost sm")}</div>` +
    sec(
      "New worktrees",
      row("Default base branch", "", inp("main", "", "mono")) +
        row(
          "Setup commands",
          "Run in the new worktree",
          area("pnpm install --frozen-lockfile\ncp ../.env.local .env.local", "", 3),
          { cls: "stack" },
        ) +
        row("Teardown commands", "", area("docker compose down -v", "", 2), { cls: "stack" }) +
        row(
          "Port range",
          "Was config-only",
          `${inp("5100", "", "short")}–${inp("5199", "", "short")}`,
          { tag: badge("was hidden", "warn") },
        ),
    );
  P.scripts = () =>
    sec(
      "Scripts",
      D.scripts
        .map(
          ([n, c, k]) =>
            `<div class="acrow">${ic(k === "service" ? "globe" : "play", 15)}<div class="ac-t"><b>${n}</b><span class="mut mono">${c}${k === "service" ? " · $FROGG_PORT" : ""}</span></div>${k === "service" ? badge("service") : ""}${btn("Edit", "ghost sm")}${btn("Remove…", "ghost sm danger")}</div>`,
        )
        .join("") +
        `<div class="srow"><div class="sl"></div><div class="sc">${btn("Add script", "ghost")}</div></div>`,
    ) +
    sec("Service URLs", row("Route", "", seg(["Reverse proxy", "Memorable", "Direct port"], 1)));
  P.ci = () =>
    sec(
      "CI",
      row("GitHub Actions", "Detected from .github/workflows", badge("on", "ok")) +
        row("Jenkins URL", "Was config-only", inp("https://jenkins.acme.dev", "", "mono"), {
          tag: badge("was hidden", "warn"),
        }) +
        row("Jenkins job", "", inp("android-release", "", "mono")) +
        row("Multibranch", "", tg(true)),
    ) +
    sec(
      "Release streams · developer",
      row("Streams", "", inp("main → beta → stable", "", "mono")) +
        row("Upstream remote", "", inp("upstream", "", "mono")),
    );
  P.metadata = () =>
    sec(
      "Instructions for generated text",
      row("Branch names", "", area("type/short-slug, e.g. feat/session-store", "", 2), {
        cls: "stack",
      }) +
        row("Commit messages", "", area("Conventional commits. Imperative, ≤ 72 chars.", "", 2), {
          cls: "stack",
        }) +
        row("Pull requests", "", area("Summary, Why, Testing. Link the to-do id.", "", 3), {
          cls: "stack",
        }),
    );
  P.plugins = () =>
    `<div class="pairbar">${ic("plugins", 22)}<div><b>Manage plugins in the Plugins tool</b><p>Install, update, sources and permissions live in the rail. Settings for each installed plugin are listed here too.</p></div>${btn("Open Plugins", "ghost", 'data-tool="plugins"')}</div>` +
    sec(
      "Sentry",
      row("Organisation slug", "", inp("acme")) +
        row("Auth token", "", inp("••••••••••••", "", "mono")) +
        row("Show resolved issues", "", tg(false)),
    ) +
    sec("Linear", row("Team", "", sel("ENG")) + row("Move issue to Done on merge", "", tg(true))) +
    sec("Docker", row("Compose file", "", inp("docker-compose.yml", "", "mono")));
  P.updates = () =>
    sec(
      "Frogg for macOS",
      row(
        "Version",
        "0.9.14 (stable)",
        `${badge("up to date", "ok")}${btn("Check now", "ghost sm")}`,
      ) +
        row("Check automatically", "Every 6 hours", tg(true)) +
        row(
          "Release channel",
          "Beta installs side by side as a separate app",
          seg(["Stable", "Beta"], 0),
        ) +
        row("What’s new", "", btn("Release notes", "ghost sm")),
    ) +
    sec(
      "Hosts",
      D.hosts
        .map((h) =>
          row(
            h.name,
            `daemon ${h.ver}`,
            h.ver === "0.9.14"
              ? badge("matches app", "ok")
              : `${badge("older than app", "warn")}${btn("Update…", "ghost sm", 'data-page="daemon"')}`,
          ),
        )
        .join(""),
    );
  P.about = () =>
    sec(
      "About",
      row("Frogg", "0.9.14 · macOS 16 · arm64", btn("Copy", "ghost sm")) +
        row("This device", "Steve’s MacBook Pro", "") +
        row("Licenses", "", btn("View", "ghost sm")),
    ) +
    sec(
      "Diagnostics",
      row(
        "App diagnostic",
        "Client, desktop, daemon, providers, logs",
        `${btn("Run", "approve sm")}${btn("Copy report", "ghost sm")}`,
      ) +
        row(
          "Provider diagnostics",
          "",
          btn("Open Providers", "ghost sm", 'data-page="providers"'),
        ) +
        row("Test audio", "", btn("Play", "ghost sm")),
    ) +
    sec(
      "Developer mode",
      row("Show developer settings", "Release streams, dev builds, beta daemons", tg(true)),
    );
  P.developer = () =>
    sec(
      "Channels",
      row("This app", "", seg(["Stable", "Beta", "Development"], 0)) +
        row("Beta app", "Installed 0.9.15-beta.2", btn("Open beta", "ghost sm")),
    ) +
    sec(
      "Beta daemon per host",
      D.hosts
        .slice(0, 2)
        .map((h) =>
          row(
            h.name,
            h.id === "devbox" ? "0.9.15-beta.2 · running on :6777" : "not installed",
            h.id === "devbox"
              ? `${btn("Stop", "ghost sm")}${btn("Uninstall…", "ghost sm danger")}`
              : btn("Install", "ghost sm"),
          ),
        )
        .join(""),
    ) +
    sec(
      "Dev builds",
      row(
        "~/projects/frogg-app",
        "main · 3 behind",
        `${btn("Launch", "ghost sm")}${btn("Rebuild & restart", "ghost sm")}`,
      ) +
        row(
          "~/.frogg/worktrees/sneaky-hedgehog",
          "frogg-interface-design-mockups",
          btn("Launch", "ghost sm"),
        ),
    );

  function main() {
    const it = flat.find((x) => x.id === S.page) || flat[0];
    const where =
      it.sc === "device"
        ? scope("device")
        : it.sc === "host"
          ? scope("host")
          : it.sc === "project"
            ? scope("project")
            : "";
    return `<div class="th set"><div class="th-t"><span class="eyebrow">${it.g}</span><h1><button class="m-back" data-back>←</button>${it.t}</h1></div><div class="acts">${where}</div></div><div class="spage" id="spage"><div class="spage-in">${P[it.id]()}</div></div>`;
  }
  return { TREE, flat, side, main };
})();
