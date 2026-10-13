// Lab: sub-work (subagents, background commands, terminals, scripts, child sessions) on session
// rows, the chat strip, and the unified model. A simulated host drives the real store and hook.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Chat } from "../../components/Chat";
import { SessionList } from "../../components/SessionList";
import { StatusSummary } from "../../components/sessions/StatusSummary";
import { Num } from "../../components/CountUp";
import { VariantOverride } from "../../components/subwork/hooks";
import { elapsed, KIND_LABEL, type SubWork } from "../../components/subwork/model";
import { SubWorkStrip } from "../../components/subwork/Strip";
import { statusColor, type SubWorkVariant } from "../../components/subwork/views";
import { StatusGlyph } from "../../components/StatusGlyph";
import { T } from "../../components/Text";
import { TasksPanel } from "../../components/TasksPanel";
import { useDaemon } from "../../daemon/store";
import { useNow, useSubWork } from "../../daemon/subwork";
import { color } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { setLabFeature } from "../client";
import { ID } from "../fixtures";
import { Act, Case, Cases, Fill, Stack, W, Controls, type Entry } from "../kit";
import {
  SIM_SESSION,
  simChildSettle,
  simFinishAny,
  simOpenTerminal,
  simProgress,
  simReset,
  simSickScript,
  simSpawnChild,
  simStartBackground,
  simStartScript,
  simStartSubagent,
  simStep,
  simStopScript,
  simTerminalStep,
} from "../sim/subwork";
import { useLab } from "../store";

const BUCKETS = { needs: 0, failed: 1, review: 2, working: 3, idle: 1 };

/** A short list (failed, working, idle) so the simulated session is in view, then the sim. */
const select = () => {
  useDaemon.setState((st) => ({
    sessions: Object.fromEntries(
      [ID.failed, SIM_SESSION, ID.idle]
        .filter((id) => st.sessions[id])
        .map((id) => [id, st.sessions[id]]),
    ),
  }));
  useUi.setState({ selected: SIM_SESSION });
  simReset();
};

const startSub = () => simStartSubagent();
const finishOne = () => simFinishAny(false);
const failOne = () => simFinishAny(true);
const childFail = () => simChildSettle(true);
const startScript = () => simStartScript();

/** Buttons that make the simulated host start, progress, finish and fail sub-work. */
function SimControls() {
  const [auto, setAuto] = useState(false);
  const rate = Number(useLab((st) => st.speed));
  const toggle = useCallback(() => setAuto((a) => !a), []);
  useEffect(() => {
    if (!auto) return;
    const step = setInterval(simStep, 1800 / rate);
    const tick = setInterval(simProgress, 2200 / rate);
    return () => {
      clearInterval(step);
      clearInterval(tick);
    };
  }, [auto, rate]);
  return (
    <Controls>
      <Act label="Start subagent" run={startSub} primary />
      <Act label="Start background command" run={simStartBackground} />
      <Act label="Start script" run={startScript} />
      <Act label="Open terminal" run={simOpenTerminal} />
      <Act label="Spawn child session" run={simSpawnChild} />
      <Act label="Finish one" run={finishOne} />
      <Act label="Fail one" run={failOne} />
      <Act label="Terminal asks / answers" run={simTerminalStep} />
      <Act label="Script unhealthy" run={simSickScript} />
      <Act label="Stop script" run={simStopScript} />
      <Act label="Child session fails" run={childFail} />
      <Act label={auto ? "Stop auto-simulate" : "Auto-simulate"} run={toggle} />
      <Act label="Reset" run={simReset} />
    </Controls>
  );
}

function Pinned({ variant, children }: { variant: SubWorkVariant; children: ReactNode }) {
  return <VariantOverride.Provider value={variant}>{children}</VariantOverride.Provider>;
}

const listCase = (variant: SubWorkVariant, w: number, note?: string) => (
  <Case
    key={`${variant}${w}`}
    name="SessionList"
    props={`subworkStyle="${variant}"`}
    note={note}
    w={w}
    h={w >= 600 ? 440 : 560}
  >
    <View style={s.col}>
      <Pinned variant={variant}>
        <SessionList />
      </Pinned>
    </View>
  </Case>
);

function RowsA() {
  return (
    <Stack>
      <SimControls />
      <Cases>
        {listCase("chip", W.panel, "Docked panel. Chip = count, beam while running; tap to open.")}
        {listCase("chip", W.tablet, "Tablet drawer.")}
        {listCase("chip", W.phone, "Phone full screen.")}
        {listCase("chip", 680, "Portrait tablet list column, widest case.")}
      </Cases>
    </Stack>
  );
}
function RowsB() {
  return (
    <Stack>
      <SimControls />
      <Cases>
        {listCase("dots", W.panel, "One square per item: cyan running, mint done, coral failed.")}
        {listCase("dots", W.phone)}
      </Cases>
    </Stack>
  );
}
function RowsC() {
  return (
    <Stack>
      <SimControls />
      <Cases>
        {listCase("tree", W.panel, "Nested rows always visible (max 5), tree connectors.")}
        {listCase("tree", W.phone)}
      </Cases>
    </Stack>
  );
}

// ---- chat strip ----

function MockHeader({ children }: { children: ReactNode }) {
  return (
    <View style={s.mock}>
      <View style={s.mockHead}>
        <T v="mono" style={s.crumb}>
          frogg / frogg-interface-design-mockups
        </T>
        <T v="display" style={s.mockTitle} numberOfLines={1}>
          Interface redesign (ui-next)
        </T>
        <View style={s.mockSub}>
          <StatusGlyph bucket="working" size={7} />
          <T style={s.working}>Working</T>
        </View>
      </View>
      {children}
      <View style={s.mockBody}>
        <T style={s.faint}>conversation…</T>
      </View>
    </View>
  );
}

function StripCase({ w }: { w: number }) {
  return (
    <Case
      name="SubWorkStrip"
      props="sessionId"
      note="Under the chat header; names truncate, tap for the list."
      w={w}
      h={w >= 600 ? 300 : 360}
    >
      <MockHeader>
        <SubWorkStrip sessionId={SIM_SESSION} />
      </MockHeader>
    </Case>
  );
}

function StripCases() {
  return (
    <Stack>
      <SimControls />
      <Cases>
        <StripCase w={W.panel} />
        <StripCase w={W.tablet} />
        <StripCase w={W.phone} />
        <StripCase w={680} />
      </Cases>
    </Stack>
  );
}

function RealChat() {
  const sess = useDaemon((st) => st.sessions[SIM_SESSION]);
  if (!sess) return null;
  return (
    <Fill>
      <Chat session={sess} />
    </Fill>
  );
}
function RealChatDemo() {
  return (
    <Stack>
      <SimControls />
      <Case name="Chat" props="session" w={W.phone} h={560} note="The strip in the real chat.">
        <RealChat />
      </Case>
    </Stack>
  );
}

// ---- model ----

function ModelRow({ item }: { item: SubWork }) {
  const live = item.status === "running";
  const now = useNow(live);
  const time = item.startedAt ? elapsed(item.startedAt, live ? now : (item.endedAt ?? now)) : "–";
  return (
    <View style={s.mrow}>
      <T v="mono" style={s.mKind} numberOfLines={1}>
        {item.kind}
      </T>
      <T v="mono" style={[s.mStatus, { color: statusColor[item.status] }]} numberOfLines={1}>
        {item.status}
      </T>
      <T numberOfLines={1} style={s.mLabel}>
        {item.label}
      </T>
      <T v="mono" style={s.mCell} numberOfLines={1}>
        {time}
      </T>
      <T v="mono" style={s.mCell} numberOfLines={1}>
        {item.port ? `:${item.port}` : ""}
      </T>
    </View>
  );
}

function Count({ label, n, tone }: { label: string; n: number; tone?: string }) {
  return (
    <View style={s.count}>
      <Num value={n} style={[s.countN, tone ? { color: tone } : null]} />
      <T v="mono" style={s.countL}>
        {label}
      </T>
    </View>
  );
}

const oldDaemon = () => {
  setLabFeature("providerSubagents", false);
  simReset();
};
const newDaemon = () => {
  setLabFeature("providerSubagents", true);
  simReset();
};

function ModelDemo() {
  const { items, counts } = useSubWork(SIM_SESSION);
  const sub = counts.running + 0;
  return (
    <Stack>
      <SimControls />
      <Controls>
        <Act label="Daemon 1.6.11 (subagents advertised)" run={newDaemon} />
        <Act label="Daemon without providerSubagents" run={oldDaemon} />
      </Controls>
      <View style={s.counts}>
        <Count label="running" n={counts.running} tone={statusColor.running} />
        <Count label="attention" n={counts.attention} tone={statusColor.attention} />
        <Count label="failed" n={counts.failed} tone={statusColor.failed} />
        <Count label="done" n={counts.done} tone={statusColor.done} />
        <Count label="idle" n={counts.idle} />
        <Count label="total" n={counts.total} />
      </View>
      <Cases>
        <Case name="useSubWork" props="(sessionId)" note="Merged, live, sorted." w={W.phone * 1.6}>
          <View style={s.table}>
            {items.map((x) => (
              <ModelRow key={x.id} item={x} />
            ))}
            {!items.length && <T style={s.faint}>No sub-work.</T>}
          </View>
        </Case>
        <Case
          name="StatusSummary"
          props="counts sub={n}"
          note="Caption only: the five counts above never change."
          w={W.panel}
        >
          <View style={s.panel}>
            <StatusSummary counts={BUCKETS} sub={sub} />
          </View>
        </Case>
        <Case name="TasksPanel" props="" note="Grouped by kind, all sources." w={W.panel} h={520}>
          <Fill>
            <TasksPanel />
          </Fill>
        </Case>
      </Cases>
      <T v="mono" style={s.faint}>
        {Object.entries(KIND_LABEL)
          .map(([k, v]) => `${k}=${v}`)
          .join("  ")}
      </T>
    </Stack>
  );
}

const MOTION =
  "chip: beam travels 1700ms + 240ms hold, mark breathes 700ms each way while running; count rolls (CountUp, 240ms); chevron turns 240ms glide · " +
  "nested rows: height glides 240ms on the glide curve, instant under reduced motion; activity line re-enters 220ms on change; elapsed ticks 1s from one shared clock · " +
  "settle (running → done/failed, live only): glyph pop x1.35 (120/260ms) + mint glow (80x3 up, 520 down) or one sharp coral flash (80 up, 520 down), never on mount · " +
  "strip: glides in 240ms, lingers 2600ms after the last item settles with the result · RN Animated (JS driver), identical on Android";

const DECISION =
  "Which session-row indicator should ship? A count chip (default), B one dot per item, C nested rows always visible. Switch live in Settings → Design options → Sub-work indicator.";

export const subwork: Entry[] = [
  {
    id: "subwork-rows",
    name: "Sub-work (session rows)",
    category: "Navigation & shell",
    path: "components/subwork/views.tsx, hooks.ts, Collapse.tsx · components/SessionList.tsx · daemon/subwork.ts",
    purpose:
      "A secondary indicator on each session row for what runs beneath it: subagents, background commands, terminals, scripts, child sessions. It never changes the session's own status. Opens by itself only when something needs you or failed; the choice is remembered per session.",
    usedBy: 1,
    polish: MOTION,
    decision: DECISION,
    setup: select,
    variants: [
      { id: "a", label: "A · Count chip (default)", C: RowsA },
      { id: "b", label: "B · Mini-glyph dots", C: RowsB },
      { id: "c", label: "C · Tree, always visible", C: RowsC },
    ],
  },
  {
    id: "subwork-strip",
    name: "Sub-work (chat strip)",
    category: "Chat",
    path: "components/subwork/Strip.tsx · components/Chat.tsx",
    purpose:
      "A slim live strip under the chat header while sub-work runs: count and names, expands to the list. Completion or failure plays one settle flash and the strip lingers with the result.",
    usedBy: 1,
    polish: MOTION,
    setup: select,
    variants: [
      { id: "cases", label: "At real widths", C: StripCases },
      { id: "chat", label: "In the real chat", C: RealChatDemo },
    ],
  },
  {
    id: "subwork-model",
    name: "Sub-work model",
    category: "Data display",
    path: "components/subwork/model.ts · daemon/subwork.ts",
    purpose:
      "One SubWork list per session merged from provider subagents, workspace scripts, terminals, child sessions and background commands, with running / attention / failed / done roll-ups. Older daemons simply contribute fewer sources.",
    usedBy: 3,
    polish: "none: data only; the views carry the motion (see Sub-work (session rows))",
    setup: select,
    variants: [{ id: "live", label: "Live model, panel and caption", C: ModelDemo }],
  },
];

const s = StyleSheet.create({
  col: { flex: 1, backgroundColor: color.bg2 },
  mock: { flex: 1, backgroundColor: color.bg2 },
  mockHead: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  crumb: { fontSize: 11 },
  mockTitle: { fontSize: 17, marginTop: 3 },
  mockSub: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  working: { fontSize: 12, color: color.cyan },
  mockBody: { padding: 24 },
  faint: { color: color.faint },
  mrow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  mKind: { width: 104, fontSize: 11, color: color.muted },
  mStatus: { width: 66, fontSize: 11 },
  mLabel: { flex: 1, fontSize: 12.5 },
  mCell: { width: 52, fontSize: 11, color: color.faint, textAlign: "right" },
  table: { padding: 12 },
  counts: { flexDirection: "row", flexWrap: "wrap", gap: 22 },
  count: { gap: 2 },
  countN: { fontSize: 20, color: color.text },
  countL: { fontSize: 10.5, color: color.faint },
  panel: { backgroundColor: color.bg2, paddingTop: 10 },
});
