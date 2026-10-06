import { Plus, QrCode, Trash2 } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useHostLink, useHosts, type Host } from "../daemon/hosts";
import { useDaemon } from "../daemon/store";
import { useFormFactor } from "../theme/layout";
import { color } from "../theme/tokens";
import { AddHost } from "./hosts/AddHost";
import { HostDetail, hostKind, offlineReason } from "./hosts/HostDetail";
import { installPairLinks } from "./hosts/links";
import { PairConfirm } from "./hosts/PairConfirm";
import { PairDevice } from "./hosts/PairDevice";
import { RemoveHost } from "./hosts/RemoveHost";
import { openSheet, useHostView, viewHost } from "./hosts/state";
import { GroupHead, PanelHead } from "./PanelHead";
import { Brackets } from "./SessionList";
import { T } from "./Text";

// Pairing links can open the app at any time; the shell imports this module at start.
installPairLinks();

const savedLabel = (active: boolean) => (active ? "" : "saved");
const openAdd = () => openSheet({ kind: "add" });
const openPair = () => openSheet({ kind: "pair-device" });
const back = () => viewHost(null, false);

/** Hosts tool: saved hosts, the active one's state, and every hosts dialog. */
export function HostsPanel() {
  const phone = useFormFactor() === "phone";
  const pushed = useHostView((s) => s.pushed);
  return (
    <View style={st.fill}>
      {phone && pushed ? <HostDetail onBack={back} /> : <HostList />}
      <AddHost />
      <PairConfirm />
      <PairDevice />
      <RemoveHost />
    </View>
  );
}

function HostList() {
  const hosts = useHosts((s) => s.hosts);
  const activeId = useHosts((s) => s.activeId);
  const viewId = useHostView((s) => s.viewId);
  const online = useDaemon((s) => s.conn === "online");
  const shown = viewId ?? activeId;
  return (
    <>
      <PanelHead title="Hosts">
        {online && (
          <Pressable onPress={openPair} accessibilityLabel="Pair a device" hitSlop={10}>
            <QrCode size={15} color={color.muted} />
          </Pressable>
        )}
        <Pressable onPress={openAdd} accessibilityLabel="Add a host" hitSlop={10}>
          <Plus size={16} color={color.muted} />
        </Pressable>
      </PanelHead>
      <ScrollView contentContainerStyle={st.scroll}>
        {hosts.map((h) => (
          <HostRow key={h.id} h={h} active={h.id === activeId} shown={h.id === shown} />
        ))}
        {!hosts.length && <T style={st.empty}>No hosts yet.</T>}
        <GroupHead label="Add" />
        <Pressable onPress={openAdd} style={st.add} accessibilityRole="button">
          <Plus size={14} color={color.cyan2} />
          <View style={st.flex}>
            <T style={st.addT}>Add a host</T>
            <T style={st.sub}>Paste a pairing link or code, or enter an address</T>
          </View>
        </Pressable>
      </ScrollView>
    </>
  );
}

function HostRow({ h, active, shown }: { h: Host; active: boolean; shown: boolean }) {
  const conn = useDaemon((s) => (active ? s.conn : null));
  const count = useDaemon((s) => (active ? Object.keys(s.sessions).length : null));
  const link = useHostLink();
  const press = useCallback(() => viewHost(h.id), [h.id]);
  const remove = useCallback(() => openSheet({ kind: "remove", hostId: h.id }), [h.id]);
  const down = active && conn === "offline";
  const reconnecting = active && conn === "connecting" && !!link.droppedAt;
  // Row and bin are siblings so hovering the bin keeps it shown and pressing it never selects the row.
  const [rowHover, setRowHover] = useState(false);
  const [binHover, setBinHover] = useState(false);
  const rowIn = useCallback(() => setRowHover(true), []);
  const rowOut = useCallback(() => setRowHover(false), []);
  const binIn = useCallback(() => setBinHover(true), []);
  const binOut = useCallback(() => setBinHover(false), []);
  const hovered = rowHover || binHover;
  return (
    <View>
      <Pressable onPress={press} onHoverIn={rowIn} onHoverOut={rowOut}>
        <View style={[st.row, shown && st.rowOn, hovered && st.rowHover]}>
          {shown && <Brackets c={color.cyan2} />}
          <View style={st.line}>
            <View style={[down || reconnecting ? st.flag : st.dot, conn ? TINT[conn] : st.tIdle]} />
            <T style={st.name} numberOfLines={1}>
              {h.name}
            </T>
            <View style={st.badge}>
              <T v="mono" style={st.badgeT}>
                {hostKind(h)}
              </T>
            </View>
            <View style={st.binSlot} />
          </View>
          <View style={st.line}>
            <T v="mono" numberOfLines={1} style={st.endpoint}>
              {h.endpoint}
            </T>
            <T v="mono" style={st.sub}>
              {count === null ? savedLabel(active) : `${count} sessions`}
            </T>
          </View>
          {(down || reconnecting) && (
            <T v="mono" style={st.err} numberOfLines={2}>
              {offlineReason(link)}
              {link.attempt > 0 ? ` · retrying (${link.attempt + 1})` : ""}
            </T>
          )}
          {active && conn === "connecting" && !link.droppedAt && (
            <T v="mono" style={st.wait}>
              connecting…
            </T>
          )}
        </View>
      </Pressable>
      {(hovered || ALWAYS_BIN) && (
        <Pressable
          onPress={remove}
          onHoverIn={binIn}
          onHoverOut={binOut}
          accessibilityLabel={`Remove ${h.name}`}
          hitSlop={8}
          style={st.bin}
        >
          <Trash2 size={13} color={binHover ? color.coral : color.faint} />
        </Pressable>
      )}
    </View>
  );
}

/** Touch has no hover: keep the bin visible on native. */
const ALWAYS_BIN = Platform.OS !== "web";

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  scroll: { paddingBottom: 16, paddingTop: 4 },
  flex: { flex: 1 },
  empty: { color: color.muted, padding: 16 },
  row: {
    marginHorizontal: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowOn: { backgroundColor: "rgba(37,181,200,0.06)" },
  rowHover: { backgroundColor: color.wash },
  binSlot: { width: 13 },
  bin: { position: "absolute", top: 12, right: 20 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  flag: { width: 9, height: 9 },
  name: { flex: 1, fontSize: 13.5, fontWeight: "500" },
  badge: { paddingHorizontal: 5, paddingVertical: 1, backgroundColor: color.raise },
  badgeT: { fontSize: 10 },
  endpoint: { flex: 1, color: color.faint, fontSize: 11, paddingLeft: 16 },
  sub: { color: color.faint, fontSize: 11 },
  err: { color: color.coral, fontSize: 11, paddingLeft: 16 },
  wait: { color: color.amber, fontSize: 11, paddingLeft: 16 },
  add: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addT: { color: color.cyan2, fontSize: 13 },
  tIdle: { backgroundColor: color.faint },
});

const TINT = StyleSheet.create({
  online: { backgroundColor: color.mint },
  connecting: { backgroundColor: color.amber },
  offline: { backgroundColor: color.coral },
});
