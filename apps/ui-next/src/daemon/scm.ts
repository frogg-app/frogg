import type {
  CheckoutDiffUpdateSchema,
  CheckoutStatusResponseSchema,
} from "@frogg/protocol/messages";
import type { z } from "zod";
import { create } from "zustand";
import { getClient, onHostSwitch } from "./store";

export type CheckoutStatus = z.infer<typeof CheckoutStatusResponseSchema>["payload"];
export type DiffFile = z.infer<typeof CheckoutDiffUpdateSchema>["payload"]["files"][number];
export type Compare = "uncommitted" | "base";

interface ScmState {
  cwd: string | null;
  compare: Compare;
  status: CheckoutStatus | null;
  files: DiffFile[] | null;
  busy: string | null;
  error: string | null;
}

export const useScm = create<ScmState>(() => ({
  cwd: null,
  compare: "uncommitted",
  status: null,
  files: null,
  busy: null,
  error: null,
}));

let subId: string | null = null;
let unsub: (() => void) | null = null;
/** Set once the user picks a comparison; until then a clean tree on a branch ahead shows the branch. */
let compareChosen = false;
onHostSwitch(() => {
  subId = null;
  unsub = null;
  compareChosen = false;
  useScm.setState({ cwd: null, status: null, files: null, error: null });
});

/** Whether the branch has commits its base lacks: what an agent that committed its work leaves. */
function aheadOfBase(status: CheckoutStatus | null): boolean {
  return !!status?.isGit && !!status.baseRef && (status.aheadBehind?.ahead ?? 0) > 0;
}

/**
 * Point source control at a checkout and keep its diff live. Shows uncommitted changes, unless
 * there are none and the branch is ahead of its base (the agent committed): then the branch's
 * changes against the base, so a review is never empty while there is work to see.
 */
export async function watchCheckout(
  cwd: string,
  compare: Compare = useScm.getState().compare,
): Promise<void> {
  const client = getClient();
  if (!client) return;
  const st = useScm.getState();
  if (st.cwd === cwd && st.compare === compare && subId && st.files !== null) return;
  if (st.cwd !== cwd) compareChosen = false;
  if (subId) client.unsubscribeCheckoutDiff(subId);
  const mine = `ui-next-scm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  subId = mine;
  useScm.setState({ cwd, compare, files: null, error: null });
  unsub ??= client.subscribeRawMessages((m) => {
    if (m.type === "checkout_diff_update" && m.payload.subscriptionId === subId) {
      useScm.setState({ files: m.payload.files });
      void refreshStatus();
    }
  });
  try {
    const [status, diff] = await Promise.all([
      client.getCheckoutStatus(cwd),
      client.subscribeCheckoutDiff(cwd, { mode: compare }, { subscriptionId: mine }),
    ]);
    // A newer call (another checkout or comparison) owns the panel now.
    if (subId !== mine) return;
    useScm.setState({ status, files: diff.files, error: diff.error?.message ?? null });
    if (compare === "uncommitted" && !compareChosen && !diff.files.length && aheadOfBase(status))
      await watchCheckout(cwd, "base");
  } catch (e) {
    if (subId !== mine) return;
    // Let the next call retry instead of short-circuiting on a subscription that never answered.
    subId = null;
    useScm.setState({ files: [], error: e instanceof Error ? e.message : String(e) });
  }
}

async function refreshStatus() {
  const { cwd } = useScm.getState();
  const client = getClient();
  if (cwd && client) useScm.setState({ status: await client.getCheckoutStatus(cwd) });
}

async function run(
  label: string,
  fn: (cwd: string) => Promise<{ error?: { message: string } | null }>,
) {
  const { cwd } = useScm.getState();
  if (!cwd) return;
  useScm.setState({ busy: label, error: null });
  try {
    const res = await fn(cwd);
    useScm.setState({ error: res.error?.message ?? null });
  } catch (e) {
    useScm.setState({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    useScm.setState({ busy: null });
    await refreshStatus();
  }
}

export const commit = (message: string) =>
  run("commit", (cwd) => getClient()!.checkoutCommit(cwd, { message, addAll: true }));
export const pull = () => run("pull", (cwd) => getClient()!.checkoutPull(cwd));
export const push = () => run("push", (cwd) => getClient()!.checkoutPush(cwd));
export const setCompare = (compare: Compare) => {
  compareChosen = true;
  const { cwd } = useScm.getState();
  if (cwd) void watchCheckout(cwd, compare);
};

// ---- Branches, stashes, session commits and the "more" actions -------------------------------

type Client = NonNullable<ReturnType<typeof getClient>>;
export type Commit = Awaited<ReturnType<Client["listCheckoutCommits"]>>["commits"][number];
export type Stash = Awaited<ReturnType<Client["stashList"]>>["entries"][number];
export interface BranchInfo {
  name: string;
  committerDate: number;
  ahead?: number;
  behind?: number;
}
export type PrSummary = { number: number | null; url: string; title: string; state: string } | null;

interface ScmExtra {
  commits: Commit[] | null;
  stashes: Stash[] | null;
  branches: BranchInfo[] | null;
  pr: PrSummary | undefined;
}

export const useScmExtra = create<ScmExtra>(() => ({
  commits: null,
  stashes: null,
  branches: null,
  pr: undefined,
}));
onHostSwitch(() =>
  useScmExtra.setState({ commits: null, stashes: null, branches: null, pr: undefined }),
);

/** Session commits, stashes and the branch's pull request, for the panel's lower sections. */
export async function loadExtras(): Promise<void> {
  const { cwd } = useScm.getState();
  const client = getClient();
  if (!cwd || !client) return;
  const [commits, stashes, pr] = await Promise.allSettled([
    client.listCheckoutCommits(cwd),
    client.stashList(cwd),
    client.checkoutPrStatus(cwd),
  ]);
  if (useScm.getState().cwd !== cwd) return;
  useScmExtra.setState({
    commits: commits.status === "fulfilled" ? commits.value.commits : [],
    stashes: stashes.status === "fulfilled" ? stashes.value.entries : [],
    pr:
      pr.status === "fulfilled" && pr.value.status
        ? {
            number: pr.value.status.number ?? null,
            url: pr.value.status.url,
            title: pr.value.status.title,
            state: pr.value.status.isMerged ? "merged" : pr.value.status.state.toLowerCase(),
          }
        : null,
  });
}

/** Local and remote branches, most recently committed first. */
export async function loadBranches(query?: string): Promise<void> {
  const { cwd } = useScm.getState();
  const client = getClient();
  if (!cwd || !client) return;
  const res = await client.getBranchSuggestions({ cwd, query, limit: 40 });
  const details: BranchInfo[] = res.branchDetails
    ? res.branchDetails.map((d) => ({
        name: d.name,
        committerDate: d.committerDate,
        ahead: d.localAhead,
        behind: d.localBehind,
      }))
    : res.branches.map((name) => ({ name, committerDate: 0 }));
  useScmExtra.setState({ branches: details });
}

async function act(
  label: string,
  fn: (cwd: string, client: Client) => Promise<{ error?: { message: string } | null } | void>,
): Promise<boolean> {
  const { cwd } = useScm.getState();
  const client = getClient();
  if (!cwd || !client) return false;
  useScm.setState({ busy: label, error: null });
  let ok = true;
  try {
    const res = await fn(cwd, client);
    if (res && res.error) {
      ok = false;
      useScm.setState({ error: res.error.message });
    }
  } catch (e) {
    ok = false;
    useScm.setState({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    useScm.setState({ busy: null });
    await refreshStatus().catch(() => {});
    void loadExtras().catch(() => {});
  }
  return ok;
}

export const switchBranch = (branch: string) =>
  act("switch", (cwd, c) => c.checkoutSwitchBranch(cwd, branch));
/** Stash uncommitted work, then switch: what the branch menu offers on a dirty tree. */
export const stashAndSwitch = (branch: string) =>
  act("switch", async (cwd, c) => {
    const saved = await c.stashSave(cwd);
    if (saved.error) return saved;
    return c.checkoutSwitchBranch(cwd, branch);
  });
export const stashSave = () => act("stash", (cwd, c) => c.stashSave(cwd));
export const stashPop = (index: number) => act("stash", (cwd, c) => c.stashPop(cwd, index));
export const discard = (paths: string[]) =>
  act("discard", (cwd, c) => c.checkoutDiscardChanges(cwd, { paths }));
export const mergeFromBase = () => act("merge", (cwd, c) => c.checkoutMergeFromBase(cwd, {}));
export const mergeIntoBase = () =>
  act("merge", (cwd, c) => c.checkoutMerge(cwd, { strategy: "merge", requireCleanTarget: true }));
export const createPr = (title?: string) =>
  act("pr", (cwd, c) => c.checkoutPrCreate(cwd, { title }));
export const commitAndPush = (message: string) =>
  act("commit", async (cwd, c) => {
    const res = await c.checkoutCommit(cwd, { message, addAll: true });
    if (res.error) return res;
    return c.checkoutPush(cwd);
  });
export const pullAndPush = () =>
  act("pull", async (cwd, c) => {
    const res = await c.checkoutPull(cwd);
    if (res.error) return res;
    return c.checkoutPush(cwd);
  });
