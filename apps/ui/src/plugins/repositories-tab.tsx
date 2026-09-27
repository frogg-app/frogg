import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { DaemonClient, PluginRepo } from "@frogg/client/internal/daemon-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { PluginSpinner } from "./spinner";
import { PluginTierBadge } from "./badges";
import { describePluginError } from "./errors";
import { usePluginMutation, usePluginRepos } from "./queries";
import { pluginStyles as styles } from "./shared-styles";

interface AddRepoInput {
  url: string;
  name: string;
  publicKey: string;
}

const addRepo = (client: DaemonClient, input: AddRepoInput) =>
  client.pluginsReposAdd({
    url: input.url.trim(),
    ...(input.name.trim() ? { name: input.name.trim() } : {}),
    ...(input.publicKey.trim() ? { publicKey: input.publicKey.trim() } : {}),
  });
const removeRepo = (client: DaemonClient, url: string) => client.pluginsReposRemove(url);

export function RepositoriesTab({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const repos = usePluginRepos(serverId, true);

  return (
    <View style={styles.list} testID="plugins-repositories">
      {repos.isPending ? <PluginSpinner /> : null}
      {repos.isError ? <Text style={styles.error}>{describePluginError(repos.error)}</Text> : null}
      {(repos.data?.repos ?? []).map((repo) => (
        <RepoRow key={repo.url} serverId={serverId} repo={repo} />
      ))}
      <Text style={styles.sectionTitle}>{t("plugins.repos.addTitle")}</Text>
      <AddRepoForm serverId={serverId} />
    </View>
  );
}

function RepoRow({ serverId, repo }: { serverId: string; repo: PluginRepo }): ReactElement {
  const { t } = useTranslation();
  const remover = usePluginMutation(serverId, removeRepo);
  const remove = useCallback(() => remover.mutate(repo.url), [remover, repo.url]);
  return (
    <View style={styles.row} testID={`plugins-repo-${repo.url}`}>
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {repo.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {repo.url}
          </Text>
        </View>
        {repo.removable ? (
          <Button
            variant="outline"
            size="sm"
            onPress={remove}
            loading={remover.isPending}
            testID="plugins-repo-remove"
          >
            {t("plugins.repos.remove")}
          </Button>
        ) : null}
      </View>
      <View style={styles.badges}>
        <PluginTierBadge tier={repo.tier} />
        {repo.pluginCount === null ? null : (
          <Text style={styles.meta}>{t("plugins.repos.count", { count: repo.pluginCount })}</Text>
        )}
      </View>
      <Text style={styles.meta} selectable>
        {t("plugins.repos.key", { key: repo.publicKey })}
      </Text>
      {repo.error ? <Text style={styles.error}>{repo.error}</Text> : null}
      {remover.error ? (
        <Text style={styles.error}>{describePluginError(remover.error)}</Text>
      ) : null}
    </View>
  );
}

function AddRepoForm({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const adder = usePluginMutation(serverId, addRepo);
  const [draft, setDraft] = useState<AddRepoInput>({ url: "", name: "", publicKey: "" });
  const [resetKey, setResetKey] = useState(0);
  const [pinned, setPinned] = useState<PluginRepo | null>(null);
  const setUrl = useCallback((url: string) => setDraft((d) => ({ ...d, url })), []);
  const setName = useCallback((name: string) => setDraft((d) => ({ ...d, name })), []);
  const setKey = useCallback((publicKey: string) => setDraft((d) => ({ ...d, publicKey })), []);
  const submit = useCallback(() => {
    if (!draft.url.trim()) return;
    setPinned(null);
    adder.mutate(draft, {
      // Inputs are kept on failure so the user can correct them.
      onSuccess: (result) => {
        setPinned(result.repo);
        setDraft({ url: "", name: "", publicKey: "" });
        setResetKey((key) => key + 1);
      },
    });
  }, [adder, draft]);

  return (
    <View style={styles.list}>
      <Field label={t("plugins.repos.url")}>
        <FormTextInput
          size="sm"
          initialValue=""
          resetKey={resetKey}
          onChangeText={setUrl}
          placeholder="https://example.com/index.json"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t("plugins.repos.url")}
          testID="plugins-repo-url"
        />
      </Field>
      <Field label={t("plugins.repos.name")}>
        <FormTextInput
          size="sm"
          initialValue=""
          resetKey={resetKey}
          onChangeText={setName}
          accessibilityLabel={t("plugins.repos.name")}
          testID="plugins-repo-name"
        />
      </Field>
      <Field label={t("plugins.repos.publicKey")} hint={t("plugins.repos.publicKeyHint")}>
        <FormTextInput
          size="sm"
          initialValue=""
          resetKey={resetKey}
          onChangeText={setKey}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t("plugins.repos.publicKey")}
          testID="plugins-repo-key"
        />
      </Field>
      {adder.error ? (
        <Text style={styles.error} testID="plugins-repo-add-error">
          {describePluginError(adder.error)}
        </Text>
      ) : null}
      {pinned ? (
        <Alert
          variant="success"
          title={t("plugins.repos.pinnedTitle", { name: pinned.name })}
          description={t("plugins.repos.pinnedBody", { key: pinned.publicKey })}
          testID="plugins-repo-pinned"
        />
      ) : null}
      <View style={styles.actions}>
        <Button
          size="sm"
          onPress={submit}
          loading={adder.isPending}
          disabled={!draft.url.trim()}
          testID="plugins-repo-add"
        >
          {t("plugins.repos.add")}
        </Button>
      </View>
    </View>
  );
}
