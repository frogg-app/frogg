import { HostPage } from "./host-state";
import { useHostAction as useAction } from "./host-state";
import { WORKSPACE_LABEL_COLORS } from "@frogg/protocol/workspace-labels";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useDaemon } from "../../../daemon/store";
import { color, labelTint } from "../../../theme/tokens";
import { Button } from "../../Button";
import { T } from "../../Text";
import {
  loadDirectory,
  useDirectory,
  type LabelDef,
  type LabelColor,
} from "../../sessions/directory";
import { Note, Section } from "../controls";
import { LabelChip, Swatches, need } from "./hostkit";
import { Block, Confirm, ErrorLine, Field } from "./kit";

const COLORS: Array<[string, string]> = WORKSPACE_LABEL_COLORS.map((c) => [c, labelTint[c]]);

export function SessionLabels() {
  return <HostPage body={PageBody} />;
}
function PageBody() {
  const labels = useDirectory((st) => st.labels);
  const error = useDirectory((st) => st.error);
  const loaded = useDirectory((st) => st.loaded);
  const workspaces = useDirectory((st) => st.workspaces);
  const host = useDaemon((st) => st.serverName) ?? "this host";
  const [q, setQ] = useState("");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of Object.values(workspaces))
      for (const l of w.labels ?? []) m.set(l.toLowerCase(), (m.get(l.toLowerCase()) ?? 0) + 1);
    return m;
  }, [workspaces]);
  const needle = q.trim().toLowerCase();
  const shown = labels
    .filter((l) => l.name.toLowerCase().includes(needle))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <View style={s.filter}>
        <Field value={q} onChangeText={setQ} placeholder="Search labels" grow />
      </View>
      <ErrorLine text={error} />
      {error && <Button label="Retry" onPress={loadDirectory} />}
      <Section title={`Labels on ${host}`}>
        {shown.length === 0 && (
          <Block last>
            <T style={s.muted}>
              {!loaded && "loading labels…"}
              {loaded && labels.length === 0 && "No labels yet."}
              {loaded && labels.length > 0 && "No labels match."}
            </T>
          </Block>
        )}
        {shown.map((l) => (
          <LabelRow
            key={l.name}
            label={l}
            count={counts.get(l.name.toLowerCase()) ?? 0}
            last={l.name === shown.at(-1)?.name}
          />
        ))}
      </Section>
      <Note>
        New labels are made from a session’s label menu; they appear here for every device.
      </Note>
    </>
  );
}

function LabelRow({ label, count, last }: { label: LabelDef; count: number; last: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [tone, setTone] = useState<string>(label.color);
  const act = useAction();
  const open = useCallback(() => {
    setName(label.name);
    setTone(label.color);
    setEditing(true);
  }, [label]);
  const close = useCallback(() => setEditing(false), []);
  const save = useCallback(() => {
    const next = name.trim();
    if (!next) return;
    void act
      .run("save", () =>
        need().updateWorkspaceLabel({
          name: label.name,
          ...(next === label.name ? {} : { newName: next }),
          ...(tone === label.color ? {} : { color: tone as LabelColor }),
        }),
      )
      .then((ok) => {
        if (!ok) return false;
        setEditing(false);
        void loadDirectory();
        return true;
      });
  }, [act, label, name, tone]);
  const remove = useCallback(() => {
    void act
      .run("delete", () => need().deleteWorkspaceLabel({ name: label.name }))
      .then((ok) => ok && void loadDirectory());
  }, [act, label.name]);
  const sessions = `${count} workspace${count === 1 ? "" : "s"}`;
  return (
    <View style={[s.row, !last && s.line]}>
      <View style={s.head}>
        <LabelChip
          name={editing ? name || label.name : label.name}
          tone={editing ? tone : label.color}
        />
        <T style={s.sub}>
          {label.color} · {sessions}
        </T>
        <View style={s.sp} />
        {!editing && <Button label="Edit" onPress={open} />}
        {!editing && (
          <Confirm
            label="Delete…"
            confirm={count ? `Delete from ${sessions}` : "Delete label"}
            onConfirm={remove}
            pending={act.pending === "delete"}
          />
        )}
      </View>
      <ErrorLine text={act.error} />
      {editing && (
        <View style={s.edit}>
          <Field value={name} onChangeText={setName} onSubmitEditing={save} autoFocus />
          <Swatches colors={COLORS} value={tone} onChange={setTone} />
          <View style={s.sp} />
          <Button label="Cancel" onPress={close} />
          <Button
            kind="primary"
            label={act.pending === "save" ? "Saving…" : "Save"}
            onPress={save}
            disabled={!name.trim() || !!act.pending}
          />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  muted: { color: color.muted },
  filter: { flexDirection: "row", gap: 10, marginBottom: 20 },
  row: { paddingHorizontal: 16, paddingVertical: 11, gap: 10 },
  line: { borderBottomWidth: 1, borderBottomColor: color.line },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  sub: { color: color.faint, fontSize: 12.5 },
  sp: { flex: 1 },
  edit: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
});
