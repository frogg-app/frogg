import { useMemo, useState } from "react";
import { Row, Section, Toggle } from "../controls";
import { Field } from "./kit";
import { ProjectSettings, SaveProject, type ProjectEditorProps } from "./ProjectSettings";

export function Ci() {
  return <ProjectSettings editor={Editor} />;
}
function Editor(props: ProjectEditorProps) {
  const { ci, streams } = props.config;
  const [github, setGithub] = useState(ci?.githubActions ?? true);
  const [url, setUrl] = useState(ci?.jenkins?.url ?? "");
  const [job, setJob] = useState(ci?.jenkins?.job ?? "");
  const [multi, setMulti] = useState(ci?.jenkins?.multibranch ?? true);
  const [dev, setDev] = useState(streams?.development ?? "main");
  const [stable, setStable] = useState(streams?.stable ?? "stable");
  const [remote, setRemote] = useState(streams?.upstream?.remote ?? "");
  const next = useMemo(
    () => ({
      ...props.config,
      ci: {
        ...ci,
        githubActions: github,
        jenkins: url.trim()
          ? { ...ci?.jenkins, url: url.trim(), job: job.trim(), multibranch: multi }
          : undefined,
      },
      streams: {
        ...streams,
        development: dev.trim(),
        stable: stable.trim(),
        upstream:
          remote.trim() || streams?.upstream
            ? { ...streams?.upstream, remote: remote.trim() || undefined }
            : undefined,
      },
    }),
    [props.config, ci, streams, github, url, job, multi, dev, stable, remote],
  );
  let error: string | null = null;
  if (url && (!/^https?:\/\//.test(url.trim()) || !job.trim()))
    error = "Enter an HTTP(S) Jenkins URL and a job path.";
  if (!dev.trim() || !stable.trim()) error = "Both release branch names are required.";
  return (
    <>
      <Section title="CI">
        <Row label="GitHub Actions" hint="Read through gh for GitHub repositories">
          <Toggle value={github} onChange={setGithub} />
        </Row>
        <Row
          label="Jenkins URL"
          hint="Blank disables Jenkins. Credentials stay in the daemon environment."
        >
          <Field value={url} onChangeText={setUrl} placeholder="https://jenkins.example.com" mono />
        </Row>
        <Row label="Jenkins job">
          <Field value={job} onChangeText={setJob} placeholder="team/job" mono />
        </Row>
        <Row label="Multibranch" last>
          <Toggle value={multi} onChange={setMulti} disabled={!url} />
        </Row>
      </Section>
      <Section title="Release streams · developer">
        <Row label="Development branch" hint="Cuts beta releases">
          <Field value={dev} onChangeText={setDev} mono />
        </Row>
        <Row label="Stable branch">
          <Field value={stable} onChangeText={setStable} mono />
        </Row>
        <Row label="Upstream remote" hint="Optional, for forks" last>
          <Field value={remote} onChangeText={setRemote} placeholder="upstream" mono />
        </Row>
      </Section>
      <SaveProject {...props} next={next} error={error} />
    </>
  );
}
