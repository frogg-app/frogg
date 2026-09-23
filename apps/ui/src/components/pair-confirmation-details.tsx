import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { PairConfirmationDetails } from "@/pairing/pair-confirmation";

const styles = StyleSheet.create((theme) => ({
  rows: {
    gap: theme.spacing[3],
  },
  row: {
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  value: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  mono: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
}));

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={mono ? styles.mono : styles.value} selectable>
        {value}
      </Text>
    </View>
  );
}

function formatExpiry(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

/**
 * The facts the user is asked to approve: where the link points, which daemon
 * key answers there, when the link stops working, and which role this device
 * would get. Shown before anything is paired.
 */
export function PairConfirmationDetailsList({ details }: { details: PairConfirmationDetails }) {
  const { t } = useTranslation();
  const address = useMemo(() => {
    if (details.endpoint) return details.endpoint;
    return details.endpoints.length > 0 ? details.endpoints.join(", ") : null;
  }, [details.endpoint, details.endpoints]);

  return (
    <View style={styles.rows} testID="pair-confirm-details">
      {address ? <DetailRow label={t("pairConfirm.fields.address")} value={address} mono /> : null}
      {details.hostname ? (
        <DetailRow label={t("pairConfirm.fields.hostname")} value={details.hostname} />
      ) : null}
      {details.formattedFingerprint ? (
        <DetailRow
          label={t("pairConfirm.fields.fingerprint")}
          value={details.formattedFingerprint}
          mono
        />
      ) : null}
      {details.expiresAt ? (
        <DetailRow
          label={t("pairConfirm.fields.expires")}
          value={formatExpiry(details.expiresAt)}
        />
      ) : null}
      {details.role ? (
        <DetailRow
          label={t("pairConfirm.fields.role")}
          value={t(`pairConfirm.roles.${details.role}`)}
        />
      ) : null}
      {details.serverId ? (
        <DetailRow label={t("pairConfirm.fields.serverId")} value={details.serverId} mono />
      ) : null}
    </View>
  );
}
