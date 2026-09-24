import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { navigateSettings } from "@/navigation/settings-navigation";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { SecurityFindingView } from "./posture";
import { SecurityDot } from "./security-dot";
import {
  useAcknowledgeSecurityFinding,
  useRefreshSecurityPosture,
  useSecurityPosture,
} from "./use-security-posture";

/** The daemon enforces the same minimum (`auth.password.set`). */
export const MIN_DAEMON_PASSWORD_LENGTH = 8;

const DISABLE_TRUST_LAN = { trustLan: false } as const;
const ENABLE_CLAIM_MODE = { claimMode: true } as const;

type PasswordProblem = "tooShort" | "mismatch" | null;

export function validateDaemonPassword(password: string, confirm: string): PasswordProblem {
  if (password.length < MIN_DAEMON_PASSWORD_LENGTH) return "tooShort";
  if (password !== confirm) return "mismatch";
  return null;
}

/** Host settings › Security. */
export function HostSecurityPage({ serverId }: { serverId: string }) {
  return (
    <View>
      <HostSecurityCard serverId={serverId} />
    </View>
  );
}

/**
 * The host's security findings, each with the fix this device can apply, and
 * any warnings the owner marked as intended. Renders nothing for a daemon
 * without `features.securityPosture` and for a non-owner.
 */
export function HostSecurityCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const posture = useSecurityPosture(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { refresh } = useRefreshSecurityPosture(serverId);
  const hasFindings = posture.findings.length > 0 || posture.acknowledged.length > 0;

  // Pairing elsewhere does not re-send server_info, so re-read on arrival.
  useEffect(() => {
    if (isConnected && posture.available) void refresh();
  }, [isConnected, posture.available, refresh]);

  if (!posture.available) return null;

  return (
    <SettingsSection
      title={t("settings.host.security.findingsTitle")}
      testID="host-security-section"
    >
      <View style={settingsStyles.card} testID="host-security-card">
        {hasFindings ? null : (
          <View style={styles.findingRow} testID="host-security-clear">
            <Text style={settingsStyles.rowHint}>{t("settings.host.security.noFindings")}</Text>
          </View>
        )}
        {posture.findings.map((finding, index) => (
          <SecurityFindingRow
            key={finding.id}
            serverId={serverId}
            finding={finding}
            isFirst={index === 0}
            canAcknowledge={posture.canAcknowledge}
            onFixed={refresh}
          />
        ))}
        {posture.acknowledged.map((finding, index) => (
          <AcknowledgedFindingRow
            key={finding.id}
            serverId={serverId}
            finding={finding}
            isFirst={index === 0 && posture.findings.length === 0}
            canAcknowledge={posture.canAcknowledge}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function findingCopyKey(finding: SecurityFindingView): string {
  return `settings.host.security.findings.${finding.knownId ?? "unknown"}`;
}

function SecurityFindingRow({
  serverId,
  finding,
  isFirst,
  canAcknowledge,
  onFixed,
}: {
  serverId: string;
  finding: SecurityFindingView;
  isFirst: boolean;
  canAcknowledge: boolean;
  onFixed: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const key = findingCopyKey(finding);
  return (
    <View
      style={[styles.findingRow, !isFirst && settingsStyles.rowBorder]}
      testID={`host-security-finding-${finding.id}`}
    >
      <View style={styles.findingHeader}>
        <SecurityDot severity={finding.severity} />
        <Text style={[settingsStyles.rowTitle, styles.findingTitle]}>{t(`${key}.title`)}</Text>
        <StatusBadge
          label={t(`settings.host.security.severity.${finding.severity}`)}
          variant={finding.severity === "critical" ? "error" : "warning"}
        />
      </View>
      <Text style={settingsStyles.rowHint}>{t(`${key}.body`, { id: finding.id })}</Text>
      <FindingFix serverId={serverId} finding={finding} onFixed={onFixed} />
      {canAcknowledge && finding.severity === "warning" ? (
        <AcknowledgeToggle serverId={serverId} findingId={finding.id} acknowledged={false} />
      ) : null}
    </View>
  );
}

/** A warning the owner marked as intended: muted, no dot, and a way to be warned again. */
function AcknowledgedFindingRow({
  serverId,
  finding,
  isFirst,
  canAcknowledge,
}: {
  serverId: string;
  finding: SecurityFindingView;
  isFirst: boolean;
  canAcknowledge: boolean;
}) {
  const { t } = useTranslation();
  const key = findingCopyKey(finding);
  return (
    <View
      style={[styles.findingRow, !isFirst && settingsStyles.rowBorder]}
      testID={`host-security-acknowledged-${finding.id}`}
    >
      <View style={styles.findingHeader}>
        <Text style={[settingsStyles.rowHint, styles.findingTitle]}>{t(`${key}.title`)}</Text>
        <StatusBadge label={t("settings.host.security.acknowledged")} />
        {canAcknowledge ? (
          <View style={styles.inlineAction}>
            <AcknowledgeToggle serverId={serverId} findingId={finding.id} acknowledged inline />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function AcknowledgeToggle({
  serverId,
  findingId,
  acknowledged,
  inline = false,
}: {
  serverId: string;
  findingId: string;
  /** Whether the finding is currently marked as intended. */
  acknowledged: boolean;
  /** Sits in a row header rather than an actions row of its own. */
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const { setAcknowledged } = useAcknowledgeSecurityFinding(serverId);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    setIsPending(true);
    setError(null);
    try {
      const sent = await setAcknowledged(findingId, !acknowledged);
      if (!sent) setError(t("common.errors.daemonClientUnavailable"));
    } catch (cause) {
      setError(t("settings.host.security.actionFailed", { message: describeError(cause) }));
    } finally {
      setIsPending(false);
    }
  }, [acknowledged, findingId, setAcknowledged, t]);
  const handlePress = useCallback(() => void toggle(), [toggle]);

  return (
    <View>
      <View style={inline ? styles.inlineActions : styles.actions}>
        <Button
          size="sm"
          variant="ghost"
          onPress={handlePress}
          disabled={isPending}
          testID={`host-security-${acknowledged ? "unacknowledge" : "acknowledge"}-${findingId}`}
        >
          {isPending
            ? t("settings.host.security.pending")
            : t(
                acknowledged
                  ? "settings.host.security.actions.unacknowledge"
                  : "settings.host.security.actions.acknowledge",
              )}
        </Button>
      </View>
      {error ? <Text style={settingsStyles.rowError}>{error}</Text> : null}
    </View>
  );
}

function FindingFix({
  serverId,
  finding,
  onFixed,
}: {
  serverId: string;
  finding: SecurityFindingView;
  onFixed: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const openPairDevice = useCallback(
    () => navigateSettings({ kind: "host", serverId, section: "pair-device" }),
    [serverId],
  );
  const openDevices = useCallback(
    () => navigateSettings({ kind: "host", serverId, section: "devices" }),
    [serverId],
  );

  switch (finding.fixAction) {
    case "claim":
      return (
        <View style={styles.actions}>
          <Button
            size="sm"
            onPress={openPairDevice}
            testID={`host-security-fix-${finding.id}-claim`}
          >
            {t("settings.host.security.actions.claim")}
          </Button>
          <Button size="sm" variant="outline" onPress={openDevices}>
            {t("settings.host.security.actions.openDevices")}
          </Button>
        </View>
      );
    case "set_password":
      return <SetPasswordFix serverId={serverId} findingId={finding.id} onFixed={onFixed} />;
    case "disable_trust_lan":
      return (
        <AuthSettingFix
          serverId={serverId}
          findingId={finding.id}
          patch={DISABLE_TRUST_LAN}
          label={t("settings.host.security.actions.disableTrustLan")}
          onFixed={onFixed}
        />
      );
    case "enable_claim_mode":
      return (
        <AuthSettingFix
          serverId={serverId}
          findingId={finding.id}
          patch={ENABLE_CLAIM_MODE}
          label={t("settings.host.security.actions.enableClaimMode")}
          onFixed={onFixed}
        />
      );
    case "bind_loopback":
      return (
        <Text
          style={settingsStyles.rowHint}
          testID={`host-security-fix-${finding.id}-instructions`}
        >
          {t("settings.host.security.bindInstructions")}
        </Text>
      );
    default:
      return (
        <View style={styles.actions}>
          <Button size="sm" variant="outline" onPress={openDevices}>
            {t("settings.host.security.actions.openDevices")}
          </Button>
        </View>
      );
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function AuthSettingFix({
  serverId,
  findingId,
  patch,
  label,
  onFixed,
}: {
  serverId: string;
  findingId: string;
  patch: { trustLan?: boolean; claimMode?: boolean };
  label: string;
  onFixed: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(async () => {
    if (!client) {
      setError(t("common.errors.daemonClientUnavailable"));
      return;
    }
    setIsPending(true);
    setError(null);
    try {
      const payload = await client.updateAuthSettings(patch);
      if (payload.error) throw new Error(payload.error);
      await onFixed();
    } catch (cause) {
      setError(
        t("settings.host.security.actionFailed", {
          message: describeError(cause),
        }),
      );
    } finally {
      setIsPending(false);
    }
  }, [client, onFixed, patch, t]);
  const handlePress = useCallback(() => void apply(), [apply]);

  return (
    <View>
      <View style={styles.actions}>
        <Button
          size="sm"
          onPress={handlePress}
          disabled={isPending}
          testID={`host-security-fix-${findingId}`}
        >
          {isPending ? t("settings.host.security.pending") : label}
        </Button>
      </View>
      {error ? <Text style={settingsStyles.rowError}>{error}</Text> : null}
    </View>
  );
}

function SetPasswordFix({
  serverId,
  findingId,
  onFixed,
}: {
  serverId: string;
  findingId: string;
  onFixed: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [isOpen, setIsOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showProblem, setShowProblem] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = validateDaemonPassword(password, confirm);

  const open = useCallback(() => setIsOpen(true), []);
  const cancel = useCallback(() => {
    setIsOpen(false);
    setPassword("");
    setConfirm("");
    setShowProblem(false);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    setShowProblem(true);
    if (problem) return;
    if (!client) {
      setError(t("common.errors.daemonClientUnavailable"));
      return;
    }
    setIsPending(true);
    setError(null);
    try {
      const payload = await client.setDaemonPassword(password);
      if (payload.error) throw new Error(payload.error);
      await onFixed();
    } catch (cause) {
      // Keep what was typed so a retry does not mean typing it twice more.
      setError(
        t("settings.host.security.password.failed", {
          message: describeError(cause),
        }),
      );
    } finally {
      setIsPending(false);
    }
  }, [client, onFixed, password, problem, t]);
  const handleSave = useCallback(() => void save(), [save]);

  if (!isOpen) {
    return (
      <View style={styles.actions}>
        <Button size="sm" onPress={open} testID={`host-security-fix-${findingId}`}>
          {t("settings.host.security.actions.setPassword")}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.passwordForm} testID="host-security-password-form">
      <Field
        label={t("settings.host.security.password.label")}
        hint={t("settings.host.security.password.hint")}
        error={
          showProblem && problem === "tooShort"
            ? t("settings.host.security.password.tooShort")
            : null
        }
      >
        <FormTextInput
          initialValue=""
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isPending}
          accessibilityLabel={t("settings.host.security.password.label")}
          testID="host-security-password-input"
        />
      </Field>
      <Field
        label={t("settings.host.security.password.confirmLabel")}
        error={
          showProblem && problem === "mismatch"
            ? t("settings.host.security.password.mismatch")
            : null
        }
      >
        <FormTextInput
          initialValue=""
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isPending}
          returnKeyType="done"
          onSubmitEditing={handleSave}
          accessibilityLabel={t("settings.host.security.password.confirmLabel")}
          testID="host-security-password-confirm"
        />
      </Field>
      {error ? (
        <Text style={settingsStyles.rowError} testID="host-security-password-error">
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button size="sm" variant="ghost" onPress={cancel} disabled={isPending}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          size="sm"
          onPress={handleSave}
          disabled={isPending}
          testID="host-security-password-save"
        >
          {isPending
            ? t("settings.host.security.password.saving")
            : t("settings.host.security.password.save")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  findingRow: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[1],
  },
  findingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  findingTitle: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  inlineAction: {
    marginLeft: "auto",
  },
  inlineActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  passwordForm: {
    gap: theme.spacing[3],
    marginTop: theme.spacing[3],
  },
}));
