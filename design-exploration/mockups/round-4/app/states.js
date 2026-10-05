/* Every surface addressable by ?state=<id>. Gallery and render.cjs read window.STATES. */
(function () {
  const { ic, btn, badge, seg, inp, tg, sel } = U;
  const st = (id, g, c, fn, o = {}) => ({ id, g, c, fn, ...o });
  const after = (f, ms = 120) => setTimeout(f, ms);
  const at = (q) => document.querySelector(q);
  const ses =
    (cur, extra = {}) =>
    () =>
      go("sessions", { cur, open: [...new Set(["s1", "s2", "s7", cur])], ...extra });
  const page = (p) => () => go("settings", { page: p });
  const full = (html) => () => {
    go("sessions");
    const d = document.createElement("div");
    d.className = "fullscreen";
    d.innerHTML = html;
    document.getElementById("layer").appendChild(d);
  };
  const emptyMain = (eyebrow, title, body, acts) =>
    `${Tools.th(eyebrow, title)}<div class="empty-state">${body}<div class="acts">${acts}</div></div>`;
  const welcome = `<div class="welcome"><div class="wl-mark">${R3.facet("frogg-brand", ["#7fd9e6", "#045b9d"], 72)}</div><span class="eyebrow">Frogg 0.9.14</span><h1>Run coding agents anywhere, steer them from here.</h1><p>Agents run on a host: this Mac, a server, or a cloud box. Pick where the first one runs.</p>
    <div class="wl-opts"><button class="meth on">${ic("laptop", 20)}<span><b>Run agents on this Mac</b><small>Installs the Frogg daemon (~180 MB) and starts it now</small></span></button><button class="meth">${ic("hosts", 20)}<span><b>Connect to a host</b><small>Scan, paste a pairing link, SSH, or deploy to a server</small></span></button></div>
    <div class="wl-steps">${[
      ["done", "Daemon"],
      ["running", "Providers"],
      ["idle", "First project"],
    ]
      .map(([k, t], i) => `<span>${R3.glyph(k)}${i + 1}. ${t}</span>`)
      .join("")}</div>
    <div class="wl-prov"><h3>Providers found on this Mac</h3>${[
      ["Claude Code", "2.4.1 · signed in as steve@work", "done"],
      ["Codex", "0.73.0 · not signed in", "permission"],
      ["Copilot", "not installed", "idle"],
    ]
      .map(
        ([n, d, k]) =>
          `<div class="ck">${R3.glyph(k)}<b>${n}</b><span class="mut">${d}</span><span class="sp"></span>${k === "permission" ? btn("Sign in", "sm") : k === "idle" ? btn("Install", "ghost sm") : badge("ready", "ok")}</div>`,
      )
      .join("")}</div>
    <div class="acts">${btn("Settings", "ghost")}<span class="sp"></span>${btn("Continue", "approve")}</div></div>`;
  const home = `${Tools.th("devbox", "Start something")}<div class="home"><div class="tiles">${[
    ["plus", "Add a project", "Browse devbox or open a path", "add-project"],
    ["upload", "Import conversations", "Claude Code, Codex or JSONL files", "import"],
    ["bolt", "Set up providers", "4 available · 1 needs attention", "page:providers"],
    ["qr", "Pair a device", "Phone, browser or another computer", "pair-device"],
  ]
    .map(
      ([i, t, d, a]) =>
        `<button class="tile" data-act="${a}" data-spot>${ic(i, 22)}<b>${t}</b><small>${d}</small></button>`,
    )
    .join("")}</div>
    <div class="newchat"><span class="eyebrow">Or just ask · no project</span><h2>What do you want to know?</h2><div class="composer"><div class="composer-input" contenteditable="true" data-placeholder="Ask anything…"></div><div class="composer-bar"><button class="chip chip-agent"><span class="agent-swatch"></span>Claude Code</button><button class="chip chip-model">Opus 5.5</button><label class="chip">${tg(false)} Web</label><span class="bar-spacer"></span><span class="mut sm">Read-only sandbox: no shell, writes only to the chat folder</span><button class="send">${Frogg.icons.send}</button></div></div></div></div>`;
  const banner = (k, t, d, a) =>
    `<div class="banner ${k}">${R3.glyph(k === "warn" ? "permission" : k === "err" ? "error" : "running")}<b>${t}</b><span>${d}</span><span class="sp"></span>${a}</div>`;

  window.STATES = [
    // Shell & rail tools
    st(
      "sessions",
      "Shell & rail tools",
      "Sessions: attention-sorted inbox, fleet bar, gliding brackets, live session with plan + subagents",
      ses("s1"),
    ),
    st(
      "tool-search",
      "Shell & rail tools",
      "Search: code and conversation results in one list; main shows the match in context",
      () => go("search"),
    ),
    st(
      "tool-files",
      "Shell & rail tools",
      "Files: session worktree tree with git status; editor with change gutter and vim status",
      () => go("files"),
    ),
    st(
      "tool-scm",
      "Shell & rail tools",
      "Source control: branch card, commit box, staged/changes, session commits; split diff with review comments",
      () => go("scm"),
    ),
    st(
      "tool-prs",
      "Shell & rail tools",
      "PRs & CI: this session’s PR with checks, reviews, activity and merge rules",
      () => go("prs"),
    ),
    st(
      "tool-terminals",
      "Shell & rail tools",
      "Terminals & services: session terminals, frogg.json scripts with URLs, setup log; split terminals",
      () => go("terminals"),
    ),
    st(
      "tool-tasks",
      "Shell & rail tools",
      "Tasks: project to-do board with agent claims; agent plan lives in the side tab",
      () => go("tasks", { taskTab: "plan" }),
    ),
    st(
      "tool-tasks-todos",
      "Shell & rail tools",
      "Tasks › Project to-dos list grouped by category, with priority and claims",
      () => go("tasks", { taskTab: "todos" }),
    ),
    st(
      "tool-hosts",
      "Shell & rail tools",
      "Hosts & devices: host health, who is connected, pairing request, security, storage, daemon",
      () => go("hosts"),
    ),
    st(
      "tool-usage",
      "Shell & rail tools",
      "Usage & limits: every account’s windows in the side, account detail with history and limit behaviour",
      () => go("usage"),
    ),
    st(
      "tool-plugins",
      "Shell & rail tools",
      "Plugins: installed list with status/tier; detail shows what the plugin adds and its permissions",
      () => go("plugins"),
    ),
    st(
      "tool-inbox",
      "Shell & rail tools",
      "Inbox (new): persisted notifications grouped by urgency; act on a permission without opening the session",
      () => go("inbox"),
    ),
    st(
      "palette",
      "Shell & rail tools",
      "⌘K palette: sessions, commands, settings and tools in one list",
      () => {
        ses("s1")();
        after(() => document.querySelector("[data-pal]").click());
      },
    ),
    st(
      "palette-settings",
      "Shell & rail tools",
      "⌘K palette mixing commands and settings; keywords match inside pages (“mode”)",
      () => {
        ses("s1")();
        after(() => {
          document.querySelector("[data-pal]").click();
          const i = document.querySelector(".pal-input");
          i.value = "mode";
          i.dispatchEvent(new Event("input"));
        });
      },
    ),
    // Sessions & chat
    st(
      "scope-menu",
      "Sessions & chat",
      "Scope switcher replaces project icons: all projects, one project, Chats, History",
      () => {
        ses("s1")();
        after(() => O["scope-menu"]());
      },
    ),
    st(
      "scope-project",
      "Sessions & chat",
      "Scoped to one project: fleet bar and groups follow the scope",
      () => go("sessions", { scope: "billing", cur: "s7" }),
    ),
    st(
      "display-menu",
      "Sessions & chat",
      "Display options: group, sort, title, row fields, filters",
      () => {
        ses("s1")();
        after(() => O["display-menu"]());
      },
    ),
    st(
      "session-menu",
      "Sessions & chat",
      "Session actions menu (also on row right-click), including plugin actions",
      () => {
        ses("s1")();
        after(() => O["session-menu"]());
      },
    ),
    st(
      "session-drawer",
      "Sessions & chat",
      "Changes drawer (\\) slides in beside the chat",
      ses("s1", { drawer: true }),
    ),
    st(
      "session-failed",
      "Sessions & chat",
      "Failed session: failing test inline with the error",
      ses("s6"),
    ),
    st(
      "session-done",
      "Sessions & chat",
      "Ready to review: finished turn with diff summary and Create PR",
      ses("s5"),
    ),
    st(
      "chats",
      "Sessions & chat",
      "Chats scope: project-less chats by date, read-only sandbox",
      () => go("sessions", { scope: "chats", mainHTML: null }),
    ),
    st(
      "history",
      "Sessions & chat",
      "History scope: archived sessions across hosts with Restore",
      () => go("sessions", { scope: "archived" }),
    ),
    st(
      "new-session",
      "Sessions & chat",
      "New session sheet: project, host, isolation, start ref, agent controls, prompt",
      () => {
        ses("s1")();
        after(() => O["new-session"]());
      },
    ),
    st("import", "Sessions & chat", "Import conversations from a host’s providers or files", () => {
      ses("s1")();
      after(() => O.import());
    }),
    st(
      "clean-cut",
      "Sessions & chat",
      "Clean-cut divider in the transcript with cost and summary model",
      ses("s9", { variant: "cleancut" }),
    ),
    st(
      "tab-menu",
      "Sessions & chat",
      "Tab context menu: reload agent, copy resume command, split, close variants",
      () => {
        ses("s1")();
        after(() => O["tab-menu"](at(".tab.on")));
      },
    ),
    // Composer
    st(
      "composer-model",
      "Composer",
      "Model picker: grouped by provider, thinking level, provider features",
      () => {
        ses("s4")();
        after(() => O.model());
      },
    ),
    st(
      "composer-mode",
      "Composer",
      "Permission mode picker with the shared vocabulary; native name shown beside",
      () => {
        ses("s4")();
        after(() => O.mode());
      },
    ),
    st(
      "composer-attach",
      "Composer",
      "Attach menu: files, images, issues/PRs, CI logs, review comments, plugin actions",
      () => {
        ses("s4")();
        after(() => O.attach());
      },
    ),
    st("composer-slash", "Composer", "Slash commands and skills autocomplete", () => {
      ses("s4")();
      after(() => {
        const c = at(".composer-input");
        c.textContent = "/re";
        O.slash();
      });
    }),
    st(
      "composer-account",
      "Composer",
      "Account menu: locked once started, move or clean-cut to another account",
      () => {
        ses("s4")();
        after(() => O.account());
      },
    ),
    st(
      "composer-notices",
      "Composer",
      "Composer notices: stale cache warning, auto-resume countdown, queued message",
      ses("s4", {
        comp: {
          notice: `<div class="cnote warn">${R3.glyph("permission")}<span>Cache expired: sending re-bills <b>182k</b> input tokens (~$2.70)</span><button class="link">Clean cut instead</button></div><div class="cnote">${R3.glyph("running")}<span>Usage limit reached · auto-resume in <b>1:12:40</b></span><button class="link">Cancel auto-resume</button><button class="link">Move to personal…</button></div>`,
          att: `<span class="att">${ic("image", 12)} screenshot-push.png <b>×</b></span><span class="att">${ic("pr", 12)} #1279 <b>×</b></span><span class="att">${ic("terminal", 12)} CI log · test (windows) <b>×</b></span>`,
        },
      }),
    ),
    st(
      "account-transfer",
      "Composer",
      "Move conversation to another account: full history vs clean cut vs switch provider",
      () => {
        ses("s4")();
        after(() => O.transfer());
      },
    ),
    // Approvals
    st(
      "approval-command",
      "Approvals",
      "Command approval inline in the chat; A approves, Esc denies, row Approve in the inbox",
      ses("s2"),
    ),
    st(
      "approval-plan",
      "Approvals",
      "Plan review: Implement / Edit / Reject with scope summary",
      ses("s7", { variant: "plan" }),
    ),
    st(
      "approval-question",
      "Approvals",
      "Agent question card with options and Other…",
      ses("s6", { variant: "question" }),
    ),
    st(
      "approval-inbox",
      "Approvals",
      "Approve from the Inbox with context and delivery record",
      () => go("inbox"),
    ),
    // Source control / PR / CI
    st(
      "scm-branch",
      "Source control, PRs & CI",
      "Branch switcher: branches and PRs, stash-and-switch warning",
      () => {
        go("scm");
        after(() => O.branch());
      },
    ),
    st(
      "scm-more",
      "Source control, PRs & CI",
      "All git actions with disabled reasons inline",
      () => {
        go("scm");
        after(() => O["git-more"]());
      },
    ),
    st(
      "pr-merge-menu",
      "Source control, PRs & CI",
      "Merge strategies and auto-merge with the blocking reason",
      () => {
        go("prs");
        after(() => O["merge-menu"]());
      },
    ),
    st(
      "ci-run",
      "Source control, PRs & CI",
      "CI run: jobs, failing log, Add log to chat, runners in the side",
      () => go("prs", { prTab: "ci" }),
    ),
    st(
      "release-streams",
      "Source control, PRs & CI",
      "Release streams (developer mode): stream lanes and waiting changes",
      () => go("prs", { prTab: "streams" }),
    ),
    // Terminals & files
    st(
      "file-menu",
      "Terminals & files",
      "File context menu: open in editor, add to chat, copy paths, rename, discard, delete",
      () => {
        go("files");
        after(() => O["file-menu"](at(".tn.on")));
      },
    ),
    st("editor-menu", "Terminals & files", "Open in external editor", () => {
      go("files");
      after(() => O["editor-menu"](at('[data-act="editor-menu"]')));
    }),
    st(
      "new-tab",
      "Terminals & files",
      "New tab launcher: agent, terminal profiles, browser",
      () => {
        go("terminals");
        after(() => O["new-tab"](at('.tabs [data-act="term-new"]')));
      },
    ),
    st(
      "service-url",
      "Terminals & files",
      "Opening a service URL: in Frogg, external browser or copy",
      () => {
        go("terminals");
        after(() => O["svc-url"]());
      },
    ),
    // Hosts & pairing
    st(
      "add-host",
      "Hosts & pairing",
      "Add a host: five methods, one confirm step (replaces six pairing flows)",
      () => {
        go("hosts");
        after(() => O["add-host"]());
      },
    ),
    st("pair-confirm", "Hosts & pairing", "Pair / claim confirm: fingerprint, role, expiry", () => {
      go("hosts");
      after(() => O["pair-confirm"]());
    }),
    st(
      "pair-device",
      "Hosts & pairing",
      "Pair a device: QR, code and link are one offer; role picked up front",
      () => {
        go("hosts");
        after(() => O["pair-device"]());
      },
    ),
    st("deploy", "Hosts & pairing", "Install on a server over SSH with step log", () => {
      go("hosts", { host: "ci-runner-2" });
      after(() => O.deploy());
    }),
    st("host-offline", "Hosts & pairing", "Unreachable host with retry, redeploy and remove", () =>
      go("hosts", { host: "ci-runner-2" }),
    ),
    // Providers / accounts / usage
    st(
      "provider-detail",
      "Providers, accounts & usage",
      "Provider detail: version, defaults, shared mode names, danger zone",
      () => {
        go("settings", { page: "providers" });
        after(() => O["provider-detail"]());
      },
    ),
    st(
      "add-account",
      "Providers, accounts & usage",
      "Add a provider account with shared folders",
      () => {
        go("settings", { page: "accounts" });
        after(() => O["add-account"]());
      },
    ),
    // Settings
    ...Settings.flat.map((x) => st("settings-" + x.id, "Settings", `${x.g} › ${x.t}`, page(x.id))),
    // Plugins
    st("plugins-browse", "Plugins", "Browse the catalog across sources", () =>
      go("plugins", { plugTab: "browse" }),
    ),
    st(
      "plugins-sources",
      "Plugins",
      "Sources: repositories with pinned keys and linked local plugins",
      () => go("plugins", { plugTab: "repos" }),
    ),
    st(
      "plugin-consent",
      "Plugins",
      "Install consent: capabilities and the not-sandboxed warning",
      () => {
        go("plugins", { plugTab: "browse" });
        after(() => O.consent());
      },
    ),
    st(
      "plugin-panel",
      "Plugins",
      "Plugin-contributed rail tool (Sentry list panel) using the same side + main frame",
      () => go("sentry"),
    ),
    st("plugin-panel-form", "Plugins", "Second plugin rail tool (Linear) with a plugin form", () =>
      go("linear"),
    ),
    // Notifications
    st(
      "toasts",
      "Notifications & inbox",
      "Toasts are transient copies of Inbox items (approve with undo, CI failed, update)",
      () => {
        ses("s1")();
        after(() => {
          U.toast("Approved · Fix composer draft loss", {
            d: "pnpm db:migrate --env staging",
            act: "Undo",
            sticky: 1,
          });
          U.toast("CI failed on chore/i18n-settings", {
            d: "test (windows) · 2 failed",
            k: "error",
            act: "Open",
            sticky: 1,
          });
          U.toast("Translate settings strings is ready", {
            d: "+912 −40 · 9 locales",
            k: "done",
            act: "Review",
            sticky: 1,
          });
        });
      },
    ),
    st(
      "banners",
      "Notifications & inbox",
      "Banners for host-wide conditions: version mismatch, reconnecting, storage",
      ses("s1", {
        banner:
          banner(
            "warn",
            "ci-runner-2 runs daemon 0.9.11",
            "older than this app (0.9.14); some features are hidden",
            btn("Update host…", "ghost sm", 'data-page="daemon"'),
          ) +
          banner(
            "run",
            "Reconnecting to devbox",
            "offline for 0:14 · messages queue until it’s back",
            btn("Retry now", "ghost sm"),
          ),
      }),
    ),
    st(
      "spoken-alert",
      "Notifications & inbox",
      "Spoken alert with voice reply (Allow / Deny / Send as message)",
      () => {
        ses("s1")();
        after(() => {
          const t = U.toast("Codex needs you · Fix composer draft loss", {
            d: "“Wants to run pnpm db migrate on staging.”",
            k: "permission",
            sticky: 1,
          });
          t.classList.add("voice");
          t.insertAdjacentHTML(
            "beforeend",
            `<div class="vr"><span class="wave">${"<i></i>".repeat(14)}</span><span>Listening… “yes, go ahead”</span>${btn("Allow", "approve sm")}${btn("Deny", "ghost sm")}${btn("Send as message", "ghost sm")}</div>`,
          );
        });
      },
    ),
    // Onboarding
    st(
      "welcome",
      "Onboarding",
      "First run: where agents run, provider check, three steps",
      full(welcome),
    ),
    st(
      "home",
      "Onboarding",
      "Start screen: add project, import, providers, pair, or a project-less chat",
      () => go("sessions", { scope: "all", mainHTML: home }),
    ),
    st("add-project", "Onboarding", "Add a project: browse the host’s folders", () => {
      go("sessions");
      after(() => O["add-project"]());
    }),
    st("companion", "Onboarding", "Companion voice overlay (preview), from the rail", () => {
      ses("s1")();
      after(() => O.companion());
    }),
    // Modals & confirmations
    st(
      "archive-confirm",
      "Modals & confirmations",
      "Archive with uncommitted/unpushed summary and a safer alternative",
      () => {
        ses("s1")();
        after(() => O.archive());
      },
    ),
    st("remove-host", "Modals & confirmations", "Typed confirmation for removing a host", () => {
      go("hosts", { host: "ci-runner-2" });
      after(() => O["remove-host"]());
    }),
    st(
      "rewind",
      "Modals & confirmations",
      "Rewind conversation, files or both, with Fork instead",
      () => {
        ses("s1")();
        after(() => O.rewind());
      },
    ),
    st("labels", "Modals & confirmations", "Labels picker from the session menu", () => {
      ses("s1")();
      after(() => O.labels());
    }),
    st("shortcuts", "Modals & confirmations", "Shortcut sheet (?)", () => {
      ses("s1")();
      after(() => O.shortcuts());
    }),
    st("todo-new", "Modals & confirmations", "New project to-do", () => {
      go("tasks", { taskTab: "todos" });
      after(() => O["todo-new"]());
    }),
    // Empty & error
    st("empty-sessions", "Empty & error states", "Project with no sessions", () =>
      go("sessions", {
        scope: "infra",
        cur: "s11",
        sideHTML: `<div class="lh"><button class="scope scope-btn" data-act="scope-menu">${R3.projFacet("docs", 15)}playground ${ic("down", 12)}</button></div><div class="empty-state side">${R3.facet("empty", ["#5f6b6e", "#1b252b"], 44)}<b>No sessions in playground yet</b><p>Start one on a new worktree, or import an existing conversation.</p>${btn("New session", "approve", 'data-act="new-session"')}${btn("Import…", "ghost", 'data-act="import"')}</div>`,
        mainHTML: emptyMain(
          "playground · devbox",
          "Nothing open",
          `<p class="mut">Set up worktree scripts so new sessions install dependencies automatically.</p>`,
          btn("Set up worktree scripts", "ghost", 'data-page="worktrees"'),
        ),
      }),
    ),
    st("empty-diff", "Empty & error states", "No changes yet / no CI configured", () =>
      go("scm", {
        mainHTML: emptyMain(
          "Changes",
          "No changes in this worktree yet",
          `${R3.facet("nochg", ["#5f6b6e", "#1b252b"], 44)}<p class="mut">The agent hasn’t edited anything. CI: add a <code>ci.jenkins</code> entry to frogg.json or push a GitHub Actions workflow.</p>`,
          btn("Open CI settings", "ghost", 'data-page="ci"'),
        ),
      }),
    ),
    st(
      "error-boundary",
      "Empty & error states",
      "Crash screen with retry and copyable details",
      () =>
        go("sessions", {
          mainHTML: emptyMain(
            "Something broke",
            "This view crashed",
            `${R3.glyph("error")}<p class="mut">TypeError: Cannot read properties of undefined (reading 'socket') in reconnect.ts:88. Your sessions keep running on their hosts.</p><pre class="term">at reconnect (apps/ui/src/connection/reconnect.ts:88:21)\nat Backoff.tick (apps/ui/src/connection/backoff.ts:41:5)</pre>`,
            btn("Try again", "approve") +
              btn("Copy details", "ghost") +
              btn("Run diagnostic", "ghost", 'data-page="about"'),
          ),
        }),
    ),
    st(
      "session-offline",
      "Empty & error states",
      "Session on an unreachable host shows saved activity",
      ses("s12", { variant: "offline" }),
    ),
    // Mobile
    st(
      "m-sessions",
      "Mobile",
      "Mobile: inbox with bottom tool bar",
      () => go("sessions", { mview: "list" }),
      { m: 1 },
    ),
    st(
      "m-chat",
      "Mobile",
      "Mobile: session with approval card",
      () => {
        ses("s2")();
        document.body.dataset.mview = "main";
      },
      { m: 1 },
    ),
    st(
      "m-more",
      "Mobile",
      "Mobile: More sheet lists every other tool, including plugin tools",
      () => {
        go("sessions", { mview: "list" });
        after(() => mMore());
      },
      { m: 1 },
    ),
    st("m-inbox", "Mobile", "Mobile: Inbox", () => go("inbox", { mview: "list" }), { m: 1 }),
    st("m-scm", "Mobile", "Mobile: Source control", () => go("scm", { mview: "list" }), { m: 1 }),
    st("m-settings", "Mobile", "Mobile: settings tree", () => go("settings", { mview: "list" }), {
      m: 1,
    }),
    st(
      "m-settings-page",
      "Mobile",
      "Mobile: a settings page (Permission modes)",
      () => go("settings", { page: "modes", mview: "main" }),
      { m: 1 },
    ),
  ];
  const q = new URLSearchParams(location.search).get("state") || "sessions";
  const s = STATES.find((x) => x.id === q) || STATES[0];
  document.body.dataset.state = s.id;
  s.fn();
  if (!document.body.dataset.mview) document.body.dataset.mview = "main";
})();
