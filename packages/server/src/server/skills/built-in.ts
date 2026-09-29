// Skills the daemon offers every agent it starts. They are written under FROGG_HOME, never into
// a provider's own skill folders, and handed to each launch: Claude gets them as a local plugin
// (so they appear as `<brand>:<name>`), Codex as an extra skill root (`<brand>-<name>`).
// Agents only see each skill's description until they decide to load it.
import { promises as fs } from "node:fs";
import path from "node:path";

export interface BuiltInSkillBrand {
  id: string;
  fullName: string;
  cliName: string;
  envPrefix: string;
  docsUrl: string;
}

export interface BuiltInSkill {
  /** Short, brand-free name: `delegate`, `project-config`. */
  name: string;
  description: string;
  body: string;
}

function renderTemplate(template: string, brand: BuiltInSkillBrand): string {
  return template
    .replaceAll("{{product}}", brand.fullName)
    .replaceAll("{{cli}}", brand.cliName)
    .replaceAll("{{env}}", brand.envPrefix)
    .replaceAll("{{docs}}", brand.docsUrl.replace(/\/+$/, ""));
}

const DELEGATE: BuiltInSkill = {
  name: "delegate",
  description:
    "Split a task across parallel {{product}} agents, each in its own worktree, then review and bring the results back. Use when work has independent parts (separate features, a fix plus its tests, several files that do not touch), when the user asks to parallelise, fan out, or run agents in the background, or when a long job should not block this conversation.",
  body: `# Delegate work to parallel agents

You are running inside {{product}}, which gives you tools to create and manage other agents
(\`create_agent\`, \`create_workspace\`, \`send_agent_prompt\`, \`get_agent_status\`,
\`get_agent_activity\`, \`list_agents\`, \`archive_agent\`). If those tools are not available,
the same operations exist on the \`{{cli}}\` CLI (\`{{cli}} agent run --help\`).

## Decide whether to delegate

Delegate only parts that are **independent**: they touch different files or can be merged in
any order. Keep in this conversation anything that needs the user's judgement, and any part the
others depend on. Two to four agents is the useful range; more mostly produces merge work.

## Brief each agent

Each agent starts with none of your context. Its prompt must stand alone:

- the goal and the definition of done (tests to pass, behaviour to show)
- the files and entry points you already found, so it does not re-derive them
- constraints: what not to touch, conventions, commands that verify the work
- what to report back: a short summary, the branch, anything left undone

## Isolate

Give every agent that edits code its own worktree workspace (\`create_workspace\` with
worktree isolation, or \`{{cli}} agent run --new-workspace worktree\`). Agents sharing a checkout
overwrite each other. Read-only research can share the current workspace.

The project's \`frogg.json\` \`worktree.setup\` runs in each new worktree; if a worktree comes up
without dependencies installed, see the \`project-config\` skill.

## Monitor without blocking

Start the agents, tell the user what is running, and keep working. Check in with
\`get_agent_status\` / \`get_agent_activity\` rather than waiting on one agent at a time. An agent
waiting on a permission shows up in \`list_pending_permissions\`; surface it to the user instead
of approving on their behalf.

## Bring it back

For each finished agent: read its summary, review its diff, run the verification it claimed.
Merge or cherry-pick the branches in dependency order, resolve conflicts here, and run the
checks once more on the combined result. Archive agents and workspaces you are done with.

Report to the user per agent: what it did, whether it verified, what is left.

More: {{docs}}/using-frogg/agents/
`,
};

const PROJECT_CONFIG: BuiltInSkill = {
  name: "project-config",
  description:
    "Write or fix a repository's frogg.json so {{product}} worktrees set themselves up and dev servers run as workspace scripts with their own ports. Use when asked to set up a project for {{product}}, when new worktrees lack dependencies or env files, when adding a run/dev/test script or service, when services collide on ports, or when editing frogg.json.",
  body: `# Configure a project with frogg.json

\`frogg.json\` sits in the repository root (same file name in every brand). {{product}} reads it
when it creates a worktree and when workspace scripts run. Invalid entries are skipped rather
than failing, so always verify after editing (last section).

Full reference: {{docs}}/reference/project-config/

## 1. Read the repository first

Find how the project installs, builds and runs: package manager lockfile, \`Makefile\`,
\`docker-compose.yml\`, \`README\`, existing dev scripts, \`.env.example\`. Note which files a
fresh checkout is missing (\`.env\`, local config, generated code) and which commands start
long-running servers.

## 2. Worktree setup and teardown

\`worktree.setup\` runs in order, in the background, in every new worktree. Make it produce a
worktree that is ready to work in:

\`\`\`json
{
  "worktree": {
    "setup": ["npm ci", "cp \\"\${{env}}_SOURCE_CHECKOUT_PATH/.env\\" .env"],
    "teardown": "docker compose down"
  }
}
\`\`\`

Available to setup and teardown: \`{{env}}_SOURCE_CHECKOUT_PATH\` (the checkout the worktree came
from), \`{{env}}_WORKTREE_PATH\`, \`{{env}}_BRANCH_NAME\`, \`{{env}}_WORKTREE_PORT\`.

- Copy untracked essentials (env files, local certs) from the source checkout; never commit
  secrets into \`frogg.json\`.
- Use the lockfile-exact install (\`npm ci\`, \`pnpm install --frozen-lockfile\`, \`uv sync\`).
- Keep setup idempotent; it may run in a worktree that already has some state.

## 3. Scripts and services

Each entry under \`scripts\` is a command run in the workspace. Add \`"type": "service"\` for
anything long-running that listens on a port:

\`\`\`json
{
  "scripts": {
    "api": { "type": "service", "command": "npm run dev -- --port \${{env}}_PORT" },
    "web": { "type": "service", "command": "API_URL=\${{env}}_SERVICE_API_URL npm run web" },
    "test": { "command": "npm test" }
  }
}
\`\`\`

- A service gets \`{{env}}_PORT\` and \`{{env}}_URL\`, plus \`{{env}}_SERVICE_<NAME>_PORT\` / \`_URL\`
  for every service in the workspace. Bind to \`\${{env}}_PORT\`, never a hard-coded port, so
  several worktrees can run side by side.
- Wire services to each other through \`{{env}}_SERVICE_<NAME>_URL\` (\`api\` →
  \`{{env}}_SERVICE_API_URL\`).
- Only use a fixed \`port\` when something outside {{product}} requires it; two services with the
  same fixed port are an error.
- For a port range per project: \`"worktree": { "servicePorts": { "range": "4100-4199" } }\`.

## 4. Verify

\`\`\`sh
{{cli}} script ls              # every script you added is listed
{{cli}} script start <name>    # a service comes up on its assigned port
{{cli}} script stop <name>
\`\`\`

A missing script means its entry was invalid. To check setup, create a throwaway worktree
workspace and confirm it comes up ready, then archive it.
`,
};

export const BUILT_IN_SKILLS: readonly BuiltInSkill[] = [DELEGATE, PROJECT_CONFIG];

export interface RenderedBuiltInSkill {
  name: string;
  description: string;
  claudeName: string;
  codexName: string;
  /** SKILL.md given to Claude inside the plugin. */
  claudePath: string;
  /** SKILL.md under the Codex extra root. */
  codexPath: string;
}

export interface RenderedBuiltInSkills {
  claudePluginDir: string;
  codexRoot: string;
  skills: RenderedBuiltInSkill[];
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function skillFile(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${quoteYaml(description)}\n---\n\n${body}`;
}

/**
 * Writes the built-in skills for this brand under `root`, replacing whatever an older daemon
 * wrote there. The directory is the daemon's own; nothing else should be kept in it.
 */
export async function renderBuiltInSkills(
  root: string,
  brand: BuiltInSkillBrand,
  skills: readonly BuiltInSkill[] = BUILT_IN_SKILLS,
): Promise<RenderedBuiltInSkills> {
  const claudePluginDir = path.join(root, "claude-plugin");
  const codexRoot = path.join(root, "codex");
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(path.join(claudePluginDir, ".claude-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(claudePluginDir, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(
      {
        name: brand.id,
        version: "1.0.0",
        description: `Skills built into ${brand.fullName}.`,
      },
      null,
      2,
    )}\n`,
  );
  const rendered: RenderedBuiltInSkill[] = [];
  for (const skill of skills) {
    const description = renderTemplate(skill.description, brand);
    const body = renderTemplate(skill.body, brand);
    const codexName = `${brand.id}-${skill.name}`;
    const claudePath = path.join(claudePluginDir, "skills", skill.name, "SKILL.md");
    const codexPath = path.join(codexRoot, codexName, "SKILL.md");
    await fs.mkdir(path.dirname(claudePath), { recursive: true });
    await fs.mkdir(path.dirname(codexPath), { recursive: true });
    await fs.writeFile(claudePath, skillFile(skill.name, description, body));
    await fs.writeFile(codexPath, skillFile(codexName, description, body));
    rendered.push({
      name: skill.name,
      description,
      claudeName: `${brand.id}:${skill.name}`,
      codexName,
      claudePath,
      codexPath,
    });
  }
  return { claudePluginDir, codexRoot, skills: rendered };
}
