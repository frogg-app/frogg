import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AgentProviderDefinition } from "@frogg/protocol/provider-manifest";
import { providerAccountDefaultId } from "@frogg/protocol/provider-accounts";
import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotAccount,
  ProviderSnapshotEntry,
} from "@frogg/protocol/agent-types";
import { useHosts } from "@/runtime/host-runtime";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { OptimisticFormPreferences } from "@/create-agent-preferences/optimistic-preferences";
import { applyAgentProfilePreferences } from "@/create-agent-preferences/preferences";
import { useProvidersSnapshot } from "./use-providers-snapshot";
import {
  useFormPreferences,
  mergeProviderPreferences,
  type FormPreferences,
} from "./use-form-preferences";
import {
  resolveAgentForm,
  resolveEffectiveModel,
  normalizeSelectedModelId,
  resolveDefaultModelId,
  mergeSelectedComposerPreferences,
  combineInitialValues,
  buildProviderDefinitionMap,
  buildProviderDefinitionMapForStatuses,
  INITIAL_AGENT_FORM_RESOLUTION,
  INITIAL_USER_MODIFIED,
  RESOLVABLE_PROVIDER_STATUSES,
  SELECTABLE_PROVIDER_STATUSES,
  type FormInitialValues,
  type FormState,
  type ProviderModelsByProvider,
} from "@/provider-selection/resolve-agent-form";
import type { MaterializedAgentProfile } from "@/agent-profiles";
import type { ProviderAccountSelection } from "@/composer/agent-controls/provider-account";

export type { FormInitialValues } from "@/provider-selection/resolve-agent-form";

export interface UseAgentFormStateOptions {
  initialServerId?: string | null;
  initialValues?: FormInitialValues;
  isVisible?: boolean;
  isCreateFlow?: boolean;
  isTargetDaemonReady?: boolean;
  onlineServerIds?: string[];
}

export interface UseAgentFormStateResult {
  selectedServerId: string | null;
  setSelectedServerId: (value: string | null) => void;
  setSelectedServerIdFromUser: (value: string | null) => void;
  selectedProvider: AgentProvider | null;
  selectedMode: string;
  setModeFromUser: (modeId: string) => void;
  selectedModel: string;
  setModelFromUser: (modelId: string) => void;
  selectedThinkingOptionId: string;
  setThinkingOptionFromUser: (thinkingOptionId: string) => void;
  workingDir: string;
  setWorkingDir: (value: string) => void;
  setWorkingDirFromUser: (value: string) => void;
  providerDefinitions: AgentProviderDefinition[];
  providerDefinitionMap: Map<AgentProvider, AgentProviderDefinition>;
  agentDefinition?: AgentProviderDefinition;
  allProviderEntries?: ProviderSnapshotEntry[];
  modeOptions: AgentMode[];
  availableModels: AgentModelDefinition[];
  allProviderModels: Map<string, AgentModelDefinition[]>;
  modelSelectorProviders: ProviderSelectorProvider[];
  isAllModelsLoading: boolean;
  isProviderModelsRefreshing: boolean;
  availableThinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  isModelLoading: boolean;
  modelError: string | null;
  refreshProviderModels: (provider?: AgentProvider) => void;
  refetchProviderModelsIfStale: () => void;
  setProviderAndModelFromUser: (provider: AgentProvider, modelId: string) => void;
  applyProfileFromUser: (profile: MaterializedAgentProfile) => void;
  clearProviderSelectionFromUser: () => void;
  // COMPAT(perAgentProviderAccounts): added in v1.3.6, remove after 2027-09-17.
  /** The selected provider's sign-in accounts, or undefined when it has none. */
  providerAccounts: ProviderSnapshotAccount[] | undefined;
  /** The provider's daemon-wide active account id, or null. */
  providerDefaultAccountId: string | null;
  /**
   * Three-valued and never to be read for truthiness: `undefined` means the user
   * has not picked, so `providerAccountId` is omitted from the launch config and
   * the daemon-wide active account applies; `null` is the explicit "Default"
   * pick; a string names an account.
   */
  selectedProviderAccountId: ProviderAccountSelection;
  setProviderAccountFromUser: (accountId: string | null) => void;
  workingDirIsEmpty: boolean;
  persistFormPreferences: () => Promise<void>;
}

function shouldAutoSelectServerId(input: {
  isVisible: boolean;
  isCreateFlow: boolean;
  isPreferencesLoading: boolean;
  userModifiedServerId: boolean;
  initialServerId: string | null | undefined;
  currentServerId: string | null;
}): boolean {
  const {
    isVisible,
    isCreateFlow,
    isPreferencesLoading,
    userModifiedServerId,
    initialServerId,
    currentServerId,
  } = input;
  if (!isVisible || !isCreateFlow) return false;
  if (isPreferencesLoading) return false;
  if (userModifiedServerId) return false;
  if (initialServerId !== undefined) return false;
  if (currentServerId) return false;
  return true;
}

function resolutionIntentKeyPart(value: string | null | undefined): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return value;
}

function buildResolutionIntentKey(initialValues: FormInitialValues | undefined): string {
  if (!initialValues) return "none";
  // workingDir seeds the open request, but locked cwd updates must not re-run
  // provider/model/mode resolution after the form has settled.
  return [
    resolutionIntentKeyPart(initialValues.serverId),
    resolutionIntentKeyPart(initialValues.provider),
    resolutionIntentKeyPart(initialValues.modeId),
    resolutionIntentKeyPart(initialValues.model),
    resolutionIntentKeyPart(initialValues.thinkingOptionId),
  ].join("\n");
}

function hasSnapshotDataForResolution(input: {
  serverId: string | null;
  snapshotEntries: ProviderSnapshotEntry[] | undefined;
}): boolean {
  if (!input.serverId) {
    return false;
  }
  return input.snapshotEntries !== undefined;
}

function resolveSelectedProviderModes(input: {
  selectedEntry: ProviderSnapshotEntry | null;
  provider: AgentProvider | null;
  providerDefinitionMap: Map<AgentProvider, AgentProviderDefinition>;
}): AgentMode[] {
  const { selectedEntry, provider, providerDefinitionMap } = input;
  if (selectedEntry?.modes) {
    return selectedEntry.modes;
  }
  if (provider) {
    return providerDefinitionMap.get(provider)?.modes ?? [];
  }
  return [];
}

function buildAllProviderModels(
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): Map<string, AgentModelDefinition[]> {
  const map = new Map<string, AgentModelDefinition[]>();
  for (const entry of snapshotEntries ?? []) {
    map.set(entry.provider, filterSelectableModels(entry.models ?? []) ?? []);
  }
  return map;
}

function buildProviderModelsByProvider(
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): ProviderModelsByProvider {
  const map: ProviderModelsByProvider = new Map();
  for (const entry of snapshotEntries ?? []) {
    map.set(entry.provider, filterSelectableModels(entry.models ?? null));
  }
  return map;
}

async function persistProviderPreferences(input: {
  provider: AgentProvider;
  formState: FormState;
  availableModels: AgentModelDefinition[] | null;
  updatePreferences: (
    updates: Partial<FormPreferences> | ((current: FormPreferences) => FormPreferences),
  ) => Promise<FormPreferences>;
}): Promise<void> {
  const { provider, formState, availableModels, updatePreferences } = input;
  const resolvedModel = resolveEffectiveModel(availableModels, formState.model);
  const modelId = resolvedModel?.id ?? formState.model;
  await updatePreferences((current) =>
    mergeProviderPreferences({
      preferences: current,
      provider,
      updates: {
        model: modelId || undefined,
        mode: formState.modeId || undefined,
        ...(modelId && formState.thinkingOptionId
          ? { thinkingByModel: { [modelId]: formState.thinkingOptionId } }
          : {}),
      },
    }),
  );
}

export function useAgentFormState(options: UseAgentFormStateOptions = {}): UseAgentFormStateResult {
  const {
    initialServerId = null,
    initialValues,
    isVisible = true,
    isCreateFlow = true,
    isTargetDaemonReady: _isTargetDaemonReady = true,
    onlineServerIds = [],
  } = options;

  const { preferences, isLoading: isPreferencesLoading, updatePreferences } = useFormPreferences();
  const preferenceOverlayRef = useRef(new OptimisticFormPreferences(preferences));

  useEffect(() => {
    preferenceOverlayRef.current.reconcile(preferences);
  }, [preferences]);

  const updateCurrentPreferences = useCallback(
    async (
      updates: Partial<FormPreferences> | ((current: FormPreferences) => FormPreferences),
    ): Promise<FormPreferences> => {
      const pendingId = preferenceOverlayRef.current.begin(updates);
      try {
        const persisted = await updatePreferences(updates);
        preferenceOverlayRef.current.commit(pendingId, persisted);
        return persisted;
      } catch (error) {
        preferenceOverlayRef.current.reject(pendingId);
        throw error;
      }
    },
    [updatePreferences],
  );

  const daemons = useHosts();

  const validServerIds = useMemo(() => new Set(daemons.map((d) => d.serverId)), [daemons]);

  const [{ form: formState, userModified, resolution }, dispatch] = useReducer(
    resolveAgentForm,
    initialServerId,
    (serverId) => ({
      form: {
        serverId,
        provider: null,
        modeId: "",
        model: "",
        thinkingOptionId: "",
        workingDir: "",
      },
      userModified: INITIAL_USER_MODIFIED,
      resolution: INITIAL_AGENT_FORM_RESOLUTION,
    }),
  );

  useEffect(() => {
    if (!isVisible) {
      dispatch({ type: "RESET" });
    }
  }, [isVisible]);

  const {
    entries: snapshotEntries,
    isLoading: snapshotIsLoading,
    isRefreshing: snapshotIsRefreshing,
    error: snapshotError,
    refresh: refreshSnapshot,
    refetchIfStale: refetchSnapshotIfStale,
  } = useProvidersSnapshot(formState.serverId, { cwd: formState.workingDir });

  const allProviderEntries = useMemo(() => snapshotEntries ?? [], [snapshotEntries]);
  const snapshotProviderDefinitions = useMemo(
    () => buildProviderDefinitions(snapshotEntries),
    [snapshotEntries],
  );
  const snapshotProviderDefinitionMap = useMemo(
    () => buildProviderDefinitionMap(snapshotProviderDefinitions),
    [snapshotProviderDefinitions],
  );
  const snapshotResolvableProviderDefinitionMap = useMemo(
    () =>
      buildProviderDefinitionMapForStatuses({
        snapshotEntries,
        providerDefinitions: snapshotProviderDefinitions,
        statuses: RESOLVABLE_PROVIDER_STATUSES,
      }),
    [snapshotEntries, snapshotProviderDefinitions],
  );
  const snapshotSelectableProviderDefinitionMap = useMemo(() => {
    return buildProviderDefinitionMapForStatuses({
      snapshotEntries,
      providerDefinitions: snapshotProviderDefinitions,
      statuses: SELECTABLE_PROVIDER_STATUSES,
    });
  }, [snapshotEntries, snapshotProviderDefinitions]);
  const snapshotAllProviderModels = useMemo(
    () => buildAllProviderModels(snapshotEntries),
    [snapshotEntries],
  );
  const snapshotProviderModelsByProvider = useMemo(
    () => buildProviderModelsByProvider(snapshotEntries),
    [snapshotEntries],
  );
  const snapshotModelSelectorProviders = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshotEntries),
    [snapshotEntries],
  );
  const snapshotSelectedEntry = useMemo(
    () =>
      formState.provider
        ? ((snapshotEntries ?? []).find((entry) => entry.provider === formState.provider) ?? null)
        : null,
    [formState.provider, snapshotEntries],
  );
  const snapshotSelectedProviderModels = filterSelectableModels(
    snapshotSelectedEntry?.models ?? null,
  );
  const selectedProviderIsLoading = snapshotSelectedEntry?.status === "loading";
  const snapshotSelectedProviderModes = resolveSelectedProviderModes({
    selectedEntry: snapshotSelectedEntry,
    provider: formState.provider,
    providerDefinitionMap: snapshotProviderDefinitionMap,
  });
  const providerDefinitions = snapshotProviderDefinitions;
  const providerDefinitionMap = snapshotProviderDefinitionMap;
  const selectableProviderDefinitionMap = snapshotSelectableProviderDefinitionMap;
  const allProviderModels = snapshotAllProviderModels;
  const modelSelectorProviders = snapshotModelSelectorProviders;
  const availableModels = snapshotSelectedProviderModels;
  const modeOptions = snapshotSelectedProviderModes;
  const isModelSelectionLoading =
    resolution.status === "pending" || snapshotIsLoading || selectedProviderIsLoading;
  const isAllModelsLoading = isModelSelectionLoading;

  const combinedInitialValues = useMemo(
    () => combineInitialValues(initialValues, initialServerId),
    [initialValues, initialServerId],
  );
  const resolutionIntentKey = useMemo(
    () => buildResolutionIntentKey(combinedInitialValues),
    [combinedInitialValues],
  );

  useEffect(() => {
    if (!isVisible || !isCreateFlow) {
      return;
    }

    dispatch({ type: "REQUEST_RESOLUTION" });
  }, [isVisible, isCreateFlow, resolutionIntentKey]);

  useEffect(() => {
    if (!isVisible || !isCreateFlow || resolution.status !== "pending") {
      return;
    }
    if (isPreferencesLoading) {
      return;
    }
    if (
      !hasSnapshotDataForResolution({
        serverId: formState.serverId,
        snapshotEntries,
      })
    ) {
      return;
    }

    dispatch({
      type: "COMPLETE_RESOLUTION",
      initialValues: combinedInitialValues,
      preferences,
      providerModelsByProvider: snapshotProviderModelsByProvider,
      allowedProviderMap: snapshotResolvableProviderDefinitionMap,
    });
  }, [
    combinedInitialValues,
    formState.serverId,
    isCreateFlow,
    isPreferencesLoading,
    isVisible,
    preferences,
    resolution.status,
    snapshotEntries,
    snapshotProviderModelsByProvider,
    snapshotResolvableProviderDefinitionMap,
  ]);

  const onlineServerIdsKey = onlineServerIds.join("|");
  useEffect(() => {
    const canAutoSelectServerId = shouldAutoSelectServerId({
      isVisible,
      isCreateFlow,
      isPreferencesLoading,
      userModifiedServerId: userModified.serverId,
      initialServerId: combinedInitialValues?.serverId,
      currentServerId: formState.serverId,
    });
    if (!canAutoSelectServerId) return;

    const candidate = onlineServerIds.find((id) => validServerIds.has(id)) ?? null;
    if (!candidate) return;

    dispatch({ type: "AUTO_SELECT_SERVER", candidateServerId: candidate });
  }, [
    combinedInitialValues?.serverId,
    isCreateFlow,
    isPreferencesLoading,
    isVisible,
    onlineServerIds,
    onlineServerIdsKey,
    formState.serverId,
    userModified.serverId,
    validServerIds,
  ]);

  const setSelectedServerIdFromUser = useCallback((value: string | null) => {
    dispatch({ type: "SET_SERVER_ID_FROM_USER", value });
  }, []);

  const setProviderAndModelFromUser = useCallback(
    (provider: AgentProvider, modelId: string) => {
      if (!selectableProviderDefinitionMap.has(provider)) {
        return;
      }
      const providerDef = selectableProviderDefinitionMap.get(provider);
      const providerModels = allProviderModels.get(provider) ?? null;
      const providerPrefs = preferenceOverlayRef.current.current().providerPreferences?.[provider];
      const normalizedModelId = normalizeSelectedModelId(modelId);
      const nextModelId = normalizedModelId || resolveDefaultModelId(providerModels);

      dispatch({
        type: "SET_PROVIDER_AND_MODEL_FROM_USER",
        provider,
        modelId,
        providerDef,
        providerModels,
        providerPrefs,
      });
      void updateCurrentPreferences((current) =>
        mergeSelectedComposerPreferences({
          preferences: current,
          provider,
          updates: {
            model: nextModelId || undefined,
          },
        }),
      );
    },
    [allProviderModels, selectableProviderDefinitionMap, updateCurrentPreferences],
  );

  const clearProviderSelectionFromUser = useCallback(() => {
    dispatch({ type: "CLEAR_PROVIDER_SELECTION_FROM_USER" });
  }, []);

  const applyProfileFromUser = useCallback(
    (profile: MaterializedAgentProfile) => {
      const provider = profile.provider as AgentProvider;
      if (!selectableProviderDefinitionMap.has(provider)) {
        return;
      }

      const previousProvider = formState.provider;
      const providerDef = selectableProviderDefinitionMap.get(provider);
      const providerModels = allProviderModels.get(provider) ?? null;
      const providerPrefs = preferenceOverlayRef.current.current().providerPreferences?.[provider];
      const action = {
        type: "APPLY_PROFILE_FROM_USER" as const,
        provider,
        modelId: profile.modelId,
        modeId: profile.modeId,
        thinkingOptionId: profile.thinkingOptionId,
        providerDef,
        providerModels,
        providerPrefs,
      };
      const nextState = resolveAgentForm({ form: formState, userModified, resolution }, action);
      const previousProviderModeIds = previousProvider
        ? (providerDefinitionMap.get(previousProvider)?.modes.map((mode) => mode.id) ?? [])
        : [];

      dispatch(action);
      void updateCurrentPreferences((current) => {
        const { model, modeId, thinkingOptionId } = nextState.form;
        return applyAgentProfilePreferences({
          preferences: current,
          previousProvider,
          previousProviderModeIds,
          provider,
          modelId: model,
          modeId,
          thinkingOptionId,
          featureValues: profile.featureValues,
        });
      }).catch((error) => {
        console.warn("[useAgentFormState] persist profile preference failed", error);
      });
    },
    [
      allProviderModels,
      formState,
      providerDefinitionMap,
      resolution,
      selectableProviderDefinitionMap,
      updateCurrentPreferences,
      userModified,
    ],
  );

  const setModeFromUser = useCallback(
    (modeId: string) => {
      dispatch({ type: "SET_MODE_FROM_USER", modeId });
      const provider = formState.provider;
      if (provider) {
        void updateCurrentPreferences((current) =>
          mergeSelectedComposerPreferences({
            preferences: current,
            provider,
            updates: {
              mode: modeId || undefined,
            },
          }),
        );
      }
    },
    [formState.provider, updateCurrentPreferences],
  );

  const setModelFromUser = useCallback(
    (modelId: string) => {
      const provider = formState.provider;
      const providerPrefs = provider
        ? preferenceOverlayRef.current.current().providerPreferences?.[provider]
        : undefined;
      dispatch({
        type: "SET_MODEL_FROM_USER",
        modelId,
        availableModels,
        providerPrefs,
      });
      if (provider) {
        const normalizedModelId = normalizeSelectedModelId(modelId);
        const nextModelId = normalizedModelId || resolveDefaultModelId(availableModels);
        void updateCurrentPreferences((current) =>
          mergeSelectedComposerPreferences({
            preferences: current,
            provider,
            updates: {
              model: nextModelId || undefined,
            },
          }),
        );
      }
    },
    [availableModels, formState.provider, updateCurrentPreferences],
  );

  const setThinkingOptionFromUser = useCallback(
    (thinkingOptionId: string) => {
      dispatch({ type: "SET_THINKING_OPTION_FROM_USER", thinkingOptionId });
      const { provider, model: modelId } = formState;
      if (provider && modelId) {
        void updateCurrentPreferences((current) =>
          mergeSelectedComposerPreferences({
            preferences: current,
            provider,
            updates: {
              thinkingByModel: {
                [modelId]: thinkingOptionId,
              },
            },
          }),
        );
      }
    },
    [formState, updateCurrentPreferences],
  );

  const setWorkingDir = useCallback((value: string) => {
    dispatch({ type: "SET_WORKING_DIR", value });
  }, []);

  const setWorkingDirFromUser = useCallback((value: string) => {
    dispatch({ type: "SET_WORKING_DIR_FROM_USER", value });
  }, []);

  const setSelectedServerId = useCallback((value: string | null) => {
    dispatch({ type: "SET_SERVER_ID", value });
  }, []);

  const refreshProviderModels = useCallback(
    (provider?: AgentProvider) => {
      void refreshSnapshot(provider ? [provider] : undefined);
    },
    [refreshSnapshot],
  );

  const refetchProviderModelsIfStale = useCallback(() => {
    refetchSnapshotIfStale(formState.provider);
  }, [formState.provider, refetchSnapshotIfStale]);

  const persistFormPreferences = useCallback(async () => {
    if (!formState.provider) {
      return;
    }
    await persistProviderPreferences({
      provider: formState.provider,
      formState,
      availableModels,
      updatePreferences: updateCurrentPreferences,
    });
  }, [availableModels, formState, updateCurrentPreferences]);

  const agentDefinition = formState.provider
    ? providerDefinitionMap.get(formState.provider)
    : undefined;
  const effectiveModel = resolveEffectiveModel(availableModels, formState.model);
  const availableThinkingOptionsRaw = effectiveModel?.thinkingOptions;
  const availableThinkingOptions = useMemo(
    () => availableThinkingOptionsRaw ?? [],
    [availableThinkingOptionsRaw],
  );
  const isModelLoading = isModelSelectionLoading;
  const modelError = snapshotError;

  const workingDirIsEmpty = !formState.workingDir.trim();

  // COMPAT(perAgentProviderAccounts): the account pick is per provider so that
  // switching provider and back does not silently carry another provider's
  // account over. A provider missing from the record has made no pick at all,
  // which is distinct from a recorded `null` ("Default").
  const [providerAccountSelections, setProviderAccountSelections] = useState<
    Record<string, string | null>
  >({});
  const selectedProvider = formState.provider;
  const selectedProviderAccountId = useMemo<ProviderAccountSelection>(() => {
    if (!selectedProvider) return undefined;
    return Object.hasOwn(providerAccountSelections, selectedProvider)
      ? providerAccountSelections[selectedProvider]
      : undefined;
  }, [providerAccountSelections, selectedProvider]);
  const providerAccounts = snapshotSelectedEntry?.accounts;
  const setProviderAccountFromUser = useCallback(
    (accountId: string | null) => {
      if (!selectedProvider) return;
      setProviderAccountSelections((current) => ({ ...current, [selectedProvider]: accountId }));
      // COMPAT(providerAccountPreferences): picking an account starts the draft on
      // that account's default model and thinking level. The pick is not written
      // to the composer preferences: the defaults belong to the account.
      const lookupId = accountId ?? providerAccountDefaultId(selectedProvider);
      const accountPreferences = providerAccounts?.find(
        (account) => account.id === lookupId,
      )?.preferences;
      const defaultModelId = accountPreferences?.defaultModelId;
      if (defaultModelId && availableModels?.some((model) => model.id === defaultModelId)) {
        dispatch({
          type: "SET_MODEL_FROM_USER",
          modelId: defaultModelId,
          availableModels,
          providerPrefs:
            preferenceOverlayRef.current.current().providerPreferences?.[selectedProvider],
        });
      }
      if (accountPreferences?.defaultThinkingOptionId) {
        dispatch({
          type: "SET_THINKING_OPTION_FROM_USER",
          thinkingOptionId: accountPreferences.defaultThinkingOptionId,
        });
      }
    },
    [availableModels, providerAccounts, selectedProvider],
  );
  const providerDefaultAccountId = snapshotSelectedEntry?.defaultAccountId ?? null;

  return useMemo(
    () => ({
      selectedServerId: formState.serverId,
      setSelectedServerId,
      setSelectedServerIdFromUser,
      selectedProvider: formState.provider,
      selectedMode: formState.modeId,
      setModeFromUser,
      selectedModel: formState.model,
      setModelFromUser,
      selectedThinkingOptionId: formState.thinkingOptionId,
      setThinkingOptionFromUser,
      workingDir: formState.workingDir,
      setWorkingDir,
      setWorkingDirFromUser,
      providerDefinitions,
      providerDefinitionMap,
      agentDefinition,
      allProviderEntries,
      modeOptions,
      availableModels: availableModels ?? [],
      allProviderModels,
      modelSelectorProviders,
      isAllModelsLoading,
      isProviderModelsRefreshing: snapshotIsRefreshing,
      availableThinkingOptions,
      isModelLoading,
      modelError,
      refreshProviderModels,
      refetchProviderModelsIfStale,
      setProviderAndModelFromUser,
      applyProfileFromUser,
      clearProviderSelectionFromUser,
      providerAccounts,
      providerDefaultAccountId,
      selectedProviderAccountId,
      setProviderAccountFromUser,
      workingDirIsEmpty,
      persistFormPreferences,
    }),
    [
      formState.serverId,
      formState.provider,
      formState.modeId,
      formState.model,
      formState.thinkingOptionId,
      formState.workingDir,
      setSelectedServerId,
      setSelectedServerIdFromUser,
      setModeFromUser,
      setModelFromUser,
      setThinkingOptionFromUser,
      setWorkingDir,
      setWorkingDirFromUser,
      providerDefinitions,
      providerDefinitionMap,
      agentDefinition,
      allProviderEntries,
      modeOptions,
      availableModels,
      allProviderModels,
      modelSelectorProviders,
      isAllModelsLoading,
      snapshotIsRefreshing,
      availableThinkingOptions,
      isModelLoading,
      modelError,
      refreshProviderModels,
      refetchProviderModelsIfStale,
      setProviderAndModelFromUser,
      applyProfileFromUser,
      clearProviderSelectionFromUser,
      providerAccounts,
      providerDefaultAccountId,
      selectedProviderAccountId,
      setProviderAccountFromUser,
      workingDirIsEmpty,
      persistFormPreferences,
    ],
  );
}

export type CreateAgentInitialValues = FormInitialValues;
