import { FroggConfigRawSchema, type FroggConfigRaw } from "@frogg/protocol/frogg-config-schema";
import { useCallback, useState, type ComponentType } from "react";
import { useDaemon } from "../../../daemon/store";
import { useDirectory } from "../../sessions/directory";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Note } from "../controls";
import { ProjectPicker, useProjectConfig, useProjects, type ProjectConfig } from "./hostkit";
import { Acts, ErrorLine } from "./kit";

export interface ProjectEditorProps {
  config: FroggConfigRaw;
  save: ProjectConfig["save"];
  saving: boolean;
}

/** Each editor is tied to one host and project; drafts never cross that boundary. */
export function ProjectSettings({ editor: Editor }: { editor: ComponentType<ProjectEditorProps> }) {
  const { projects, current, pick } = useProjects();
  const url = useDaemon((s) => s.url);
  const conn = useDaemon((s) => s.conn);
  const loaded = useDirectory((s) => s.loaded);
  const error = useDirectory((s) => s.error);
  if (conn !== "online") return <Note>Host offline. Connect to load its projects.</Note>;
  if (error) return <ErrorLine text={error} />;
  if (!loaded) return <Note>Loading projects…</Note>;
  return (
    <>
      <ProjectPicker projects={projects} current={current} onPick={pick} />
      {current ? (
        <ProjectBody key={`${url}:${current.root}`} root={current.root} editor={Editor} />
      ) : (
        <Note>No Git projects on this host. Add a project to configure its frogg.json.</Note>
      )}
    </>
  );
}

function ProjectBody({
  root,
  editor: Editor,
}: {
  root: string;
  editor: ComponentType<ProjectEditorProps>;
}) {
  const rpc = useProjectConfig(root);
  const conn = useDaemon((s) => s.conn);
  let body = (
    <T v="label">{rpc.loading ? "Loading configuration…" : "Configuration unavailable"}</T>
  );
  if (conn !== "online") body = <T v="label">Host offline</T>;
  else if (rpc.config) body = <Editor config={rpc.config} save={rpc.save} saving={rpc.saving} />;
  return (
    <>
      <Note>{root}/frogg.json · Changes edit this project’s configuration file.</Note>
      <ErrorLine text={rpc.error} />
      {rpc.error && <Button label="Reload configuration" onPress={rpc.reload} />}
      {body}
    </>
  );
}

export function SaveProject({
  config,
  next,
  save,
  saving,
  error,
}: ProjectEditorProps & { next: FroggConfigRaw; error?: string | null }) {
  const [saved, setSaved] = useState(false);
  const validation = FroggConfigRawSchema.safeParse(next);
  const problem = error ?? (!validation.success ? validation.error.issues[0]?.message : null);
  const dirty = JSON.stringify(config) !== JSON.stringify(next);
  const submit = useCallback(() => {
    void save(() => next).then(setSaved);
  }, [save, next]);
  return (
    <>
      <ErrorLine text={problem ?? null} />
      <Acts>
        <Button
          label={saving ? "Saving…" : "Save changes"}
          kind="primary"
          onPress={submit}
          disabled={saving || !!problem || !dirty}
        />
        {saved && !dirty && <T v="label">Saved</T>}
      </Acts>
    </>
  );
}
