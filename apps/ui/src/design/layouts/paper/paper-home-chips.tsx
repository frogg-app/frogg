import { useRouter, type Href } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useOpenProject } from "@/hooks/use-open-project";
import { useHostChooser } from "@/hosts/host-chooser";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { buildHostAgentDetailRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { PaperIcon, paperMuted, type PaperIconName } from "./paper-icons";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

interface Chip {
  key: string;
  icon: PaperIconName;
  label: string;
  onPress: () => void;
  testID: string;
}

function chipStyle({ hovered, pressed }: HoverState) {
  return [styles.chip, (Boolean(hovered) || pressed) && styles.chipHovered];
}

/**
 * Claude's suggestion chips under the composer, carrying the home screen's real starting points:
 * add a project, import a CLI conversation, set up providers, pair a phone.
 */
export function PaperHomeChips() {
  const { t } = useTranslation();
  const router = useRouter();
  const openProjectPicker = useOpenAddProject();
  const chooseHost = useHostChooser();
  const localServerId = useLocalDaemonServerId();
  const [importServerId, setImportServerId] = useState<string | null>(null);
  const importClient = useHostRuntimeClient(importServerId ?? "");
  const openImportedProject = useOpenProject(importServerId);
  const [isPairOpen, setIsPairOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const handleAddProject = useCallback(() => void openProjectPicker(), [openProjectPicker]);
  const handleImport = useCallback(() => {
    chooseHost({
      title: t("openProject.chooseHost.importSession"),
      onChooseHost: (serverId) => {
        setImportServerId(serverId);
        setIsImportOpen(true);
      },
    });
  }, [chooseHost, t]);
  const handleProviders = useCallback(() => {
    chooseHost({
      title: t("openProject.chooseHost.setupProviders"),
      onChooseHost: (serverId) => router.push(buildSettingsHostSectionRoute(serverId, "providers")),
    });
  }, [chooseHost, router, t]);
  const handleImported = useCallback(
    (agent: { id: string; cwd: string }) => {
      if (!importServerId) return;
      void (async () => {
        const result = await openImportedProject(agent.cwd);
        if (result.ok) router.push(buildHostAgentDetailRoute(importServerId, agent.id) as Href);
      })();
    },
    [importServerId, openImportedProject, router],
  );
  const openPair = useCallback(() => setIsPairOpen(true), []);
  const closePair = useCallback(() => setIsPairOpen(false), []);
  const closeImport = useCallback(() => setIsImportOpen(false), []);

  const chips = useMemo<Chip[]>(() => {
    const list: Chip[] = [
      {
        key: "add-project",
        icon: "folderPlus",
        label: t("openProject.tiles.addProject.title"),
        onPress: handleAddProject,
        testID: "open-project-submit",
      },
      {
        key: "import",
        icon: "inbox",
        label: t("openProject.tiles.importSession.title"),
        onPress: handleImport,
        testID: "open-project-import-session",
      },
      {
        key: "providers",
        icon: "plug",
        label: t("openProject.tiles.setupProviders.title"),
        onPress: handleProviders,
        testID: "open-project-setup-providers",
      },
    ];
    if (localServerId) {
      list.push({
        key: "pair",
        icon: "phone",
        label: t("openProject.tiles.pairDevice.title"),
        onPress: openPair,
        testID: "open-project-pair-device",
      });
    }
    return list;
  }, [handleAddProject, handleImport, handleProviders, localServerId, openPair, t]);

  return (
    <>
      <View style={styles.row}>
        {chips.map((chip) => {
          const Icon = PaperIcon[chip.icon];
          return (
            <Pressable
              key={chip.key}
              onPress={chip.onPress}
              accessibilityRole="button"
              testID={chip.testID}
              style={chipStyle}
            >
              <Icon size={14} strokeWidth={1.7} uniProps={paperMuted} />
              <Text style={styles.chipLabel}>{chip.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <PairDeviceModal
        serverId={localServerId ?? ""}
        visible={isPairOpen}
        onClose={closePair}
        testID="open-project-pair-device-modal"
      />
      <ImportSessionSheet
        visible={isImportOpen}
        client={importClient}
        serverId={importServerId}
        onClose={closeImport}
        onImported={handleImported}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  chipHovered: {
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.surface4,
  },
  chipLabel: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
  },
}));
