import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as QRCode from "qrcode";
import { SvgXml } from "react-native-svg";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Copy, KeyRound } from "lucide-react-native";
import { formatPairingCode, type DeviceRole } from "@frogg/protocol/device-access";
import { formatFingerprint } from "@frogg/client/internal/device-identity";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { useToast } from "@/contexts/toast-context";
import type { Theme } from "@/styles/theme";
import { RolePicker } from "./role-badge";
import { useDeviceAccess } from "./use-device-access";
import { pairingCodeSecondsRemaining, usePairingCode } from "./use-pairing-code";

/** Matches the daemon's own default. */
const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_CODE_ROLE: DeviceRole = "operator";

/**
 * Minting a code for a new device. Owner-only, because a code is a credential
 * in waiting: whoever types it in gets the role it was minted for.
 */
export function PairingCodeCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const access = useDeviceAccess(serverId);
  const { code, mint, isPending, error, clear } = usePairingCode(serverId);
  const [role, setRole] = useState<DeviceRole>(DEFAULT_CODE_ROLE);

  const handleMint = useCallback(() => {
    void mint({ role, ttlSeconds: DEFAULT_TTL_SECONDS }).catch(() => {
      // Surfaced below through `error`; the toast would be a second copy.
    });
  }, [mint, role]);

  const handleCopy = useCallback(() => {
    if (!code) return;
    void Clipboard.setStringAsync(formatPairingCode(code.code)).then(() => toast.copied());
  }, [code, toast]);

  const handleCopyLink = useCallback(() => {
    if (!code?.deepLink) return;
    void Clipboard.setStringAsync(code.deepLink).then(() => toast.copied());
  }, [code?.deepLink, toast]);

  if (!access.canCreatePairingCode) {
    return (
      <Alert
        variant="info"
        description={
          access.handshakeSeen && access.devices
            ? t("deviceAccess.refusal.roleCode", {
                role: t(`deviceAccess.roles.${access.callerRole}.label`),
              })
            : t("deviceAccess.refusal.unsupported")
        }
        testID="pairing-code-unavailable"
      />
    );
  }

  return (
    <View style={styles.card} testID="pairing-code-card">
      <Text style={styles.meta}>{t("deviceAccess.code.roleLabel")}</Text>
      <RolePicker value={role} onChange={setRole} disabled={isPending} />
      {role === "owner" ? (
        <Alert variant="warning" description={t("deviceAccess.code.ownerWarning")} />
      ) : null}

      {error ? <Alert variant="error" description={error.message} testID="pairing-code-error" /> : null}

      <Button
        variant="default"
        leftIcon={KeyRound}
        loading={isPending}
        onPress={handleMint}
        testID="pairing-code-generate"
      >
        {code ? t("deviceAccess.code.regenerate") : t("deviceAccess.code.generate")}
      </Button>

      {code ? (
        <MintedCode
          code={code.code}
          expiresAt={code.expiresAt}
          fingerprint={code.fingerprint}
          deepLink={code.deepLink}
          onCopy={handleCopy}
          onCopyLink={handleCopyLink}
          onClear={clear}
        />
      ) : null}
    </View>
  );
}

function MintedCode(props: {
  code: string;
  expiresAt: string;
  fingerprint: string;
  deepLink: string | null;
  onCopy: () => void;
  onCopyLink: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const remaining = useCountdown(props.expiresAt);
  const expired = remaining <= 0;

  const qr = useFetchQuery({
    queryKey: ["device-access-pairing-code-qr", props.deepLink],
    queryFn: () =>
      QRCode.toString(props.deepLink ?? "", {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 480,
      }),
    enabled: Boolean(props.deepLink) && !expired,
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
  });

  return (
    <View style={styles.minted} testID="pairing-code-result">
      <Text style={styles.code} testID="pairing-code-value">
        {formatPairingCode(props.code)}
      </Text>
      <Text style={expired ? styles.expired : styles.meta} testID="pairing-code-expiry">
        {expired
          ? t("deviceAccess.code.expired")
          : t("deviceAccess.code.expiresIn", { time: formatRemaining(remaining) })}
      </Text>

      {props.deepLink && !expired ? (
        <View style={styles.qrTile}>
          {qr.data ? (
            <SvgXml
              xml={qr.data}
              style={styles.qrImage}
              accessibilityRole="image"
              accessibilityLabel={t("deviceAccess.code.qrAccessibility")}
            />
          ) : (
            <Text style={styles.meta}>
              {qr.isError ? t("deviceAccess.code.qrUnavailable") : t("deviceAccess.code.qrLoading")}
            </Text>
          )}
        </View>
      ) : null}

      <Text style={styles.fingerprint} testID="pairing-code-fingerprint">
        {t("deviceAccess.code.fingerprint", { fingerprint: formatFingerprint(props.fingerprint) })}
      </Text>
      <Text style={styles.meta}>{t("deviceAccess.code.fingerprintHint")}</Text>

      <View style={styles.actions}>
        <Button variant="outline" size="sm" leftIcon={Copy} onPress={props.onCopy}>
          {t("deviceAccess.code.copyCode")}
        </Button>
        {props.deepLink ? (
          <Button variant="outline" size="sm" leftIcon={Copy} onPress={props.onCopyLink}>
            {t("deviceAccess.code.copyLink")}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onPress={props.onClear}>
          {t("deviceAccess.code.hide")}
        </Button>
      </View>

      <Alert variant="warning" description={t("deviceAccess.code.securityWarning")} />
    </View>
  );
}

/** Seconds left, ticking once a second while a code is on screen. */
function useCountdown(expiresAt: string): number {
  const [remaining, setRemaining] = useState(() => pairingCodeSecondsRemaining(expiresAt));
  useEffect(() => {
    setRemaining(pairingCodeSecondsRemaining(expiresAt));
    const timer = setInterval(() => {
      const next = pairingCodeSecondsRemaining(expiresAt);
      setRemaining(next);
      if (next <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return remaining;
}

export function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create((theme: Theme) => ({
  card: { gap: theme.spacing[3] },
  minted: { gap: theme.spacing[2] },
  code: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize["3xl"],
    letterSpacing: 2,
  },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  expired: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  fingerprint: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  qrTile: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#ffffff",
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[2],
  },
  qrImage: { height: 180, width: 180 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));

