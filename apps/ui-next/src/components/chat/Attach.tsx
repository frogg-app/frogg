import {
  ClipboardPaste,
  FileText,
  GitFork,
  Image as ImageIcon,
  Paperclip,
  Plus,
  X,
} from "lucide-react-native";
import { useCallback, useMemo, type ReactNode, type RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { color } from "../../theme/tokens";
import { T } from "../Text";
import { toast, toastError } from "../toast/store";
import { Menu, useAnchor, type MenuEntry } from "../tools/Menu";
import type { Attachment } from "./actions";
import { canPastePicture, clipboardHasPicture, pasteClipboardPicture } from "./clipboard";
import { canPickFiles, pickFiles } from "./pickFiles";
import { cancelUpload, formatBytes, useUploads, type Picked } from "./upload";

/**
 * What an attach button does when pressed: opens the file chooser straight away or, on a phone
 * with a picture on the clipboard, a menu that can paste it instead. Render `menu` beside the
 * button and put `ref` on the View around it.
 */
export function useAttachPicker(onPicked: (picked: Picked[]) => void): {
  ref: RefObject<View | null>;
  press: () => void;
  menu: ReactNode;
} {
  const { ref, rect, open, close } = useAnchor();
  const choose = useCallback(async () => {
    try {
      const picked = await pickFiles();
      if (picked.length) onPicked(picked);
    } catch (e) {
      toastError("Could not attach", e);
    }
  }, [onPicked]);
  const paste = useCallback(async () => {
    try {
      const picked = await pasteClipboardPicture();
      if (picked) onPicked([picked]);
      else toast({ title: "Nothing to paste", detail: "The clipboard has no image." });
    } catch (e) {
      toastError("Could not paste the image", e);
    }
  }, [onPicked]);
  const press = useCallback(() => {
    if (!canPickFiles) {
      toast({ title: "Attaching isn't available on this device yet" });
      return;
    }
    if (!canPastePicture) {
      void choose();
      return;
    }
    void clipboardHasPicture().then((has) => (has ? open() : choose()));
  }, [choose, open]);
  const items = useMemo<MenuEntry[]>(
    () => [
      {
        label: "Paste image",
        hint: "The picture on the clipboard",
        icon: ClipboardPaste,
        onPress: () => void paste(),
      },
      { label: "Choose files", icon: Paperclip, onPress: () => void choose() },
    ],
    [paste, choose],
  );
  const menu = canPastePicture ? (
    <Menu rect={rect} onClose={close} items={items} width={240} />
  ) : null;
  return { ref, press, menu };
}

/**
 * The composer's + button: opens the file chooser (or, with a picture on a phone's clipboard,
 * offers to paste it). Small images go to the model; everything else uploads to the host.
 */
export function AttachButton({ onPicked }: { onPicked: (picked: Picked[]) => void }) {
  const { ref, press, menu } = useAttachPicker(onPicked);
  return (
    <View ref={ref} collapsable={false}>
      <Pressable
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel="Attach images or files"
        accessibilityHint="Images go to the model; files go to the host"
        hitSlop={6}
      >
        {({ hovered }) => <Plus size={16} color={hovered ? color.text : color.muted} />}
      </Pressable>
      {menu}
    </View>
  );
}

const iconFor = { image: ImageIcon, file: FileText, fork: GitFork, upload: FileText };

function chipIcon(a: Attachment) {
  if (a.kind === "local") return a.picked.mimeType.startsWith("image/") ? ImageIcon : FileText;
  return iconFor[a.kind];
}

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
  const Icon = chipIcon(a);
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
