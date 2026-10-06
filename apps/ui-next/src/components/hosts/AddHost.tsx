import { Link2, QrCode, type LucideIcon } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { addHost, parseHostAddress, type Host } from "../../daemon/hosts";
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
          sub="host:port, optional password and TLS"
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

function DirectForm() {
  const [endpoint, setEndpoint] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState(false);
  const toggleTls = useCallback(() => setTls((v) => !v), []);
  const valid = parseHostAddress(endpoint) !== null;
  const tlsState = useMemo(() => ({ checked: tls }), [tls]);
  const save = useCallback(() => {
    const address = parseHostAddress(endpoint);
    if (!address) return;
    const host: Omit<Host, "id"> = {
      endpoint: address.endpoint,
      name: name.trim() || address.name,
      tls,
      ...(password ? { password } : {}),
    };
    void connect(addHost(host));
    closeSheet();
  }, [endpoint, name, password, tls]);
  return (
    <View style={s.form}>
      <T v="label">Address</T>
      <TextInput
        value={endpoint}
        onChangeText={setEndpoint}
        placeholder="host:port  e.g. devbox.lan:6767"
        placeholderTextColor={color.faint}
        style={s.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name (optional)"
        placeholderTextColor={color.faint}
        style={s.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password (if the daemon has one)"
        placeholderTextColor={color.faint}
        style={s.input}
        secureTextEntry
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
      {!!endpoint.trim() && !valid && (
        <T style={s.error}>
          Enter host:port with a port from 1 to 65535. Use brackets around IPv6 addresses.
        </T>
      )}
      <View style={s.actions}>
        <Button label="Cancel" onPress={closeSheet} />
        <Button kind="primary" label="Connect" disabled={!valid} onPress={save} />
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
