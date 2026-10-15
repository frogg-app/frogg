import { Eye, EyeOff, Folder, Pin, PinOff, X } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useHosts } from "../../daemon/hosts";
import { useDaemon } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { Button } from "../Button";
import { T } from "../Text";
import { Dialog } from "../tools/Dialog";
import { baseName, closeSheet, tildePath, useDirectory } from "./directory";
import {
  addLocalProject,
  hideProject,
  mergeProjects,
  pinProject,
  prefsOf,
  removeLocalProject,
  useLocalProjects,
  type MergedProject,
} from "./localProjects";
import { FolderBrowser } from "./sheets";

/**
 * This device's project list for the active host: pin, hide (here only) or list folders the
 * daemon does not have. Nothing here changes the host's own projects.
 */
export function ProjectsDialog() {
  const host = useDaemon((st) => st.serverName) ?? "this host";
  const hostId = useHosts((st) => st.activeId);
  const daemon = useDirectory((d) => d.projects);
  const byHost = useLocalProjects((st) => st.byHost);
  const merged = useMemo(
    () => mergeProjects(daemon, prefsOf(byHost, hostId)),
    [daemon, byHost, hostId],
  );
  const [browsing, setBrowsing] = useState(false);
  const browse = useCallback(() => setBrowsing(true), []);
  const stopBrowsing = useCallback(() => setBrowsing(false), []);
  const footer = useMemo(
    () => (
      <View style={s.footRow}>
        <T style={s.footNote}>Kept on this device. {host}’s own project list is unchanged.</T>
        {!browsing && <Button label="Add folder…" onPress={browse} />}
        <Button kind="primary" label="Done" onPress={closeSheet} />
      </View>
    ),
    [host, browsing, browse],
  );
  return (
    <Dialog
      open
      onClose={closeSheet}
      eyebrow={`Projects · ${host}`}
      title="Projects on this device"
      footer={footer}
      width={640}
    >
      {browsing && hostId && <AddLocal hostId={hostId} onDone={stopBrowsing} />}
      <View>
        {merged.map((m) => (
          <ProjectRow key={m.project.projectRootPath} m={m} hostId={hostId} />
        ))}
        {!merged.length && <T style={s.muted}>No projects on {host} yet.</T>}
      </View>
    </Dialog>
  );
}

function AddLocal({ hostId, onDone }: { hostId: string; onDone: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const target = picked ?? cwd;
  const add = useCallback(() => {
    if (!target) return;
    addLocalProject(hostId, target);
    onDone();
  }, [hostId, target, onDone]);
  const name = target ? baseName(target) || target : null;
  return (
    <View style={s.browse}>
      <ScrollView style={s.browseList}>
        <FolderBrowser picked={picked} onPick={setPicked} onCwd={setCwd} />
      </ScrollView>
      <View style={s.browseActs}>
        <Button label="Cancel" onPress={onDone} />
        <Button
          kind="primary"
          label={name ? `List ${name}` : "Pick a folder"}
          onPress={add}
          disabled={!target}
        />
      </View>
    </View>
  );
}

function ProjectRow({ m, hostId }: { m: MergedProject; hostId: string | null }) {
  const root = m.project.projectRootPath;
  const pin = useCallback(() => hostId && pinProject(hostId, root, !m.pinned), [hostId, root, m]);
  const hide = useCallback(() => hostId && hideProject(hostId, root, !m.hidden), [hostId, root, m]);
  const remove = useCallback(() => hostId && removeLocalProject(hostId, root), [hostId, root]);
  const name = m.project.projectCustomName || m.project.projectDisplayName;
  return (
    <View style={[s.row, m.hidden && s.rowHidden]}>
      <Folder size={13} color={color.faint} />
      <View style={s.flex}>
        <T numberOfLines={1} style={s.name}>
          {name}
          {m.local && <T style={s.tag}> · this device</T>}
          {m.hidden && <T style={s.tag}> · hidden</T>}
        </T>
        <T v="mono" numberOfLines={1} ellipsizeMode="head" style={s.path}>
          {tildePath(root)}
        </T>
      </View>
      <IconToggle
        on={m.pinned}
        onPress={pin}
        label={m.pinned ? `Unpin ${name}` : `Pin ${name}`}
        Icon={m.pinned ? PinOff : Pin}
      />
      {m.local ? (
        <IconToggle on={false} onPress={remove} label={`Remove ${name}`} Icon={X} />
      ) : (
        <IconToggle
          on={m.hidden}
          onPress={hide}
          label={m.hidden ? `Show ${name}` : `Hide ${name}`}
          Icon={m.hidden ? Eye : EyeOff}
        />
      )}
    </View>
  );
}

function IconToggle({
  on,
  onPress,
  label,
  Icon,
}: {
  on: boolean;
  onPress: () => void;
  label: string;
  Icon: typeof Pin;
}) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={s.icon}>
      {({ hovered }) => <Icon size={14} color={on || hovered ? color.cyan2 : color.faint} />}
    </Pressable>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  muted: { fontSize: 12.5, color: color.muted },
  footRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  footNote: { flex: 1, fontSize: 11.5, color: color.faint },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowHidden: { opacity: 0.55 },
  name: { fontSize: 13 },
  tag: { fontSize: 11.5, color: color.faint },
  path: { fontSize: 11, color: color.faint, marginTop: 2 },
  icon: { padding: 4 },
  browse: {
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.bg2,
  },
  browseList: { maxHeight: 280 },
  browseActs: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
});
