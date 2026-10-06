import type { CheckoutDiffUpdateSchema, CheckoutStatusResponseSchema } from "@frogg/protocol/messages";
import type { z } from "zod";
import { create } from "zustand";
import { getClient } from "./store";

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
  cwd: null, compare: "uncommitted", status: null, files: null, busy: null, error: null,
}));

let subId: string | null = null;
let unsub: (() => void) | null = null;

/** Point source control at a checkout and keep its diff live. */
export async function watchCheckout(cwd: string, compare: Compare = useScm.getState().compare): Promise<void> {
  const client = getClient();
  if (!client) return;
  const st = useScm.getState();
  if (st.cwd === cwd && st.compare === compare && subId) return;
  if (subId) client.unsubscribeCheckoutDiff(subId);
  subId = `ui-next-scm-${Date.now()}`;
  useScm.setState({ cwd, compare, files: null, error: null });
  unsub ??= client.subscribeRawMessages((m) => {
    if (m.type === "checkout_diff_update" && m.payload.subscriptionId === subId) {
      useScm.setState({ files: m.payload.files });
      void refreshStatus();
    }
  });
  const [status, diff] = await Promise.all([
    client.getCheckoutStatus(cwd),
    client.subscribeCheckoutDiff(cwd, { mode: compare }, { subscriptionId: subId }),
  ]);
  useScm.setState({ status, files: diff.files, error: diff.error?.message ?? null });
}

async function refreshStatus() {
  const { cwd } = useScm.getState();
  const client = getClient();
  if (cwd && client) useScm.setState({ status: await client.getCheckoutStatus(cwd) });
}

async function run(label: string, fn: (cwd: string) => Promise<{ error?: { message: string } | null }>) {
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

export const commit = (message: string) => run("commit", (cwd) => getClient()!.checkoutCommit(cwd, { message, addAll: true }));
export const pull = () => run("pull", (cwd) => getClient()!.checkoutPull(cwd));
export const push = () => run("push", (cwd) => getClient()!.checkoutPush(cwd));
export const setCompare = (compare: Compare) => {
  const { cwd } = useScm.getState();
  if (cwd) void watchCheckout(cwd, compare);
};
