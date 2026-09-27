import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import { themeOf } from "@/styles/design-theme";
import {
  entryCard,
  entryColumn,
  entrySectionTitle,
  entrySolidButton,
  entrySolidButtonText,
} from "@/home/entry-design";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { BarcodeScanningResult, BarcodeSettings } from "expo-camera";
import { hasPairingCode } from "@frogg/protocol/connection-offer";
import { usePairWithOffer } from "@/pairing/use-pair-with-offer";
import { buildHostRootRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { isWeb } from "@/constants/platform";
import { BackHeader } from "@/components/headers/back-header";
import { ClaimOfferPanel } from "@/components/claim-offer-panel";

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing[6],
  },
  bodyDesign: {
    ...entryColumn(themeOf(rt.themeName)),
  },
  cameraWrap: {
    flex: 1,
    overflow: "hidden",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    width: 260,
    height: 260,
  },
  corner: {
    position: "absolute",
    width: 36,
    height: 36,
    borderColor: theme.colors.accent,
  },
  cornerTL: {
    left: 0,
    top: 0,
    borderLeftWidth: 4,
    borderTopWidth: 4,
    borderTopLeftRadius: 12,
  },
  cornerTR: {
    right: 0,
    top: 0,
    borderRightWidth: 4,
    borderTopWidth: 4,
    borderTopRightRadius: 12,
  },
  cornerBL: {
    left: 0,
    bottom: 0,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
    borderBottomLeftRadius: 12,
  },
  cornerBR: {
    right: 0,
    bottom: 0,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderBottomRightRadius: 12,
  },
  helperText: {
    marginTop: theme.spacing[6],
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    fontSize: theme.fontSize.base,
  },
  permissionCard: {
    marginTop: theme.spacing[6],
    padding: theme.spacing[6],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    gap: theme.spacing[4],
  },
  permissionCardDesign: {
    ...entryCard(themeOf(rt.themeName)),
  },
  permissionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  permissionTitleDesign: {
    ...entrySectionTitle(themeOf(rt.themeName)),
  },
  permissionBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  permissionButton: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.palette.blue[500],
  },
  permissionButtonDesign: {
    ...entrySolidButton(themeOf(rt.themeName)),
  },
  permissionButtonText: {
    color: theme.colors.palette.white,
    fontWeight: theme.fontWeight.semibold,
  },
  permissionButtonTextDesign: {
    ...entrySolidButtonText(themeOf(rt.themeName)),
  },
}));

function extractOfferUrlFromScan(result: BarcodeScanningResult): string | null {
  const raw = typeof result.data === "string" ? result.data.trim() : "";
  return raw && hasPairingCode(raw) ? raw : null;
}

export default function PairScanScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    source?: string;
  }>();
  const source = typeof params.source === "string" ? params.source : "settings";
  const { state, pair, retryWithEndpoint, reset } = usePairWithOffer();
  const isPairing = state.status === "pairing";

  const [permission, requestPermission] = useCameraPermissions();
  const lastScannedRef = useRef<string | null>(null);

  const navigateToPairedHost = useCallback(
    (serverId: string) => {
      if (source !== "settings") {
        router.replace(buildHostRootRoute(serverId));
        return;
      }
      router.replace(buildSettingsHostSectionRoute(serverId, "host"));
    },
    [router, source],
  );

  const closeToSource = useCallback(() => {
    try {
      router.back();
    } catch {
      router.replace("/" as Href);
    }
  }, [router]);

  useEffect(() => {
    if (isWeb) return;
    if (permission && permission.granted) return;
    void requestPermission().catch(() => undefined);
  }, [permission, requestPermission]);

  const handleScan = useCallback(
    async (result: BarcodeScanningResult) => {
      if (state.status !== "idle") return;
      const offerUrl = extractOfferUrlFromScan(result);
      if (!offerUrl) return;

      if (lastScannedRef.current === offerUrl) return;
      lastScannedRef.current = offerUrl;

      const success = await pair(offerUrl);
      // Relay offers land in the app directly; a claim shows the owner confirmation first.
      if (success && success.offer.v === 2) navigateToPairedHost(success.serverId);
    },
    [navigateToPairedHost, pair, state.status],
  );

  const handleDone = useCallback(() => {
    if (state.status === "success") navigateToPairedHost(state.serverId);
  }, [navigateToPairedHost, state]);

  const handleRetry = useCallback(
    (endpoint: string) => {
      void retryWithEndpoint(endpoint);
    },
    [retryWithEndpoint],
  );

  const handleScanAgain = useCallback(() => {
    lastScannedRef.current = null;
    reset();
  }, [reset]);

  const handleRouterBack = useCallback(() => router.back(), [router]);
  const handleRequestPermission = useCallback(() => {
    void requestPermission();
  }, [requestPermission]);

  const bodyStyle = useMemo(
    () => [styles.body, styles.bodyDesign, { paddingBottom: insets.bottom + theme.spacing[6] }],
    [insets.bottom, theme.spacing],
  );
  const helperTextStyle = useMemo(
    () => [styles.helperText, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );

  if (isWeb) {
    return (
      <View style={styles.container}>
        <BackHeader title={t("pairing.scan.title")} onBack={handleRouterBack} />
        <View style={bodyStyle}>
          <View style={permissionCardStyle()}>
            <Text style={permissionTitleStyle()} dataSet={DESIGN_FONT_DATASET}>
              {t("pairing.scan.webUnavailableTitle")}
            </Text>
            <Text style={styles.permissionBody}>{t("pairing.scan.webUnavailableBody")}</Text>
            <Pressable style={permissionButtonStyle()} onPress={closeToSource}>
              <Text style={permissionButtonTextStyle()}>{t("pairing.scan.backToSettings")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const granted = Boolean(permission?.granted);

  let body;
  if (!granted) {
    body = (
      <View style={permissionCardStyle()}>
        <Text style={permissionTitleStyle()} dataSet={DESIGN_FONT_DATASET}>
          {t("pairing.scan.cameraPermissionTitle")}
        </Text>
        <Text style={styles.permissionBody}>{t("pairing.scan.cameraPermissionBody")}</Text>
        <Pressable style={permissionButtonStyle()} onPress={handleRequestPermission}>
          <Text style={permissionButtonTextStyle()}>{t("pairing.scan.grantPermission")}</Text>
        </Pressable>
      </View>
    );
  } else if (state.status !== "idle") {
    body = (
      <View style={permissionCardStyle()}>
        <ClaimOfferPanel
          state={state}
          onRetryWithEndpoint={handleRetry}
          onDone={handleDone}
          onDismiss={state.status === "error" ? handleScanAgain : undefined}
          testID="pair-scan-claim-panel"
        />
      </View>
    );
  } else {
    body = (
      <View style={styles.cameraWrap}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={BARCODE_SCANNER_SETTINGS}
          onBarcodeScanned={handleScan}
        />
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          {isPairing ? <Text style={helperTextStyle}>{t("pairing.scan.pairing")}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BackHeader title={t("pairing.scan.title")} onBack={closeToSource} />

      <View style={bodyStyle}>{body}</View>
    </View>
  );
}

const BARCODE_SCANNER_SETTINGS: BarcodeSettings = { barcodeTypes: ["qr"] };

// Composed at render: reading style proxies at module scope is not allowed.
const permissionCardStyle = () => [styles.permissionCard, styles.permissionCardDesign];
// Composed at render: reading style proxies at module scope is not allowed.
const permissionTitleStyle = () => [styles.permissionTitle, styles.permissionTitleDesign];
// Composed at render: reading style proxies at module scope is not allowed.
const permissionButtonStyle = () => [styles.permissionButton, styles.permissionButtonDesign];
// Composed at render: reading style proxies at module scope is not allowed.
const permissionButtonTextStyle = () => [
  styles.permissionButtonText,
  styles.permissionButtonTextDesign,
];
