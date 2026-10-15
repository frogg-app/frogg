// First session (with starter prompts for the user's kind of work) and the key concepts.
import { ArrowRight, Plus } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useDaemon } from "../../daemon/store";
import { color, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { Button } from "../Button";
import { Cut } from "../Cut";
import { T } from "../Text";
import { conceptsFor, showDeep, startersFor, type Concept } from "./model";
import { away, openSettingsPage, openTool } from "./nav";
import { Choice, Para, Status, StepHead } from "./parts";
import { useOnboarding } from "./store";

const start = (prompt?: string) =>
  away("session", () => useUi.getState().setNewSession(true, prompt ?? ""));
const startBlank = () => start();
const openSessions = () => away("session", () => openTool("sessions"));

export function SessionStep() {
  const count = useDaemon((st) => Object.keys(st.sessions).length);
  const level = useOnboarding((st) => st.level);
  const work = useOnboarding((st) => st.work);
  const starters = useMemo(() => startersFor(work), [work]);
  const pick = useCallback((p: string) => start(p), []);
  return (
    <>
      <StepHead
        title={count ? "You have sessions running" : "Start your first session"}
        lede="Pick a folder on the host, choose a provider and say what you want done."
      />
      {count > 0 && (
        <Status tone="ok">
          {count} {count === 1 ? "session" : "sessions"} on this host
        </Status>
      )}
      {level === "new" && (
        <Para>
          A project is just a folder on the host. If it’s a git repository, turn on New branch when
          you start: the agent then works in its own worktree and your checkout stays untouched.
        </Para>
      )}
      <T v="label" style={s.label}>
        Try one of these
      </T>
      <View style={s.grid}>
        {starters.map((p) => (
          <Choice key={p} id={p} title={p} on={false} onPick={pick} compact />
        ))}
      </View>
      <View style={s.actions}>
        <Button label="New session" icon={Plus} kind="primary" kbd="⌘N" onPress={startBlank} />
        {count > 0 && <Button label="Open sessions" onPress={openSessions} />}
      </View>
    </>
  );
}

export function ConceptsStep() {
  const level = useOnboarding((st) => st.level);
  const work = useOnboarding((st) => st.work);
  const list = useMemo(() => conceptsFor(level, work), [level, work]);
  const deep = showDeep(level);
  return (
    <>
      <StepHead
        title="Key concepts"
        lede={
          level === "expert"
            ? "The few things that work differently here."
            : "What you'll see around a session, and where each lives."
        }
      />
      <View style={s.grid}>
        {list.map((c) => (
          <ConceptCard key={c.id} c={c} deep={deep} />
        ))}
      </View>
    </>
  );
}

function ConceptCard({ c, deep }: { c: Concept; deep: boolean }) {
  const show = useCallback(() => {
    const { tool, page } = c;
    if (page) away("concepts", () => openSettingsPage(page));
    else if (tool) away("concepts", () => openTool(tool));
  }, [c]);
  return (
    <Cut size={10} style={s.card}>
      <T v="display" style={s.cardTitle}>
        {c.title}
      </T>
      <T style={s.cardBody}>{c.body}</T>
      {deep && c.deep && <T style={s.cardDeep}>{c.deep}</T>}
      {(c.tool || c.page) && (
        <Pressable onPress={show} style={s.show} accessibilityRole="link">
          {({ hovered }) => (
            <>
              <T style={[s.showT, hovered && s.showTH]}>Show me</T>
              <ArrowRight size={12} color={hovered ? color.cyan2 : color.cyan} />
            </>
          )}
        </Pressable>
      )}
    </Cut>
  );
}

const s = StyleSheet.create({
  label: { marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: {
    flexGrow: 1,
    flexBasis: 220,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
    padding: 14,
    gap: 6,
  },
  cardTitle: { fontSize: 14 },
  cardBody: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  cardDeep: { color: color.faint, fontSize: 12.5, lineHeight: 18 },
  show: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
    alignSelf: "flex-start",
    ...web({ outlineStyle: "none" }),
  },
  showT: { color: color.cyan, fontSize: 12.5, ...web({ transition: "color 120ms ease-out" }) },
  showTH: { color: color.cyan2 },
});
