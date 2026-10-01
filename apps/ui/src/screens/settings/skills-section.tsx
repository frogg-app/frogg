/**
 * COMPAT(skillsManagement): added in v1.6.6.
 *
 * The product's own skills — the ones that teach agents to work in this ADE — with a switch per
 * skill and a view of its instructions. Switching one off hides it from agents started
 * afterwards. Skills the user or a project installs for a provider CLI are not shown here.
 */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import type { SkillEntry } from "@frogg/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { useFetchQuery } from "@/data/query";
import { i18n } from "@/localisation/i18next";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { skillProviders, stripFrontMatter } from "./skills-view";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function HostSkillsSection({ serverId }: { serverId: string }): ReactElement | null {
  const { t } = useTranslation();
  const supported = useHostFeature(serverId, "skillsManagement");
  const isConnected = useHostRuntimeIsConnected(serverId);
  if (!isConnected) return null;
  if (!supported) {
    return (
      <SettingsSection title={t("settings.host.skills.title")} testID="host-page-skills">
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("settings.host.skills.unsupported")}</Text>
          </View>
        </View>
      </SettingsSection>
    );
  }
  return <SkillsList serverId={serverId} />;
}

function SkillsList({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [viewing, setViewing] = useState<SkillEntry | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const query = useFetchQuery({
    queryKey: ["host-skills", serverId],
    queryFn: async () => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.listSkills();
      if (payload.error) throw new Error(payload.error);
      return payload.skills;
    },
    enabled: Boolean(client),
    dataShape: "value",
    staleTimeMs: 10_000,
    retry: 1,
  });
  const refetch = query.refetch;

  const toggle = useMutation({
    mutationFn: async (input: { skillId: string; enabled: boolean }) => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.setSkillEnabled(input.skillId, input.enabled);
      if (payload.error) throw new Error(payload.error);
      return payload.skill;
    },
    onMutate: () => setToggleError(null),
    onError: (error) => setToggleError(errorMessage(error)),
    onSettled: () => void refetch(),
  });
  const mutate = toggle.mutate;
  const pendingId = toggle.isPending ? toggle.variables?.skillId : undefined;
  const handleToggle = useCallback(
    (skill: SkillEntry, enabled: boolean) => mutate({ skillId: skill.id, enabled }),
    [mutate],
  );
  const handleClose = useCallback(() => setViewing(null), []);

  return (
    <>
      <SettingsSection
        title={t("settings.host.skills.title")}
        info={t("settings.host.skills.info")}
        testID="host-page-skills"
      >
        {toggleError ? (
          <Alert
            variant="error"
            title={t("settings.host.skills.toggleFailed")}
            description={toggleError}
            testID="host-page-skills-toggle-error"
          />
        ) : null}
        <SkillsBody
          loading={!query.data && !query.error}
          error={query.data ? null : query.error}
          skills={query.data ?? []}
          pendingId={pendingId}
          onToggle={handleToggle}
          onView={setViewing}
        />
      </SettingsSection>
      <SkillContentSheet serverId={serverId} skill={viewing} onClose={handleClose} />
    </>
  );
}

function SkillsBody({
  loading,
  error,
  skills,
  pendingId,
  onToggle,
  onView,
}: {
  loading: boolean;
  error: unknown;
  skills: SkillEntry[];
  pendingId: string | undefined;
  onToggle: (skill: SkillEntry, enabled: boolean) => void;
  onView: (skill: SkillEntry) => void;
}): ReactElement {
  const { t } = useTranslation();
  if (error) {
    return (
      <Alert
        variant="error"
        title={t("settings.host.skills.loadFailed")}
        description={errorMessage(error)}
        testID="host-page-skills-error"
      />
    );
  }
  if (loading) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>{t("settings.host.skills.loading")}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={settingsStyles.card} testID="host-page-skills-list">
      {skills.map((skill, index) => (
        <SkillRow
          key={skill.id}
          skill={skill}
          first={index === 0}
          pending={pendingId === skill.id}
          onToggle={onToggle}
          onView={onView}
        />
      ))}
    </View>
  );
}

function SkillRow({
  skill,
  first,
  pending,
  onToggle,
  onView,
}: {
  skill: SkillEntry;
  first: boolean;
  pending: boolean;
  onToggle: (skill: SkillEntry, enabled: boolean) => void;
  onView: (skill: SkillEntry) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onView(skill), [onView, skill]);
  const handleValueChange = useCallback(
    (value: boolean) => onToggle(skill, value),
    [onToggle, skill],
  );
  const providers = skillProviders(skill)
    .map((provider) => t(`settings.host.skills.providers.${provider}`, { defaultValue: provider }))
    .join(" · ");
  return (
    <Pressable
      style={[settingsStyles.row, !first && settingsStyles.rowBorder]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t("settings.host.skills.view", { name: skill.name })}
      testID={`host-page-skill-${skill.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={[settingsStyles.rowTitle, !skill.enabled && styles.disabled]}>
          {skill.name}
        </Text>
        {skill.description ? (
          <Text style={settingsStyles.rowHint} numberOfLines={2}>
            {skill.description}
          </Text>
        ) : null}
        {providers ? <Text style={[settingsStyles.rowHint, styles.meta]}>{providers}</Text> : null}
      </View>
      <Switch
        value={skill.enabled}
        onValueChange={handleValueChange}
        disabled={pending}
        accessibilityLabel={t("settings.host.skills.toggle", { name: skill.name })}
        testID={`host-page-skill-toggle-${skill.id}`}
      />
    </Pressable>
  );
}

function SkillContentSheet({
  serverId,
  skill,
  onClose,
}: {
  serverId: string;
  skill: SkillEntry | null;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const skillId = skill?.id ?? null;
  const query = useFetchQuery({
    queryKey: ["host-skill-content", serverId, skillId],
    queryFn: async () => {
      if (!client || !skillId) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.getSkillContent(skillId);
      if (payload.error || payload.content === null) {
        throw new Error(payload.error ?? t("settings.host.skills.contentUnavailable"));
      }
      return stripFrontMatter(payload.content);
    },
    enabled: Boolean(client && skillId),
    dataShape: "value",
    staleTimeMs: 30_000,
    retry: 0,
  });
  const header = useMemo<SheetHeader>(
    () => ({
      title: skill?.name ?? "",
      subtitle: skill?.locations[0]?.path ? (
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {skill.locations[0].path}
        </Text>
      ) : undefined,
    }),
    [skill],
  );
  return (
    <AdaptiveModalSheet
      visible={skill !== null}
      onClose={onClose}
      header={header}
      desktopMaxWidth={760}
      testID="host-page-skill-content"
    >
      {query.data ? (
        <ScrollView style={styles.content}>
          <MarkdownRenderer text={query.data} />
        </ScrollView>
      ) : (
        <Text style={settingsStyles.rowHint}>
          {query.error ? errorMessage(query.error) : t("settings.host.skills.loading")}
        </Text>
      )}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  meta: {
    marginTop: theme.spacing[1],
  },
  disabled: {
    color: theme.colors.foregroundMuted,
  },
  content: {
    maxHeight: 560,
  },
}));
