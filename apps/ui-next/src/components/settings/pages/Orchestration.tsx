import { patchHostConfig as patchConfig } from "./host-state";
import { HostPage } from "./host-state";
import { useHostRpc as useRpc } from "./host-state";
import { useHostAction as useAction } from "./host-state";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useCallback, useState } from "react";
import { useConfig } from "../../../daemon/config";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Area, Note, Row, Section, Toggle } from "../controls";
import { need } from "./hostkit";
import { Acts, Block, ErrorLine, Item, Status, useFeature } from "./kit";

const setMcp = (v: boolean) => void patchConfig({ mcp: { injectIntoAgents: v } });
const setBrowser = (v: boolean) => void patchConfig({ browserTools: { enabled: v } });
const setHooks = (v: boolean) => void patchConfig({ enableTerminalAgentHooks: v });
const loadSkills = async (c: DaemonClient) => {
  const r = await c.listSkills();
  if (r.error) throw new Error(r.error);
  return r;
};
const loadDefinitions = async (c: DaemonClient) => {
  const r = await c.listProviderAgentDefinitions();
  if (r.error) throw new Error(r.error);
  return r;
};
type Skill = Awaited<ReturnType<typeof loadSkills>>["skills"][number];

export function Orchestration() {
  return <HostPage body={PageBody} />;
}
function PageBody() {
  const cfg = useConfig((s) => s.config);
  const saving = useConfig((s) => s.saving);
  const error = useConfig((s) => s.error);
  const [prompt, setPrompt] = useState<string | null>(null);
  const draft = prompt ?? cfg?.appendSystemPrompt ?? "";
  const save = useCallback(() => {
    void patchConfig({ appendSystemPrompt: draft }).then((ok) => {
      if (ok) setPrompt(null);
      return ok;
    });
  }, [draft]);
  const revert = useCallback(() => setPrompt(null), []);
  if (!cfg) return <Note>Connect to a host to load its tools and prompts.</Note>;
  return (
    <>
      <Section title="Frogg tools for agents">
        <Row
          label="Enable Frogg tools"
          hint="Lets agents create worktrees, start agents and schedule work (MCP)"
        >
          <Toggle value={cfg.mcp.injectIntoAgents} onChange={setMcp} disabled={saving} />
        </Row>
        <Row
          label="Browser tools"
          hint="Agents can drive browser tabs. Exposes page content to the model"
        >
          <Toggle value={cfg.browserTools.enabled} onChange={setBrowser} disabled={saving} />
        </Row>
        <Row
          label="Terminal agent hooks"
          hint="Installs hooks so terminal agents report status"
          last
        >
          <Toggle value={cfg.enableTerminalAgentHooks} onChange={setHooks} disabled={saving} />
        </Row>
      </Section>
      <Section title="System prompt for every agent">
        <Block last>
          <Area
            value={draft}
            onChange={setPrompt}
            placeholder="Instructions appended to new agents on this host"
          />
          <Acts>
            <Button
              label="Save"
              kind="primary"
              onPress={save}
              disabled={saving || prompt === null}
            />
            <Button label="Revert" onPress={revert} disabled={prompt === null} />
          </Acts>
        </Block>
      </Section>
      <ErrorLine text={error} />
      <Skills />
      <Definitions />
    </>
  );
}
function Skills() {
  const supported = useFeature("skillsManagement");
  const rpc = useRpc(loadSkills, { enabled: supported === true });
  return (
    <Section title="Skills">
      {supported === false ? (
        <Block last>
          <T>Update this daemon to manage skills.</T>
        </Block>
      ) : (
        <Status rpc={rpc} what="skills">
          {rpc.data?.skills.length === 0 && (
            <Block last>
              <T>No skills found.</T>
            </Block>
          )}
          {rpc.data?.skills.map((skill) => (
            <SkillRow key={skill.id} skill={skill} reload={rpc.reload} />
          ))}
        </Status>
      )}
    </Section>
  );
}
function SkillRow({ skill, reload }: { skill: Skill; reload: () => void }) {
  const act = useAction();
  const [content, setContent] = useState<string | null>(null);
  const toggle = useCallback(
    (enabled: boolean) => {
      void act
        .run("toggle", () => need().setSkillEnabled(skill.id, enabled))
        .then((ok) => ok && reload());
    },
    [act, skill.id, reload],
  );
  const view = useCallback(() => {
    if (content !== null) {
      setContent(null);
      return;
    }
    void act.run("view", async () => {
      const r = await need().getSkillContent(skill.id);
      if (r.error) throw new Error(r.error);
      setContent(r.content);
    });
  }, [act, content, skill.id]);
  return (
    <>
      <Item title={skill.name} sub={skill.description}>
        <Button
          label={content === null ? "View" : "Hide"}
          onPress={view}
          disabled={!!act.pending}
        />
        <Toggle value={skill.enabled} onChange={toggle} disabled={!!act.pending} />
      </Item>
      <ErrorLine text={act.error} />
      {content !== null && (
        <Block>
          <T v="mono" selectable>
            {content}
          </T>
        </Block>
      )}
    </>
  );
}
function Definitions() {
  const supported = useFeature("providerAgentDefinitions");
  const rpc = useRpc(loadDefinitions, { enabled: supported === true });
  if (supported === false)
    return (
      <Section title="Agent definitions on disk">
        <Block last>
          <T>Update this daemon to list agent definitions.</T>
        </Block>
      </Section>
    );
  return (
    <Section title="Agent definitions on disk">
      <Status rpc={rpc} what="agent definitions">
        {rpc.data?.definitions.map((d) => (
          <Item
            key={`${d.provider}:${d.path}`}
            title={d.name}
            sub={`${d.provider} · ${d.path}`}
            subMono
          />
        ))}
        {rpc.data?.definitions.length === 0 && (
          <Block last>
            <T>No user-level agent definitions found.</T>
          </Block>
        )}
      </Status>
    </Section>
  );
}
