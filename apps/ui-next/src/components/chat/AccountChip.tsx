import { ChevronDown } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Agent } from "../../daemon/types";
import { color } from "../../theme/tokens";
import { T } from "../Text";
import { toast, toastError } from "../toast/store";
import { Menu, useAnchor, type MenuEntry } from "../tools/Menu";
import { cleanCut, hasFeature, listAccounts, moveToAccount, type Account } from "./actions";

/** Account the session runs on. Locked once started: switching means a move or a clean cut. */
export function AccountChip({ agent }: { agent: Agent }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const anchor = useAnchor();
  useEffect(() => {
    let live = true;
    listAccounts(agent.provider).then(
      (a) => live && setAccounts(a),
      () => live && setAccounts([]),
    );
    return () => {
      live = false;
    };
  }, [agent.provider]);
  const current = useMemo(() => {
    if (!accounts?.length) return null;
    if (agent.providerAccountId === undefined) return accounts.find((a) => a.isActive) ?? null;
    return accounts.find((a) => a.id === agent.providerAccountId) ?? null;
  }, [accounts, agent.providerAccountId]);
  const items = useMemo<MenuEntry[]>(() => {
    if (!accounts) return [];
    const others = accounts.filter(
      (a) => a.authenticated && a.id !== current?.id && a.provider === agent.provider,
    );
    const canMove = agent.status !== "running" && hasFeature("agentProviderAccountTransfer");
    const canCut = agent.status !== "running" && hasFeature("agentCleanCut");
    const entries: MenuEntry[] = [
      { head: "Account · locked once the agent started" },
      ...accounts
        .filter((a) => a.provider === agent.provider)
        .map((a) => ({
          label: a.name,
          hint: accountHint(a),
          on: a.id === current?.id,
          disabled: a.id !== current?.id,
        })),
    ];
    if (others.length && (canMove || canCut)) entries.push("-");
    for (const o of others) {
      if (canMove)
        entries.push({
          label: `Move conversation to ${o.name}…`,
          hint: "Full history; re-sends the context on the next turn",
          onPress: () =>
            moveToAccount(agent.id, o.id).then(
              () => toast({ title: `Moved to ${o.name}` }),
              (e) => toastError("Could not move the conversation", e),
            ),
        });
      if (canCut)
        entries.push({
          label: `Clean cut to ${o.name}`,
          hint: "Summarise, then continue there",
          onPress: () =>
            cleanCut(agent.id, o.id).then(
              () => toast({ title: `Clean cut to ${o.name}` }),
              (e) => toastError("Clean cut failed", e),
            ),
        });
    }
    return entries;
  }, [accounts, current, agent.id, agent.provider, agent.status]);
  if (!current) return null;
  return (
    <>
      <View ref={anchor.ref} collapsable={false}>
        <Pressable onPress={anchor.open} accessibilityLabel="Account">
          {({ hovered }) => (
            <View style={[s.chip, hovered && s.hover]}>
              <T v="mono" style={s.t} numberOfLines={1}>
                {current.name}
              </T>
              <ChevronDown size={11} color={color.faint} />
            </View>
          )}
        </Pressable>
      </View>
      <Menu rect={anchor.rect} onClose={anchor.close} items={items} width={300} />
    </>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: color.wash,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 160,
  },
  hover: { backgroundColor: color.line },
  t: { color: color.text, flexShrink: 1 },
});

function accountHint(account: Account): string | undefined {
  if (!account.authenticated) return "Signed out";
  return account.isActive ? "Host default" : undefined;
}
