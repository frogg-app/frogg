import { GitBranch, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
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
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 5).join("-") || "session";

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
    });
    if (!providers) void loadConfig();
  }, [open, providers]);

  const ready = useMemo(() => providers?.entries.filter((p) => p.status === "ready" && p.enabled) ?? [], [providers]);
  const entry = ready.find((p) => p.provider === provider) ?? ready[0];
  useEffect(() => {
    if (!entry) return;
    setProvider(entry.provider);
    setModel((m) => (entry.models?.some((x) => x.id === m) ? m : (entry.models?.find((x) => x.isDefault) ?? entry.models?.[0])?.id ?? null));
    setMode((m) => (entry.modes?.some((x) => x.id === m) ? m : entry.defaultModeId ?? entry.modes?.[0]?.id ?? null));
  }, [entry]);

  if (!open) return null;
  const project = projects?.find((p) => p.projectId === projectId);
  const isGit = project?.projectKind === "git";
  const branch = slug(title || prompt);
  const close = () => {
    setOpen(false);
    setError(null);
  };
  const submit = async () => {
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
        worktree: isGit && isolation === "worktree" ? { mode: "branch-off", newBranch: branch, base } : undefined,
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
  };

  return (
    <View style={s.layer}>
      <Pressable style={s.scrim} onPress={close} />
      <Cut size={16} flip style={[s.box, phone && { maxWidth: "100%" }]}>
        <ScrollView contentContainerStyle={{ padding: 22, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <T v="mono" style={{ fontSize: 10.5 }}>⌘N</T>
              <T v="display" style={{ fontSize: 19, marginTop: 2 }}>New session</T>
            </View>
            <Pressable onPress={close} hitSlop={10}><X size={16} color={color.faint} /></Pressable>
          </View>
          <Field label="Project" z={5}>
            <Select
              value={projectId}
              onChange={setProjectId}
              options={(projects ?? []).map((p) => ({ value: p.projectId, label: p.projectCustomName || p.projectDisplayName, hint: p.projectRootPath }))}
              placeholder={projects ? "No projects yet" : "Loading…"}
            />
          </Field>
          {isGit && (
            <Field label="Isolation">
              <Seg options={[["worktree", "New worktree"], ["local", "Local checkout"]]} value={isolation} onChange={setIsolation} />
            </Field>
          )}
          {isGit && isolation === "worktree" && (
            <Field label="Start from">
              <View style={s.input}>
                <GitBranch size={13} color={color.faint} />
                <TextInput value={base} onChangeText={setBase} style={s.inputT} placeholder="main" placeholderTextColor={color.faint} />
              </View>
            </Field>
          )}
          <Field label="Agent" z={4}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
              <Select width={150} value={entry?.provider ?? null} onChange={setProvider}
                options={ready.map((p) => ({ value: p.provider, label: p.label ?? providerLabel(p.provider) }))} />
              <Select width={170} mono value={model} onChange={setModel}
                options={(entry?.models ?? []).map((m) => ({ value: m.id, label: m.label }))} />
              {!!entry?.modes?.length && (
                <Select width={150} value={mode} onChange={setMode} options={entry.modes.map((m) => ({ value: m.id, label: m.label, hint: m.description }))} />
              )}
            </View>
          </Field>
          <View style={s.prompt}>
            <TextInput
              autoFocus
              multiline
              value={prompt}
              onChangeText={setPrompt}
              placeholder="What should the agent do?"
              placeholderTextColor={color.faint}
              style={s.promptT}
            />
            <TextInput value={title} onChangeText={setTitle} placeholder="Title (optional)" placeholderTextColor={color.faint} style={s.title} />
          </View>
          {error && <T v="mono" style={{ color: color.coral }}>{error}</T>}
        </ScrollView>
        <View style={s.foot}>
          <T v="mono" numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
            {isGit && isolation === "worktree" ? `worktree · ${branch} from ${base}` : project ? `in ${project.projectRootPath}` : ""}
          </T>
          <Button label="Cancel" onPress={close} />
          <Button kind="primary" label={busy ? "Creating…" : "Create session"} kbd="⌘↵" disabled={busy || !prompt.trim() || !project || !entry} onPress={() => void submit()} />
        </View>
      </Cut>
    </View>
  );
}

function Field({ label, children, z = 1 }: { label: string; children: React.ReactNode; z?: number }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, zIndex: z }}>
      <T style={{ width: 110, color: color.muted }}>{label}</T>
      <View style={{ flex: 1, minWidth: 220, alignItems: "flex-end" }}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 12, zIndex: 60 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4,8,10,0.6)", ...web({ backdropFilter: "blur(6px)" }) },
  box: { width: "100%", maxWidth: 760, maxHeight: "92%", backgroundColor: color.panel, borderTopWidth: 1, borderTopColor: color.cyan },
  input: { flexDirection: "row", alignItems: "center", gap: 8, width: 240, paddingHorizontal: 10, backgroundColor: color.bg, borderWidth: 1, borderColor: color.line },
  inputT: { flex: 1, paddingVertical: 7, color: color.text, fontFamily: font.mono, fontSize: 12.5, ...web({ outlineStyle: "none" }) },
  prompt: { backgroundColor: color.raise, borderWidth: 1, borderColor: color.line, padding: 12, gap: 8 },
  promptT: { minHeight: 90, color: color.text, fontFamily: font.body, fontSize: 14.5, lineHeight: 21, ...web({ outlineStyle: "none", resize: "none" }) },
  title: { alignSelf: "flex-end", width: 220, textAlign: "right", color: color.muted, fontFamily: font.body, fontSize: 12.5, ...web({ outlineStyle: "none" }) },
  foot: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 22, paddingVertical: 14, borderTopWidth: 1, borderTopColor: color.line },
});
