import { Link2, QrCode, type LucideIcon } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { DEFAULT_SSH_DAEMON_PORT } from "@frogg/protocol/ssh-transport";
import { addHost, parseHostAddress, updateHost, useHosts, type Host } from "../../daemon/hosts";
import { parsePairInput, usePendingPair } from "../../daemon/pairing";
import { connect } from "../../daemon/store";
import { color, font, web } from "../../theme/tokens";
import { Button } from "../Button";
import { T } from "../Text";
import { Dialog } from "../tools/Dialog";
import { closeSheet, openSheet, useHostView } from "./state";

type Method = "pair" | "direct";

/** Add a host: paste a pairing link or type its code, or enter a direct address. */
export function AddHost() {
  const open = useHostView((s) => s.sheet?.kind === "add");
  const [method, setMethod] = useState<Method>("direct");
  return (
    <Dialog
      open={open}
      onClose={closeSheet}
      eyebrow="Hosts"
      title="Add a host"
      width={740}
      footer={null}
    >
      <T style={s.lede}>
        Connect using a LAN or tailnet address. A pairing offer has a separate confirmation step.
      </T>
      <View style={s.methods}>
        <MethodCard
          id="pair"
          on={method === "pair"}
          icon={QrCode}
          title="Scan or paste a pairing offer"
          sub="Link or 8-character code shown on the host"
          pick={setMethod}
        />
        <MethodCard
          id="direct"
          on={method === "direct"}
          icon={Link2}
          title="Direct address"
          sub="Host and port, optional password and TLS"
          pick={setMethod}
        />
      </View>
      {method === "pair" ? <PairForm /> : <DirectForm />}
    </Dialog>
  );
}

function MethodCard({
  id,
  on,
  icon: Icon,
  title,
  sub,
  pick,
}: {
  id: Method;
  on: boolean;
  icon: LucideIcon;
  title: string;
  sub: string;
  pick: (m: Method) => void;
}) {
  const press = useCallback(() => pick(id), [pick, id]);
  return (
    <Pressable onPress={press} style={[s.method, on && s.methodOn]} accessibilityRole="button">
      <Icon size={16} color={on ? color.cyan2 : color.muted} />
      <View style={s.flex}>
        <T style={s.methodTitle}>{title}</T>
        <T style={s.methodSub}>{sub}</T>
      </View>
    </Pressable>
  );
}

const CELLS = 8;
const POS = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"];

function PairForm() {
  const [link, setLink] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const onCode = useCallback(
    (v: string) =>
      setCode(
        v
          .toUpperCase()
          .replace(/[^0-9A-Z]/g, "")
          .slice(0, CELLS),
      ),
    [],
  );
  const codeOnly = !link.trim() && code.length > 0;
  const go = useCallback(() => {
    const target = link.trim()
      ? parsePairInput(link)
      : parsePairInput(code, address.trim() || undefined);
    if (!target) {
      setError(
        link.trim()
          ? "That is not a Frogg pairing link."
          : "Codes are 8 characters, letters and digits.",
      );
      return;
    }
    if (target.kind === "code" && !target.endpoint) {
      setError("Enter the host's address to use a code.");
      return;
    }
    setError(null);
    usePendingPair.setState({ target, invalid: null });
    openSheet({ kind: "confirm" });
  }, [link, code, address]);
  const cells = useMemo(() => Array.from({ length: CELLS }, (_, i) => code[i] ?? ""), [code]);
  return (
    <View style={s.form}>
      <T v="label">Paste a link or enter the code</T>
      <TextInput
        value={link}
        onChangeText={setLink}
        placeholder="frogg://pair#offer=…  or  https://pair.frogg.app/code/…"
        placeholderTextColor={color.faint}
        style={s.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <View style={s.codeWrap}>
        <View style={s.cells} pointerEvents="none">
          {cells.map((c, i) => (
            <Cell key={POS[i]} ch={c} gap={i === 3} />
          ))}
        </View>
        <TextInput
          value={code}
          onChangeText={onCode}
          style={s.codeInput}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={CELLS}
          accessibilityLabel="Pairing code"
        />
      </View>
      {codeOnly && (
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="Host address  e.g. devbox.lan:6767"
          placeholderTextColor={color.faint}
          style={s.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
      )}
      <T style={s.hint}>
        On the host: Hosts › Pair a device, or run{" "}
        <T v="mono" style={s.cmd}>
          frogg pair
        </T>
        .
      </T>
      {error && <T style={s.error}>{error}</T>}
      <View style={s.actions}>
        <Button label="Cancel" onPress={closeSheet} />
        <Button
          kind="primary"
          label="Continue"
          disabled={!link.trim() && code.length < CELLS}
          onPress={go}
        />
      </View>
    </View>
  );
}

function Cell({ ch, gap }: { ch: string; gap: boolean }) {
  return (
    <View style={[s.cell, gap && s.cellGap, !!ch && s.cellOn]}>
      <T style={s.cellT}>{ch}</T>
    </View>
  );
}

/** Splits a pasted "host:port" or ws(s):// URL; null when the text is just a host. */
export function splitPastedAddress(
  input: string,
): { host: string; port?: string; tls?: boolean } | null {
  const raw = input.trim();
  const scheme = /^(wss?|https?):\/\//i.exec(raw);
  if (scheme) {
    try {
      const url = new URL(
        raw.replace(/^wss?:/i, (m) => (m.toLowerCase() === "wss:" ? "https:" : "http:")),
      );
      const tls = /^(wss|https)$/i.test(scheme[1] ?? "");
      return { host: url.hostname, port: url.port || undefined, tls };
    } catch {
      return null;
    }
  }
  const m = /^(\[[0-9a-fA-F:]+\]|[^:/\s]+):(\d*)$/.exec(raw);
  return m ? { host: m[1] ?? "", port: m[2] } : null;
}

const validPort = (p: string) => /^\d{1,5}$/.test(p) && Number(p) >= 1 && Number(p) <= 65535;
/** Bare IPv6 literals get brackets so host:port stays unambiguous. */
const joinAddress = (host: string, port: string) => {
  const h = host.trim();
  return `${h.includes(":") && !h.startsWith("[") ? `[${h}]` : h}:${port.trim()}`;
};

/** Host/port split of a saved endpoint, for pre-filling the form. */
function endpointParts(endpoint: string): { host: string; port: string } {
  const split = splitPastedAddress(endpoint);
  return split
    ? { host: split.host, port: split.port || String(DEFAULT_SSH_DAEMON_PORT) }
    : { host: endpoint, port: String(DEFAULT_SSH_DAEMON_PORT) };
}

const connectNew = (entry: Omit<Host, "id">) => void connect(addHost(entry));

function DirectForm() {
  return <HostFields submitLabel="Connect" onSave={connectNew} />;
}

/** Edit a saved host: same fields as Add, pre-filled; saves in place and reconnects if active. */
export function EditHost() {
  const hostId = useHostView((st) => (st.sheet?.kind === "edit" ? st.sheet.hostId : null));
  const host = useHosts((st) => st.hosts.find((h) => h.id === hostId));
  return (
    <Dialog
      open={!!host}
      onClose={closeSheet}
      eyebrow="Hosts"
      title={host ? `Edit ${host.name}` : "Edit host"}
      width={620}
      footer={null}
    >
      {host && <EditForm key={host.id} host={host} />}
    </Dialog>
  );
}

function EditForm({ host }: { host: Host }) {
  const save = useCallback(
    (entry: Omit<Host, "id">) => {
      const changedRoute =
        entry.endpoint !== host.endpoint ||
        !!entry.tls !== !!host.tls ||
        (entry.password ?? "") !== (host.password ?? "");
      // A blank password field clears the saved one.
      const next = updateHost(host.id, { ...entry, password: entry.password ?? "" });
      if (next && changedRoute && useHosts.getState().activeId === host.id) void connect(next);
    },
    [host],
  );
  return <HostFields initial={host} submitLabel="Save" onSave={save} />;
}

function HostFields({
  initial,
  submitLabel,
  onSave,
}: {
  initial?: Host;
  submitLabel: string;
  onSave: (entry: Omit<Host, "id">) => void;
}) {
  const parts = useMemo(() => (initial ? endpointParts(initial.endpoint) : null), [initial]);
  const [host, setHost] = useState(parts?.host ?? "");
  const [port, setPort] = useState(parts?.port ?? String(DEFAULT_SSH_DAEMON_PORT));
  const [name, setName] = useState(initial?.name ?? "");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [tls, setTls] = useState(initial?.tls ?? false);
  const toggleTls = useCallback(() => setTls((v) => !v), []);
  const onHost = useCallback((v: string) => {
    const split = splitPastedAddress(v);
    if (!split) {
      setHost(v);
      return;
    }
    setHost(split.host);
    if (split.port) setPort(split.port);
    if (split.tls !== undefined) setTls(split.tls);
  }, []);
  const onPort = useCallback((v: string) => setPort(v.replace(/[^0-9]/g, "").slice(0, 5)), []);
  const portOk = validPort(port);
  const address = portOk && host.trim() ? parseHostAddress(joinAddress(host, port)) : null;
  const valid = address !== null;
  const tlsState = useMemo(() => ({ checked: tls }), [tls]);
  const save = useCallback(() => {
    if (!address) return;
    onSave({
      endpoint: address.endpoint,
      name: name.trim() || address.name,
      tls,
      ...(password ? { password } : {}),
    });
    closeSheet();
  }, [address, name, password, tls, onSave]);
  return (
    <View style={s.form}>
      <View style={s.addrRow}>
        <View style={s.hostCol}>
          <T v="label">Host</T>
          <TextInput
            value={host}
            onChangeText={onHost}
            placeholder="devbox.lan or 100.64.0.7"
            placeholderTextColor={color.faint}
            style={s.input}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Host"
          />
        </View>
        <View style={s.portCol}>
          <T v="label">Port</T>
          <TextInput
            value={port}
            onChangeText={onPort}
            placeholder={String(DEFAULT_SSH_DAEMON_PORT)}
            placeholderTextColor={color.faint}
            style={[s.input, !portOk && s.inputBad]}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={5}
            accessibilityLabel="Port"
          />
        </View>
      </View>
      {!portOk && <T style={s.error}>Port must be a number from 1 to 65535.</T>}
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name (optional)"
        placeholderTextColor={color.faint}
        style={s.input}
        accessibilityLabel="Name"
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password (if the daemon has one)"
        placeholderTextColor={color.faint}
        style={s.input}
        secureTextEntry
        accessibilityLabel="Password"
      />
      <Pressable
        onPress={toggleTls}
        style={s.check}
        accessibilityRole="checkbox"
        accessibilityState={tlsState}
      >
        <View style={[s.box, tls && s.boxOn]} />
        <T style={s.hint}>Use TLS (wss://)</T>
      </Pressable>
      {!!host.trim() && portOk && !valid && (
        <T style={s.error}>
          Enter a hostname or IP address. Paths and credentials are not part of the host.
        </T>
      )}
      <View style={s.actions}>
        <Button label="Cancel" onPress={closeSheet} />
        <Button kind="primary" label={submitLabel} disabled={!valid} onPress={save} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  lede: { color: color.muted, fontSize: 13 },
  methods: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  method: {
    flexBasis: 220,
    flexGrow: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
    backgroundColor: color.wash,
    borderWidth: 1,
    borderColor: "transparent",
  },
  methodOn: { borderColor: color.cyan, backgroundColor: "rgba(37,181,200,0.08)" },
  methodTitle: { fontSize: 13, fontWeight: "600" },
  methodSub: { color: color.faint, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  form: { gap: 10, marginTop: 6 },
  addrRow: { flexDirection: "row", gap: 10 },
  hostCol: { flex: 7, gap: 6 },
  portCol: { flex: 3, minWidth: 84, gap: 6 },
  inputBad: { borderColor: color.coral },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 12.5,
    ...web({ outlineStyle: "none" }),
  },
  codeWrap: { height: 46, alignSelf: "flex-start" },
  cells: { flexDirection: "row", gap: 8 },
  cell: {
    width: 32,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: color.line2,
    backgroundColor: color.wash,
  },
  cellOn: { borderBottomColor: color.cyan },
  cellGap: { marginRight: 10 },
  cellT: { fontFamily: font.mono, fontSize: 20, fontWeight: "600" },
  codeInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
    color: "transparent",
    ...web({ outlineStyle: "none", caretColor: "transparent" }),
  },
  hint: { color: color.muted, fontSize: 12 },
  cmd: { color: color.cyan2, fontSize: 11.5 },
  error: { color: color.coral, fontSize: 12.5 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 6 },
  check: { flexDirection: "row", alignItems: "center", gap: 8 },
  box: { width: 12, height: 12, borderWidth: 1, borderColor: color.line2 },
  boxOn: { backgroundColor: color.cyan },
});
