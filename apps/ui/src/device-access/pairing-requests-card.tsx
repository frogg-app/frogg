import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { RotateCw, ShieldQuestion } from "lucide-react-native";
import type { DeviceRole, PendingPairingRequest } from "@frogg/protocol/device-access";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import type { Theme } from "@/styles/theme";
import { RolePicker } from "./role-badge";
import { sanitizeUntrustedText } from "./untrusted-text";
import { useDeviceAccess } from "./use-device-access";
import { usePairingRequestMutations, usePairingRequests } from "./use-pairing-requests";

const ThemedShieldQuestion = withUnistyles(ShieldQuestion);
const warningIcon = (theme: Theme) => ({ color: theme.colors.statusWarning });

/** The role an approval grants unless the owner picks another. */
const DEFAULT_APPROVAL_ROLE: DeviceRole = "operator";

/**
 * Devices asking an owner to let them in. Everything a requesting device
 * supplies — its name and its match code — is attacker-authored: it is shown
 * as plain, sanitized, truncated text next to the buttons, never as anything
 * that could dress itself up as part of the app's own chrome.
 */
export function PairingRequestsCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const access = useDeviceAccess(serverId);
  const { requests, isLoading, error, isEmpty, refetch } = usePairingRequests(serverId);
  const mutations = usePairingRequestMutations(serverId);

  const handleRetry = useCallback(() => refetch(), [refetch]);

  if (!access.canDecidePairingRequests) return null;

  if (error) {
    return (
      <Alert variant="error" description={error.message} testID="pairing-requests-error">
        <Button variant="outline" size="sm" leftIcon={RotateCw} onPress={handleRetry}>
          {t("deviceAccess.actions.retry")}
        </Button>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Text style={styles.meta} testID="pairing-requests-loading">
        {t("deviceAccess.requests.loading")}
      </Text>
    );
  }

  if (isEmpty) {
    return (
      <Text style={styles.meta} testID="pairing-requests-empty">
        {t("deviceAccess.requests.empty")}
      </Text>
    );
  }

  return (
    <View style={styles.list} testID="pairing-requests">
      {requests.map((request) => (
        <PairingRequestRow
          key={request.id}
          request={request}
          canPickRole={access.canChangeRole}
          isPending={mutations.pendingRequestId === request.id}
          onDecide={mutations.decide}
        />
      ))}
    </View>
  );
}

function PairingRequestRow({
  request,
  canPickRole,
  isPending,
  onDecide,
}: {
  request: PendingPairingRequest;
  canPickRole: boolean;
  isPending: boolean;
  onDecide: (input: {
    pairingRequestId: string;
    decision: "approve" | "deny";
    role?: DeviceRole;
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [role, setRole] = useState<DeviceRole>(DEFAULT_APPROVAL_ROLE);
  const [failure, setFailure] = useState<string | null>(null);

  const deviceName = useMemo(
    () => sanitizeUntrustedText(request.deviceName, { fallback: t("deviceAccess.unnamedDevice") }),
    [request.deviceName, t],
  );
  // The match code is short and fixed-shape, but it is still the requester's
  // to write, so it goes through the same cleaning.
  const matchCode = useMemo(
    () => sanitizeUntrustedText(request.matchCode, { max: 16 }),
    [request.matchCode],
  );
  const remoteAddress = useMemo(
    () => sanitizeUntrustedText(request.remoteAddress, { max: 45 }),
    [request.remoteAddress],
  );

  const decide = useCallback(
    async (decision: "approve" | "deny") => {
      setFailure(null);
      try {
        await onDecide({
          pairingRequestId: request.id,
          decision,
          ...(decision === "approve" && canPickRole ? { role } : {}),
        });
        toast.show(
          decision === "approve"
            ? t("deviceAccess.requests.approved", { name: deviceName })
            : t("deviceAccess.requests.denied", { name: deviceName }),
          { variant: decision === "approve" ? "success" : "default" },
        );
      } catch (caught) {
        setFailure(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [canPickRole, deviceName, onDecide, request.id, role, t, toast],
  );

  const handleApprove = useCallback(() => void decide("approve"), [decide]);
  const handleDeny = useCallback(() => void decide("deny"), [decide]);

  return (
    <View style={styles.row} testID={`pairing-request-${request.id}`}>
      <View style={styles.headerRow}>
        <ThemedShieldQuestion size={16} uniProps={warningIcon} />
        <Text style={styles.name} numberOfLines={1} testID="pairing-request-name">
          {deviceName}
        </Text>
      </View>
      <Text style={styles.untrustedNote}>{t("deviceAccess.requests.untrustedName")}</Text>
      <Text style={styles.meta} testID="pairing-request-match-code">
        {t("deviceAccess.requests.matchCode", { code: matchCode })}
      </Text>
      {remoteAddress ? (
        <Text style={styles.meta}>
          {t("deviceAccess.requests.from", { address: remoteAddress })}
        </Text>
      ) : null}

      {canPickRole ? (
        <>
          <Text style={styles.meta}>{t("deviceAccess.requests.roleLabel")}</Text>
          <RolePicker value={role} onChange={setRole} disabled={isPending} />
        </>
      ) : null}

      {failure ? (
        <Text style={styles.error} testID="pairing-request-error">
          {failure}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          variant="default"
          size="sm"
          loading={isPending}
          onPress={handleApprove}
          testID="pairing-request-approve"
        >
          {t("deviceAccess.requests.approve")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onPress={handleDeny}
          testID="pairing-request-deny"
        >
          {t("deviceAccess.requests.deny")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  list: { gap: theme.spacing[2] },
  row: {
    borderColor: theme.colors.statusWarning,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
  headerRow: { alignItems: "center", flexDirection: "row", gap: theme.spacing[2] },
  name: { color: theme.colors.foreground, flexShrink: 1, fontSize: theme.fontSize.base },
  untrustedNote: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", gap: theme.spacing[2] },
}));
