import { ChevronDown } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { getClient } from "../../daemon/store";
import { color, web } from "../../theme/tokens";
import { Cut } from "../Cut";
import { T } from "../Text";
import { Menu, useAnchor, type MenuEntry } from "./Menu";

type Client = NonNullable<ReturnType<typeof getClient>>;
export type PrStatus = NonNullable<Awaited<ReturnType<Client["checkoutPrStatus"]>>["status"]>;
type Method = "squash" | "merge" | "rebase";

const LABEL: Record<Method, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};
const BUTTON: Record<Method, string> = {
  squash: "Squash and merge",
  merge: "Merge",
  rebase: "Rebase and merge",
};

/** Why the forge would refuse a merge right now, or null when it can go. */
export function mergeBlocker(pr: PrStatus): string | null {
  if (pr.isMerged) return "Already merged";
  if (pr.state.toLowerCase() !== "open") return "Pull request is closed";
  const parts: string[] = [];
  if (pr.isDraft) parts.push("Draft");
  const failing = pr.checks.filter((c) => /fail|error|cancel/i.test(c.status)).length;
  if (failing) parts.push(`${failing} failing check${failing === 1 ? "" : "s"}`);
  if (pr.mergeable === "CONFLICTING") parts.push("Merge conflicts");
  if (pr.reviewDecision === "REVIEW_REQUIRED") parts.push("Review required");
  if (pr.reviewDecision === "CHANGES_REQUESTED") parts.push("Changes requested");
  return parts.length ? parts.join(" · ") : null;
}

function allowed(pr: PrStatus): Method[] {
  const repo = pr.github?.repository;
  if (!repo) return ["squash", "merge", "rebase"];
  const out: Method[] = [];
  if (repo.squashMergeAllowed) out.push("squash");
  if (repo.mergeCommitAllowed) out.push("merge");
  if (repo.rebaseMergeAllowed) out.push("rebase");
  return out;
}

function defaultMethod(pr: PrStatus, methods: Method[]): Method {
  const d = pr.github?.repository.viewerDefaultMergeMethod?.toLowerCase();
  if (d === "squash" || d === "merge" || d === "rebase") if (methods.includes(d)) return d;
  return methods[0] ?? "squash";
}

/** The pr-merge-menu split button: merge with the chosen method, or arm auto-merge. */
export function PrMergeButton({
  cwd,
  pr,
  onDone,
}: {
  cwd: string;
  pr: PrStatus;
  onDone: () => void;
}) {
  const methods = useMemo(() => allowed(pr), [pr]);
  const [method, setMethod] = useState<Method>(() => defaultMethod(pr, methods));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchor = useAnchor();
  const blocker = methods.length
    ? mergeBlocker(pr)
    : "No merge method is enabled for this repository";
  const selectedMethod = methods.includes(method) ? method : defaultMethod(pr, methods);
  const auto = pr.github?.autoMergeRequest ?? null;
  const run = useCallback(
    async (fn: (c: Client) => Promise<{ error?: { message: string } | null }>) => {
      const client = getClient();
      if (!client) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fn(client);
        if (res.error) setError(res.error.message);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
        onDone();
      }
    },
    [onDone],
  );
  const merge = useCallback(
    () => void run((c) => c.checkoutPrMerge(cwd, { method: selectedMethod })),
    [run, cwd, selectedMethod],
  );
  const items = useMemo<MenuEntry[]>(() => {
    const out: MenuEntry[] = [{ head: "Merge" }];
    for (const m of methods)
      out.push({ label: LABEL[m], on: m === selectedMethod, onPress: () => setMethod(m) });
    const canAuto = pr.github ? pr.github.repository.autoMergeAllowed : true;
    if (canAuto && !pr.isMerged) {
      out.push("-", { head: "Auto-merge when checks pass" });
      if (auto)
        out.push({
          label: "Disable auto-merge",
          hint: auto.mergeMethod ? `armed · ${auto.mergeMethod.toLowerCase()}` : "armed",
          onPress: () => void run((c) => c.checkoutForgeSetAutoMerge(cwd, { enabled: false })),
        });
      else
        out.push({
          label: `Enable auto-merge (${selectedMethod})`,
          onPress: () =>
            void run((c) =>
              c.checkoutForgeSetAutoMerge(cwd, { enabled: true, method: selectedMethod }),
            ),
        });
    }
    if (blocker)
      out.push("-", { label: "Merge disabled", hint: blocker, warn: true, disabled: true });
    return out;
  }, [methods, selectedMethod, pr, auto, blocker, run, cwd]);
  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Pressable onPress={merge} disabled={!!blocker || busy} accessibilityRole="button">
          {({ hovered }) => (
            <Cut size={6} style={[s.main, hovered && !blocker && s.mainHover, !!blocker && s.off]}>
              <T style={[s.label, !!blocker && s.labelOff]}>
                {busy ? "Merging…" : BUTTON[selectedMethod]}
              </T>
            </Cut>
          )}
        </Pressable>
        <View ref={anchor.ref} collapsable={false}>
          <Pressable onPress={anchor.open} accessibilityLabel="Merge options">
            {({ hovered }) => (
              <View style={[s.chev, hovered && s.mainHover, !!blocker && s.off]}>
                <ChevronDown size={13} color={blocker ? color.faint : color.onAccent} />
              </View>
            )}
          </Pressable>
        </View>
      </View>
      {auto && (
        <T v="mono" style={s.note}>
          auto-merge on
        </T>
      )}
      {error && (
        <T v="mono" style={s.error}>
          {error}
        </T>
      )}
      <Menu rect={anchor.rect} onClose={anchor.close} items={items} right width={270} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: "row", gap: 2 },
  main: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: color.cyan,
    ...web({ backgroundImage: "linear-gradient(90deg,#7fd9e6,#25b5c8)" }),
  },
  mainHover: { opacity: 0.9 },
  off: { backgroundColor: color.raise, ...web({ backgroundImage: "none" }) },
  label: { color: color.onAccent, fontSize: 12.5, fontWeight: "600" },
  labelOff: { color: color.faint },
  chev: {
    width: 30,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.cyan,
  },
  note: { fontSize: 10.5, color: color.mint },
  error: { color: color.coral, fontSize: 11 },
});
