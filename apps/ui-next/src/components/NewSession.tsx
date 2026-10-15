import { KeyboardFrame } from "./shell/KeyboardFrame";
import { exitPointer, riseStyle, scrimStyle, sheetStyle, usePresence } from "./presence";
import { FileText, GitBranch, Image as ImageIcon, Paperclip, X } from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { loadConfig, useConfig } from "../daemon/config";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useHosts } from "../daemon/hosts";
import {
  connect,
  getHostClient,
  useDaemon,
  useFleet,
  useHostConn,
  type Project,
} from "../daemon/store";
import { useFormFactor } from "../theme/layout";
import { color, font, overlayMs, web } from "../theme/tokens";
import { useUi } from "../ui-store";
import { providerLabel } from "../util";
import { Button } from "./Button";
import { Cut } from "./Cut";
import { Seg } from "./settings/controls";
import { Select } from "./Select";
import { canPickFiles, pickFiles } from "./chat/pickFiles";
import {
  isImage,
  loadBranches,
  prepareDrafts,
  toDraft,
  type BranchOption,
  type Draft,
  type HostProviders,
} from "./sessions/create";
import { addProject, baseName } from "./sessions/directory";
import { isLocalProject, useVisibleProjects } from "./sessions/localProjects";
import { LaunchFields, useLaunch, type Launch, type LaunchInput } from "./sessions/LaunchFields";
import { FolderBrowser } from "./sessions/sheets";
import { useModalLayer } from "./shell/modalStack";
import { T } from "./Text";

type Isolation = "worktree" | "local";
const NO_PROJECTS: Project[] = [];

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 5)
    .join("-") || "session";

const ISOLATION_OPTIONS: Array<[Isolation, string]> = [
  ["worktree", "New worktree"],
  ["local", "Local checkout"],
];

function footText(
  worktree: boolean,
  branch: string,
  base: string,
  project: Project | undefined,
): string {
  if (worktree) return `worktree · ${branch} from ${base}`;
  return project ? `in ${project.projectRootPath}` : "";
}

interface Opt {
  value: string;
  label: string;
  hint?: string;
}
function AgentFields({
  phone,
  loaded,
  provider,
  setProvider,
  providerOptions,
  model,
  setModel,
  modelOptions,
  mode,
  setMode,
  modeOptions,
}: {
  phone: boolean;
  loaded: boolean;
  provider: string | null;
  setProvider: (v: string) => void;
  providerOptions: Opt[];
  model: string | null;
  setModel: (v: string) => void;
  modelOptions: Opt[];
  mode: string | null;
  setMode: (v: string) => void;
  modeOptions: Opt[];
}) {
  return phone ? (
    <>
      <Field label="Agent" phone>
        <Select
          width="100%"
          label="Agent"
          placeholder={loaded ? "No ready agents" : "Loading agents…"}
          value={provider}
          onChange={setProvider}
          options={providerOptions}
        />
      </Field>
      {modelOptions.length > 0 && (
        <Field label="Model" phone>
          <Select
            width="100%"
            label="Model"
            mono
            value={model}
            onChange={setModel}
            options={modelOptions}
          />
        </Field>
      )}
      {modeOptions.length > 0 && (
        <Field label="Mode" phone>
          <Select width="100%" label="Mode" value={mode} onChange={setMode} options={modeOptions} />
        </Field>
      )}
    </>
  ) : (
    <Field label="Agent" z={4}>
      <View style={s.agentRow}>
        <Select width={150} value={provider} onChange={setProvider} options={providerOptions} />
        <Select width={170} mono value={model} onChange={setModel} options={modelOptions} />
        {modeOptions.length > 0 && (
          <Select width={150} value={mode} onChange={setMode} options={modeOptions} />
        )}
      </View>
    </Field>
  );
}

type Kind = "agent" | "terminal";
const KIND_OPTIONS: Array<[Kind, string]> = [
  ["agent", "Agent"],
  ["terminal", "Terminal"],
];

function connHint(conn: string | null | undefined): string {
  if (conn === "online") return "connected";
  if (conn === "connecting") return "connecting…";
  return "offline";
}

/** Every saved host and its link state, for the host picker. */
function useHostOptions() {
  const hosts = useHosts((st) => st.hosts);
  const activeId = useHosts((st) => st.activeId);
  const fleet = useFleet((st) => st.conn);
  const own = useDaemon((st) => st.conn);
  return useMemo(
    () =>
      hosts.map((h) => {
        const conn = h.id === activeId ? own : fleet[h.id];
        return {
          value: h.id,
          label: h.name,
          hint: `${h.endpoint} · ${connHint(conn)}`,
          disabled: conn !== "online",
        };
      }),
    [hosts, activeId, fleet, own],
  );
}

/** The chosen host's ready providers: the shell's snapshot for the active host, else its own. */
function useHostProviders(hostId: string | null, active: boolean, open: boolean) {
  const shared = useConfig((st) => st.providers);
  const [own, setOwn] = useState<HostProviders | null>(null);
  useEffect(() => {
    setOwn(null);
    if (!open || active) {
      if (open && !shared) void loadConfig();
      return;
    }
    const c = getHostClient(hostId);
    if (!c) return;
    let live = true;
    c.getProvidersSnapshot()
      .then((p) => live && setOwn(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hostId, active, open, shared]);
  return active ? shared : own;
}

/** The chosen host's projects; switching hosts starts the pick over. */
function useHostProjects(
  open: boolean,
  hostId: string | null,
  hostConn: string | null,
  setError: (e: string | null) => void,
  setBrowsing: (b: boolean) => void,
) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setProjects(null);
    setProjectId(null);
    setBrowsing(false);
    const c = getHostClient(hostId);
    if (!c || hostConn !== "online") return;
    let live = true;
    const read = async () => {
      const r = await c.listProjects();
      if (!live) return;
      // The sheet picks the first project of this device's list (pinned first) once merged.
      setProjects(r.projects);
    };
    read().catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [open, hostId, hostConn, setError, setBrowsing]);
  return { projects, setProjects, projectId, setProjectId };
}

/** Start from: every local and published branch of the picked checkout. */
function useBranches(
  open: boolean,
  hostId: string | null,
  root: string | undefined,
  setBase: (fn: (b: string) => string) => void,
): BranchOption[] | null {
  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  useEffect(() => {
    setBranches(null);
    const c = getHostClient(hostId);
    if (!open || !c || !root) return;
    let live = true;
    const read = async () => {
      const list = await loadBranches(c, root);
      if (!live) return;
      setBranches(list);
      const first = list[0]?.value;
      setBase((b) => (list.some((x) => x.value === b) || !first ? b : first));
    };
    read().catch(() => live && setBranches([]));
    return () => {
      live = false;
    };
  }, [open, hostId, root, setBase]);
  return branches;
}

/** Provider, model and mode, kept valid as the host's ready providers change. */
function useAgentChoice(providers: HostProviders | null) {
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const ready = useMemo(
    () => providers?.entries.filter((p) => p.status === "ready" && p.enabled) ?? [],
    [providers],
  );
  const entry = ready.find((p) => p.provider === provider) ?? ready[0];
  useEffect(() => {
    if (!entry) return;
    setProvider(entry.provider);
    setModel((m) =>
      entry.models?.some((x) => x.id === m)
        ? m
        : ((entry.models?.find((x) => x.isDefault) ?? entry.models?.[0])?.id ?? null),
    );
    setMode((m) =>
      entry.modes?.some((x) => x.id === m)
        ? m
        : (entry.defaultModeId ?? entry.modes?.[0]?.id ?? null),
    );
  }, [entry]);
  return { ready, entry, setProvider, model, setModel, mode, setMode };
}

/** Makes `hostId` the active host when it is not already (a no-op for the active one). */
async function focusHost(hostId: string | null): Promise<void> {
  const st = useHosts.getState();
  const target = st.hosts.find((h) => h.id === hostId);
  if (target && target.id !== st.activeId) await connect(target);
}

async function startTerminal(
  c: DaemonClient,
  hostId: string | null,
  cwd: string,
  name?: string,
): Promise<void> {
  const res = await c.createTerminal(cwd, name);
  if (res.error || !res.terminal) throw new Error(res.error ?? "Could not start a terminal");
  await focusHost(hostId);
  useUi.getState().setTool("terminals");
  useUi.getState().openTerminal(res.terminal.id);
}

async function startAgent(
  c: DaemonClient,
  hostId: string | null,
  input: {
    provider: string;
    cwd: string;
    model?: string;
    modeId?: string;
    title?: string;
    initialPrompt: string;
    drafts: Draft[];
    worktree?: { mode: "branch-off"; newBranch: string; base?: string };
  } & LaunchInput,
): Promise<void> {
  const { drafts, provider, ...rest } = input;
  const { images, attachments } = await prepareDrafts(c, drafts);
  const agent = await c.createAgent({
    ...rest,
    provider: provider as never,
    images,
    attachments,
  });
  await focusHost(hostId);
  useDaemon.setState((st) => ({
    sessions: {
      ...st.sessions,
      [agent.id]: { agent, project: st.sessions[agent.id]?.project ?? null },
    },
  }));
  useUi.getState().setTool("sessions");
  useUi.getState().select(agent.id);
}

type Entry = NonNullable<ReturnType<typeof useAgentChoice>["entry"]>;

/** Creates the session (or terminal) on the chosen host from the sheet's current fields. */
function useSubmit(f: {
  hostId: string | null;
  kind: Kind;
  project: Project | undefined;
  entry: Entry | undefined;
  prompt: string;
  drafts: Draft[];
  model: string | null;
  mode: string | null;
  title: string;
  worktree: { newBranch: string; base: string } | null;
  launch: LaunchInput;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}) {
  const ref = useRef(f);
  ref.current = f;
  return useCallback(async () => {
    const { hostId, kind, project, entry, prompt, title, setBusy, setError } = ref.current;
    const c = getHostClient(hostId);
    if (!c || !project) return;
    if (kind === "agent" && (!entry || !prompt.trim())) return;
    setBusy(true);
    setError(null);
    try {
      const cwd = project.projectRootPath;
      const name = title.trim() || undefined;
      if (kind === "terminal") await startTerminal(c, hostId, cwd, name);
      else if (entry) {
        // Agents run in daemon projects: a folder only this device lists is registered first.
        if (isLocalProject(project)) await c.addProject(cwd);
        await startAgent(c, hostId, agentInput(ref.current, entry, cwd, name));
      }
      ref.current.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
}

function agentInput(
  f: Parameters<typeof useSubmit>[0],
  entry: Entry,
  cwd: string,
  title: string | undefined,
): Parameters<typeof startAgent>[2] {
  return {
    provider: entry.provider,
    cwd,
    model: f.model ?? undefined,
    modeId: f.mode ?? undefined,
    title,
    initialPrompt: f.prompt.trim(),
    drafts: f.drafts,
    worktree: f.worktree ? { mode: "branch-off", ...f.worktree } : undefined,
    ...f.launch,
  };
}

/** Each opening starts on the active host and takes any prompt handed to the sheet. */
function useOnOpen(
  open: boolean,
  setHostId: (id: string | null) => void,
  setPrompt: (p: string) => void,
): void {
  useEffect(() => {
    if (!open) return;
    setHostId(useHosts.getState().activeId);
    const seed = useUi.getState().newSessionPrompt;
    if (seed) {
      setPrompt(seed);
      useUi.setState({ newSessionPrompt: "" });
    }
  }, [open, setHostId, setPrompt]);
}

/** Files picked for the first prompt; they are sent once the session exists. */
function useDrafts(setError: (e: string | null) => void) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const attachFiles = useCallback(() => {
    pickFiles({ images: false })
      .then((picked) => {
        if (picked.length) setDrafts((d) => [...d, ...picked.map(toDraft)]);
        return undefined;
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [setError]);
  const dropDraft = useCallback((id: string) => setDrafts((d) => d.filter((x) => x.id !== id)), []);
  return { drafts, setDrafts, attachFiles, dropDraft };
}

type HostOption = ReturnType<typeof useHostOptions>[number];

interface SheetFieldsProps {
  agentKind: boolean;
  attachFiles: () => void;
  base: string;
  branchOptions: BranchOption[];
  branches: BranchOption[] | null;
  browse: () => void;
  browsing: boolean;
  drafts: Draft[];
  dropDraft: (id: string) => void;
  entry: Entry | undefined;
  error: string | null;
  folderAdded: (p: Project[], path: string) => void;
  hostConn: string | null;
  hostId: string | null;
  hostName: string | undefined;
  hostOptions: HostOption[];
  isGit: boolean;
  isolation: Isolation;
  kind: Kind;
  launch: Launch["fields"];
  mode: string | null;
  modeOptions: Opt[];
  model: string | null;
  modelOptions: Opt[];
  phone: boolean;
  project: Project | undefined;
  projectId: string | null;
  projectOptions: Opt[];
  projectPaths: string[];
  projects: Project[] | null;
  prompt: string;
  providerOptions: Opt[];
  providers: HostProviders | null;
  setBase: (b: string) => void;
  setHostId: (id: string) => void;
  setIsolation: (v: Isolation) => void;
  setKind: (v: Kind) => void;
  setMode: (v: string) => void;
  setModel: (v: string) => void;
  setProjectId: (id: string) => void;
  setPrompt: (v: string) => void;
  setProvider: (v: string) => void;
  setTitle: (v: string) => void;
  stopBrowsing: () => void;
  title: string;
  worktree: boolean;
}

/** Every field of the sheet, top to bottom; NewSession owns the state. */
function SheetFields({
  agentKind,
  attachFiles,
  base,
  branchOptions,
  branches,
  browse,
  browsing,
  drafts,
  dropDraft,
  entry,
  error,
  folderAdded,
  hostConn,
  hostId,
  hostName,
  hostOptions,
  isGit,
  isolation,
  kind,
  launch,
  mode,
  modeOptions,
  model,
  modelOptions,
  phone,
  project,
  projectId,
  projectOptions,
  projectPaths,
  projects,
  prompt,
  providerOptions,
  providers,
  setBase,
  setHostId,
  setIsolation,
  setKind,
  setMode,
  setModel,
  setProjectId,
  setPrompt,
  setProvider,
  setTitle,
  stopBrowsing,
  title,
  worktree,
}: SheetFieldsProps) {
  return (
    <>
      {hostOptions.length > 1 && (
        <HostField phone={phone} value={hostId} onChange={setHostId} options={hostOptions} />
      )}
      <Field label="Type" phone={phone}>
        <Seg options={KIND_OPTIONS} value={kind} onChange={setKind} />
      </Field>
      <ProjectField
        phone={phone}
        value={projectId}
        onChange={setProjectId}
        options={projectOptions}
        loaded={!!projects || hostConn !== "online"}
        offline={hostConn !== "online"}
        browsing={browsing}
        onBrowse={browse}
      />
      {browsing && (
        <FolderPick
          key={hostId ?? "active"}
          from={project?.projectRootPath}
          hostId={hostId}
          hostName={hostName}
          projectPaths={projectPaths}
          onCancel={stopBrowsing}
          onAdded={folderAdded}
        />
      )}
      {agentKind && isGit && (
        <Field label="Isolation" phone={phone}>
          <Seg options={ISOLATION_OPTIONS} value={isolation} onChange={setIsolation} />
        </Field>
      )}
      {worktree && (
        <BranchField
          phone={phone}
          value={base}
          onChange={setBase}
          options={branchOptions}
          loaded={!!branches}
        />
      )}
      {agentKind && (
        <AgentFields
          phone={phone}
          loaded={!!providers}
          provider={entry?.provider ?? null}
          setProvider={setProvider}
          providerOptions={providerOptions}
          model={model}
          setModel={setModel}
          modelOptions={modelOptions}
          mode={mode}
          setMode={setMode}
          modeOptions={modeOptions}
        />
      )}
      {agentKind && <LaunchFields {...launch} phone={phone} Field={Field} />}
      {agentKind && (
        <PromptBox
          phone={phone}
          prompt={prompt}
          setPrompt={setPrompt}
          title={title}
          setTitle={setTitle}
          drafts={drafts}
          onRemove={dropDraft}
          onAttach={attachFiles}
        />
      )}
      {(phone || !agentKind) && (
        <NameField phone={phone} agent={agentKind} value={title} onChange={setTitle} />
      )}
      {error && <ErrorBox agent={agentKind} error={error} />}
    </>
  );
}

export function NewSession() {
  const open = useUi((s) => s.newSessionOpen);
  const setOpen = useUi((s) => s.setNewSession);
  const phone = useFormFactor() === "phone";
  const { mounted, closing } = usePresence(open, phone ? overlayMs.out + 30 : overlayMs.out);
  const activeId = useHosts((s) => s.activeId);
  const hostOptions = useHostOptions();
  const [hostId, setHostId] = useState<string | null>(activeId);
  const active = !hostId || hostId === activeId;
  const ownConn = useDaemon((st) => st.conn);
  const hostConn = useHostConn(hostId) ?? ownConn;
  const hostName = hostOptions.find((h) => h.value === hostId)?.label;
  const providers = useHostProviders(hostId, active, open);
  const [kind, setKind] = useState<Kind>("agent");
  const [isolation, setIsolation] = useState<Isolation>("worktree");
  const [base, setBase] = useState("main");
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const {
    projects: daemonProjects,
    setProjects,
    projectId,
    setProjectId,
  } = useHostProjects(open, hostId, hostConn, setError, setBrowsing);
  // This device's list for the host: pinned first, hidden left out, its own folders added.
  const visible = useVisibleProjects(hostId, daemonProjects ?? NO_PROJECTS);
  const projects = daemonProjects ? visible : null;
  useEffect(() => {
    if (projects && !projects.some((p) => p.projectId === projectId))
      setProjectId(projects[0]?.projectId ?? null);
  }, [projects, projectId, setProjectId]);

  useOnOpen(open, setHostId, setPrompt);
  const { drafts, setDrafts, attachFiles, dropDraft } = useDrafts(setError);
  const { ready, entry, setProvider, model, setModel, mode, setMode } = useAgentChoice(providers);
  const project = projects?.find((p) => p.projectId === projectId);
  const isGit = project?.projectKind === "git";
  const branches = useBranches(open, hostId, isGit ? project?.projectRootPath : undefined, setBase);
  const launch = useLaunch({
    client: open ? getHostClient(hostId) : null,
    entry,
    root: project?.projectRootPath,
    flagsSupported: hostFeature(hostId, "claudeExtraArgs"),
  });

  const browse = useCallback(() => setBrowsing(true), []);
  const stopBrowsing = useCallback(() => setBrowsing(false), []);
  const folderAdded = useCallback(
    (p: Project[], path: string) => {
      setProjects(p);
      const hit = p.find((x) => x.projectRootPath === path);
      if (hit) setProjectId(hit.projectId);
      setBrowsing(false);
    },
    [setProjects, setProjectId],
  );

  const branch = slug(title || prompt);
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, [setOpen]);
  const root = useRef<View>(null);
  useModalLayer(open, close, root);
  const reset = useCallback(() => {
    setPrompt("");
    setTitle("");
    setDrafts([]);
    close();
  }, [close, setDrafts]);
  const submit = useSubmit({
    hostId,
    kind,
    project,
    entry,
    prompt,
    drafts,
    model,
    mode,
    title,
    worktree: isGit && isolation === "worktree" ? { newBranch: branch, base } : null,
    launch: launch.input,
    setBusy,
    setError,
    reset,
  });
  const onCreate = useCallback(() => void submit(), [submit]);
  const {
    projectOptions,
    projectPaths,
    providerOptions,
    modelOptions,
    modeOptions,
    branchOptions,
  } = useSheetOptions(projects, ready, entry, branches, base);

  if (!mounted) return null;

  const agentKind = kind === "agent";
  const worktree = agentKind && isGit && isolation === "worktree";
  const fields = (
    <SheetFields
      agentKind={agentKind}
      attachFiles={attachFiles}
      base={base}
      branchOptions={branchOptions}
      branches={branches}
      browse={browse}
      browsing={browsing}
      drafts={drafts}
      dropDraft={dropDraft}
      entry={entry}
      error={error}
      folderAdded={folderAdded}
      hostConn={hostConn}
      hostId={hostId}
      hostName={hostName}
      hostOptions={hostOptions}
      isGit={isGit}
      isolation={isolation}
      kind={kind}
      launch={launch.fields}
      mode={mode}
      modeOptions={modeOptions}
      model={model}
      modelOptions={modelOptions}
      phone={phone}
      project={project}
      projectId={projectId}
      projectOptions={projectOptions}
      projectPaths={projectPaths}
      projects={projects}
      prompt={prompt}
      providerOptions={providerOptions}
      providers={providers}
      setBase={setBase}
      setHostId={setHostId}
      setIsolation={setIsolation}
      setKind={setKind}
      setMode={setMode}
      setModel={setModel}
      setProjectId={setProjectId}
      setPrompt={setPrompt}
      setProvider={setProvider}
      setTitle={setTitle}
      stopBrowsing={stopBrowsing}
      title={title}
      worktree={worktree}
    />
  );
  const createLabel = actionLabel(agentKind, busy);
  const canCreate =
    !busy &&
    !!project &&
    hostConn === "online" &&
    (!agentKind || (agentReady(prompt, entry) && !launch.error));
  const foot = [hostOptions.length > 1 ? hostName : null, footText(worktree, branch, base, project)]
    .filter(Boolean)
    .join(" · ");

  const Shell = phone ? PhoneSheet : DeskSheet;
  return (
    <Shell
      closing={closing}
      close={close}
      foot={foot}
      createLabel={createLabel}
      canCreate={canCreate}
      onCreate={onCreate}
      root={root}
    >
      {fields}
    </Shell>
  );
}

/** A `server_info.features` flag of any connected host. */
function hostFeature(hostId: string | null, name: string): boolean {
  const info = getHostClient(hostId)?.getLastServerInfoMessage() as {
    features?: Record<string, unknown>;
  } | null;
  return info?.features?.[name] === true;
}

function agentReady(prompt: string, entry: unknown): boolean {
  return !!prompt.trim() && !!entry;
}

function useSheetOptions(
  projects: Project[] | null,
  ready: HostProviders["entries"],
  entry: HostProviders["entries"][number] | undefined,
  branches: BranchOption[] | null,
  base: string,
) {
  const projectOptions = useMemo(
    () =>
      (projects ?? []).map((p) => ({
        value: p.projectId,
        label: p.projectCustomName || p.projectDisplayName,
        hint: p.projectRootPath,
      })),
    [projects],
  );
  const projectPaths = useMemo(() => (projects ?? []).map((p) => p.projectRootPath), [projects]);
  const providerOptions = useMemo(
    () => ready.map((p) => ({ value: p.provider, label: p.label ?? providerLabel(p.provider) })),
    [ready],
  );
  const modelOptions = useMemo(
    () => (entry?.models ?? []).map((m) => ({ value: m.id, label: m.label })),
    [entry],
  );
  const modeOptions = useMemo(
    () => (entry?.modes ?? []).map((m) => ({ value: m.id, label: m.label, hint: m.description })),
    [entry],
  );
  // The current base stays pickable even when the host has not listed it (yet).
  const branchOptions = useMemo(() => {
    const list = branches ?? [];
    return list.some((b) => b.value === base) ? list : [{ value: base, label: base }, ...list];
  }, [branches, base]);
  return {
    projectOptions,
    projectPaths,
    providerOptions,
    modelOptions,
    modeOptions,
    branchOptions,
  };
}

function HostField({
  phone,
  value,
  onChange,
  options,
}: {
  phone: boolean;
  value: string | null;
  onChange: (id: string) => void;
  options: Array<{ value: string; label: string; hint?: string; disabled?: boolean }>;
}) {
  return (
    <Field label="Host" z={7} phone={phone}>
      <Select
        width={phone ? "100%" : 240}
        label="Host"
        value={value}
        onChange={onChange}
        options={options}
      />
    </Field>
  );
}

function BranchField({
  phone,
  value,
  onChange,
  options,
  loaded,
}: {
  phone: boolean;
  value: string;
  onChange: (b: string) => void;
  options: BranchOption[];
  loaded: boolean;
}) {
  return (
    <Field label="Start from" z={3} phone={phone}>
      <View style={s.branchRow}>
        <GitBranch size={13} color={color.faint} />
        <Select
          width={phone ? "100%" : 240}
          mono
          label="Start from"
          value={value}
          onChange={onChange}
          options={options}
          placeholder={loaded ? "No branches" : "Loading branches…"}
        />
      </View>
    </Field>
  );
}

interface ShellProps {
  closing: boolean;
  close: () => void;
  foot: string;
  createLabel: string;
  canCreate: boolean;
  onCreate: () => void;
  root: RefObject<View | null>;
  children: ReactNode;
}

function PhoneSheet({
  closing,
  close,
  foot,
  createLabel,
  canCreate,
  onCreate,
  children,
}: ShellProps) {
  return (
    <Modal
      visible
      transparent={Platform.OS === "web"}
      animationType={Platform.OS === "web" ? "none" : "slide"}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <SafeAreaView edges={EDGES_ALL} style={[s.phoneRoot, sheetStyle(closing)]}>
        <KeyboardFrame style={s.flex}>
          <View style={s.phoneHead}>
            <Pressable onPress={close} hitSlop={12} accessibilityLabel="Close">
              <X size={20} color={color.muted} />
            </Pressable>
            <T v="display" style={s.phoneHeading}>
              New session
            </T>
          </View>
          <ScrollView
            style={s.flex}
            contentContainerStyle={s.phoneContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          <View style={s.phoneFoot}>
            {!!foot && (
              <T v="mono" numberOfLines={1} style={s.footText}>
                {foot}
              </T>
            )}
            <Button
              kind="primary"
              grow
              label={createLabel}
              disabled={!canCreate}
              onPress={onCreate}
            />
          </View>
        </KeyboardFrame>
      </SafeAreaView>
    </Modal>
  );
}

function DeskSheet({
  closing,
  close,
  foot,
  createLabel,
  canCreate,
  onCreate,
  root,
  children,
}: ShellProps) {
  return (
    <View style={s.layer} pointerEvents={exitPointer(closing)}>
      <Pressable style={[s.scrim, scrimStyle(closing)]} onPress={close} />
      <View style={[s.boxPlace, riseStyle(closing)]} ref={root}>
        <Cut size={16} flip style={s.box}>
          <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <View style={s.headRow}>
              <View style={s.flex}>
                <T v="mono" style={s.kbd}>
                  ⌘N
                </T>
                <T v="display" style={s.heading}>
                  New session
                </T>
              </View>
              <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close">
                <X size={16} color={color.faint} />
              </Pressable>
            </View>
            {children}
          </ScrollView>
          <View style={s.foot}>
            <T v="mono" numberOfLines={1} style={s.footText}>
              {foot}
            </T>
            <Button label="Cancel" onPress={close} />
            <Button
              kind="primary"
              label={createLabel}
              kbd="⌘↵"
              disabled={!canCreate}
              onPress={onCreate}
            />
          </View>
        </Cut>
      </View>
    </View>
  );
}

function actionLabel(agent: boolean, busy: boolean): string {
  if (agent) return busy ? "Creating…" : "Create session";
  return busy ? "Starting…" : "Start terminal";
}

/** The first prompt, its attachments and (on wide layouts) the optional title. */
function PromptBox({
  phone,
  prompt,
  setPrompt,
  title,
  setTitle,
  drafts,
  onRemove,
  onAttach,
}: {
  phone: boolean;
  prompt: string;
  setPrompt: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
  drafts: Draft[];
  onRemove: (id: string) => void;
  onAttach: () => void;
}) {
  return (
    <View style={s.prompt}>
      {drafts.length > 0 && <DraftChips drafts={drafts} onRemove={onRemove} />}
      <TextInput
        autoFocus={!phone}
        multiline
        value={prompt}
        onChangeText={setPrompt}
        placeholder="What should the agent do?"
        placeholderTextColor={color.faint}
        style={[s.promptT, phone && s.promptPhone]}
        textAlignVertical="top"
      />
      <View style={s.promptFoot}>
        {canPickFiles && (
          <Pressable onPress={onAttach} accessibilityLabel="Attach files" hitSlop={6}>
            {({ hovered }) => (
              <View style={s.attach}>
                <Paperclip size={14} color={hovered ? color.text : color.muted} />
                <T style={hovered ? s.attachTOn : s.attachT}>Attach</T>
              </View>
            )}
          </Pressable>
        )}
        {!phone && (
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title (optional)"
            placeholderTextColor={color.faint}
            style={s.title}
          />
        )}
      </View>
    </View>
  );
}

function NameField({
  phone,
  agent,
  value,
  onChange,
}: {
  phone: boolean;
  agent: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={agent ? "Title" : "Name"} phone={phone}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={agent ? "Optional — named from the prompt otherwise" : "Optional"}
        placeholderTextColor={color.faint}
        style={[s.titlePhone, !phone && s.nameWide]}
      />
    </Field>
  );
}

function ErrorBox({ agent, error }: { agent: boolean; error: string }) {
  return (
    <View style={s.errorBox}>
      <T style={s.errorHead}>
        {agent ? "Could not create the session" : "Could not start the terminal"}
      </T>
      <T v="mono" style={s.error}>
        {error}
      </T>
    </View>
  );
}

const EDGES_ALL = ["top", "bottom", "left", "right"] as const;

function ProjectField({
  phone,
  value,
  onChange,
  options,
  loaded,
  offline,
  browsing,
  onBrowse,
}: {
  phone: boolean;
  value: string | null;
  onChange: (id: string) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
  loaded: boolean;
  offline: boolean;
  browsing: boolean;
  onBrowse: () => void;
}) {
  return (
    <Field label="Project" z={5} phone={phone}>
      <View style={[s.projectRow, phone && s.projectRowPhone]}>
        <Select
          width={phone ? "100%" : undefined}
          label="Project"
          value={value}
          onChange={onChange}
          options={options}
          placeholder={projectPlaceholder(loaded, offline)}
        />
        {!browsing && !offline && <Button label="Choose folder…" onPress={onBrowse} />}
      </View>
    </Field>
  );
}

function projectPlaceholder(loaded: boolean, offline: boolean): string {
  if (offline) return "Host offline";
  return loaded ? "No projects yet" : "Loading projects…";
}

function folderLabel(folder: string | null, adding: boolean): string {
  if (adding) return "Adding…";
  return folder ? `Use ${baseName(folder) || folder}` : "Pick a folder";
}

/** Inline host-folder picker on the chosen host: the picked folder is added as a project. */
function FolderPick({
  from,
  hostId,
  hostName,
  projectPaths,
  onCancel,
  onAdded,
}: {
  from?: string;
  hostId: string | null;
  hostName?: string;
  projectPaths: string[];
  onCancel: () => void;
  onAdded: (projects: Project[], path: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  // Nothing selected inside the listed folder means the listed folder itself.
  const folder = picked ?? cwd;
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = getHostClient(hostId);
  const pick = useCallback(() => {
    if (!folder || !client) return;
    setAdding(true);
    setError(null);
    addProject(folder, client)
      .then(() => client.listProjects())
      .then((r) => {
        onAdded(r.projects, folder);
        return r;
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setAdding(false));
  }, [folder, client, onAdded]);
  const label = folderLabel(folder, adding);
  return (
    <View style={s.browse}>
      <ScrollView style={s.browseList}>
        <FolderBrowser
          picked={picked}
          onPick={setPicked}
          onCwd={setCwd}
          from={from}
          client={client}
          hostName={hostName}
          projectPaths={projectPaths}
        />
      </ScrollView>
      {error && (
        <T v="mono" style={s.error}>
          {error}
        </T>
      )}
      <View style={s.browseActs}>
        <Button label="Cancel" onPress={onCancel} />
        <Button kind="primary" label={label} onPress={pick} disabled={!folder || adding} />
      </View>
    </View>
  );
}

/** Files waiting to go with the first prompt. */
function DraftChips({ drafts, onRemove }: { drafts: Draft[]; onRemove: (id: string) => void }) {
  return (
    <View style={s.chips}>
      {drafts.map((d) => (
        <DraftChip key={d.id} d={d} onRemove={onRemove} />
      ))}
    </View>
  );
}

function DraftChip({ d, onRemove }: { d: Draft; onRemove: (id: string) => void }) {
  const remove = useCallback(() => onRemove(d.id), [d.id, onRemove]);
  const Icon = isImage(d) ? ImageIcon : FileText;
  return (
    <View style={s.chip}>
      <Icon size={12} color={color.muted} />
      <T v="mono" style={s.chipName} numberOfLines={1}>
        {d.name}
      </T>
      <Pressable onPress={remove} hitSlop={6} accessibilityLabel={`Remove ${d.name}`}>
        <X size={11} color={color.faint} />
      </Pressable>
    </View>
  );
}

function Field({
  label,
  children,
  z = 1,
  phone,
}: {
  label: string;
  children: React.ReactNode;
  z?: number;
  /** Stack the label above a full-width control. */
  phone?: boolean;
}) {
  const style = useMemo(() => [phone ? s.fieldPhone : s.field, { zIndex: z }], [z, phone]);
  return (
    <View style={style}>
      <T style={phone ? s.fieldLabelPhone : s.fieldLabel}>{label}</T>
      <View style={phone ? s.fieldBodyPhone : s.fieldBody}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  browse: {
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.bg2,
  },
  browseList: { maxHeight: 300 },
  projectRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  projectRowPhone: { flexDirection: "column", alignItems: "stretch" },
  browseActs: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    zIndex: 60,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.scrim,
    ...web({ backdropFilter: "blur(6px)" }),
  },
  boxPlace: { width: "100%", maxHeight: "92%", alignItems: "center" },
  box: {
    width: "100%",
    maxWidth: 760,
    flexShrink: 1,
    backgroundColor: color.panel,
    borderTopWidth: 1,
    borderTopColor: color.cyan,
  },
  input: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: 240,
    paddingHorizontal: 10,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
  },
  inputT: {
    flex: 1,
    paddingVertical: 7,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 12.5,
    ...web({ outlineStyle: "none" }),
  },
  branchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  promptFoot: { flexDirection: "row", alignItems: "center", gap: 12 },
  attach: { flexDirection: "row", alignItems: "center", gap: 6 },
  attachT: { fontSize: 12.5, color: color.muted },
  attachTOn: { fontSize: 12.5, color: color.text },
  nameWide: { width: 240 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.wash,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 260,
  },
  chipName: { color: color.text, flexShrink: 1 },
  prompt: {
    backgroundColor: color.raise,
    borderWidth: 1,
    borderColor: color.line,
    padding: 12,
    gap: 8,
  },
  promptT: {
    minHeight: 90,
    color: color.text,
    fontFamily: font.body,
    fontSize: 14.5,
    lineHeight: 21,
    ...web({ outlineStyle: "none", resize: "none" }),
  },
  title: {
    marginLeft: "auto",
    width: 220,
    textAlign: "right",
    color: color.muted,
    fontFamily: font.body,
    fontSize: 12.5,
    ...web({ outlineStyle: "none" }),
  },
  inputPhone: { width: "100%", paddingVertical: 4 },
  promptPhone: { minHeight: 140 },
  titlePhone: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    color: color.text,
    fontFamily: font.body,
    fontSize: 14,
    ...web({ outlineStyle: "none" }),
  },
  errorBox: {
    gap: 4,
    padding: 12,
    backgroundColor: color.coralWash,
    borderLeftWidth: 2,
    borderLeftColor: color.coral,
  },
  errorHead: { color: color.text, fontSize: 13 },
  phoneRoot: { flex: 1, backgroundColor: color.panel },
  phoneHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  phoneHeading: { fontSize: 19 },
  phoneContent: { padding: 16, gap: 16 },
  phoneFoot: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  fieldPhone: { gap: 6 },
  fieldLabelPhone: { color: color.muted, fontSize: 12.5 },
  fieldBodyPhone: { alignSelf: "stretch" },
  content: { padding: 22, gap: 14 },
  headRow: { flexDirection: "row", alignItems: "flex-start" },
  flex: { flex: 1 },
  kbd: { fontSize: 10.5 },
  heading: { fontSize: 19, marginTop: 2 },
  agentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
  },
  error: { color: color.coral },
  footText: { flex: 1, fontSize: 11 },
  field: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  fieldLabel: { width: 110, color: color.muted },
  fieldBody: { flex: 1, minWidth: 220, alignItems: "flex-end" },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
});
