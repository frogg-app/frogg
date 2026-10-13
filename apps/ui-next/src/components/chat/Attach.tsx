import { FileText, GitFork, Image as ImageIcon, Plus, X } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { color } from "../../theme/tokens";
import { T } from "../Text";
import { toastError } from "../toast/store";
import { Menu, useAnchor, type MenuEntry } from "../tools/Menu";
import { prepareAttachment, type Attachment } from "./actions";
import { canPickFiles, pickFiles } from "./pickFiles";

/** The composer's + button: pick images or files to send with the next message. */
export function AttachMenu({ onAdd }: { onAdd: (a: Attachment[]) => void }) {
  const anchor = useAnchor();
  const pick = useCallback(
    async (images: boolean) => {
      try {
        const picked = await pickFiles({ images });
        if (picked.length) onAdd(await Promise.all(picked.map(prepareAttachment)));
      } catch (e) {
        toastError("Could not attach", e);
      }
    },
    [onAdd],
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

const iconFor = { image: ImageIcon, file: FileText, fork: GitFork };

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
  const remove = useCallback(() => onRemove(a.id), [a.id, onRemove]);
  const Icon = iconFor[a.kind];
  return (
    <View style={s.chip}>
      <Icon size={12} color={color.muted} />
      <T v="mono" style={s.name} numberOfLines={1}>
        {a.name}
      </T>
      <Pressable onPress={remove} hitSlop={6} accessibilityLabel={`Remove ${a.name}`}>
        <X size={11} color={color.faint} />
      </Pressable>
    </View>
  );
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
  },
  name: { color: color.text, flexShrink: 1 },
});
