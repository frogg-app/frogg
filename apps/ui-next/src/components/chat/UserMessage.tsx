import { ArrowUpRight, Bot } from "lucide-react-native";
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

/** A user turn: the user's own bubble, or a message relayed from another agent. */
export function UserMessage({ text }: { text: string }) {
  const relay = useMemo(() => parseRelay(text), [text]);
  if (relay) return <RelayMessage relay={relay} />;
  return <UserBubble text={text} />;
}

/** The user's bubble; attached images (Claude Code writes them as markdown) render inline. */
function UserBubble({ text }: { text: string }) {
  const pieces = useMemo(() => splitImages(text), [text]);
  const images = pieces.some((p) => p.kind === "img");
  return (
    <View style={[s.user, images && s.userWide]}>
      {pieces.map((p) =>
        p.kind === "img" ? (
          <HostImage key={`i${p.off}`} src={p.src} alt={p.alt} />
        ) : (
          <T key={`t${p.off}`} selectable style={s.userT}>
            {images ? p.text.trim() : p.text}
          </T>
        ),
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
