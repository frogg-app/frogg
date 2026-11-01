import { FileText, GitFork, Image as ImageIcon, Plus, X } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { color } from "../../theme/tokens";
import { T } from "../Text";
import { toastError } from "../toast/store";
import { Menu, useAnchor, type MenuEntry } from "../tools/Menu";
import { attachPicked, type Attachment } from "./actions";
import { canPickFiles, pickFiles } from "./pickFiles";
import { cancelUpload, formatBytes, useUploads } from "./upload";

/** The composer's + button: pick images or files to send with the next message. */
export function AttachMenu({
  onAdd,
  onRemove,
}: {
  onAdd: (a: Attachment[]) => void;
  onRemove: (id: string) => void;
}) {
  const anchor = useAnchor();
  const pick = useCallback(
    async (images: boolean) => {
      try {
        attachPicked(await pickFiles({ images }), onAdd, onRemove);
      } catch (e) {
        toastError("Could not attach", e);
      }
    },
    [onAdd, onRemove],
  );
  const items = useMemo<MenuEntry[]>(
    () => [
      {
        label: "Image or file",
        icon: FileText,
        hint: canPickFiles
          ? "Files go to the host; images go to the model"
          : "Not available on this device yet",
        disabled: !canPickFiles,
        onPress: () => void pick(false),
      },
      {
        label: "Image",
        icon: ImageIcon,
        disabled: !canPickFiles,
        onPress: () => void pick(true),
      },
    ],
    [pick],
  );
  return (
    <>
      <View ref={anchor.ref} collapsable={false}>
        <Pressable onPress={anchor.open} accessibilityLabel="Attach" hitSlop={6}>
          {({ hovered }) => <Plus size={16} color={hovered ? color.text : color.muted} />}
        </Pressable>
      </View>
      <Menu rect={anchor.rect} onClose={anchor.close} items={items} width={280} />
    </>
  );
}

const iconFor = { image: ImageIcon, file: FileText, fork: GitFork, upload: FileText };

export function AttachChips({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove: (id: string) => void;
}) {
  return (
    <View style={s.row}>
      {items.map((a) => (
        <Chip key={a.id} a={a} onRemove={onRemove} />
      ))}
    </View>
  );
}

function Chip({ a, onRemove }: { a: Attachment; onRemove: (id: string) => void }) {
  const uploading = a.kind === "upload";
  const remove = useCallback(
    () => (uploading ? cancelUpload(a.id) : onRemove(a.id)),
    [a.id, onRemove, uploading],
  );
  const Icon = iconFor[a.kind];
  return (
    <View style={s.chip}>
      <Icon size={12} color={color.muted} />
      <T v="mono" style={s.name} numberOfLines={1}>
        {a.name}
      </T>
      {uploading && <UploadProgress id={a.id} size={a.size} />}
      <Pressable
        onPress={remove}
        hitSlop={6}
        accessibilityLabel={uploading ? `Cancel uploading ${a.name}` : `Remove ${a.name}`}
      >
        <X size={11} color={color.faint} />
      </Pressable>
      {uploading && <UploadBar id={a.id} />}
    </View>
  );
}

export function UploadProgress({ id, size }: { id: string; size: number }) {
  const sent = useUploads((st) => st[id]?.sent ?? 0);
  return (
    <T v="mono" style={s.pct}>
      {`${Math.floor((sent / Math.max(size, 1)) * 100)}% of ${formatBytes(size)}`}
    </T>
  );
}

export function UploadBar({ id }: { id: string }) {
  const frac = useUploads((st) => (st[id] ? st[id].sent / Math.max(st[id].total, 1) : 0));
  return <View style={[s.bar, { width: `${frac * 100}%` }]} />;
}

const s = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.wash,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 260,
    overflow: "hidden",
  },
  name: { color: color.text, flexShrink: 1 },
  pct: { color: color.muted, fontVariant: ["tabular-nums"] },
  bar: { position: "absolute", left: 0, bottom: 0, height: 2, backgroundColor: color.mint },
});
