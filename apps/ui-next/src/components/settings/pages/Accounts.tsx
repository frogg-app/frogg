import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getClient } from "../../../daemon/store";
import { color } from "../../../theme/tokens";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Area, Pill, Row, Section } from "../controls";
import { Acts, Block, Confirm, ErrorLine, Field, Status, useAction, useRpc } from "./kit";

type AccountList = Awaited<ReturnType<DaemonClient["listProviderAccounts"]>>;
type Account = AccountList["accounts"][number];
type Usage = Awaited<ReturnType<DaemonClient["listProviderUsage"]>>["providers"][number];
type Bundle = Parameters<DaemonClient["importProviderAccounts"]>[0]["bundle"];
type Provider = Account["provider"];

const NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  copilot: "Copilot",
  opencode: "OpenCode",
  gemini: "Gemini",
};
const SWATCH = [color.cyan, color.violet, color.mint, color.amber, color.coral];
const NO_USAGE: Record<string, Usage | undefined> = {};
const provName = (p: string) => NAMES[p] ?? p;

interface Loaded {
  list: AccountList;
  usage: Record<string, Usage | undefined>;
}

/** Accounts plus each account's usage windows, fetched in parallel. */
async function loadAll(c: DaemonClient): Promise<Loaded> {
  const list = await c.listProviderAccounts();
  const usage: Record<string, Usage | undefined> = {};
  await Promise.all(
    list.accounts.map(async (a) => {
      const res = await c
        .listProviderUsage({ provider: a.provider, providerAccountId: a.id })
        .catch(() => null);
      usage[a.id] = res?.providers.find((u) => u.providerId === a.provider) ?? res?.providers[0];
    }),
  );
  return { list, usage };
}

export function Accounts() {
  const rpc = useRpc(loadAll);
  const groups = useMemo(() => {
    const out = new Map<Provider, Account[]>();
    for (const a of rpc.data?.list.accounts ?? []) {
      const arr = out.get(a.provider) ?? [];
      arr.push(a);
      out.set(a.provider, arr);
    }
    // Providers that support accounts but have none yet are offered together below.
    const rest = (rpc.data?.list.capabilities ?? [])
      .map((c) => c.provider)
      .filter((p) => !out.has(p));
    return { used: [...out.entries()], rest };
  }, [rpc.data]);
  const all = useMemo(() => [...groups.used.map(([p]) => p), ...groups.rest], [groups]);
  return (
    <Status rpc={rpc} what="accounts">
      {groups.used.map(([prov, accts], gi) => (
        <ProviderGroup
          key={prov}
          provider={prov}
          accounts={accts}
          usage={rpc.data?.usage ?? NO_USAGE}
          tint={SWATCH[gi % SWATCH.length]}
          reload={rpc.reload}
        />
      ))}
      {groups.rest.length > 0 ? (
        <Section title="Other providers">
          {groups.rest.map((p) => (
            <AddAccount key={p} provider={p} reload={rpc.reload} />
          ))}
        </Section>
      ) : null}
      <Transfer providers={all} reload={rpc.reload} />
    </Status>
  );
}

function ProviderGroup({
  provider,
  accounts,
  usage,
  tint,
  reload,
}: {
  provider: Provider;
  accounts: Account[];
  usage: Record<string, Usage | undefined>;
  tint: string;
  reload: () => void;
}) {
  return (
    <Section title={provName(provider)}>
      {accounts.map((a) => (
        <AccountRow key={a.id} account={a} usage={usage[a.id]} tint={tint} reload={reload} />
      ))}
      <AddAccount provider={provider} reload={reload} />
    </Section>
  );
}

function AccountRow({
  account: a,
  usage,
  tint,
  reload,
}: {
  account: Account;
  usage: Usage | undefined;
  tint: string;
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const act = useAction();
  const sw = useMemo(() => [s.sw, { backgroundColor: tint }], [tint]);
  const makeDefault = useCallback(async () => {
    const ok = await act.run("default", () =>
      clientOrThrow().setActiveProviderAccount({ provider: a.provider, accountId: a.id }),
    );
    if (ok) reload();
  }, [act, a, reload]);
  const signOut = useCallback(async () => {
    const ok = await act.run("signout", () =>
      clientOrThrow().signOutProviderAccount({ accountId: a.id }),
    );
    if (ok) reload();
  }, [act, a.id, reload]);
  const remove = useCallback(async () => {
    const ok = await act.run("delete", () =>
      clientOrThrow().deleteProviderAccount({ accountId: a.id }),
    );
    if (ok) reload();
  }, [act, a.id, reload]);
  const plan = usage?.planLabel ? `${usage.planLabel} · ` : "";
  const state = a.authenticated ? "signed in" : "signed out";
  const windows = (usage?.windows ?? []).slice(0, 2);
  return (
    <View style={s.acct}>
      <View style={s.acctRow}>
        <View style={sw} />
        <View style={s.acctText}>
          <View style={s.nameRow}>
            <T style={s.name}>{a.name}</T>
            {a.isActive ? <Pill text="default" /> : null}
          </View>
          <T style={s.sub} numberOfLines={1}>
            {plan}
            {a.configDir} · {state}
          </T>
        </View>
        {windows.length > 0 ? (
          <View style={s.windows}>
            {windows.map((w) => (
              <WindowMeter key={w.id} label={w.label} pct={w.usedPct ?? null} />
            ))}
          </View>
        ) : null}
        <Button label={open ? "Done" : "Manage"} onPress={toggle} />
      </View>
      {open ? (
        <View style={s.manage}>
          <ErrorLine text={act.error} />
          <Acts>
            {a.isActive ? null : (
              <Button label="Make default" onPress={makeDefault} disabled={act.pending !== null} />
            )}
            {a.authenticated ? (
              <Confirm
                label="Sign out"
                confirm="Sign out"
                onConfirm={signOut}
                pending={act.pending === "signout"}
              />
            ) : null}
            <Confirm
              label="Remove"
              confirm="Remove account"
              onConfirm={remove}
              pending={act.pending === "delete"}
            />
          </Acts>
        </View>
      ) : null}
    </View>
  );
}

function clientOrThrow(): DaemonClient {
  const c = getClient();
  if (!c) throw new Error("host offline");
  return c;
}

const meterCache = new Map<number, object>();
function meterFill(pct: number) {
  const key = Math.round(Math.max(0, Math.min(100, pct)));
  let st = meterCache.get(key);
  if (!st) {
    st = StyleSheet.create({ w: { width: `${key}%` } }).w;
    meterCache.set(key, st);
  }
  return st;
}

function WindowMeter({ label, pct }: { label: string; pct: number | null }) {
  const p = pct ?? 0;
  const warn = p >= 65;
  return (
    <View style={s.win}>
      <T v="mono" style={s.winL} numberOfLines={1}>
        {label}
      </T>
      <View style={s.bar}>
        <View style={[s.fill, warn && s.fillWarn, meterFill(p)]} />
      </View>
      <T v="mono" style={s.winP}>
        {pct === null ? "—" : `${Math.round(p)}%`}
      </T>
    </View>
  );
}

function AddAccount({ provider, reload }: { provider: Provider; reload: () => void }) {
  const [name, setName] = useState<string | null>(null);
  const act = useAction();
  const start = useCallback(() => setName(""), []);
  const cancel = useCallback(() => setName(null), []);
  const add = useCallback(async () => {
    const n = name?.trim();
    if (!n) return;
    const ok = await act.run("add", () =>
      clientOrThrow().createProviderAccount({ provider, name: n }),
    );
    if (ok) {
      setName(null);
      reload();
    }
  }, [act, name, provider, reload]);
  if (name === null)
    return (
      <View style={s.addRow}>
        <Button label={`Add ${provName(provider)} account`} onPress={start} />
      </View>
    );
  return (
    <Block last>
      <ErrorLine text={act.error} />
      <View style={s.addForm}>
        <Field
          grow
          value={name}
          onChangeText={setName}
          onSubmitEditing={add}
          placeholder="Account name, e.g. work"
          autoFocus
        />
        <Button label="Cancel" onPress={cancel} />
        <Button
          kind="primary"
          label={act.pending ? "Adding…" : "Add"}
          onPress={add}
          disabled={!name.trim() || act.pending !== null}
        />
      </View>
      <T style={s.sub}>Then sign in from a terminal session with this account selected.</T>
    </Block>
  );
}

function Transfer({ providers, reload }: { providers: Provider[]; reload: () => void }) {
  const [exported, setExported] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const act = useAction();
  const doExport = useCallback(async () => {
    const bundles: unknown[] = [];
    const ok = await act.run("export", async () => {
      for (const p of providers) {
        const res = await clientOrThrow().exportProviderAccounts({ provider: p });
        if (res.error) throw new Error(res.error);
        if (res.bundle) bundles.push(res.bundle);
      }
    });
    if (ok) setExported(JSON.stringify(bundles.length === 1 ? bundles[0] : bundles, null, 2));
  }, [act, providers]);
  const hideExport = useCallback(() => setExported(null), []);
  const startPaste = useCallback(() => setPaste(""), []);
  const cancelPaste = useCallback(() => setPaste(null), []);
  const doImport = useCallback(async () => {
    setNote(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(paste ?? "");
    } catch {
      setNote("That is not valid JSON.");
      return;
    }
    const list = (Array.isArray(parsed) ? parsed : [parsed]) as Bundle[];
    const ok = await act.run("import", async () => {
      for (const bundle of list) {
        const res = await clientOrThrow().importProviderAccounts({ bundle });
        if (res.error) throw new Error(res.error);
      }
    });
    if (ok) {
      setPaste(null);
      setNote(`Imported ${list.length} bundle${list.length === 1 ? "" : "s"}.`);
      reload();
    }
  }, [act, paste, reload]);
  return (
    <Section title="Move accounts between hosts">
      <Row label="Export bundle" hint="Contains credentials in plain text">
        {exported === null ? (
          <Button
            label={act.pending === "export" ? "Exporting…" : "Export…"}
            onPress={doExport}
            disabled={providers.length === 0 || act.pending !== null}
          />
        ) : (
          <Button label="Hide" onPress={hideExport} />
        )}
      </Row>
      {exported === null ? null : (
        <Block>
          <Area value={exported} onChange={setExported} />
        </Block>
      )}
      <Row label="Import bundle" last={paste === null && !act.error && !note}>
        {paste === null ? <Button label="Paste JSON…" onPress={startPaste} /> : null}
      </Row>
      {paste === null ? null : (
        <Block last>
          <Area value={paste} onChange={setPaste} placeholder="Paste an exported bundle" />
          <Acts>
            <Button label="Cancel" onPress={cancelPaste} />
            <Button
              kind="primary"
              label={act.pending === "import" ? "Importing…" : "Import"}
              onPress={doImport}
              disabled={!paste.trim() || act.pending !== null}
            />
          </Acts>
        </Block>
      )}
      {act.error || note ? (
        <Block last>
          <ErrorLine text={act.error ?? note} />
        </Block>
      ) : null}
    </Section>
  );
}

const s = StyleSheet.create({
  acct: { borderBottomWidth: 1, borderBottomColor: color.line },
  acctRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sw: { width: 9, height: 9, transform: [{ rotate: "45deg" }] },
  acctText: { flex: 1, minWidth: 180 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontWeight: "500" },
  sub: { color: color.faint, fontSize: 12, marginTop: 3 },
  windows: { gap: 6, width: 260, maxWidth: "100%" },
  win: { flexDirection: "row", alignItems: "center", gap: 10 },
  winL: { width: 70, fontSize: 11, color: color.faint },
  bar: { flex: 1, height: 3, backgroundColor: "rgba(255,255,255,0.08)" },
  fill: { height: 3, backgroundColor: color.cyan },
  fillWarn: { backgroundColor: color.amber },
  winP: { width: 34, textAlign: "right", fontSize: 11, color: color.faint },
  manage: { paddingHorizontal: 16, paddingBottom: 12, paddingLeft: 37 },
  addRow: { flexDirection: "row", justifyContent: "flex-end", padding: 10 },
  addForm: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
});
