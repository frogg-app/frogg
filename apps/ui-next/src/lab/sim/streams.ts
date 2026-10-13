// A simulated release-streams graph for the lab: main (beta channel) → stable, feature branches
// contributing to main, pending promotions, a backport and release tags.
import { latency } from "./time";

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() - days * DAY).toISOString();

let seq = 0;
const sha = (seed: string) => {
  let h = 0x811c9dc5;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h.toString(16).padStart(8, "0") + (h ^ 0x5bd1e995).toString(16).padStart(8, "0"))
    .repeat(3)
    .slice(0, 40);
};

interface Presence {
  stream: string;
  state: string;
  via: string | null;
  release: string | null;
}
const p = (
  stream: string,
  state: string,
  via: string | null = null,
  release: string | null = null,
): Presence => ({
  stream,
  state,
  via,
  release,
});

function change(
  subject: string,
  origin: string,
  days: number,
  presence: Presence[],
  author = "Paz",
) {
  seq += 1;
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?:/.exec(subject);
  return {
    sha: sha(`${subject}${seq}`),
    subject,
    type: m?.[1] ?? "other",
    scope: m?.[2] ?? null,
    breaking: !!m?.[3],
    author,
    date: at(days),
    origin,
    presence,
  };
}

const release = (tag: string, days: number) => ({
  tag,
  version: tag.replace(/^v/, ""),
  sha: sha(tag),
  date: at(days),
});

/** The graph `checkoutStreamsGetGraph` resolves with. */
export function streamsGraph(cwd: string) {
  seq = 0;
  const streams = [
    {
      id: "development",
      kind: "development",
      label: "main",
      ref: "refs/heads/main",
      channel: "beta",
      exists: true,
      head: sha("main-head"),
      headDate: at(0.1),
      version: "1.6.13-beta.1",
      unreleased: 5,
      releases: [
        release("v1.6.13-beta.1", 1.2),
        release("v1.6.12-beta.3", 4),
        release("v1.6.12-beta.2", 6),
      ],
    },
    {
      id: "stable",
      kind: "stable",
      label: "stable",
      ref: "refs/heads/stable",
      channel: "stable",
      exists: true,
      head: sha("stable-head"),
      headDate: at(3),
      version: "1.6.12",
      unreleased: 1,
      releases: [release("v1.6.12", 3), release("v1.6.11", 11)],
    },
    {
      id: "feat/session-cache-cap",
      kind: "feature",
      label: "feat/session-cache-cap",
      ref: "refs/heads/feat/session-cache-cap",
      channel: "none",
      exists: true,
      head: sha("feat-head"),
      headDate: at(0.02),
      version: null,
      unreleased: 2,
      releases: [],
    },
    {
      id: "fix/android-keyboard",
      kind: "feature",
      label: "fix/android-keyboard",
      ref: "refs/heads/fix/android-keyboard",
      channel: "none",
      exists: true,
      head: sha("kbd-head"),
      headDate: at(0.6),
      version: null,
      unreleased: 1,
      releases: [],
    },
  ];
  const changes = [
    change(
      "feat(server): cap the session cache with LRU eviction",
      "feat/session-cache-cap",
      0.02,
      [
        p("feat/session-cache-cap", "landed", "commit"),
        p("development", "pending", "contribution"),
      ],
    ),
    change("test(server): cover session cache eviction", "feat/session-cache-cap", 0.05, [
      p("feat/session-cache-cap", "landed", "commit"),
      p("development", "pending", "contribution"),
    ]),
    change("fix(ui-next): keep phone chat pinned above the keyboard", "fix/android-keyboard", 0.6, [
      p("fix/android-keyboard", "landed", "commit"),
      p("development", "pending", "contribution"),
    ]),
    change("feat(ui-next): tool call settle animation", "development", 0.3, [
      p("development", "landed", "commit"),
      p("stable", "pending", "promotion"),
    ]),
    change("fix(daemon): stop OOM kills from build children", "development", 0.8, [
      p("development", "landed", "commit"),
      p("stable", "landed", "backport"),
    ]),
    change("perf(server): stream checkout diffs in chunks", "development", 0.9, [
      p("development", "landed", "commit"),
      p("stable", "pending", "promotion"),
    ]),
    change("feat(ui-next): release streams in source control", "development", 1, [
      p("development", "landed", "commit"),
      p("stable", "pending", "promotion"),
    ]),
    change("fix(client): retry relay reconnect after sleep", "development", 1.1, [
      p("development", "landed", "commit"),
      p("stable", "pending", "promotion"),
    ]),
    change("feat(protocol): sessionCache config block", "development", 1.3, [
      p("development", "shipped", "commit", "v1.6.13-beta.1"),
      p("stable", "pending", "promotion"),
    ]),
    change("fix(desktop): restore window bounds on Linux", "development", 4, [
      p("development", "shipped", "commit", "v1.6.12-beta.3"),
      p("stable", "shipped", "promotion", "v1.6.12"),
    ]),
    change("feat(server): host metrics in settings", "development", 6, [
      p("development", "shipped", "commit", "v1.6.12-beta.2"),
      p("stable", "shipped", "promotion", "v1.6.12"),
    ]),
  ];
  const flows = [
    {
      from: "development",
      to: "stable",
      kind: "promote",
      pending: 5,
      command: "npm run release:promote",
    },
    { from: "stable", to: "development", kind: "forward-port", pending: 0, command: null },
    { from: "development", to: "stable", kind: "backport", pending: 1, command: "git cherry-pick" },
    {
      from: "feat/session-cache-cap",
      to: "development",
      kind: "contribute",
      pending: 2,
      command: "open PR #412",
    },
    { from: "development", to: "feat/session-cache-cap", kind: "sync", pending: 0, command: null },
    {
      from: "fix/android-keyboard",
      to: "development",
      kind: "contribute",
      pending: 1,
      command: "PR #409",
    },
    {
      from: "development",
      to: "fix/android-keyboard",
      kind: "sync",
      pending: 3,
      command: "git merge main",
    },
  ];
  const events = [
    {
      kind: "promotion",
      from: "development",
      to: "stable",
      fromRelease: "v1.6.12-beta.3",
      toRelease: "v1.6.12",
      sha: sha("promo"),
      date: at(3),
      count: 14,
    },
    {
      kind: "backport",
      from: "development",
      to: "stable",
      fromRelease: null,
      toRelease: null,
      sha: sha("backport"),
      date: at(0.7),
      count: 1,
    },
  ];
  return {
    cwd,
    config: { development: "main", stable: "stable", upstream: null, declared: true },
    streams,
    flows,
    changes,
    events,
    truncated: false,
    fetchedAt: at(0.005),
    fetchError: null,
    error: null,
    requestId: "lab",
  };
}

export async function checkoutStreamsGetGraph(cwd: string) {
  await latency(600);
  return streamsGraph(cwd);
}
