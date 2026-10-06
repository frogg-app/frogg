import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { getClient } from "../../daemon/store";
import { color, font } from "../../theme/tokens";
import { Button } from "../Button";
import { T } from "../Text";
import { Dialog } from "./Dialog";
import { useConfirm } from "./Confirm";

type Repo = Awaited<
  ReturnType<NonNullable<ReturnType<typeof getClient>>["pluginsReposList"]>
>["repos"][number];
export function PluginSources() {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void getClient()
      ?.pluginsReposList()
      .then(
        (r) => {
          setRepos(r.repos);
          setError(null);
          return undefined;
        },
        (e: unknown) => setError(String(e)),
      );
  }, []);
  useEffect(load, [load]);
  const show = useCallback(() => {
    setUrl("");
    setKey("");
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    if (!busy) setOpen(false);
  }, [busy]);
  const add = useCallback(async () => {
    const c = getClient();
    if (!c || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await c.pluginsReposAdd({ url: url.trim(), publicKey: key.trim() || undefined });
      if (!r.repo) throw new Error("Repository was not added.");
      setOpen(false);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [url, key, busy, load]);
  const footer = useMemo(
    () => (
      <Button
        label={busy ? "Adding…" : "Add repository"}
        onPress={add}
        disabled={busy || !url.trim()}
      />
    ),
    [busy, add, url],
  );
  return (
    <View style={s.stack}>
      <T v="label">Repositories</T>
      {!repos && !error && <T>Loading sources…</T>}
      {repos?.length === 0 && <T>No plugin sources configured.</T>}
      {repos?.map((repo) => (
        <Source key={repo.url} repo={repo} onDone={load} onError={setError} />
      ))}
      <Button label="Add repository" onPress={show} />
      {error && <T style={s.error}>{error}</T>}
      <Dialog open={open} onClose={close} title="Add plugin repository" footer={footer}>
        <T v="label">Repository URL</T>
        <TextInput
          accessibilityLabel="Repository URL"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          style={s.input}
        />
        <T v="label">Pinned public key (optional)</T>
        <TextInput
          accessibilityLabel="Pinned public key"
          value={key}
          onChangeText={setKey}
          autoCapitalize="none"
          style={s.input}
        />
        {error && <T style={s.error}>{error}</T>}
      </Dialog>
    </View>
  );
}
function Source({
  repo,
  onDone,
  onError,
}: {
  repo: Repo;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const confirm = useConfirm();
  const remove = useCallback(
    () =>
      confirm.ask({
        title: `Remove ${repo.name}?`,
        body: "Installed plugins remain installed. This removes their catalog source.",
        action: "Remove source",
        danger: true,
        run: () => {
          void getClient()
            ?.pluginsReposRemove(repo.url)
            .then((r) => {
              if (!r.success) throw new Error("Source could not be removed.");
              onDone();
              return undefined;
            })
            .catch((e: unknown) => onError(String(e)));
        },
      }),
    [confirm, repo, onDone, onError],
  );
  return (
    <View style={s.card}>
      <T>{repo.name}</T>
      <T v="mono">{repo.url}</T>
      <T v="mono">
        {repo.tier} · {repo.pluginCount ?? "Unknown"} plugins
      </T>
      <T v="mono">{repo.publicKey ? `Pinned key ${repo.publicKey}` : "No pinned key"}</T>
      {repo.error && <T style={s.error}>{repo.error}</T>}
      {repo.removable && <Button label="Remove source…" onPress={remove} />}
      {confirm.dialog}
    </View>
  );
}
const s = StyleSheet.create({
  stack: { gap: 12 },
  card: { backgroundColor: color.panel, padding: 12, gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: color.line2,
    padding: 10,
    color: color.text,
    fontFamily: font.mono,
  },
  error: { color: color.coral },
});
