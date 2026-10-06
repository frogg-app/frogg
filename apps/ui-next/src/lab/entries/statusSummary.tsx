import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BUCKETS, StatusSummary, summaryMotion } from "../../components/sessions/StatusSummary";
import { T } from "../../components/Text";
import type { Bucket } from "../../daemon/types";
import { color } from "../../theme/tokens";
import { Act, Case, Cases, Controls, Stack, W, type Entry } from "../kit";
import { useLab } from "../store";

type Counts = Record<Bucket, number>;
const START: Counts = { needs: 2, failed: 1, review: 2, working: 2, idle: 1 };

/** Moves one session from `from` to `to` (from = null creates one). */
const move = (c: Counts, from: Bucket | null, to: Bucket | null): Counts => {
  if (from && !c[from]) return c;
  const next = { ...c };
  if (from) next[from] -= 1;
  if (to) next[to] += 1;
  return next;
};

const sum = (c: Counts) => BUCKETS.reduce((n, o) => n + c[o.b], 0);

const STEPS: Array<[Bucket | null, Bucket | null]> = [
  [null, "working"],
  ["working", "needs"],
  ["working", "review"],
  ["working", "failed"],
  ["needs", "working"],
  ["review", "idle"],
  ["failed", "working"],
  ["idle", "working"],
];

function SummaryDemo() {
  const [c, setC] = useState(START);
  const [mount, setMount] = useState(0);
  const [auto, setAuto] = useState(false);
  const rate = Number(useLab((st) => st.speed));
  const go = useCallback(
    (from: Bucket | null, to: Bucket | null) => setC((x) => move(x, from, to)),
    [],
  );
  const addNeeds = useCallback(() => go("working", "needs"), [go]);
  const addFailed = useCallback(() => go("working", "failed"), [go]);
  const finish = useCallback(() => go("working", "review"), [go]);
  const answer = useCallback(() => go("needs", "working"), [go]);
  const start = useCallback(() => go(null, "working"), [go]);
  const archive = useCallback(() => go("review", null), [go]);
  const reset = useCallback(() => {
    setC(START);
    setMount((m) => m + 1);
  }, []);
  const toggle = useCallback(() => setAuto((a) => !a), []);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      const [from, to] = STEPS[Math.floor(Math.random() * STEPS.length)] ?? [null, "working"];
      setC((x) => {
        if (sum(x) > 12) return move(x, "review", null);
        return move(x, from, to);
      });
    }, 1400 / rate);
    return () => clearInterval(id);
  }, [auto, rate]);
  const line = BUCKETS.map((o) => `${o.b} ${c[o.b]}`).join(" · ");
  return (
    <Stack>
      <Controls>
        <Act label="+ needs you" run={addNeeds} primary />
        <Act label="+ failed" run={addFailed} />
        <Act label="Finish (working → ready)" run={finish} />
        <Act label="Answer (needs → working)" run={answer} />
        <Act label="Start new" run={start} />
        <Act label="Archive ready" run={archive} />
        <Act label="Reset + replay mount" run={reset} />
        <Act label={auto ? "Stop auto-simulate" : "Auto-simulate"} run={toggle} />
      </Controls>
      <T v="mono" style={s.line}>
        {line}
      </T>
      <Cases>
        <Case name="StatusSummary" props="counts={…}" note="Docked side panel." w={W.panel}>
          <View style={s.panel}>
            <StatusSummary key={mount} counts={c} />
          </View>
        </Case>
        <Case name="StatusSummary" props="counts={…}" note="Tablet side panel." w={W.tablet}>
          <View style={s.panel}>
            <StatusSummary key={mount} counts={c} />
          </View>
        </Case>
      </Cases>
    </Stack>
  );
}

const M = summaryMotion;
export const statusSummary: Entry = {
  id: "status-summary",
  name: "StatusSummary",
  category: "Navigation & shell",
  path: "components/sessions/StatusSummary.tsx",
  purpose:
    "Session-list header: proportional bar of attention buckets and a legend of counts that bleeps when something needs the user.",
  usedBy: 1,
  polish:
    `mount: bar wipes in ${M.fill}ms glide · width change ${M.resize}ms glide, new segments grow from 0, removed shrink out · ` +
    `counts lerp old→new with the bar (${M.resize}ms; 0→n over ${M.fill}ms on mount), each step rolls ${M.roll}ms · legend enter ${M.enter}ms / exit ${M.exit}ms · ` +
    `needs you: 2 pulses (${M.bleepUp}↑/${M.bleepDown}↓, ~2.7/s) on bar + legend wash, glyph pop ×1.7 (${M.popUp}/${M.popDown}ms), glyph breathes ${M.breathe * 2}ms cycle while >0 · ` +
    `failed: one sharp flash (${M.sharpUp}↑/${M.sharpDown}↓) + pop, no persistent pulse · ` +
    `ready: one soft glow (${M.glowUp}↑/${M.glowDown}↓) + pop · ` +
    `working: light beam travels the segment every ${M.beam + 240}ms, ▶ pulses ${M.pulse * 2}ms cycle · ` +
    "reduced motion: all static, instant · RN Animated (JS driver), same on Android",
  variants: [
    {
      id: "default",
      label: "Counts change",
      note: "Use the buttons or Auto-simulate.",
      C: SummaryDemo,
    },
  ],
};

const s = StyleSheet.create({
  line: { color: color.faint },
  panel: { backgroundColor: color.bg2, paddingTop: 10 },
});
