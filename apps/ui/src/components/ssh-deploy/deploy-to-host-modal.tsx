import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { Check, Circle, Minus, Rocket, X } from "lucide-react-native";
import { DEFAULT_SSH_DAEMON_PORT } from "@frogg/protocol/ssh-transport";
import type { HostProfile } from "@/types/host-connection";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SshConfigHostPicker, useSshConfigHosts } from "@/components/ssh-config-host-picker";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  DEPLOY_STEPS,
  DeployToHostError,
  daemonKeyFingerprint,
  deployAction,
  resolveDeployTarget,
  runDeployToHost,
  type DeployFormError,
  type DeployNetwork,
  type DeployStepId,
  type DeployStepStatus,
  type DeployToHostDeps,
} from "@/desktop/ssh-deploy/deploy-to-host";
import {
  describeSshDeployPlatform,
  fetchSshDeployPairCode,
  probeSshDeploy,
  runSshDeployJob,
  type SshDeployProbe,
} from "@/desktop/ssh-deploy/ssh-deploy";

const FLEX_ONE_STYLE = { flex: 1 } as const;
const FLEX_TWO_STYLE = { flex: 2 } as const;
const MAX_LOG_LINES = 500;
const ThemedRocket = withUnistyles(Rocket);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedCheck = withUnistyles(Check);
const ThemedX = withUnistyles(X);
const ThemedMinus = withUnistyles(Minus);
const ThemedCircle = withUnistyles(Circle);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const successIconMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const dangerIconMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

const styles = StyleSheet.create((theme) => ({
  helper: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  tabs: { alignSelf: "flex-start" },
  row: { flexDirection: "row", gap: theme.spacing[3] },
  steps: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  step: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  stepIcon: { width: 16, alignItems: "center" },
  stepBody: { flex: 1 },
  stepLabel: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  stepPending: { color: theme.colors.foregroundMuted },
  stepNote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
  },
  note: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  log: {
    maxHeight: 180,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
  },
  logContent: { padding: theme.spacing[3] },
  logLine: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));

type Phase = "form" | "running" | "failed" | "done";
type StepStates = Record<DeployStepId, DeployStepStatus>;

const IDLE_STEPS: StepStates = {
  connect: "pending",
  install: "pending",
  pairCode: "pending",
  pair: "pending",
};

export interface DeployToHostModalProps {
  visible: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSaved?: (result: {
    profile: HostProfile | null;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

/**
 * Hosts → "Deploy to host": pick an SSH config entry or type the target,
 * choose SSH tunnel (loopback daemon) or network, then watch each step.
 * Re-running on a host that already has the daemon upgrades or reinstalls it.
 */
export function DeployToHostModal({ visible, onClose, onCancel, onSaved }: DeployToHostModalProps) {
  const { t } = useTranslation();
  const configHosts = useSshConfigHosts();
  const isCompact = useIsCompactFormFactor();
  const size = isCompact ? "md" : "sm";

  const fields = useRef<DeployFields>({
    host: "",
    user: "",
    sshPort: "",
    identityFile: "",
    daemonPort: "",
  });
  const [chosenMode, setChosenMode] = useState<"config" | "manual" | null>(null);
  const [alias, setAlias] = useState<string | null>(null);
  const [network, setNetwork] = useState<DeployNetwork>("tunnel");
  const run = useDeployRun();

  const mode =
    chosenMode ?? (configHosts === undefined || configHosts.length > 0 ? "config" : "manual");
  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.deployHost.title") }), [t]);
  const modeOptions = useMemo<SegmentedControlOption<"config" | "manual">[]>(
    () => [
      {
        value: "config",
        label: t("pairing.deployHost.tabs.config"),
        testID: "deploy-host-tab-config",
      },
      {
        value: "manual",
        label: t("pairing.deployHost.tabs.manual"),
        testID: "deploy-host-tab-manual",
      },
    ],
    [t],
  );
  const networkOptions = useMemo<SegmentedControlOption<DeployNetwork>[]>(
    () => [
      {
        value: "tunnel",
        label: t("pairing.deployHost.network.tunnel"),
        testID: "deploy-host-network-tunnel",
      },
      {
        value: "lan",
        label: t("pairing.deployHost.network.lan"),
        testID: "deploy-host-network-lan",
      },
    ],
    [t],
  );

  const resetForm = useCallback(() => {
    fields.current = { host: "", user: "", sshPort: "", identityFile: "", daemonPort: "" };
    setChosenMode(null);
    setAlias(null);
    setNetwork("tunnel");
    run.reset();
  }, [run]);

  const { reportSaved, phase } = run;
  const handleClose = useCallback(() => {
    if (phase === "running") return;
    const result = run.result();
    resetForm();
    onClose();
    reportSaved(result, onSaved);
  }, [onClose, onSaved, phase, reportSaved, resetForm, run]);

  const { backToForm } = run;
  const handleBack = useCallback(() => {
    if (phase === "running") return;
    if (phase === "form") {
      resetForm();
      (onCancel ?? onClose)();
      return;
    }
    backToForm();
  }, [backToForm, onCancel, onClose, phase, resetForm]);

  const { start } = run;
  const handleStart = useCallback(
    () => void start({ mode, alias, network, fields: fields.current }),
    [alias, mode, network, start],
  );

  const setField = useCallback(
    (key: keyof DeployFields) => (value: string) => {
      fields.current[key] = value;
    },
    [],
  );
  const onHost = useMemo(() => setField("host"), [setField]);
  const onUser = useMemo(() => setField("user"), [setField]);
  const onSshPort = useMemo(() => setField("sshPort"), [setField]);
  const onKey = useMemo(() => setField("identityFile"), [setField]);
  const onDaemonPort = useMemo(() => setField("daemonPort"), [setField]);

  const {
    steps,
    probe,
    error,
    daemonPort,
    verified,
    lines,
    showLog,
    toggleLog,
    cancel: handleCancelRun,
    formError,
  } = run;
  const formErrorText = formError ? t(`pairing.deployHost.formErrors.${formError}`) : undefined;
  const editable = phase === "form";
  const saved = run.result();

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="deploy-host-modal"
    >
      <Text style={styles.helper}>{t("pairing.deployHost.helper")}</Text>
      {editable ? (
        <DeployForm
          size={size}
          mode={mode}
          onModeChange={setChosenMode}
          modeOptions={modeOptions}
          networkOptions={networkOptions}
          configHosts={configHosts}
          alias={alias}
          onAliasChange={setAlias}
          fields={fields.current}
          formError={formError}
          formErrorText={formErrorText}
          network={network}
          onNetworkChange={setNetwork}
          onUser={onUser}
          onHost={onHost}
          onSshPort={onSshPort}
          onDaemonPort={onDaemonPort}
          onKey={onKey}
          onSubmit={handleStart}
        />
      ) : (
        <DeployProgress
          steps={steps}
          probe={probe}
          error={error}
          daemonPort={daemonPort}
          done={phase === "done"}
          verified={verified}
          name={saved?.hostname ?? saved?.serverId ?? ""}
          lines={lines}
          showLog={showLog}
          onToggleLog={toggleLog}
        />
      )}
      <DeployActions
        phase={phase}
        onCancelRun={handleCancelRun}
        onClose={handleClose}
        onBack={handleBack}
        onStart={handleStart}
      />
    </AdaptiveModalSheet>
  );
}

interface DeployFormProps {
  size: "sm" | "md";
  mode: "config" | "manual";
  onModeChange: (mode: "config" | "manual") => void;
  modeOptions: SegmentedControlOption<"config" | "manual">[];
  networkOptions: SegmentedControlOption<DeployNetwork>[];
  configHosts: ReturnType<typeof useSshConfigHosts>;
  alias: string | null;
  onAliasChange: (alias: string) => void;
  fields: DeployFields;
  formError: DeployFormError | null;
  formErrorText: string | undefined;
  network: DeployNetwork;
  onNetworkChange: (network: DeployNetwork) => void;
  onUser: (value: string) => void;
  onHost: (value: string) => void;
  onSshPort: (value: string) => void;
  onDaemonPort: (value: string) => void;
  onKey: (value: string) => void;
  onSubmit: () => void;
}

/** Picks the SSH target — a config entry or typed-in details — and the network. */
function DeployForm(props: DeployFormProps) {
  const { t } = useTranslation();
  const { size, mode, fields, formError, formErrorText, network } = props;
  return (
    <>
      <SegmentedControl
        options={props.modeOptions}
        value={mode}
        onValueChange={props.onModeChange}
        size={size}
        style={styles.tabs}
        testID="deploy-host-tabs"
      />
      {mode === "config" && props.configHosts !== undefined ? (
        <SshConfigHostPicker
          hosts={props.configHosts}
          selectedAlias={props.alias}
          onSelect={props.onAliasChange}
          daemonPortText={fields.daemonPort}
          onDaemonPortChange={props.onDaemonPort}
          size={size}
          hostError={formError === "hostRequired" ? formErrorText : undefined}
          daemonPortError={formError === "invalidDaemonPort" ? formErrorText : undefined}
          onSubmit={props.onSubmit}
        />
      ) : null}
      {mode === "manual" ? (
        <ManualFields
          size={size}
          fields={fields}
          formError={formError}
          formErrorText={formErrorText}
          onUser={props.onUser}
          onHost={props.onHost}
          onSshPort={props.onSshPort}
          onDaemonPort={props.onDaemonPort}
          onKey={props.onKey}
          onSubmit={props.onSubmit}
        />
      ) : null}
      <Field
        label={t("pairing.deployHost.network.label")}
        hint={
          network === "tunnel"
            ? t("pairing.deployHost.network.tunnelHint")
            : t("pairing.deployHost.network.lanHint", {
                port: fields.daemonPort.trim() || DEFAULT_SSH_DAEMON_PORT,
              })
        }
        testID="deploy-host-network"
      >
        <SegmentedControl
          options={props.networkOptions}
          value={network}
          onValueChange={props.onNetworkChange}
          size={size}
          style={styles.tabs}
        />
      </Field>
    </>
  );
}

/** The running deploy: its steps, then the outcome and the remote log. */
function DeployProgress({
  steps,
  probe,
  error,
  daemonPort,
  done,
  verified,
  name,
  lines,
  showLog,
  onToggleLog,
}: {
  steps: StepStates;
  probe: SshDeployProbe | null;
  error: DeployToHostError | null;
  daemonPort: number;
  done: boolean;
  verified: boolean;
  name: string;
  lines: string[];
  showLog: boolean;
  onToggleLog: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <DeploySteps steps={steps} probe={probe} testID="deploy-host-steps" />
      {error ? (
        <Text style={styles.error} testID="deploy-host-error">
          {t(`pairing.deployHost.errors.${error.code}`, { detail: error.detail, port: daemonPort })}
        </Text>
      ) : null}
      {done ? (
        <Text style={styles.note} testID="deploy-host-success">
          {t("pairing.deployHost.success", { name })}
          {verified ? "" : ` ${t("pairing.deployHost.unverified")}`}
        </Text>
      ) : null}
      {lines.length > 0 ? (
        <Button variant="ghost" size="sm" onPress={onToggleLog} testID="deploy-host-toggle-log">
          {showLog
            ? t("pairing.deployHost.actions.hideLog")
            : t("pairing.deployHost.actions.showLog")}
        </Button>
      ) : null}
      {showLog && lines.length > 0 ? <DeployLog lines={lines} /> : null}
    </>
  );
}

function StepRow({
  status,
  label,
  note,
  testID,
}: {
  status: DeployStepStatus;
  label: string;
  note: string | null;
  testID: string;
}) {
  let icon;
  if (status === "running")
    icon = <ThemedActivityIndicator size="small" uniProps={mutedIconMapping} />;
  else if (status === "done") icon = <ThemedCheck size={14} uniProps={successIconMapping} />;
  else if (status === "failed") icon = <ThemedX size={14} uniProps={dangerIconMapping} />;
  else if (status === "skipped") icon = <ThemedMinus size={14} uniProps={mutedIconMapping} />;
  else icon = <ThemedCircle size={10} uniProps={mutedIconMapping} />;
  return (
    <View style={styles.step} testID={testID} accessibilityLabel={`${label}: ${status}`}>
      <View style={styles.stepIcon}>{icon}</View>
      <View style={styles.stepBody}>
        <Text style={[styles.stepLabel, status === "pending" && styles.stepPending]}>{label}</Text>
        {note ? <Text style={styles.stepNote}>{note}</Text> : null}
      </View>
    </View>
  );
}

function DeployLog({ lines }: { lines: string[] }) {
  const scrollRef = useRef<ScrollView>(null);
  const handleSize = useCallback(() => scrollRef.current?.scrollToEnd({ animated: false }), []);
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.log}
      contentContainerStyle={styles.logContent}
      onContentSizeChange={handleSize}
      testID="deploy-host-log"
    >
      {lines.map((line, index) => (
        // Log lines have no identity; the index is stable because lines only append.
        // eslint-disable-next-line react/no-array-index-key
        <Text key={index} style={styles.logLine} selectable>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

interface ManualFieldsProps {
  size: "sm" | "md";
  fields: { host: string; user: string; sshPort: string; identityFile: string; daemonPort: string };
  formError: DeployFormError | null;
  formErrorText: string | undefined;
  onUser: (value: string) => void;
  onHost: (value: string) => void;
  onSshPort: (value: string) => void;
  onDaemonPort: (value: string) => void;
  onKey: (value: string) => void;
  onSubmit: () => void;
}

/** The typed-in SSH target: user, host, ports and an optional key file. */
function ManualFields({
  size,
  fields,
  formError,
  formErrorText,
  onUser,
  onHost,
  onSshPort,
  onDaemonPort,
  onKey,
  onSubmit,
}: ManualFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.row}>
        <View style={FLEX_ONE_STYLE}>
          <Field label={t("pairing.deployHost.fields.user")} testID="deploy-host-user">
            <FormTextInput
              size={size}
              accessibilityLabel={t("pairing.deployHost.fields.user")}
              initialValue={fields.user}
              onChangeText={onUser}
              autoCapitalize="none"
              autoCorrect={false}
              testID="deploy-host-user-input"
            />
          </Field>
        </View>
        <View style={FLEX_TWO_STYLE}>
          <Field
            label={t("pairing.deployHost.fields.host")}
            error={
              formError === "hostRequired" || formError === "invalidHost"
                ? formErrorText
                : undefined
            }
            testID="deploy-host-host"
          >
            <FormTextInput
              size={size}
              accessibilityLabel={t("pairing.deployHost.fields.host")}
              initialValue={fields.host}
              onChangeText={onHost}
              placeholder="build.example.com"
              autoCapitalize="none"
              autoCorrect={false}
              testID="deploy-host-host-input"
            />
          </Field>
        </View>
      </View>
      <View style={styles.row}>
        <View style={FLEX_ONE_STYLE}>
          <Field
            label={t("pairing.deployHost.fields.sshPort")}
            error={formError === "invalidSshPort" ? formErrorText : undefined}
            testID="deploy-host-ssh-port"
          >
            <FormTextInput
              size={size}
              accessibilityLabel={t("pairing.deployHost.fields.sshPort")}
              initialValue={fields.sshPort}
              onChangeText={onSshPort}
              placeholder="22"
              keyboardType="number-pad"
            />
          </Field>
        </View>
        <View style={FLEX_ONE_STYLE}>
          <Field
            label={t("pairing.deployHost.fields.daemonPort")}
            error={formError === "invalidDaemonPort" ? formErrorText : undefined}
            testID="deploy-host-daemon-port"
          >
            <FormTextInput
              size={size}
              accessibilityLabel={t("pairing.deployHost.fields.daemonPort")}
              initialValue={fields.daemonPort}
              onChangeText={onDaemonPort}
              placeholder={String(DEFAULT_SSH_DAEMON_PORT)}
              keyboardType="number-pad"
            />
          </Field>
        </View>
      </View>
      <Field
        label={t("pairing.deployHost.fields.identityFile")}
        hint={t("pairing.deployHost.fields.identityFileHint")}
        error={
          formError === "invalidKeyFile" || formError === "tunnelKeyUnsupported"
            ? formErrorText
            : undefined
        }
        testID="deploy-host-key"
      >
        <FormTextInput
          size={size}
          accessibilityLabel={t("pairing.deployHost.fields.identityFile")}
          initialValue={fields.identityFile}
          onChangeText={onKey}
          placeholder="~/.ssh/id_ed25519"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={onSubmit}
        />
      </Field>
    </>
  );
}

/** The footer buttons for each phase of the deploy. */
function DeployActions({
  phase,
  onCancelRun,
  onClose,
  onBack,
  onStart,
}: {
  phase: Phase;
  onCancelRun: () => void;
  onClose: () => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  let content;
  if (phase === "running") {
    content = (
      <Button
        style={FLEX_ONE_STYLE}
        variant="secondary"
        onPress={onCancelRun}
        testID="deploy-host-cancel"
      >
        {t("pairing.deployHost.actions.cancel")}
      </Button>
    );
  } else if (phase === "done") {
    content = (
      <Button style={FLEX_ONE_STYLE} onPress={onClose} testID="deploy-host-done">
        {t("pairing.deployHost.actions.done")}
      </Button>
    );
  } else {
    content = (
      <>
        <Button style={FLEX_ONE_STYLE} variant="secondary" onPress={onBack}>
          {phase === "form"
            ? t("pairing.deployHost.actions.cancel")
            : t("pairing.deployHost.actions.back")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          onPress={onStart}
          leftIcon={ThemedRocket}
          testID="deploy-host-submit"
        >
          {phase === "failed"
            ? t("pairing.deployHost.actions.retry")
            : t("pairing.deployHost.actions.deploy")}
        </Button>
      </>
    );
  }
  return (
    <View style={styles.actions} testID="deploy-host-actions">
      {content}
    </View>
  );
}

/** The four deploy steps, labelled for a first install, an upgrade or a reinstall. */
function DeploySteps({
  steps,
  probe,
  testID,
}: {
  steps: StepStates;
  probe: SshDeployProbe | null;
  testID: string;
}) {
  const { t } = useTranslation();
  const installLabel = useMemo(() => {
    if (!probe) return t("pairing.deployHost.steps.install");
    const action = deployAction(probe, null);
    if (action === "deploy") return t("pairing.deployHost.steps.install");
    const from = probe.hasFrogg.version ?? "?";
    return action === "reinstall"
      ? t("pairing.deployHost.steps.reinstall", { version: from })
      : t("pairing.deployHost.steps.upgrade", { from });
  }, [probe, t]);
  const noteFor = (step: DeployStepId): string | null => {
    if (step === "connect" && probe) {
      return t("pairing.deployHost.platform", { platform: describeSshDeployPlatform(probe) });
    }
    return steps[step] === "skipped" ? t("pairing.deployHost.skipped") : null;
  };
  return (
    <View style={styles.steps} testID={testID}>
      {DEPLOY_STEPS.map((step) => (
        <StepRow
          key={step}
          status={steps[step]}
          label={step === "install" ? installLabel : t(`pairing.deployHost.steps.${step}`)}
          note={noteFor(step)}
          testID={`deploy-host-step-${step}`}
        />
      ))}
    </View>
  );
}

type HostMutations = ReturnType<typeof useHostMutations>;

interface DeployRunOptions {
  signal: AbortSignal;
  connectTunnel: HostMutations["probeAndUpsertRemoteSshConnection"];
  claim: HostMutations["claimAndUpsertDirectOffer"];
  onLog: (text: string) => void;
  onStep: (step: DeployStepId, status: DeployStepStatus) => void;
  onProbe: (probe: SshDeployProbe) => void;
}

function asDeployError(caught: unknown): DeployToHostError {
  return caught instanceof DeployToHostError
    ? caught
    : new DeployToHostError("connect", "connect_failed", String(caught));
}

/**
 * Wires the deploy run to the desktop commands and the host store, and reports
 * the profile the run added or refreshed alongside the daemon it reached.
 */
async function executeDeploy(
  input: Parameters<typeof runDeployToHost>[0],
  options: DeployRunOptions,
): Promise<{
  profile: HostProfile | null;
  serverId: string;
  hostname: string | null;
  verified: boolean;
}> {
  let profile: HostProfile | null = null;
  const deps: DeployToHostDeps = {
    probe: probeSshDeploy,
    install: (job, signal) => runSshDeployJob(job, { signal, onLog: options.onLog }),
    pairCode: fetchSshDeployPairCode,
    connectTunnel: async (target) => {
      const result = await options.connectTunnel(target);
      profile = result.profile;
      return { serverId: result.serverId, hostname: result.hostname };
    },
    claim: async (offer, claimInput) => {
      const result = await options.claim(offer, claimInput);
      profile = result.profile;
      return { serverId: result.serverId, hostname: result.hostname };
    },
    fingerprint: (key) => daemonKeyFingerprint(key),
  };
  const deployed = await runDeployToHost(input, deps, {
    signal: options.signal,
    onStep: options.onStep,
    onProbe: options.onProbe,
  });
  return {
    profile,
    serverId: deployed.serverId,
    hostname: deployed.hostname,
    verified: deployed.verified,
  };
}

export interface DeployFields {
  host: string;
  user: string;
  sshPort: string;
  identityFile: string;
  daemonPort: string;
}

type DeploySavedResult = Parameters<NonNullable<DeployToHostModalProps["onSaved"]>>[0];

/**
 * The run itself: validates the form's target, drives the deploy and keeps the
 * step, log and result state the modal renders. Form fields stay in the modal.
 */
function useDeployRun() {
  const hosts = useHosts();
  const { probeAndUpsertRemoteSshConnection, claimAndUpsertDirectOffer } = useHostMutations();
  const [formError, setFormError] = useState<DeployFormError | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [steps, setSteps] = useState<StepStates>(IDLE_STEPS);
  const [probe, setProbe] = useState<SshDeployProbe | null>(null);
  const [error, setError] = useState<DeployToHostError | null>(null);
  const [daemonPort, setDaemonPort] = useState(DEFAULT_SSH_DAEMON_PORT);
  const [verified, setVerified] = useState(true);
  const [lines, setLines] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<DeploySavedResult | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (form: {
      mode: "config" | "manual";
      alias: string | null;
      network: DeployNetwork;
      fields: DeployFields;
    }) => {
      const resolved = resolveDeployTarget({
        mode: form.mode,
        alias: form.alias,
        host: form.fields.host,
        user: form.fields.user,
        sshPortText: form.fields.sshPort,
        identityFile: form.fields.identityFile,
        daemonPortText: form.fields.daemonPort,
        network: form.network,
        defaultDaemonPort: DEFAULT_SSH_DAEMON_PORT,
      });
      if (!resolved.ok) {
        setFormError(resolved.error);
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setFormError(null);
      setError(null);
      setProbe(null);
      setLines([]);
      setSteps(IDLE_STEPS);
      setDaemonPort(resolved.daemonPort);
      setPhase("running");
      try {
        const deployed = await executeDeploy(
          { target: resolved.target, network: form.network, daemonPort: resolved.daemonPort },
          {
            signal: controller.signal,
            connectTunnel: probeAndUpsertRemoteSshConnection,
            claim: claimAndUpsertDirectOffer,
            onLog: (text) =>
              setLines((previous) => [...previous.slice(-(MAX_LOG_LINES - 1)), text]),
            onStep: (step, status) => setSteps((previous) => ({ ...previous, [step]: status })),
            onProbe: setProbe,
          },
        );
        setVerified(deployed.verified);
        resultRef.current = {
          profile: deployed.profile,
          serverId: deployed.serverId,
          hostname: deployed.hostname,
          isNewHost: !hosts.some((host) => host.serverId === deployed.serverId),
        };
        setPhase("done");
      } catch (caught) {
        setError(asDeployError(caught));
        setShowLog(true);
        setPhase("failed");
      } finally {
        abortRef.current = null;
      }
    },
    [claimAndUpsertDirectOffer, hosts, probeAndUpsertRemoteSshConnection],
  );

  const reset = useCallback(() => {
    setFormError(null);
    setPhase("form");
    setSteps(IDLE_STEPS);
    setProbe(null);
    setError(null);
    setLines([]);
    setShowLog(false);
    resultRef.current = null;
  }, []);

  const backToForm = useCallback(() => {
    setPhase("form");
    setSteps(IDLE_STEPS);
    setError(null);
  }, []);

  return {
    formError,
    phase,
    steps,
    probe,
    error,
    daemonPort,
    verified,
    lines,
    showLog,
    start,
    reset,
    backToForm,
    result: useCallback(() => resultRef.current, []),
    reportSaved: useCallback(
      (result: DeploySavedResult | null, onSaved?: (value: DeploySavedResult) => void) => {
        if (result) onSaved?.(result);
      },
      [],
    ),
    cancel: useCallback(() => abortRef.current?.abort(), []),
    toggleLog: useCallback(() => setShowLog((value) => !value), []),
  };
}
