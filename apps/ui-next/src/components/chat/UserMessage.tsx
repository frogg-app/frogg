import { ArrowUpRight, Bot, Image as ImageIcon, Paperclip } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useDaemon } from "../../daemon/store";
import { color, font } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { HostImage } from "../markdown/HostImage";
import { splitImages } from "../markdown/syntax";
import { Markdown } from "../Markdown";
import { T } from "../Text";
import { parseRelay, resolveSender, type Relay } from "./relay";
import { useSentAttachments, type SentAttachment } from "./sentAttachments";

/** A user turn: the user's own bubble, or a message relayed from another agent. */
export function UserMessage({ text, messageId }: { text: string; messageId?: string }) {
  const relay = useMemo(() => parseRelay(text), [text]);
  if (relay) return <RelayMessage relay={relay} />;
  return <UserBubble text={text} messageId={messageId} />;
}

const NONE: SentAttachment[] = [];

/**
 * The user's bubble. Images written into the text as markdown (Claude Code's history) render
 * inline; what this device attached when sending shows under the text, pictures first.
 */
function UserBubble({ text, messageId }: { text: string; messageId?: string }) {
  const pieces = useMemo(() => splitImages(text), [text]);
  const sent = useSentAttachments((st) => (messageId ? (st[messageId] ?? NONE) : NONE));
  const pictures = sent.filter((x) => x.uri);
  const chips = sent.filter((x) => !x.uri);
  const images = pieces.some((p) => p.kind === "img") || pictures.length > 0;
  return (
    <View style={[s.user, images && s.userWide]}>
      {pieces.map((p) =>
        p.kind === "img" ? (
          <HostImage key={`i${p.off}`} src={p.src} alt={p.alt} />
        ) : (
          !!p.text.trim() && (
            <T key={`t${p.off}`} selectable style={s.userT}>
              {images ? p.text.trim() : p.text}
            </T>
          )
        ),
      )}
      {pictures.map((x) => (
        <HostImage key={x.id} src={x.uri ?? ""} alt={x.name} />
      ))}
      {chips.length > 0 && (
        <View style={s.chips}>
          {chips.map((x) => (
            <View key={x.id} style={s.chip}>
              {x.kind === "image" ? (
                <ImageIcon size={12} color={color.muted} />
              ) : (
                <Paperclip size={12} color={color.muted} />
              )}
              <T v="mono" numberOfLines={1} style={s.chipT}>
                {x.name}
              </T>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Another agent talking to this one: sender chip (opens that session when it is known). */
function RelayMessage({ relay }: { relay: Relay }) {
  const sender = useDaemon((st) => resolveSender(relay.id, Object.keys(st.sessions)));
  const open = useCallback(() => {
    if (sender) useUi.getState().select(sender);
  }, [sender]);
  return (
    <View style={s.relay}>
      <Pressable
        onPress={open}
        disabled={!sender}
        accessibilityRole={sender ? "link" : undefined}
        accessibilityLabel={`From the ${relay.name} agent${sender ? ", open its session" : ""}`}
      >
        {({ hovered }) => (
          <View style={s.from}>
            <Bot size={13} color={color.violet} />
            <T style={s.fromLabel}>From</T>
            <T numberOfLines={1} style={[s.name, hovered && sender && s.nameHover]}>
              {relay.name}
            </T>
            <T v="mono" style={s.id}>
              {relay.id}
            </T>
            {relay.where && (
              <T v="mono" numberOfLines={1} ellipsizeMode="middle" style={s.where}>
                {relay.where}
              </T>
            )}
            {sender && <ArrowUpRight size={13} color={hovered ? color.text : color.faint} />}
          </View>
        )}
      </Pressable>
      <View style={s.relayBody}>
        <Markdown text={relay.body} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  user: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    marginTop: 14,
    gap: 8,
    backgroundColor: color.raise,
    borderLeftWidth: 2,
    borderLeftColor: color.cyan2,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userWide: { width: 440 },
  userT: { fontSize: 14.5, lineHeight: 22 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: color.wash,
  },
  chipT: { fontSize: 11.5, color: color.text, flexShrink: 1 },
  relay: {
    marginTop: 14,
    marginRight: "10%",
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
    borderLeftWidth: 2,
    borderLeftColor: color.violet,
  },
  from: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    backgroundColor: color.wash,
  },
  fromLabel: { fontSize: 12, color: color.faint },
  name: { fontSize: 12.5, fontWeight: "600", color: color.text, flexShrink: 1, minWidth: 40 },
  nameHover: { color: color.cyan2 },
  id: { fontSize: 11, color: color.violet, fontFamily: font.mono, flexShrink: 0 },
  /** The location gives way first; the name keeps what it can. */
  where: { fontSize: 10.5, color: color.faint, flexShrink: 100, minWidth: 0 },
  relayBody: { paddingHorizontal: 14, paddingVertical: 10 },
});
