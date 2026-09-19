import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { isNative } from "@/constants/platform";
import {
  getActiveConfirmDialogRequest,
  settleConfirmDialogRequest,
  subscribeConfirmDialogRequests,
} from "@/utils/confirm-dialog";

/**
 * Renders whatever `confirmDialog()` is currently asking, in Frogg's own modal.
 *
 * Mounted once at the app root. Requests raised before this mounts are queued by the store and
 * shown as soon as it subscribes, and further requests are answered one after another.
 */
export function ConfirmDialogHost() {
  const { t } = useTranslation();
  const request = useSyncExternalStore(
    subscribeConfirmDialogRequests,
    getActiveConfirmDialogRequest,
    getActiveConfirmDialogRequest,
  );

  const requestId = request?.id ?? null;
  const settle = useCallback(
    (confirmed: boolean) => {
      if (requestId === null) return;
      settleConfirmDialogRequest(requestId, confirmed);
    },
    [requestId],
  );
  const handleCancel = useCallback(() => settle(false), [settle]);
  const handleConfirm = useCallback(() => settle(true), [settle]);

  // Escape already cancels through the sheet's own overlay handling; Enter is ours to add so the
  // keyboard answer matches what a platform dialog used to do.
  useEffect(() => {
    if (isNative || requestId === null) return;
    const target = (globalThis as { window?: Window }).window;
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      settleConfirmDialogRequest(requestId, true);
    };
    target.addEventListener("keydown", onKeyDown, true);
    return () => target.removeEventListener("keydown", onKeyDown, true);
  }, [requestId]);

  const header = useMemo<SheetHeader>(
    () => ({ title: request?.input.title ?? "" }),
    [request?.input.title],
  );

  if (!request) return null;

  const { message, confirmLabel, cancelLabel, destructive } = request.input;

  return (
    <AdaptiveModalSheet
      key={request.id}
      visible
      header={header}
      onClose={handleCancel}
      testID="confirm-dialog"
    >
      <View style={styles.body}>
        <Text style={styles.message} testID="confirm-dialog-message">
          {message}
        </Text>
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            style={styles.actionButton}
            onPress={handleCancel}
            testID="confirm-dialog-cancel"
          >
            {cancelLabel ?? t("common.actions.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            style={styles.actionButton}
            onPress={handleConfirm}
            testID="confirm-dialog-confirm"
          >
            {confirmLabel ?? t("common.actions.confirm")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.5,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
