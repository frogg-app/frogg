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
    refExists.has(`refs/remotes/origin/${branch}`)
      ? `refs/remotes/origin/${branch}`
      : `refs/heads/${branch}`;
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
  limit: string | null = null,
): Promise<{ missing: string[]; equivalent: string[] }> {
  const missing: string[] = [];
  const equivalent: string[] = [];
  const args = ["cherry", upstream, head, ...(limit ? [limit] : [])];
  for (const line of lines(await tryGit(git, args))) {
    if (line.startsWith("+ ")) missing.push(line.slice(2));
    else if (line.startsWith("- ")) equivalent.push(line.slice(2));
  }
  return { missing, equivalent };
}

async function revSet(git: StreamsGit, args: string[]): Promise<Set<string>> {
  return new Set(lines(await tryGit(git, ["rev-list", ...args])));
}

interface Carrier {
  sha: string;
  date: string | null;
}

/** Everything the stages below share: the refs, and what they read from git once. */
interface GraphContext {
  git: StreamsGit;
  config: ReleaseStreamsConfig;
  known: Set<string>;
  dev: StreamRef;
  stable: StreamRef;
  upDev: StreamRef | null;
  upStable: StreamRef | null;
  /** The upstream stream the fork merges from, when it exists locally. */
  follow: StreamRef | null;
  hasStable: boolean;
}

type PresenceState = "shipped" | "landed" | "pending" | "absent";

function presence(
  stream: string,
  state: PresenceState,
  via: string | null,
  release: string | null = null,
): ReleaseStreamPresence {
  return { stream, state: state === "landed" && release ? "shipped" : state, via, release };
}

function logArgs(...rest: string[]): string[] {
  return ["log", "--no-merges", `--format=${LOG_FORMAT}`, ...rest];
}

function withoutCuts(commits: Commit[]): Commit[] {
  return commits.filter((commit) => !RELEASE_CUT.test(commit.subject));
}

async function readStream(
  ctx: GraphContext,
  stream: StreamRef,
  hasDev: boolean,
): Promise<ReleaseStream> {
  const { git } = ctx;
  const present = ctx.known.has(stream.ref);
  // Before `streams init` there is no stable branch, but the stable releases that were cut from
  // the development branch are still the stable history worth drawing.
  const fallback = stream.id === "stable" && hasDev ? ctx.dev.ref : null;
  const source = present ? stream.ref : fallback;
  const releases = source
    ? await releasesOn(git, source, stream.tagNamespace, stream.tagPattern)
    : [];
  const newest = releases[0];
  let head: string | null = null;
  let headDate: string | null = null;
  let version: string | null = newest?.version ?? null;
  let unreleased = 0;
  if (present) {
    const tip = await tryGit(git, ["log", "-1", `--format=%H${SEP}%cI`, stream.ref]);
    [head = null, headDate = null] = tip ? tip.split(SEP) : [];
    version = await readVersion(git, stream.ref);
    if (newest) {
      const count = await tryGit(git, [
        "rev-list",
        "--count",
        "--no-merges",
        `${newest.sha}..${stream.ref}`,
      ]);
      unreleased = Number(count ?? 0);
    }
  }
  return {
    id: stream.id,
    kind: stream.kind,
    label: stream.label,
    ref: stream.ref,
    channel: stream.channel,
    exists: present,
    head,
    headDate: headDate || null,
    version,
    unreleased,
    releases: releases.slice(0, RELEASES_PER_STREAM),
  };
}

/** Stable-only commits (`cherry-pick -x`) mapped from the development commit they carry. */
async function readBackports(ctx: GraphContext): Promise<Map<string, Carrier>> {
  const carriers = new Map<string, Carrier>();
  if (!ctx.hasStable) return carriers;
  const log = await tryGit(ctx.git, [
    "log",
    "--no-merges",
    "--grep=cherry picked from commit",
    `--format=%H${SEP}%cI${SEP}%B%x1e`,
    `${ctx.dev.ref}..${ctx.stable.ref}`,
  ]);
  for (const record of (log ?? "").split("\x1e")) {
    const [sha = "", date = "", body = ""] = record.trim().split(SEP);
    if (!sha) continue;
    for (const match of body.matchAll(CHERRY_PICKED)) {
      carriers.set(match[1]!, { sha, date: date || null });
    }
  }
  return carriers;
}

/**
 * Stable-only work that development lacks. A promotion copies development's tree up, so
 * anything on stable before the last promotion is either in development or was dropped on
 * purpose; and a backport's source is on development by definition.
 */
async function readStranded(ctx: GraphContext, carriers: Map<string, Carrier>): Promise<Commit[]> {
  if (!ctx.hasStable) return [];
  const { git, dev, stable } = ctx;
  const lastPromotion =
    (await tryGit(git, [
      "log",
      "--first-parent",
      "--merges",
      "-1",
      "--format=%H",
      "--grep=^chore(release): promote ",
      stable.ref,
    ])) || null;
  const since = lastPromotion ? [`^${lastPromotion}`] : [];
  const stableOnly = parseLog(await tryGit(git, logArgs(`${dev.ref}..${stable.ref}`, ...since)));
  const missing = new Set((await cherry(git, dev.ref, stable.ref, lastPromotion)).missing);
  const carrierShas = new Set([...carriers.values()].map((carrier) => carrier.sha));
  return withoutCuts(stableOnly).filter(
    (commit) => !carrierShas.has(commit.sha) && missing.has(commit.sha),
  );
}

function carrierLookup(carriers: Map<string, Carrier>) {
  return (sha: string): Carrier | null => {
    for (const [picked, carrier] of carriers) {
      if (sha.startsWith(picked) || picked.startsWith(sha)) return carrier;
    }
    return null;
  };
}

interface Relations {
  window: Commit[];
  truncated: boolean;
  incoming: Commit[];
  stranded: Commit[];
  /** Development commits not upstream; null when there is no upstream. */
  forkOnly: Set<string> | null;
  notInStable: Set<string> | null;
  promotable: Set<string>;
  backported: Set<string>;
  carriers: Map<string, Carrier>;
  carrierFor: (sha: string) => Carrier | null;
  contributed: Set<string>;
  uncontributed: Set<string>;
  inUpDev: Set<string>;
  inUpStable: Set<string>;
}

async function readRelations(ctx: GraphContext): Promise<Relations> {
  const { git, dev, stable, upDev, upStable, follow, hasStable } = ctx;
  const devLog = withoutCuts(
    parseLog(await tryGit(git, logArgs("-n", String(CHANGE_WINDOW + 1), dev.ref))),
  );
  const upstreamRefs = [upDev, upStable].flatMap((stream) => (stream ? [stream.ref] : []));
  const forkOnly = upstreamRefs.length
    ? await revSet(git, ["--no-merges", dev.ref, "--not", ...upstreamRefs])
    : null;
  const incoming = follow
    ? withoutCuts(
        parseLog(
          await tryGit(git, logArgs("-n", String(INCOMING_WINDOW), `${dev.ref}..${follow.ref}`)),
        ),
      )
    : [];
  const toStable = hasStable ? await cherry(git, stable.ref, dev.ref) : null;
  const carriers = await readBackports(ctx);
  const toUpstream = upDev && forkOnly ? await cherry(git, upDev.ref, dev.ref) : null;
  const recent = (stream: StreamRef | null) =>
    stream ? revSet(git, ["-n", String(CHANGE_WINDOW * 20), stream.ref]) : new Set<string>();
  return {
    window: devLog.slice(0, CHANGE_WINDOW),
    truncated: devLog.length > CHANGE_WINDOW,
    incoming,
    stranded: await readStranded(ctx, carriers),
    forkOnly,
    notInStable: hasStable ? await revSet(git, [`${stable.ref}..${dev.ref}`]) : null,
    promotable: new Set(toStable?.missing ?? []),
    backported: new Set(toStable?.equivalent ?? []),
    carriers,
    carrierFor: carrierLookup(carriers),
    contributed: new Set(toUpstream?.equivalent ?? []),
    uncontributed: new Set(toUpstream?.missing ?? []),
    inUpDev: await recent(upDev),
    inUpStable: await recent(upStable),
  };
}

type ReleaseMaps = Record<"dev" | "stable" | "upDev" | "upStable", Map<string, string>>;

async function readFirstReleases(ctx: GraphContext, rel: Relations): Promise<ReleaseMaps> {
  const { git, dev, stable, upDev, upStable, hasStable } = ctx;
  const windowShas = rel.window.map((commit) => commit.sha);
  const carried = windowShas.flatMap((sha) => {
    const carrier = rel.carrierFor(sha);
    return carrier ? [carrier.sha] : [];
  });
  const upstreamShas = [...windowShas, ...rel.incoming.map((c) => c.sha)];
  const none = Promise.resolve(new Map<string, string>());
  const [devMap, stableMap, upDevMap, upStableMap] = await Promise.all([
    firstReleases(git, windowShas, dev),
    hasStable
      ? firstReleases(git, [...windowShas, ...carried, ...rel.stranded.map((c) => c.sha)], stable)
      : none,
    upDev ? firstReleases(git, upstreamShas, upDev) : none,
    upStable ? firstReleases(git, upstreamShas, upStable) : none,
  ]);
  return { dev: devMap, stable: stableMap, upDev: upDevMap, upStable: upStableMap };
}

/** Where an upstream-made commit stands on upstream's own streams. */
function upstreamPresence(sha: string, rel: Relations, releases: ReleaseMaps) {
  const on = (set: Set<string>, stream: string, map: Map<string, string>) =>
    set.has(sha)
      ? presence(stream, "landed", "commit", map.get(sha) ?? null)
      : presence(stream, "absent", null);
  return [
    on(rel.inUpStable, "upstream-stable", releases.upStable),
    on(rel.inUpDev, "upstream-development", releases.upDev),
  ];
}

function stablePresence(sha: string, rel: Relations, releases: ReleaseMaps) {
  if (!rel.notInStable) return presence("stable", "pending", null);
  if (!rel.notInStable.has(sha)) {
    return presence("stable", "landed", "promotion", releases.stable.get(sha) ?? null);
  }
  if (rel.backported.has(sha)) {
    const carrier = rel.carrierFor(sha);
    const release = carrier ? (releases.stable.get(carrier.sha) ?? null) : null;
    return presence("stable", "landed", "backport", release);
  }
  return presence("stable", "pending", null);
}

function buildChanges(
  ctx: GraphContext,
  rel: Relations,
  releases: ReleaseMaps,
): ReleaseStreamChange[] {
  const upstreamId = ctx.follow?.id ?? "upstream-development";
  const changes: ReleaseStreamChange[] = [];
  for (const commit of rel.window) {
    const forkMade = rel.forkOnly ? rel.forkOnly.has(commit.sha) : true;
    const entries: ReleaseStreamPresence[] = [];
    if (ctx.config.upstream && forkMade) {
      const contributed = rel.contributed.has(commit.sha);
      entries.push(
        presence("upstream-stable", "absent", null),
        contributed
          ? presence("upstream-development", "landed", "contribution")
          : presence("upstream-development", "absent", null),
      );
    } else if (ctx.config.upstream) {
      entries.push(...upstreamPresence(commit.sha, rel, releases));
    }
    entries.push(
      stablePresence(commit.sha, rel, releases),
      presence(
        "development",
        "landed",
        forkMade ? "commit" : "sync",
        releases.dev.get(commit.sha) ?? null,
      ),
    );
    changes.push({
      ...commit,
      ...classify(commit.subject),
      origin: forkMade ? "development" : upstreamId,
      presence: entries,
    });
  }
  for (const commit of rel.incoming) {
    changes.push({
      ...commit,
      ...classify(commit.subject),
      origin: upstreamId,
      presence: [
        ...upstreamPresence(commit.sha, rel, releases),
        presence("stable", "pending", null),
        presence("development", "pending", null),
      ],
    });
  }
  const upstreamAbsent = ctx.config.upstream
    ? [
        presence("upstream-stable", "absent", null),
        presence("upstream-development", "absent", null),
      ]
    : [];
  for (const commit of rel.stranded) {
    changes.push({
      ...commit,
      ...classify(commit.subject),
      origin: "stable",
      presence: [
        ...upstreamAbsent,
        presence("stable", "landed", "commit", releases.stable.get(commit.sha) ?? null),
        presence("development", "absent", null),
      ],
    });
  }
  return changes;
}

function buildFlows(ctx: GraphContext, rel: Relations): ReleaseStreamFlow[] {
  const flows: ReleaseStreamFlow[] = [
    {
      from: "development",
      to: "stable",
      kind: "promote",
      pending: ctx.hasStable
        ? rel.window.filter((commit) => rel.promotable.has(commit.sha)).length
        : rel.window.length,
      command: ctx.hasStable ? "npm run release:promote" : "npm run streams -- init",
    },
  ];
  if (rel.stranded.length) {
    flows.push({
      from: "stable",
      to: "development",
      kind: "forward-port",
      pending: rel.stranded.length,
      command: `git cherry-pick -x ${rel.stranded.map((c) => c.sha.slice(0, 9)).join(" ")}`,
    });
  }
  if (ctx.follow) {
    flows.push({
      from: ctx.follow.id,
      to: "development",
      kind: "sync",
      pending: rel.incoming.length,
      command: "npm run release:sync-upstream",
    });
  }
  if (ctx.upDev && rel.forkOnly) {
    const forkOnly = rel.forkOnly;
    flows.push({
      from: "development",
      to: "upstream-development",
      kind: "contribute",
      pending: rel.window.filter(
        (commit) => forkOnly.has(commit.sha) && rel.uncontributed.has(commit.sha),
      ).length,
      command: "npm run release:contribute -- <commit...>",
    });
  }
  return flows;
}

async function recentMerges(git: StreamsGit, ref: string, pattern: RegExp): Promise<Commit[]> {
  const log = await tryGit(git, [
    "log",
    "--merges",
    "--first-parent",
    `--format=${LOG_FORMAT}`,
    "-n",
    "40",
    ref,
  ]);
  return parseLog(log).filter((commit) => pattern.test(commit.subject));
}

async function promotionAndBackportEvents(
  ctx: GraphContext,
  rel: Relations,
): Promise<ReleaseStreamEvent[]> {
  if (!ctx.hasStable) return [];
  const { git, stable } = ctx;
  const promotions = await recentMerges(git, stable.ref, PROMOTE);
  const carriers = [...rel.carriers.values()];
  const [promotedTo, carrierReleases] = await Promise.all([
    firstReleases(
      git,
      promotions.map((c) => c.sha),
      stable,
    ),
    firstReleases(
      git,
      carriers.map((c) => c.sha),
      stable,
    ),
  ]);
  const events: ReleaseStreamEvent[] = promotions.map((commit) => ({
    kind: "promote",
    from: "development",
    to: "stable",
    fromRelease: PROMOTE.exec(commit.subject)?.[1] ?? null,
    toRelease: promotedTo.get(commit.sha) ?? null,
    sha: commit.sha,
    date: commit.date,
    count: 0,
  }));
  // One connector per stable release, counting the fixes it carried.
  const byRelease = new Map<string, ReleaseStreamEvent>();
  for (const carrier of carriers) {
    const release = carrierReleases.get(carrier.sha) ?? null;
    const existing = byRelease.get(release ?? "unreleased");
    if (existing) {
      existing.count += 1;
      continue;
    }
    byRelease.set(release ?? "unreleased", {
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
  return [...events, ...byRelease.values()];
}

async function upstreamEvents(
  ctx: GraphContext,
  rel: Relations,
  releases: ReleaseMaps,
): Promise<ReleaseStreamEvent[]> {
  const events: ReleaseStreamEvent[] = [];
  const { follow } = ctx;
  if (follow) {
    const syncs = await recentMerges(ctx.git, ctx.dev.ref, SYNC);
    const syncedInto = await firstReleases(
      ctx.git,
      syncs.map((c) => c.sha),
      ctx.dev,
    );
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
  for (const commit of rel.window) {
    if (!rel.forkOnly?.has(commit.sha) || !rel.contributed.has(commit.sha)) continue;
    events.push({
      kind: "contribute",
      from: "development",
      to: "upstream-development",
      fromRelease: releases.dev.get(commit.sha) ?? null,
      toRelease: releases.upDev.get(commit.sha) ?? null,
      sha: commit.sha,
      date: commit.date,
      count: 1,
    });
  }
  return events;
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
  const present = (id: string) => {
    const stream = byId.get(id);
    return stream && known.has(stream.ref) ? stream : null;
  };
  const upDev = present("upstream-development");
  const upStable = present("upstream-stable");
  const ctx: GraphContext = {
    git,
    config,
    known,
    dev: byId.get("development")!,
    stable: byId.get("stable")!,
    upDev,
    upStable,
    follow: config.upstream?.follow === "development" ? upDev : upStable,
    hasStable: present("stable") !== null,
  };
  const hasDev = present("development") !== null;
  const streams = await Promise.all(refs.map((stream) => readStream(ctx, stream, hasDev)));
  if (!hasDev) return { streams, flows: [], changes: [], events: [], truncated: false };

  const rel = await readRelations(ctx);
  const releases = await readFirstReleases(ctx, rel);
  const events = [
    ...(await promotionAndBackportEvents(ctx, rel)),
    ...(await upstreamEvents(ctx, rel, releases)),
  ].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return {
    streams,
    flows: buildFlows(ctx, rel),
    changes: buildChanges(ctx, rel, releases),
    events,
    truncated: rel.truncated,
  };
}
