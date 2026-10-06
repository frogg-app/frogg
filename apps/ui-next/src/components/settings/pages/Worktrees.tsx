import { useMemo, useState } from "react";
import { Area, Row, Section } from "../controls";
import { Block, Field } from "./kit";
import { linesOf, listOf } from "./hostkit";
import { ProjectSettings, SaveProject, type ProjectEditorProps } from "./ProjectSettings";

export function Worktrees() {
  return <ProjectSettings editor={Editor} />;
}
function Editor(props: ProjectEditorProps) {
  const w = props.config.worktree;
  const [baseBranch, setBase] = useState(w?.baseBranch ?? "");
  const [setup, setSetup] = useState(linesOf(w?.setup));
  const [teardown, setTeardown] = useState(linesOf(w?.teardown));
  const [range, setRange] = useState(w?.servicePorts?.range ?? "");
  const next = useMemo(() => {
    const changed = { ...w };
    if (baseBranch !== (w?.baseBranch ?? "")) changed.baseBranch = baseBranch.trim() || undefined;
    if (setup !== linesOf(w?.setup)) changed.setup = listOf(setup);
    if (teardown !== linesOf(w?.teardown)) changed.teardown = listOf(teardown);
    if (range !== (w?.servicePorts?.range ?? "")) {
      const ports = { ...w?.servicePorts, range: range.trim() || undefined };
      changed.servicePorts = ports.range || ports.portScript ? ports : undefined;
    }
    return { ...props.config, ...(Object.keys(changed).length ? { worktree: changed } : {}) };
  }, [props.config, w, baseBranch, setup, teardown, range]);
  return (
    <>
      <Section title="New worktrees">
        <Row label="Default base branch" hint="Blank uses the repository’s default branch">
          <Field value={baseBranch} onChangeText={setBase} placeholder="Repository default" mono />
        </Row>
        <Block>
          <Row label="Setup commands" hint="Run in the new worktree" last />
          <Area value={setup} onChange={setSetup} placeholder="npm ci" />
        </Block>
        <Block>
          <Row label="Teardown commands" last />
          <Area value={teardown} onChange={setTeardown} placeholder="One command per line" />
        </Block>
        <Row label="Port range" hint="Inclusive TCP ports for services, e.g. 5100-5199" last>
          <Field value={range} onChangeText={setRange} placeholder="5100-5199" mono />
        </Row>
      </Section>
      <SaveProject {...props} next={next} />
    </>
  );
}
