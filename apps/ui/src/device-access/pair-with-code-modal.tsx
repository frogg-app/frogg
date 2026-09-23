import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";
import { PairingCodeEntryForm } from "./pairing-code-entry-form";

export interface PairWithCodeModalProps {
  visible: boolean;
  onClose: () => void;
  onCancel: () => void;
  onSaved: () => void;
}

/** "I have a pairing code": the other half of an owner minting one. */
export function PairWithCodeModal({ visible, onClose, onCancel, onSaved }: PairWithCodeModalProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(
    () => ({ title: t("deviceAccess.entry.title"), subtitle: t("deviceAccess.entry.subtitle") }),
    [t],
  );
  const handlePaired = useCallback(() => onSaved(), [onSaved]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="pair-with-code-modal"
    >
      <View style={styles.body}>
        <PairingCodeEntryForm onPaired={handlePaired} />
        <Button variant="ghost" onPress={onCancel}>
          {t("deviceAccess.actions.back")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  body: { gap: theme.spacing[3] },
}));
