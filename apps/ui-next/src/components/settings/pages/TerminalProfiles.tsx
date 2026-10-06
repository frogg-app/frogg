import { patchHostConfig as patchConfig } from "./host-state";
import { HostPage } from "./host-state";
import type { TerminalProfile } from "@frogg/protocol/messages";
import { SquareTerminal } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useConfig } from "../../../daemon/config";
import { color } from "../../../theme/tokens";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Lede, Section } from "../controls";
import { Acts, Block, Confirm, Field, Item } from "./kit";

interface Draft {
  name: string;
  command: string;
  args: string;
}

const EMPTY: Draft = { name: "", command: "", args: "" };

/** JSON preserves quotes, empty arguments and backslashes without invoking a shell. */
function splitArgs(text: string): string[] | null {
  try {
    const value: unknown = JSON.parse(text || "[]");
    return Array.isArray(value) && value.every((a) => typeof a === "string") ? value : null;
  } catch {
    return null;
  }
}
const joinArgs = (args: string[] | undefined) => JSON.stringify(args ?? []);
function save(list: TerminalProfile[]) {
  return patchConfig({ terminalProfiles: list });
}

export function TerminalProfiles() {
  return <HostPage body={PageBody} />;
}
function PageBody() {
  const cfg = useConfig((st) => st.config);
  const [adding, setAdding] = useState(false);
  const startAdd = useCallback(() => setAdding(true), []);
  const stopAdd = useCallback(() => setAdding(false), []);
  const add = useCallback((d: Draft) => {
    const id = `${d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
    const prev = useConfig.getState().config?.terminalProfiles ?? [];
    void save([
      ...prev,
      { id, name: d.name, command: d.command, args: splitArgs(d.args) ?? [] },
    ]).then((ok) => {
      if (ok) setAdding(false);
      return ok;
    });
  }, []);
  if (!cfg) return <T v="label">loading…</T>;
  const list = cfg.terminalProfiles ?? [];
  return (
    <>
      <Lede>
        Profiles appear in the terminal’s new-tab menu on every device connected to this host.
      </Lede>
      <Section title="Profiles">
        {list.length === 0 && !adding && (
          <Block>
            <T style={s.muted}>No profiles yet. New terminals open the host’s login shell.</T>
          </Block>
        )}
        {list.map((p) => (
          <ProfileRow key={p.id} profile={p} list={list} />
        ))}
        {adding ? (
          <Editor initial={EMPTY} onSave={add} onCancel={stopAdd} />
        ) : (
          <Block last>
            <Acts>
              <Button label="Add profile" onPress={startAdd} />
            </Acts>
          </Block>
        )}
      </Section>
    </>
  );
}

function ProfileRow({ profile, list }: { profile: TerminalProfile; list: TerminalProfile[] }) {
  const [editing, setEditing] = useState(false);
  const open = useCallback(() => setEditing(true), []);
  const close = useCallback(() => setEditing(false), []);
  const remove = useCallback(
    () => save(list.filter((p) => p.id !== profile.id)),
    [list, profile.id],
  );
  const update = useCallback(
    (d: Draft) => {
      void save(
        list.map((p) =>
          p.id === profile.id
            ? { ...p, name: d.name, command: d.command, args: splitArgs(d.args) ?? [] }
            : p,
        ),
      ).then((ok) => {
        if (ok) setEditing(false);
        return ok;
      });
    },
    [list, profile.id],
  );
  const initial = useMemo(
    () => ({ name: profile.name, command: profile.command, args: joinArgs(profile.args) }),
    [profile],
  );
  if (editing) return <Editor initial={initial} onSave={update} onCancel={close} />;
  return (
    <Item
      icon={SquareTerminal}
      title={profile.name}
      sub={`${profile.command} ${joinArgs(profile.args)}`.trim()}
      subMono
    >
      <Button label="Edit" onPress={open} />
      <Confirm label="Remove…" confirm="Remove profile" onConfirm={remove} />
    </Item>
  );
}

function Editor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Draft;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [command, setCommand] = useState(initial.command);
  const [args, setArgs] = useState(initial.args);
  const saving = useConfig((st) => st.saving);
  const parsed = splitArgs(args);
  const ok = name.trim() && command.trim() && parsed !== null && !saving;
  const submit = useCallback(() => {
    if (ok) onSave({ name: name.trim(), command: command.trim(), args });
  }, [ok, onSave, name, command, args]);
  return (
    <Block>
      <View style={s.fields}>
        <Field value={name} onChangeText={setName} placeholder="Name" autoFocus />
        <Field
          value={command}
          onChangeText={setCommand}
          placeholder="Command, e.g. /bin/zsh"
          mono
        />
        <Field
          value={args}
          onChangeText={setArgs}
          onSubmitEditing={submit}
          placeholder='Arguments as JSON, e.g. ["-l"]'
          mono
          grow
        />
      </View>
      {parsed === null && <T>Enter a JSON array of argument strings.</T>}
      <Acts>
        <Button label="Cancel" onPress={onCancel} />
        <Button kind="primary" label="Save" onPress={submit} disabled={!ok} />
      </Acts>
    </Block>
  );
}

const s = StyleSheet.create({
  muted: { color: color.muted },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
