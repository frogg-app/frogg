import { KeyboardFrame } from "./shell/KeyboardFrame";
import { GitBranch, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { loadConfig, useConfig } from "../daemon/config";
import { createSession, listProjects, type Project } from "../daemon/store";
import { useFormFactor } from "../theme/layout";
import { color, font, web } from "../theme/tokens";
import { useUi } from "../ui-store";
import { providerLabel } from "../util";
import { Button } from "./Button";
import { Cut } from "./Cut";
import { Seg } from "./settings/controls";
import { Select } from "./Select";
import { T } from "./Text";

type Isolation = "worktree" | "local";

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

export function NewSession() {
  const open = useUi((s) => s.newSessionOpen);
  const setOpen = useUi((s) => s.setNewSession);
  const select = useUi((s) => s.select);
  const setTool = useUi((s) => s.setTool);
  const providers = useConfig((s) => s.providers);
  const phone = useFormFactor() === "phone";
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isolation, setIsolation] = useState<Isolation>("worktree");
  const [base, setBase] = useState("main");
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const seed = useUi.getState().newSessionPrompt;
    if (seed) {
      setPrompt(seed);
      useUi.setState({ newSessionPrompt: "" });
    }
    void listProjects().then((p) => {
      setProjects(p);
      setProjectId((cur) => cur ?? p[0]?.projectId ?? null);
      return p;
    });
    if (!providers) void loadConfig();
  }, [open, providers]);

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

  const project = projects?.find((p) => p.projectId === projectId);
  const isGit = project?.projectKind === "git";
  const branch = slug(title || prompt);
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, [setOpen]);
  const submit = useCallback(async () => {
    if (!project || !entry || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createSession({
        cwd: project.projectRootPath,
        provider: entry.provider,
        model: model ?? undefined,
        modeId: mode ?? undefined,
        title: title.trim() || undefined,
        initialPrompt: prompt.trim(),
        worktree:
          isGit && isolation === "worktree"
            ? { mode: "branch-off", newBranch: branch, base }
            : undefined,
      });
      setPrompt("");
      setTitle("");
      close();
      setTool("sessions");
      select(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    project,
    entry,
    prompt,
    model,
    mode,
    title,
    isGit,
    isolation,
    branch,
    base,
    close,
    setTool,
    select,
  ]);
  const onCreate = useCallback(() => void submit(), [submit]);
  const projectOptions = useMemo(
    () =>
      (projects ?? []).map((p) => ({
        value: p.projectId,
        label: p.projectCustomName || p.projectDisplayName,
        hint: p.projectRootPath,
      })),
    [projects],
  );
  const providerOptions = useMemo(
    () =>
      ready.map((p) => ({
        value: p.provider,
        label: p.label ?? providerLabel(p.provider),
      })),
    [ready],
  );
  const modelOptions = useMemo(
    () => (entry?.models ?? []).map((m) => ({ value: m.id, label: m.label })),
    [entry],
  );
  const modeOptions = useMemo(
    () =>
      (entry?.modes ?? []).map((m) => ({
        value: m.id,
        label: m.label,
        hint: m.description,
      })),
    [entry],
  );

  if (!open) return null;

  const worktree = isGit && isolation === "worktree";
  const selW = phone ? "100%" : undefined;
  const fields = (
    <>
      <Field label="Project" z={5} phone={phone}>
        <Select
          width={selW}
          label="Project"
          value={projectId}
          onChange={setProjectId}
          options={projectOptions}
          placeholder={projects ? "No projects yet" : "Loading projects…"}
        />
      </Field>
      {isGit && (
        <Field label="Isolation" phone={phone}>
          <Seg options={ISOLATION_OPTIONS} value={isolation} onChange={setIsolation} />
        </Field>
      )}
      {worktree && (
        <Field label="Start from" phone={phone}>
          <View style={[s.input, phone && s.inputPhone]}>
            <GitBranch size={13} color={color.faint} />
            <TextInput
              value={base}
              onChangeText={setBase}
              style={s.inputT}
              placeholder="main"
              placeholderTextColor={color.faint}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </Field>
      )}
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
      <View style={s.prompt}>
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
      {phone && (
        <Field label="Title" phone>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Optional — named from the prompt otherwise"
            placeholderTextColor={color.faint}
            style={s.titlePhone}
          />
        </Field>
      )}
      {error && (
        <View style={s.errorBox}>
          <T style={s.errorHead}>Could not create the session</T>
          <T v="mono" style={s.error}>
            {error}
          </T>
        </View>
      )}
    </>
  );
  const createLabel = busy ? "Creating…" : "Create session";
  const canCreate = !busy && !!prompt.trim() && !!project && !!entry;
  const foot = footText(worktree, branch, base, project);

  if (phone)
    return (
      <Modal
        visible
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={close}
      >
        <SafeAreaView edges={EDGES_ALL} style={s.phoneRoot}>
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
              {fields}
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

  return (
    <View style={s.layer}>
      <Pressable style={s.scrim} onPress={close} />
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
          {fields}
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
  );
}

const EDGES_ALL = ["top", "bottom", "left", "right"] as const;

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
  box: {
    width: "100%",
    maxWidth: 760,
    maxHeight: "92%",
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
    alignSelf: "flex-end",
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
