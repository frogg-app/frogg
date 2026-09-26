import type {
  ReleaseStream,
  ReleaseStreamChange,
  ReleaseStreamEvent,
  ReleaseStreamFlow,
  ReleaseStreamPresence,
  ReleaseStreamRelease,
  ReleaseStreamsConfig,
} from "@frogg/protocol/messages";
import { compareVersionStrings } from "@frogg/protocol/release-version";

/** Runs git in the checkout and returns stdout; rejects on failure. */
export type StreamsGit = (args: string[]) => Promise<string>;

export interface ReleaseStreamsGraph {
  streams: ReleaseStream[];
  flows: ReleaseStreamFlow[];
  changes: ReleaseStreamChange[];
  events: ReleaseStreamEvent[];
  truncated: boolean;
}

/** Recent changes shown per graph; older history is summarised by the release nodes. */
export const CHANGE_WINDOW = 150;
const RELEASES_PER_STREAM = 12;
const INCOMING_WINDOW = 100;

const STABLE_TAG = /^v\d+\.\d+\.\d+$/;
const BETA_TAG = /^v\d+\.\d+\.\d+-beta\.\d+$/;
const RELEASE_CUT = /^chore\(release\): (?:cut|promote) /;
const PROMOTE = /^chore\(release\): promote \S+ (\S+) to /;
const SYNC = /^Merge upstream (\S+)/;
const CHERRY_PICKED = /\(cherry picked from commit ([0-9a-f]{7,40})\)/g;
const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s/;
const SEP = "\x1f";

interface StreamRef {
  id: string;
  kind: string;
  label: string;
  ref: string;
  channel: "beta" | "stable";
  tagNamespace: string;
  /** Which tags count as this stream's releases. */
  tagPattern: RegExp;
}

interface Commit {
  sha: string;
  subject: string;
  author: string;
  date: string | null;
}

async function tryGit(git: StreamsGit, args: string[]): Promise<string | null> {
  try {
    return await git(args);
  } catch {
    return null;
  }
}

function lines(text: string | null): string[] {
  return (text ?? "").split("\n").filter((line) => line.length > 0);
}

function parseLog(text: string | null): Commit[] {
  return lines(text).map((line) => {
    const [sha = "", subject = "", author = "", date = ""] = line.split(SEP);
    return { sha, subject, author, date: date || null };
  });
}

const LOG_FORMAT = ["%H", "%s", "%an", "%cI"].join(SEP);

function classify(subject: string): { type: string; scope: string | null; breaking: boolean } {
  const match = CONVENTIONAL.exec(subject);
  if (!match?.groups) return { type: "other", scope: null, breaking: false };
  return {
    type: match.groups.type ?? "other",
    scope: match.groups.scope || null,
    breaking: match.groups.bang === "!" || /BREAKING CHANGE/.test(subject),
  };
}

function streamRefs(config: ReleaseStreamsConfig, refExists: Set<string>): StreamRef[] {
  const local = (branch: string) =>
    refExists.has(`refs/remotes/origin/${branch}`) ? `refs/remotes/origin/${branch}` : `refs/heads/${branch}`;
  const refs: StreamRef[] = [];
  if (config.upstream) {
    const { remote, stable, development } = config.upstream;
    refs.push(
      {
        id: "upstream-stable",
        kind: "upstream-stable",
        label: `${remote}/${stable}`,
        ref: `refs/remotes/${remote}/${stable}`,
        channel: "stable",
        tagNamespace: `refs/remotes/${remote}/tags/`,
        tagPattern: STABLE_TAG,
      },
      {
        id: "upstream-development",
        kind: "upstream-development",
        label: `${remote}/${development}`,
        ref: `refs/remotes/${remote}/${development}`,
        channel: "beta",
        tagNamespace: `refs/remotes/${remote}/tags/`,
        tagPattern: BETA_TAG,
      },
    );
  }
  refs.push(
    {
      id: "stable",
      kind: "stable",
      label: config.stable,
      ref: local(config.stable),
      channel: "stable",
      tagNamespace: "refs/tags/",
      tagPattern: STABLE_TAG,
    },
    {
      id: "development",
      kind: "development",
      label: config.development,
      ref: local(config.development),
      channel: "beta",
      tagNamespace: "refs/tags/",
      tagPattern: BETA_TAG,
    },
  );
  return refs;
}

async function readVersion(git: StreamsGit, ref: string): Promise<string | null> {
  const text = await tryGit(git, ["show", `${ref}:package.json`]);
  if (!text) return null;
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** Release tags reachable from `ref`, newest version first. */
async function releasesOn(
  git: StreamsGit,
  ref: string,
  namespace: string,
  pattern: RegExp,
): Promise<ReleaseStreamRelease[]> {
  const out = await tryGit(git, [
    "for-each-ref",
    "--merged",
    ref,
    `--format=%(refname)${SEP}%(objectname)${SEP}%(*objectname)${SEP}%(creatordate:iso-strict)`,
    namespace,
  ]);
  const releases: ReleaseStreamRelease[] = [];
  for (const line of lines(out)) {
    const [refname = "", object = "", peeled = "", date = ""] = line.split(SEP);
    const tag = refname.slice(namespace.length);
    if (tag.includes("/") || !pattern.test(tag)) continue;
    releases.push({ tag, version: tag.slice(1), sha: peeled || object, date: date || null });
  }
  return releases.sort((a, b) => compareVersionStrings(b.version, a.version));
}

/**
 * The release on a stream that first contained each commit: `git name-rev` names a commit after
 * the nearest tag that contains it, which along a release branch is the earliest one.
 */
async function firstReleases(
  git: StreamsGit,
  shas: string[],
  stream: StreamRef,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (shas.length === 0) return result;
  const pattern = stream.tagPattern === BETA_TAG ? "v*-beta.*" : "v*";
  for (let index = 0; index < shas.length; index += 200) {
    const batch = shas.slice(index, index + 200);
    const out = await tryGit(git, [
      "name-rev",
      "--name-only",
      "--no-undefined",
      "--always",
      `--refs=${stream.tagNamespace}${pattern}`,
      ...(stream.tagPattern === STABLE_TAG ? [`--exclude=${stream.tagNamespace}*-*`] : []),
      ...batch,
    ]);
    const names = lines(out);
    batch.forEach((sha, i) => {
      const name = names[i]?.replace(/[~^].*$/, "").replace(/^(?:remotes\/[^/]+\/)?tags\//, "");
      if (name && stream.tagPattern.test(name)) result.set(sha, name.slice(1));
    });
  }
  return result;
}

/** `git cherry upstream head`: head's commits, split by whether upstream has an equivalent. */
async function cherry(
  git: StreamsGit,
  upstream: string,
  head: string,
): Promise<{ missing: string[]; equivalent: string[] }> {
  const missing: string[] = [];
  const equivalent: string[] = [];
  for (const line of lines(await tryGit(git, ["cherry", upstream, head]))) {
    if (line.startsWith("+ ")) missing.push(line.slice(2));
    else if (line.startsWith("- ")) equivalent.push(line.slice(2));
  }
  return { missing, equivalent };
}

async function revSet(git: StreamsGit, args: string[]): Promise<Set<string>> {
  return new Set(lines(await tryGit(git, ["rev-list", ...args])));
}

export async function buildReleaseStreamsGraph(input: {
  git: StreamsGit;
  config: ReleaseStreamsConfig;
}): Promise<ReleaseStreamsGraph> {
  const { git, config } = input;
  const known = new Set(
    lines(await tryGit(git, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"])),
  );
  const refs = streamRefs(config, known);
  const byId = new Map(refs.map((stream) => [stream.id, stream]));
  const exists = (stream: StreamRef | undefined): stream is StreamRef =>
    !!stream && known.has(stream.ref);
  const dev = byId.get("development")!;
  const stable = byId.get("stable")!;
  const upDev = byId.get("upstream-development");
  const upStable = byId.get("upstream-stable");
  const follow = config.upstream?.follow === "development" ? upDev : upStable;
  const followId: string | null = follow?.id ?? null;
  const hasDev = exists(dev);
  const hasStable = exists(stable);

  // Streams, their versions and releases.
  const streams: ReleaseStream[] = [];
  for (const stream of refs) {
    const present = known.has(stream.ref);
    // Before `streams init` there is no stable branch, but the stable releases that were cut from
    // the development branch are still the stable history worth drawing.
    const source = present ? stream.ref : stream.id === "stable" && hasDev ? dev.ref : null;
    const [head, releases, version] = source
      ? await Promise.all([
          tryGit(git, ["log", "-1", `--format=%H${SEP}%cI`, stream.ref]),
          releasesOn(git, source, stream.tagNamespace, stream.tagPattern),
          present ? readVersion(git, stream.ref) : Promise.resolve(null),
        ])
      : [null, [], null];
    const [headSha = null, headDate = null] = present && head ? head.split(SEP) : [];
    const newest = releases[0];
    const unreleased =
      present && newest
        ? Number((await tryGit(git, ["rev-list", "--count", "--no-merges", `${newest.sha}..${stream.ref}`])) ?? 0)
        : 0;
    streams.push({
      id: stream.id,
      kind: stream.kind,
      label: stream.label,
      ref: stream.ref,
      channel: stream.channel,
      exists: present,
      head: headSha,
      headDate: headDate || null,
      version: version ?? (present ? null : (newest?.version ?? null)),
      unreleased,
      releases: releases.slice(0, RELEASES_PER_STREAM),
    });
  }

  if (!hasDev) {
    return { streams, flows: [], changes: [], events: [], truncated: false };
  }

  // The change window: recent development commits, what upstream has that development lacks,
  // and anything made on stable alone.
  const devLog = parseLog(
    await tryGit(git, ["log", "--no-merges", `--format=${LOG_FORMAT}`, "-n", String(CHANGE_WINDOW + 1), dev.ref]),
  ).filter((commit) => !RELEASE_CUT.test(commit.subject));
  const truncated = devLog.length > CHANGE_WINDOW;
  const window = devLog.slice(0, CHANGE_WINDOW);

  const upstreamRefs = [upDev, upStable].filter(exists).map((stream) => stream.ref);
  const forkOnly = upstreamRefs.length
    ? await revSet(git, ["--no-merges", dev.ref, "--not", ...upstreamRefs])
    : null;
  const incoming =
    follow && exists(follow)
      ? parseLog(
          await tryGit(git, [
            "log",
            "--no-merges",
            `--format=${LOG_FORMAT}`,
            "-n",
            String(INCOMING_WINDOW),
            `${dev.ref}..${follow.ref}`,
          ]),
        ).filter((commit) => !RELEASE_CUT.test(commit.subject))
      : [];

  // Stable against development.
  const notInStable = hasStable ? await revSet(git, [`${stable.ref}..${dev.ref}`]) : null;
  const toStable = hasStable ? await cherry(git, stable.ref, dev.ref) : null;
  const backported = new Set(toStable?.equivalent ?? []);
  const stableOnly = hasStable
    ? parseLog(
        await tryGit(git, ["log", "--no-merges", `--format=${LOG_FORMAT}`, `${dev.ref}..${stable.ref}`]),
      )
    : [];
  const stableOnlyCherry = hasStable ? await cherry(git, dev.ref, stable.ref) : null;
  const stranded = stableOnly.filter(
    (commit) =>
      !RELEASE_CUT.test(commit.subject) && (stableOnlyCherry?.missing.includes(commit.sha) ?? false),
  );

  // Backports: the stable commit that carries each development commit (`cherry-pick -x`).
  const backportLog = hasStable
    ? lines(
        await tryGit(git, [
          "log",
          "--no-merges",
          "--grep=cherry picked from commit",
          `--format=%H${SEP}%cI${SEP}%B%x1e`,
          `${dev.ref}..${stable.ref}`,
        ]),
      )
    : [];
  const backportCarrier = new Map<string, { sha: string; date: string | null }>();
  for (const record of backportLog.join("\n").split("\x1e")) {
    const [sha = "", date = "", body = ""] = record.trim().split(SEP);
    if (!sha) continue;
    for (const match of body.matchAll(CHERRY_PICKED)) {
      backportCarrier.set(match[1]!, { sha, date: date || null });
    }
  }
  const carrierFor = (sha: string) => {
    for (const [picked, carrier] of backportCarrier) {
      if (sha.startsWith(picked) || picked.startsWith(sha)) return carrier;
    }
    return null;
  };

  // Upstream against the fork.
  const upDevCherry = exists(upDev) && forkOnly ? await cherry(git, upDev.ref, dev.ref) : null;
  const inUpDev = exists(upDev)
    ? await revSet(git, ["-n", String(CHANGE_WINDOW * 20), upDev.ref])
    : new Set<string>();
  const inUpStable = exists(upStable)
    ? await revSet(git, ["-n", String(CHANGE_WINDOW * 20), upStable.ref])
    : new Set<string>();

  // First release per stream.
  const windowShas = window.map((commit) => commit.sha);
  const carrierShas = windowShas.map((sha) => carrierFor(sha)?.sha).filter((sha): sha is string => !!sha);
  const [devReleases, stableReleases, upDevReleases, upStableReleases] = await Promise.all([
    firstReleases(git, windowShas, dev),
    hasStable ? firstReleases(git, [...windowShas, ...carrierShas, ...stranded.map((c) => c.sha)], stable) : new Map<string, string>(),
    exists(upDev) ? firstReleases(git, [...windowShas, ...incoming.map((c) => c.sha)], upDev) : new Map<string, string>(),
    exists(upStable) ? firstReleases(git, [...windowShas, ...incoming.map((c) => c.sha)], upStable) : new Map<string, string>(),
  ]);

  const presence = (
    stream: string,
    state: "shipped" | "landed" | "pending" | "absent",
    via: string | null,
    release: string | null = null,
  ): ReleaseStreamPresence => ({
    stream,
    state: state === "landed" && release ? "shipped" : state,
    via,
    release,
  });

  const changes: ReleaseStreamChange[] = [];
  for (const commit of window) {
    const forkMade = forkOnly ? forkOnly.has(commit.sha) : true;
    const origin = forkMade ? "development" : (followId ?? "upstream-development");
    const entries: ReleaseStreamPresence[] = [];
    if (config.upstream) {
      if (forkMade) {
        const contributed = upDevCherry?.equivalent.includes(commit.sha) ?? false;
        entries.push(
          presence("upstream-stable", "absent", null),
          presence(
            "upstream-development",
            contributed ? "landed" : "absent",
            contributed ? "contribution" : null,
          ),
        );
      } else {
        entries.push(
          presence(
            "upstream-stable",
            inUpStable.has(commit.sha) ? "landed" : "absent",
            inUpStable.has(commit.sha) ? "commit" : null,
            upStableReleases.get(commit.sha) ?? null,
          ),
          presence(
            "upstream-development",
            inUpDev.has(commit.sha) ? "landed" : "absent",
            inUpDev.has(commit.sha) ? "commit" : null,
            upDevReleases.get(commit.sha) ?? null,
          ),
        );
      }
    }
    if (!hasStable || !notInStable) {
      entries.push(presence("stable", "pending", null));
    } else if (!notInStable.has(commit.sha)) {
      entries.push(presence("stable", "landed", "promotion", stableReleases.get(commit.sha) ?? null));
    } else if (backported.has(commit.sha)) {
      const carrier = carrierFor(commit.sha);
      entries.push(
        presence("stable", "landed", "backport", carrier ? (stableReleases.get(carrier.sha) ?? null) : null),
      );
    } else {
      entries.push(presence("stable", "pending", null));
    }
    entries.push(
      presence("development", "landed", forkMade ? "commit" : "sync", devReleases.get(commit.sha) ?? null),
    );
    changes.push({ ...commit, ...classify(commit.subject), origin, presence: entries });
  }

  for (const commit of incoming) {
    changes.push({
      ...commit,
      ...classify(commit.subject),
      origin: follow!.id,
      presence: [
        presence(
          "upstream-stable",
          inUpStable.has(commit.sha) ? "landed" : "absent",
          inUpStable.has(commit.sha) ? "commit" : null,
          upStableReleases.get(commit.sha) ?? null,
        ),
        presence(
          "upstream-development",
          inUpDev.has(commit.sha) ? "landed" : "absent",
          inUpDev.has(commit.sha) ? "commit" : null,
          upDevReleases.get(commit.sha) ?? null,
        ),
        presence("stable", "pending", null),
        presence("development", "pending", null),
      ],
    });
  }

  for (const commit of stranded) {
    changes.push({
      ...commit,
      ...classify(commit.subject),
      origin: "stable",
      presence: [
        ...(config.upstream
          ? [presence("upstream-stable", "absent", null), presence("upstream-development", "absent", null)]
          : []),
        presence("stable", "landed", "commit", stableReleases.get(commit.sha) ?? null),
        presence("development", "absent", null),
      ],
    });
  }

  // Flows.
  const flows: ReleaseStreamFlow[] = [];
  const promotable = (toStable?.missing ?? []).length
    ? window.filter((commit) => toStable!.missing.includes(commit.sha)).length
    : 0;
  flows.push({
    from: "development",
    to: "stable",
    kind: "promote",
    pending: hasStable ? promotable : window.length,
    command: hasStable ? "npm run release:promote" : "npm run streams -- init",
  });
  if (stranded.length) {
    flows.push({
      from: "stable",
      to: "development",
      kind: "forward-port",
      pending: stranded.length,
      command: `git cherry-pick -x ${stranded.map((c) => c.sha.slice(0, 9)).join(" ")}`,
    });
  }
  if (follow && exists(follow)) {
    flows.push({
      from: follow.id,
      to: "development",
      kind: "sync",
      pending: incoming.length,
      command: "npm run release:sync-upstream",
    });
  }
  if (upDevCherry && forkOnly) {
    const candidates = window.filter(
      (commit) => forkOnly.has(commit.sha) && upDevCherry.missing.includes(commit.sha),
    );
    flows.push({
      from: "development",
      to: "upstream-development",
      kind: "contribute",
      pending: candidates.length,
      command: "npm run release:contribute -- <commit...>",
    });
  }

  // Events for the graph's connectors.
  const events: ReleaseStreamEvent[] = [];
  if (hasStable) {
    const merges = parseLog(
      await tryGit(git, [
        "log",
        "--merges",
        "--first-parent",
        `--format=${LOG_FORMAT}`,
        "-n",
        "40",
        stable.ref,
      ]),
    );
    const promotions = merges.filter((commit) => PROMOTE.test(commit.subject));
    const promotedTo = await firstReleases(git, promotions.map((c) => c.sha), stable);
    for (const commit of promotions) {
      events.push({
        kind: "promote",
        from: "development",
        to: "stable",
        fromRelease: PROMOTE.exec(commit.subject)?.[1] ?? null,
        toRelease: promotedTo.get(commit.sha) ?? null,
        sha: commit.sha,
        date: commit.date,
        count: 0,
      });
    }
    const byRelease = new Map<string, ReleaseStreamEvent>();
    const carriers = [...backportCarrier.values()];
    const carrierReleases = await firstReleases(git, carriers.map((c) => c.sha), stable);
    for (const carrier of carriers) {
      const release = carrierReleases.get(carrier.sha) ?? null;
      const key = release ?? "unreleased";
      const existing = byRelease.get(key);
      if (existing) existing.count += 1;
      else {
        byRelease.set(key, {
          kind: "backport",
          from: "development",
          to: "stable",
          fromRelease: null,
          toRelease: release,
          sha: carrier.sha,
          date: carrier.date,
          count: 1,
        });
      }
    }
    events.push(...byRelease.values());
  }
  if (follow && exists(follow)) {
    const syncs = parseLog(
      await tryGit(git, ["log", "--merges", "--first-parent", `--format=${LOG_FORMAT}`, "-n", "40", dev.ref]),
    ).filter((commit) => SYNC.test(commit.subject));
    const syncedInto = await firstReleases(git, syncs.map((c) => c.sha), dev);
    for (const commit of syncs) {
      const label = SYNC.exec(commit.subject)?.[1] ?? null;
      events.push({
        kind: "sync",
        from: follow.id,
        to: "development",
        fromRelease: label && /^v\d/.test(label) ? label.slice(1) : null,
        toRelease: syncedInto.get(commit.sha) ?? null,
        sha: commit.sha,
        date: commit.date,
        count: 0,
      });
    }
  }
  if (upDevCherry) {
    for (const commit of window) {
      if (forkOnly?.has(commit.sha) && upDevCherry.equivalent.includes(commit.sha)) {
        events.push({
          kind: "contribute",
          from: "development",
          to: "upstream-development",
          fromRelease: devReleases.get(commit.sha) ?? null,
          toRelease: upDevReleases.get(commit.sha) ?? null,
          sha: commit.sha,
          date: commit.date,
          count: 1,
        });
      }
    }
  }
  events.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  return { streams, flows, changes, events, truncated };
}
