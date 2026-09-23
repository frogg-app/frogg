import { useCallback, useMemo, useRef, useState } from "react";
import { Switch, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react-native";
import {
  DaemonIdentityError,
  formatFingerprint,
  verifyDaemonIdentity,
} from "@frogg/client/internal/device-identity";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useHostMutations } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import {
  entryEndpoint,
  formatPairingCodeInput,
  pairingLinkFromEntry,
  parsePairingCodeEntry,
  type PairingCodeEntryParse,
} from "./pairing-code-entry";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedShieldCheck = withUnistyles(ShieldCheck);
const mutedTint = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const successTint = (theme: Theme) => ({ color: theme.colors.statusSuccess });

type Stage =
  | { kind: "editing" }
  | { kind: "verifying" }
  | { kind: "verified"; serverId: string; fingerprint: string }
  | { kind: "refused"; code: DaemonIdentityError["code"]; message: string; fingerprint: string | null }
  | { kind: "pairing"; serverId: string; fingerprint: string }
  | { kind: "paired"; label: string };

/**
 * Joining a host with a code the owner read out. There is no link to check a
 * fingerprint against here, so the daemon is made to prove it holds its key
 * and the fingerprint is shown for the user to compare with the owner's
 * screen before anything is paired. Nothing is redeemed until they press Pair.
 */
export function PairingCodeEntryForm({ onPaired }: { onPaired?: (serverId: string) => void }) {
  const { t } = useTranslation();
  const { claimAndUpsertDirectPairingLink } = useHostMutations();
  const endpointRef = useRef("");
  const [code, setCode] = useState("");
  const [useTls, setUseTls] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "editing" });
  const [endpointVersion, setEndpointVersion] = useState(0);

  const draft = useMemo(
    () => ({ endpoint: endpointRef.current, code, useTls }),
    // endpointVersion re-reads the uncontrolled input without re-rendering on
    // every keystroke, which is what the shared input is built for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code, useTls, endpointVersion],
  );
  const parsed: PairingCodeEntryParse = useMemo(() => parsePairingCodeEntry(draft), [draft]);

  const handleEndpointChange = useCallback((value: string) => {
    endpointRef.current = value;
    setEndpointVersion((version) => version + 1);
    setStage({ kind: "editing" });
  }, []);

  const handleCodeChange = useCallback((value: string) => {
    setCode(formatPairingCodeInput(value));
    setStage({ kind: "editing" });
  }, []);

  const verify = useCallback(async () => {
    if (!parsed.ok) return;
    setStage({ kind: "verifying" });
    try {
      const verified = await verifyDaemonIdentity({
        endpoint: entryEndpoint(parsed),
        useTls: parsed.useTls,
      });
      setStage({ kind: "verified", serverId: verified.serverId, fingerprint: verified.fingerprint });
    } catch (error) {
      const identity = error instanceof DaemonIdentityError ? error : null;
      setStage({
        kind: "refused",
        code: identity?.code ?? "unreachable",
        message: error instanceof Error ? error.message : String(error),
        fingerprint: identity?.actualFingerprint ?? null,
      });
    }
  }, [parsed]);

  const pair = useCallback(async () => {
    if (!parsed.ok || stage.kind !== "verified") return;
    const { serverId, fingerprint } = stage;
    setStage({ kind: "pairing", serverId, fingerprint });
    try {
      const result = await claimAndUpsertDirectPairingLink(
        pairingLinkFromEntry(parsed, { serverId, fingerprint }),
      );
      setStage({ kind: "paired", label: result.profile.label });
      onPaired?.(result.serverId);
    } catch (error) {
      setStage({
        kind: "refused",
        code: "unreachable",
        message: error instanceof Error ? error.message : String(error),
        fingerprint,
      });
    }
  }, [claimAndUpsertDirectPairingLink, onPaired, parsed, stage]);

  const handleVerify = useCallback(() => void verify(), [verify]);
  const handlePair = useCallback(() => void pair(), [pair]);

  const problem = parsed.ok ? null : t(`deviceAccess.entry.problems.${parsed.problem}`);

  return (
    <View style={styles.form} testID="pairing-code-entry">
      <Text style={styles.label}>{t("deviceAccess.entry.hostLabel")}</Text>
      <TextInput
        style={styles.input}
        initialValue=""
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={t("deviceAccess.entry.hostPlaceholder")}
        onChangeText={handleEndpointChange}
        accessibilityLabel={t("deviceAccess.entry.hostLabel")}
        testID="pairing-entry-host"
      />

      <Text style={styles.label}>{t("deviceAccess.entry.codeLabel")}</Text>
      <TextInput
        style={[styles.input, styles.codeInput]}
        initialValue=""
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="XXXX-XXXX"
        onChangeText={handleCodeChange}
        accessibilityLabel={t("deviceAccess.entry.codeLabel")}
        testID="pairing-entry-code"
      />

      <View style={styles.switchRow}>
        <Switch value={useTls} onValueChange={setUseTls} testID="pairing-entry-tls" />
        <Text style={styles.meta}>{t("deviceAccess.entry.useTls")}</Text>
      </View>

      {problem && code.length > 0 ? (
        <Text style={styles.meta} testID="pairing-entry-problem">
          {problem}
        </Text>
      ) : null}

      {stage.kind === "verifying" ? (
        <View style={styles.statusRow} testID="pairing-entry-verifying">
          <ThemedLoadingSpinner size="small" uniProps={mutedTint} />
          <Text style={styles.meta}>{t("deviceAccess.entry.verifying")}</Text>
        </View>
      ) : null}

      {stage.kind === "refused" ? (
        <Alert
          variant="error"
          title={t(`deviceAccess.entry.refused.${stage.code}`)}
          description={stage.message}
          testID="pairing-entry-refused"
        >
          {stage.fingerprint ? (
            <Text style={styles.fingerprint}>{formatFingerprint(stage.fingerprint)}</Text>
          ) : null}
        </Alert>
      ) : null}

      {stage.kind === "verified" || stage.kind === "pairing" ? (
        <View style={styles.verified} testID="pairing-entry-verified">
          <View style={styles.statusRow}>
            <ThemedShieldCheck size={16} uniProps={successTint} />
            <Text style={styles.meta}>{t("deviceAccess.entry.verified")}</Text>
          </View>
          <Text style={styles.fingerprint} testID="pairing-entry-fingerprint">
            {formatFingerprint(stage.fingerprint)}
          </Text>
          <Text style={styles.meta}>{t("deviceAccess.entry.compareFingerprint")}</Text>
        </View>
      ) : null}

      {stage.kind === "paired" ? (
        <Alert
          variant="success"
          description={t("deviceAccess.entry.paired", { name: stage.label })}
          testID="pairing-entry-paired"
        />
      ) : null}

      <View style={styles.actions}>
        {stage.kind === "verified" || stage.kind === "pairing" ? (
          <Button
            variant="default"
            loading={stage.kind === "pairing"}
            onPress={handlePair}
            testID="pairing-entry-pair"
          >
            {t("deviceAccess.entry.pair")}
          </Button>
        ) : (
          <Button
            variant="default"
            disabled={!parsed.ok}
            loading={stage.kind === "verifying"}
            onPress={handleVerify}
            testID="pairing-entry-verify"
          >
            {t("deviceAccess.entry.verify")}
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  form: { gap: theme.spacing[2] },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  input: {
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    color: theme.colors.foreground,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  codeInput: { fontFamily: theme.fontFamily.mono, letterSpacing: 2 },
  switchRow: { alignItems: "center", flexDirection: "row", gap: theme.spacing[2] },
  statusRow: { alignItems: "center", flexDirection: "row", gap: theme.spacing[2] },
  verified: { gap: theme.spacing[1] },
  fingerprint: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", gap: theme.spacing[2] },
}));
