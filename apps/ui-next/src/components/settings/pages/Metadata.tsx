import { useMemo, useState } from "react";
import { Area, Row, Section } from "../controls";
import { Block } from "./kit";
import { ProjectSettings, SaveProject, type ProjectEditorProps } from "./ProjectSettings";

export function Metadata() {
  return <ProjectSettings editor={Editor} />;
}
function Editor(props: ProjectEditorProps) {
  const m = props.config.metadataGeneration;
  const [branch, setBranch] = useState(m?.branchName?.instructions ?? "");
  const [commit, setCommit] = useState(m?.commitMessage?.instructions ?? "");
  const [pr, setPr] = useState(m?.pullRequest?.instructions ?? "");
  const next = useMemo(() => {
    const metadata = { ...m };
    if (branch !== (m?.branchName?.instructions ?? ""))
      metadata.branchName = { ...m?.branchName, instructions: branch };
    if (commit !== (m?.commitMessage?.instructions ?? ""))
      metadata.commitMessage = { ...m?.commitMessage, instructions: commit };
    if (pr !== (m?.pullRequest?.instructions ?? ""))
      metadata.pullRequest = { ...m?.pullRequest, instructions: pr };
    return {
      ...props.config,
      ...(Object.keys(metadata).length ? { metadataGeneration: metadata } : {}),
    };
  }, [props.config, m, branch, commit, pr]);
  return (
    <>
      <Section title="Instructions for generated text">
        <Block>
          <Row label="Branch names" last />
          <Area
            value={branch}
            onChange={setBranch}
            placeholder="type/short-slug, e.g. feat/session-store"
          />
        </Block>
        <Block>
          <Row label="Commit messages" last />
          <Area
            value={commit}
            onChange={setCommit}
            placeholder="Conventional commits. Imperative, ≤ 72 characters."
          />
        </Block>
        <Block last>
          <Row label="Pull requests" last />
          <Area value={pr} onChange={setPr} placeholder="Summary, Why, Testing." />
        </Block>
      </Section>
      <SaveProject {...props} next={next} />
    </>
  );
}
