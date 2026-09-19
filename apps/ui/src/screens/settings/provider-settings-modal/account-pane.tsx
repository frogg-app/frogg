import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  PROVIDER_ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
  PROVIDER_ACCOUNT_SYSTEM_PROMPT_MAX_LENGTH,
  normalizeProviderAccountDisplayName,
  parseProviderAccountDefaultId,
  type ProviderAccountPreferences,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";
import type { AgentModelDefinition } from "@frogg/protocol/agent-types";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { SettingsTextArea } from "@/components/settings-textarea";
import { settingsStyles } from "@/styles/settings";
import {
  IDENTITY_COLOR_NAMES,
  identityColor,
  type IdentityColorName,
} from "@/styles/identity-colors";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  ProviderAccountAvatar,
  resolveProviderAccountColor,
} from "@/provider-accounts/account-avatar";
import { ProviderUsageCard } from "@/provider-usage/card";
import type { ProviderUsage } from "@/provider-usage/types";
import type { useProviderAccounts } from "@/provider-accounts/use-provider-accounts";
import type { useAuthenticateProviderAccount } from "@/provider-accounts/use-authenticate-account";
import { AccountTransfer } from "./account-transfer";
import { providerAccountDisplayName } from "./account-tabs";

type Accounts = ReturnType<typeof useProviderAccounts>;
type Auth = ReturnType<typeof useAuthenticateProviderAccount>;
interface MutationPayload {
  error: string | null;
  warnings?: string[];
}

/** The model default and thinking default share one sentinel for "no preference". */
const UNSET = "";

/**
 * Every section owns its own feedback line, so an error shows next to the
 * control that caused it rather than at the bottom of a long page.
 */
function useSectionMutation() {
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const run = useCallback(async (mutate: () => Promise<MutationPayload>) => {
    setError(null);
    setWarnings([]);
    try {
      const payload = await mutate();
      setWarnings(payload.warnings ?? []);
      setError(payload.error);
      return payload.error === null;
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }, []);
  return { run, error, warnings };
}

function SectionFeedback({
  error,
  warnings = [],
  testID,
}: {
  error: string | null;
  warnings?: readonly string[];
  testID: string;
}) {
  return (
    <>
      {error ? (
        <Text style={settingsStyles.rowError} testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
      {warnings.map((warning) => (
        <Text key={warning} style={styles.warning} testID={`${testID}-warning`}>
          {warning}
        </Text>
      ))}
    </>
  );
}

/** A titled group: small muted heading, optional one-line description, then content. */
export function PaneSection({
  title,
  description,
  trailing,
  children,
  testID,
}: {
  title: string;
  description?: string;
  trailing?: ReactNode;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
        </View>
        {trailing}
      </View>
      {children}
    </View>
  );
}

export interface AccountPaneProps {
  providerId: string;
  providerLabel: string;
  account: ProviderAccountState;
  /** The provider's selectable models, already filtered for display. */
  models: readonly AgentModelDefinition[];
  accounts: Accounts;
  auth: Auth;
  canManage: boolean;
  canRestrictModels: boolean;
  canSetPreferences: boolean;
  /** Usage the provider reports for this account's own config directory. */
  usage: ProviderUsage | null;
  /** True for the synthesized default account the daemon has stored nothing about. */
  synthesized: boolean;
  onDeleted: () => void;
}

/**
 * Everything about one sign-in, in the order a person reaches for it: who it
 * is and whether it works, what it has used, how new agents on it start, which
 * models it may run, what it tells every agent, then the rare and destructive.
 */
export function AccountPane(props: AccountPaneProps): ReactElement {
  const { account, canSetPreferences, canRestrictModels, models } = props;
  return (
    <View style={styles.pane} testID={`provider-account-pane-${account.id}`}>
      <AccountHero {...props} />
      <AccountUsage {...props} />
      {canSetPreferences && models.length > 0 ? <AccountDefaults {...props} /> : null}
      {canRestrictModels && models.length > 0 ? <AccountModelAccess {...props} /> : null}
      {canSetPreferences ? <AccountSystemPrompt {...props} /> : null}
      <AccountIdentity {...props} />
      {props.canManage ? (
        <AccountTransfer
          providerId={props.providerId}
          account={account}
          accounts={props.accounts}
          synthesized={props.synthesized}
        />
      ) : null}
      <AccountDanger {...props} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hero: identity, sign-in state and the primary actions.

function AccountHero({ providerLabel, account, accounts, auth, synthesized }: AccountPaneProps) {
  const { t } = useTranslation();
  const setActive = useSectionMutation();
  const label = providerAccountDisplayName(account, t);
  const color = resolveProviderAccountColor(account);
  const isDefault = parseProviderAccountDefaultId(account.id) !== null;
  const setActiveMutate = accounts.setActive.mutateAsync;

  const handleMakeActive = useCallback(() => {
    void setActive.run(() =>
      setActiveMutate({
        provider: account.provider,
        // The default account is "no active account": the provider's own folder.
        accountId: isDefault ? null : account.id,
      }),
    );
  }, [account.id, account.provider, isDefault, setActive, setActiveMutate]);

  const handleAuthenticate = useCallback(() => auth.authenticate(account), [account, auth]);
  const isAuthenticating = auth.pendingAccountId === account.id;
  const isActivating =
    accounts.setActive.isPending &&
    (accounts.setActive.variables?.accountId ?? null) === (isDefault ? null : account.id);

  let signInBadge: ReactElement;
  if (synthesized) {
    signInBadge = (
      <StatusBadge label={t("settings.providers.settingsModal.account.providerSignIn")} />
    );
  } else if (account.authenticated) {
    signInBadge = (
      <StatusBadge
        label={t("settings.providers.settingsModal.account.signedIn")}
        variant="success"
      />
    );
  } else {
    signInBadge = (
      <StatusBadge
        label={t("settings.providers.settingsModal.account.notSignedIn")}
        variant="warning"
      />
    );
  }

  return (
    <View style={styles.hero} testID="provider-account-hero">
      <View style={styles.heroTop}>
        <ProviderAccountAvatar label={label} color={color} size={52} />
        <View style={styles.heroText}>
          <Text style={styles.heroName} numberOfLines={1} testID="provider-account-hero-name">
            {label}
          </Text>
          <View style={styles.badgeRow}>
            {signInBadge}
            {account.isActive ? (
              <StatusBadge label={t("settings.providers.settingsModal.account.inUse")} />
            ) : null}
          </View>
          <Text style={styles.path} numberOfLines={1}>
            {account.configDir}
          </Text>
        </View>
      </View>

      <View style={styles.heroActions}>
        <Button
          size="sm"
          variant={account.authenticated || synthesized ? "outline" : "default"}
          onPress={handleAuthenticate}
          disabled={!auth.canAuthenticate || isAuthenticating}
          loading={isAuthenticating}
          testID="provider-account-authenticate"
        >
          {account.authenticated
            ? t("settings.providers.settingsModal.account.reauthenticate")
            : t("settings.providers.settingsModal.account.signIn")}
        </Button>
        {account.isActive ? null : (
          <Button
            size="sm"
            variant="ghost"
            onPress={handleMakeActive}
            disabled={isActivating}
            loading={isActivating}
            testID="provider-account-make-active"
          >
            {t("settings.providers.settingsModal.account.makeActive")}
          </Button>
        )}
      </View>
      <Text style={styles.hint}>
        {auth.canAuthenticate
          ? t("settings.providers.settingsModal.account.signInHint", { provider: providerLabel })
          : t("settings.host.providerAccounts.authenticateNoWorkspace")}
      </Text>
      {auth.error ? (
        <Text style={settingsStyles.rowError} testID="provider-account-auth-error">
          {auth.error}
        </Text>
      ) : null}
      <SectionFeedback error={setActive.error} testID="provider-account-activate" />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Usage: the figures the provider reports for THIS sign-in.

function AccountUsage({ usage }: AccountPaneProps) {
  const { t } = useTranslation();
  if (!usage) return null;
  return (
    <PaneSection
      title={t("settings.providers.settingsModal.account.usageTitle")}
      testID="provider-account-usage"
    >
      <View style={settingsStyles.card}>
        <ProviderUsageCard usage={usage} />
      </View>
    </PaneSection>
  );
}

// ---------------------------------------------------------------------------
// Defaults: the model and thinking level a new agent on this account starts on.

/** Writes one preferences field, keeping the rest as they are. */
function usePreferencesWriter(accounts: Accounts, account: ProviderAccountState) {
  const mutation = useSectionMutation();
  const mutate = accounts.setPreferences.mutateAsync;
  const write = useCallback(
    (patch: Partial<ProviderAccountPreferences>) => {
      const next: ProviderAccountPreferences = { ...account.preferences, ...patch };
      return mutation.run(() => mutate({ accountId: account.id, preferences: next }));
    },
    [account.id, account.preferences, mutate, mutation],
  );
  return { write, error: mutation.error };
}

function AccountDefaults({ account, accounts, models }: AccountPaneProps) {
  const { t } = useTranslation();
  const { write, error } = usePreferencesWriter(accounts, account);
  const busy = accounts.setPreferences.isPending;

  // A default the account may not run would be refused at launch, so it is not offered.
  const runnable = useMemo(
    () =>
      account.allowedModels === undefined
        ? models
        : models.filter((model) => account.allowedModels!.includes(model.id)),
    [account.allowedModels, models],
  );

  const defaultModelId = account.preferences?.defaultModelId ?? UNSET;
  const defaultThinkingId = account.preferences?.defaultThinkingOptionId ?? UNSET;
  const providerDefaultLabel = t("settings.providers.settingsModal.account.providerDefault");

  const modelOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: "unset", value: UNSET, label: providerDefaultLabel },
      ...runnable.map((model) => ({
        id: model.id,
        value: model.id,
        label: model.label,
        description: model.id,
      })),
    ],
    [providerDefaultLabel, runnable],
  );

  const effectiveModel = useMemo(
    () =>
      runnable.find((model) => model.id === defaultModelId) ??
      runnable.find((model) => model.isDefault) ??
      runnable[0],
    [defaultModelId, runnable],
  );
  const thinkingOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: "unset", value: UNSET, label: providerDefaultLabel },
      ...(effectiveModel?.thinkingOptions ?? []).map((option) => ({
        id: option.id,
        value: option.id,
        label: option.label,
      })),
    ],
    [effectiveModel, providerDefaultLabel],
  );

  const selectedModelDisplay = useMemo(() => {
    const option = modelOptions.find((candidate) => candidate.value === defaultModelId);
    return option ? { label: option.label } : null;
  }, [defaultModelId, modelOptions]);
  const selectedThinkingDisplay = useMemo(() => {
    const option = thinkingOptions.find((candidate) => candidate.value === defaultThinkingId);
    return option ? { label: option.label } : null;
  }, [defaultThinkingId, thinkingOptions]);

  const handleModelChange = useCallback(
    (modelId: string) => {
      // A thinking level belongs to a model; a new model starts from its own default.
      void write({
        defaultModelId: modelId || undefined,
        defaultThinkingOptionId: undefined,
      });
    },
    [write],
  );
  const handleThinkingChange = useCallback(
    (thinkingId: string) => {
      void write({ defaultThinkingOptionId: thinkingId || undefined });
    },
    [write],
  );

  return (
    <PaneSection
      title={t("settings.providers.settingsModal.account.defaultsTitle")}
      description={t("settings.providers.settingsModal.account.defaultsDescription")}
      testID="provider-account-defaults"
    >
      <View style={styles.fieldStack}>
        <SelectField
          label={t("settings.providers.settingsModal.account.defaultModel")}
          value={defaultModelId}
          selectedDisplay={selectedModelDisplay}
          options={modelOptions}
          onChange={handleModelChange}
          placeholder={providerDefaultLabel}
          emptyText={t("settings.providers.settingsModal.account.noModels")}
          disabled={busy}
          searchable={modelOptions.length > 8}
          title={t("settings.providers.settingsModal.account.defaultModel")}
          testID="provider-account-default-model"
          triggerTestID="provider-account-default-model-trigger"
        />
        {thinkingOptions.length > 1 ? (
          <SelectField
            label={t("settings.providers.settingsModal.account.defaultThinking")}
            value={defaultThinkingId}
            selectedDisplay={selectedThinkingDisplay}
            options={thinkingOptions}
            onChange={handleThinkingChange}
            placeholder={providerDefaultLabel}
            emptyText={t("settings.providers.settingsModal.account.noThinking")}
            disabled={busy}
            searchable={false}
            title={t("settings.providers.settingsModal.account.defaultThinking")}
            testID="provider-account-default-thinking"
            triggerTestID="provider-account-default-thinking-trigger"
          />
        ) : null}
      </View>
      <SectionFeedback error={error} testID="provider-account-defaults" />
    </PaneSection>
  );
}

// ---------------------------------------------------------------------------
// Model access: `allowedModels` is a tri-state on the wire — absent is every
// model, `[]` is none, a list is exactly that list — and this is the one place
// the difference is shown.

export function modelAccessSummary(
  allowedModels: readonly string[] | undefined,
  total: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; variant: "success" | "warning" | "error" } {
  if (allowedModels === undefined) {
    return { label: t("settings.providers.settingsModal.account.allModels"), variant: "success" };
  }
  if (allowedModels.length === 0) {
    return {
      label: t("settings.providers.settingsModal.account.noModelsAllowed"),
      variant: "error",
    };
  }
  return {
    label: t("settings.providers.settingsModal.account.someModels", {
      allowed: allowedModels.length,
      total,
    }),
    variant: "warning",
  };
}

function ModelAccessRow({
  model,
  isFirst,
  isAllowed,
  busy,
  onToggle,
}: {
  model: AgentModelDefinition;
  isFirst: boolean;
  isAllowed: boolean;
  busy: boolean;
  onToggle: (modelId: string, next: boolean) => void;
}) {
  const handleValueChange = useCallback(
    (next: boolean) => onToggle(model.id, next),
    [model.id, onToggle],
  );
  return (
    <View
      style={[settingsStyles.row, styles.modelRow, isFirst ? null : settingsStyles.rowBorder]}
      testID={`provider-account-model-row-${model.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={[settingsStyles.rowTitle, isAllowed ? null : styles.dimmed]} numberOfLines={1}>
          {model.label}
        </Text>
        <Text style={styles.mono} numberOfLines={1}>
          {model.id}
        </Text>
      </View>
      <Switch
        value={isAllowed}
        disabled={busy}
        onValueChange={handleValueChange}
        accessibilityLabel={model.label}
        testID={`provider-account-model-toggle-${model.id}`}
      />
    </View>
  );
}

function AccountModelAccess({ account, accounts, models }: AccountPaneProps) {
  const { t } = useTranslation();
  const mutation = useSectionMutation();
  const mutate = accounts.setAllowedModels.mutateAsync;
  const busy = accounts.setAllowedModels.isPending;
  const summary = modelAccessSummary(account.allowedModels, models.length, t);
  const summaryBadge = useMemo(
    () => (
      <View testID="provider-account-models-summary">
        <StatusBadge label={summary.label} variant={summary.variant} />
      </View>
    ),
    [summary.label, summary.variant],
  );

  const write = useCallback(
    (allowedModels: string[] | null) =>
      void mutation.run(() => mutate({ accountId: account.id, allowedModels })),
    [account.id, mutate, mutation],
  );

  const handleToggle = useCallback(
    (modelId: string, next: boolean) => {
      // Absent means unrestricted, so the first denial starts from the full catalogue.
      const current = account.allowedModels ?? models.map((model) => model.id);
      const allowed = next
        ? [...new Set([...current, modelId])]
        : current.filter((id) => id !== modelId);
      // Allowing everything again is spelled as "no restriction", so models the
      // provider adds later are not silently withheld.
      write(models.every((model) => allowed.includes(model.id)) ? null : allowed);
    },
    [account.allowedModels, models, write],
  );
  const handleAllowAll = useCallback(() => write(null), [write]);

  return (
    <PaneSection
      title={t("settings.providers.settingsModal.account.modelsTitle")}
      description={t("settings.providers.settingsModal.account.modelsDescription")}
      trailing={summaryBadge}
      testID="provider-account-models"
    >
      <View style={settingsStyles.card}>
        {models.map((model, index) => (
          <ModelAccessRow
            key={model.id}
            model={model}
            isFirst={index === 0}
            isAllowed={
              account.allowedModels === undefined || account.allowedModels.includes(model.id)
            }
            busy={busy}
            onToggle={handleToggle}
          />
        ))}
      </View>
      {account.allowedModels !== undefined ? (
        <View style={styles.inlineActions}>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onPress={handleAllowAll}
            testID="provider-account-models-allow-all"
          >
            {t("settings.providers.settingsModal.account.allowAll")}
          </Button>
        </View>
      ) : null}
      <SectionFeedback error={mutation.error} testID="provider-account-models" />
    </PaneSection>
  );
}

// ---------------------------------------------------------------------------
// System prompt: appended to every agent launched as this account.

function AccountSystemPrompt({ account, accounts }: AccountPaneProps) {
  const { t } = useTranslation();
  const { write, error } = usePreferencesWriter(accounts, account);
  const persisted = account.preferences?.systemPrompt ?? "";
  const [draft, setDraft] = useState(persisted);
  // Remounting the input is how an uncontrolled text area takes a new value.
  const [inputKey, setInputKey] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(persisted);
    setInputKey((key) => key + 1);
  }, [account.id, persisted]);

  const handleChange = useCallback((text: string) => {
    setDraft(text);
    setSaved(false);
  }, []);
  const handleSave = useCallback(() => {
    void (async () => {
      if (await write({ systemPrompt: draft.trim() || undefined })) setSaved(true);
    })();
  }, [draft, write]);
  const handleRevert = useCallback(() => {
    setDraft(persisted);
    setInputKey((key) => key + 1);
  }, [persisted]);

  const dirty = draft.trim() !== persisted.trim();
  const tooLong = draft.length > PROVIDER_ACCOUNT_SYSTEM_PROMPT_MAX_LENGTH;
  const busy = accounts.setPreferences.isPending;

  return (
    <PaneSection
      title={t("settings.providers.settingsModal.account.systemPromptTitle")}
      description={t("settings.providers.settingsModal.account.systemPromptDescription")}
      testID="provider-account-system-prompt"
    >
      <View style={settingsStyles.card}>
        <SettingsTextArea
          key={inputKey}
          accessibilityLabel={t("settings.providers.settingsModal.account.systemPromptTitle")}
          value={draft}
          onChangeText={handleChange}
          placeholder={t("settings.providers.settingsModal.account.systemPromptPlaceholder")}
          testID="provider-account-system-prompt-input"
        />
      </View>
      <View style={styles.inlineActions}>
        {saved && !dirty ? (
          <Text style={styles.savedLabel}>
            {t("settings.providers.settingsModal.account.saved")}
          </Text>
        ) : null}
        {dirty ? (
          <Button size="sm" variant="ghost" onPress={handleRevert} disabled={busy}>
            {t("settings.providers.settingsModal.account.revert")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="default"
          onPress={handleSave}
          disabled={!dirty || tooLong || busy}
          loading={busy && dirty}
          testID="provider-account-system-prompt-save"
        >
          {t("settings.providers.settingsModal.account.save")}
        </Button>
      </View>
      {tooLong ? (
        <Text style={settingsStyles.rowError}>
          {t("settings.providers.settingsModal.account.systemPromptTooLong", {
            max: PROVIDER_ACCOUNT_SYSTEM_PROMPT_MAX_LENGTH,
          })}
        </Text>
      ) : null}
      <SectionFeedback error={error} testID="provider-account-system-prompt" />
    </PaneSection>
  );
}

// ---------------------------------------------------------------------------
// Identity: nickname and colour.

function ColorSwatch({
  color,
  selected,
  onSelect,
}: {
  color: IdentityColorName;
  selected: boolean;
  onSelect: (color: IdentityColorName) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onSelect(color), [color, onSelect]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const ringStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.swatchRing,
      selected ? { borderColor: identityColor(color) } : null,
      pressed ? styles.pressed : null,
    ],
    [color, selected],
  );
  const dotStyle = useMemo(
    () => [styles.swatchDot, { backgroundColor: identityColor(color) }],
    [color],
  );
  return (
    <Pressable
      onPress={handlePress}
      style={ringStyle}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={t(`settings.host.appearance.color.options.${color}`)}
      testID={`provider-account-color-${color}`}
    >
      <View style={dotStyle} />
    </Pressable>
  );
}

function AccountIdentity({ account, accounts, canManage, canSetPreferences }: AccountPaneProps) {
  const { t } = useTranslation();
  const rename = useSectionMutation();
  const { write, error: colorError } = usePreferencesWriter(accounts, account);
  const label = providerAccountDisplayName(account, t);
  const [draft, setDraft] = useState(label);
  const [inputKey, setInputKey] = useState(0);
  const renameMutate = accounts.rename.mutateAsync;

  useEffect(() => {
    setDraft(label);
    setInputKey((key) => key + 1);
  }, [account.id, label]);

  const normalized = normalizeProviderAccountDisplayName(draft);
  const dirty = draft.trim() !== label;
  const nameError =
    dirty && normalized === null
      ? t("settings.providers.settingsModal.account.nicknameInvalid")
      : null;

  const handleSubmit = useCallback(() => {
    if (!normalized || !dirty) return;
    void rename.run(() => renameMutate({ accountId: account.id, name: normalized }));
  }, [account.id, dirty, normalized, rename, renameMutate]);

  const color = resolveProviderAccountColor(account);
  const handleColor = useCallback(
    (next: IdentityColorName) => void write({ color: next }),
    [write],
  );

  if (!canManage && !canSetPreferences) return null;

  return (
    <PaneSection
      title={t("settings.providers.settingsModal.account.identityTitle")}
      testID="provider-account-identity"
    >
      <View style={[settingsStyles.card, styles.identityCard]}>
        {canManage ? (
          <View style={styles.nicknameRow}>
            <View style={styles.nicknameField}>
              <Field
                label={t("settings.providers.settingsModal.account.nickname")}
                hint={t("settings.providers.settingsModal.account.nicknameHint")}
                error={nameError}
                testID="provider-account-nickname-field"
              >
                <FormTextInput
                  key={inputKey}
                  initialValue={label}
                  onChangeText={setDraft}
                  onSubmitEditing={handleSubmit}
                  maxLength={PROVIDER_ACCOUNT_DISPLAY_NAME_MAX_LENGTH}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!accounts.rename.isPending}
                  testID="provider-account-nickname-input"
                />
              </Field>
            </View>
            {dirty ? (
              <Button
                size="sm"
                variant="default"
                onPress={handleSubmit}
                disabled={normalized === null || accounts.rename.isPending}
                loading={accounts.rename.isPending}
                testID="provider-account-nickname-save"
              >
                {t("settings.providers.settingsModal.account.save")}
              </Button>
            ) : null}
          </View>
        ) : null}
        {canSetPreferences ? (
          <View style={styles.colorBlock}>
            <Text style={styles.fieldLabel}>
              {t("settings.providers.settingsModal.account.color")}
            </Text>
            <View style={styles.swatches} testID="provider-account-colors">
              {IDENTITY_COLOR_NAMES.map((name) => (
                <ColorSwatch
                  key={name}
                  color={name}
                  selected={name === color}
                  onSelect={handleColor}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>
      <SectionFeedback error={rename.error ?? colorError} testID="provider-account-identity" />
    </PaneSection>
  );
}

// ---------------------------------------------------------------------------
// Danger zone: sign out, delete.

function DangerRow({
  title,
  description,
  children,
  isFirst,
}: {
  title: string;
  description: string;
  /** The row's action. */
  children: ReactNode;
  isFirst: boolean;
}) {
  return (
    <View style={[settingsStyles.row, isFirst ? null : settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{description}</Text>
      </View>
      {children}
    </View>
  );
}

function AccountDanger({ account, accounts, canManage, synthesized, onDeleted }: AccountPaneProps) {
  const { t } = useTranslation();
  const mutation = useSectionMutation();
  const isDefault = parseProviderAccountDefaultId(account.id) !== null;
  const label = providerAccountDisplayName(account, t);
  const signOutMutate = accounts.signOut.mutateAsync;
  const removeMutate = accounts.remove.mutateAsync;

  const handleSignOut = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("settings.providers.settingsModal.accounts.signOutConfirmTitle", { name: label }),
        message: t("settings.providers.settingsModal.accounts.signOutConfirmMessage"),
        confirmLabel: t("settings.providers.settingsModal.accounts.signOut"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      await mutation.run(() => signOutMutate(account.id));
    })();
  }, [account.id, label, mutation, signOutMutate, t]);

  const handleDelete = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("settings.host.providerAccounts.removeConfirmTitle", { name: label }),
        message: t("settings.host.providerAccounts.removeConfirmMessage", {
          path: account.configDir,
        }),
        confirmLabel: t("settings.host.providerAccounts.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      if (await mutation.run(() => removeMutate(account.id))) onDeleted();
    })();
  }, [account.configDir, account.id, label, mutation, onDeleted, removeMutate, t]);

  const showSignOut = canManage && account.authenticated && !synthesized;
  const showDelete = !isDefault;
  if (!showSignOut && !showDelete) return null;

  return (
    <PaneSection
      title={t("settings.providers.settingsModal.account.dangerTitle")}
      testID="provider-account-danger"
    >
      <View style={[settingsStyles.card, styles.dangerCard]}>
        {showSignOut ? (
          <DangerRow
            isFirst
            title={t("settings.providers.settingsModal.accounts.signOut")}
            description={t("settings.providers.settingsModal.account.signOutDescription")}
          >
            <Button
              size="sm"
              variant="outline"
              onPress={handleSignOut}
              loading={accounts.signOut.isPending}
              disabled={accounts.signOut.isPending}
              testID="provider-account-sign-out"
            >
              {t("settings.providers.settingsModal.accounts.signOut")}
            </Button>
          </DangerRow>
        ) : null}
        {showDelete ? (
          <DangerRow
            isFirst={!showSignOut}
            title={t("settings.providers.settingsModal.account.deleteTitle")}
            description={t("settings.providers.settingsModal.account.deleteDescription")}
          >
            <Button
              size="sm"
              variant="destructive"
              onPress={handleDelete}
              loading={accounts.remove.isPending}
              disabled={accounts.remove.isPending}
              testID="provider-account-delete"
            >
              {t("settings.providers.settingsModal.account.delete")}
            </Button>
          </DangerRow>
        ) : null}
      </View>
      <SectionFeedback
        error={mutation.error}
        warnings={mutation.warnings}
        testID="provider-account-danger"
      />
    </PaneSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  pane: {
    gap: theme.spacing[6],
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  sectionHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  sectionDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  hero: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1.5],
  },
  heroName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  heroActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  path: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  fieldStack: {
    gap: theme.spacing[3],
  },
  modelRow: {
    paddingVertical: theme.spacing[3],
  },
  mono: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    marginTop: 2,
  },
  dimmed: {
    color: theme.colors.foregroundMuted,
  },
  inlineActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  savedLabel: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.sm,
  },
  identityCard: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  nicknameRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
  },
  nicknameField: {
    flex: 1,
    minWidth: 0,
  },
  colorBlock: {
    gap: theme.spacing[2],
  },
  fieldLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  swatchRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  swatchDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  pressed: {
    opacity: 0.7,
  },
  dangerCard: {
    borderColor: theme.colors.statusDanger,
  },
}));
