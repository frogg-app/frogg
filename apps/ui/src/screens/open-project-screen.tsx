import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { BrandLogo } from "@/components/icons/brand-logo";
import { MenuHeader } from "@/components/headers/menu-header";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useHostChooser } from "@/hosts/host-chooser";
import { usePanelStore } from "@/stores/panel-store";
import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { buildHostAgentDetailRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useOpenProject } from "@/hooks/use-open-project";
import type { Href } from "expo-router";
import { HomeActions, type HomeAction } from "@/home/home-actions";
import { resolveHomePresentation } from "@/home/home-layout";
import { useDesignPreviewStore } from "@/design/design-preview-store";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import { themeOf } from "@/styles/design-theme";
import { designHeading } from "@/styles/settings-treatment";
import type { TextFragment } from "@/styles/style-fragment";
import type { Theme } from "@/styles/theme";
import { entryPageTitle } from "@/home/entry-design";

export function OpenProjectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const openProjectPicker = useOpenAddProject();
  const chooseHost = useHostChooser();
  const localServerId = useLocalDaemonServerId();
  const [importServerId, setImportServerId] = useState<string | null>(null);
  const importClient = useHostRuntimeClient(importServerId ?? "");
  const openImportedProject = useOpenProject(importServerId);
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);

  const isCompactLayout = useIsCompactFormFactor();
  const presentation = resolveHomePresentation(useDesignPreviewStore((s) => s.variant));

  useEffect(() => {
    if (!isCompactLayout) {
      openDesktopAgentList();
    }
  }, [isCompactLayout, openDesktopAgentList]);

  const handleOpenPicker = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  const handleOpenImportSession = useCallback(() => {
    chooseHost({
      title: t("openProject.chooseHost.importSession"),
      onChooseHost: (serverId) => {
        setImportServerId(serverId);
        setIsImportSheetOpen(true);
      },
    });
  }, [chooseHost, t]);
  const handleCloseImportSession = useCallback(() => setIsImportSheetOpen(false), []);

  const handleImported = useCallback(
    (agent: { id: string; cwd: string }) => {
      if (!importServerId) return;
      void (async () => {
        const result = await openImportedProject(agent.cwd);
        if (result.ok) {
          router.push(buildHostAgentDetailRoute(importServerId, agent.id) as Href);
        }
      })();
    },
    [importServerId, openImportedProject, router],
  );

  const handleOpenProviders = useCallback(() => {
    chooseHost({
      title: t("openProject.chooseHost.setupProviders"),
      onChooseHost: (serverId) => {
        router.push(buildSettingsHostSectionRoute(serverId, "providers"));
      },
    });
  }, [chooseHost, router, t]);

  const actions = useMemo<HomeAction[]>(() => {
    const list: HomeAction[] = [
      {
        key: "add-project",
        icon: "folder",
        title: t("openProject.tiles.addProject.title"),
        description: t("openProject.tiles.addProject.description"),
        onPress: handleOpenPicker,
        testID: "open-project-submit",
        accent: true,
      },
      {
        key: "import-session",
        icon: "inbox",
        title: t("openProject.tiles.importSession.title"),
        description: t("openProject.tiles.importSession.description"),
        onPress: handleOpenImportSession,
        testID: "open-project-import-session",
      },
      {
        key: "setup-providers",
        icon: "plug",
        title: t("openProject.tiles.setupProviders.title"),
        description: t("openProject.tiles.setupProviders.description"),
        onPress: handleOpenProviders,
        testID: "open-project-setup-providers",
      },
    ];
    if (localServerId) {
      list.push({
        key: "pair-device",
        icon: "phone",
        title: t("openProject.tiles.pairDevice.title"),
        description: t("openProject.tiles.pairDevice.description"),
        onPress: handleOpenPairDevice,
        testID: "open-project-pair-device",
      });
    }
    return list;
  }, [
    handleOpenImportSession,
    handleOpenPairDevice,
    handleOpenPicker,
    handleOpenProviders,
    localServerId,
    t,
  ]);

  return (
    <View style={styles.container}>
      <MenuHeader borderless />
      <View style={styles.content}>
        <TitlebarDragRegion />
        <View style={presentation.alignStart ? styles.headerStart : styles.header}>
          <BrandLogo size={presentation.logoSize} />
          {presentation.greeting ? (
            <Text
              style={presentation.alignStart ? styles.greetingStart : greetingStyle}
              dataSet={DESIGN_FONT_DATASET}
              accessibilityRole="header"
            >
              {t("openProject.greeting")}
            </Text>
          ) : null}
        </View>
        <HomeActions actions={actions} layout={presentation.layout} />
      </View>
      <PairDeviceModal
        serverId={localServerId ?? ""}
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="open-project-pair-device-modal"
      />
      <ImportSessionSheet
        visible={isImportSheetOpen}
        client={importClient}
        serverId={importServerId}
        onClose={handleCloseImportSession}
        onImported={handleImported}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  content: {
    position: "relative",
    flex: 1,
    justifyContent: { xs: "flex-start", md: "center" },
    alignItems: "center",
    gap: 0,
    padding: theme.spacing[6],
    paddingTop: { xs: theme.spacing[12], md: theme.spacing[6] },
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[6],
      md: HEADER_INNER_HEIGHT + theme.spacing[6],
    },
  },
  header: {
    width: "100%",
    maxWidth: 680,
    alignItems: "center",
    gap: theme.spacing[6],
    marginBottom: variantOf(rt.themeName) === "current" ? theme.spacing[8] : 0,
  },
  headerStart: {
    width: "100%",
    maxWidth: variantOf(rt.themeName) === "mono" ? 600 : 480,
    alignItems: "flex-start",
    gap: variantOf(rt.themeName) === "mono" ? theme.spacing[6] : theme.spacing[3],
  },
  greeting: {
    color: theme.colors.foreground,
    fontSize: { xs: 26, md: 32 },
    lineHeight: { xs: 32, md: 42 },
    textAlign: "center",
  },
  greetingDesign: {
    ...greetingFragment(themeOf(rt.themeName)),
  },
  greetingSize: {
    fontSize: { xs: 26, md: wideGreeting(rt.themeName) ? 36 : 32 },
    lineHeight: { xs: 32, md: wideGreeting(rt.themeName) ? 44 : 42 },
  },
  greetingStart: {
    color: theme.colors.foreground,
    ...entryPageTitle(themeOf(rt.themeName)),
  },
}));

function variantOf(themeName: string | undefined) {
  return themeOf(themeName).design.variant;
}

// The centred greeting in the direction's display face (Soft runs it bold).
function greetingFragment(theme: Theme): TextFragment {
  const heading = designHeading(theme);
  if (theme.design.variant === "soft") return { ...heading, fontWeight: "700" };
  return heading;
}

// Paper's serif and Focus's display type run a size up on wide screens.
function wideGreeting(themeName: string | undefined): boolean {
  const variant = variantOf(themeName);
  return variant === "focus" || variant === "paper";
}

const greetingStyle = [styles.greeting, styles.greetingDesign, styles.greetingSize];
