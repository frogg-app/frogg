import type { FroggScriptEntryRaw } from "@frogg/protocol/frogg-config-schema";
import { useCallback, useMemo, useState } from "react";
import { Button } from "../../Button";
import { Area, Note, Row, Section, Toggle } from "../controls";
import { Acts, Block, Confirm, ErrorLine, Field } from "./kit";
import { ProjectSettings, SaveProject, type ProjectEditorProps } from "./ProjectSettings";

export function Scripts() {
  return <ProjectSettings editor={Editor} />;
}
function Editor(props: ProjectEditorProps) {
  const [scripts, setScripts] = useState(props.config.scripts ?? {});
  const [name, setName] = useState("");
  const update = useCallback((key: string, value: FroggScriptEntryRaw | null) => {
    setScripts((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }, []);
  const add = useCallback(() => {
    const key = name.trim();
    if (!key || Object.hasOwn(scripts, key)) return;
    setScripts((prev) => ({ ...prev, [key]: { command: "", type: undefined } }));
    setName("");
  }, [name, scripts]);
  const duplicate = !!name.trim() && Object.hasOwn(scripts, name.trim());
  const next = useMemo(() => ({ ...props.config, scripts }), [props.config, scripts]);
  const invalid = Object.values(scripts).some(
    (v) => typeof v.command !== "string" || !v.command.trim(),
  );
  return (
    <>
      <Section title="Scripts">
        {Object.entries(scripts).map(([key, script]) => (
          <ScriptRow key={key} name={key} script={script} onChange={update} />
        ))}
        <Block last>
          <Acts>
            <Field value={name} onChangeText={setName} placeholder="New script name" />
            <Button label="Add script" onPress={add} disabled={!name.trim() || duplicate} />
          </Acts>
          <ErrorLine text={duplicate ? "A script with this name already exists." : null} />
        </Block>
      </Section>
      <Section title="Service URLs">
        <Row
          label="Port allocation"
          hint="Service scripts receive $FROGG_PORT. Configure the allocation range in Worktrees."
          last
        />
      </Section>
      <Note>Saving changes configuration only. Run scripts from the Scripts tool.</Note>
      <SaveProject
        {...props}
        next={next}
        error={invalid ? "Every script needs a command." : null}
      />
    </>
  );
}
function ScriptRow({
  name,
  script,
  onChange,
}: {
  name: string;
  script: FroggScriptEntryRaw;
  onChange: (name: string, script: FroggScriptEntryRaw | null) => void;
}) {
  const command = useCallback(
    (v: string) => onChange(name, { ...script, command: v }),
    [name, script, onChange],
  );
  const service = useCallback(
    (v: boolean) => onChange(name, { ...script, type: v ? "service" : undefined }),
    [name, script, onChange],
  );
  const remove = useCallback(() => onChange(name, null), [name, onChange]);
  return (
    <Block>
      <Row label={name} hint={script.type === "service" ? "Service · $FROGG_PORT" : "Command"} last>
        <Confirm label="Remove…" confirm="Remove script" onConfirm={remove} />
      </Row>
      <Area
        value={typeof script.command === "string" ? script.command : ""}
        onChange={command}
        placeholder="Command"
      />
      <Row label="Service" hint="Keep running and expose a port" last>
        <Toggle value={script.type === "service"} onChange={service} />
      </Row>
    </Block>
  );
}
