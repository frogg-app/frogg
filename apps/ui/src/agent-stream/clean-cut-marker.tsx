/**
 * COMPAT(agentCleanCut): added in v1.6.2, remove after 2027-09-27.
 *
 * The divider a clean cut leaves in the timeline. Everything above it belongs
 * to a provider conversation that has ended: the user can still read it, the
 * agent cannot. Below the line sits the summary the new conversation started
 * from, collapsed by default, and the old conversation's id for when it needs
 * to be looked up.
 */
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ChevronDown, ChevronRight, Copy, Scissors } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { useToast } from "@/contexts/toast-context";
import type { CleanCutMarker as CleanCutMarkerData } from "@/types/stream";
import type { Theme } from "@/styles/theme";

const ThemedScissors = withUnistyles(Scissors);
const ThemedCopy = withUnistyles(Copy);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const accentColor = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const CleanCutMarker = memo(function CleanCutMarker({
  cleanCut,
}: {
  cleanCut: CleanCutMarkerData;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const previousSessionId = cleanCut.previousSessionId ?? null;
  const handleCopy = useCallback(() => {
    if (!previousSessionId) return;
    void Clipboard.setStringAsync(previousSessionId);
    toast.copied(t("agentStream.cleanCut.idCopied"));
  }, [previousSessionId, t, toast]);

  const switched =
    cleanCut.provider &&
    cleanCut.previousProvider &&
    cleanCut.provider !== cleanCut.previousProvider
      ? t("agentStream.cleanCut.switched", {
          from: cleanCut.previousProvider,
          to: cleanCut.provider,
        })
      : null;

  return (
    <View style={styles.container} testID="clean-cut-marker">
      <View style={styles.divider}>
        <View style={styles.line} />
        <View style={styles.label}>
          <ThemedScissors size={13} uniProps={accentColor} />
          <Text style={styles.title}>{t("agentStream.cleanCut.title")}</Text>
        </View>
        <View style={styles.line} />
      </View>

      <View style={styles.meta}>
        {switched ? <Text style={styles.metaText}>{switched}</Text> : null}
        {previousSessionId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("agentStream.cleanCut.copyId")}
            onPress={handleCopy}
            style={styles.metaButton}
            hitSlop={6}
            testID="clean-cut-copy-id"
          >
            <ThemedCopy size={12} uniProps={mutedColor} />
            <Text style={styles.metaText}>{t("agentStream.cleanCut.copyId")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          accessibilityLabel={t("agentStream.cleanCut.summary")}
          onPress={toggle}
          style={styles.metaButton}
          hitSlop={6}
          testID="clean-cut-toggle-summary"
        >
          {expanded ? (
            <ThemedChevronDown size={12} uniProps={mutedColor} />
          ) : (
            <ThemedChevronRight size={12} uniProps={mutedColor} />
          )}
          <Text style={styles.metaText}>
            {cleanCut.summaryModel
              ? t("agentStream.cleanCut.summaryBy", { model: cleanCut.summaryModel })
              : t("agentStream.cleanCut.summary")}
          </Text>
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.summary} testID="clean-cut-summary">
          <MarkdownRenderer text={cleanCut.summary} compact />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  line: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.palette.amber[500],
    opacity: 0.6,
  },
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.palette.amber[500],
  },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: theme.spacing[4],
    rowGap: theme.spacing[1],
  },
  metaButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  metaText: {
    fontFamily: theme.fontFamily.ui,
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  summary: {
    marginTop: theme.spacing[1],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
}));
