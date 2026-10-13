import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  REVEALS,
  RevealMarkdown,
  RevealTitle,
  revealMs,
  TITLE_REVEALS,
  type RevealMode,
  type TitleMode,
} from "../../components/chat/TextReveal";
import { Seg } from "../../components/settings/controls";
import { T } from "../../components/Text";
import { color } from "../../theme/tokens";
import { Act, Case, Cases, Controls, Stack, W, type Entry } from "../kit";
import { useLab } from "../store";

const REPLY = `I traced the flicker to the **session list** re-sorting on every status tick.

## What changed
- \`SessionList\` now memoises its rows by \`id\`, so a status change repaints one row
- the sort key ignores \`updatedAt\` while an agent is *working*
- added a regression test for rapid ticks

\`\`\`ts
const rows = useMemo(() => sortRows(sessions), [order]);
return rows.map((r) => <Row key={r.id} row={r} />);
\`\`\`

Run \`npm test -w ui-next\` to confirm; the list should stay put while agents stream.`;

type Pace = "slow" | "normal" | "fast" | "burst";
const PACES: Array<[Pace, string]> = [
  ["slow", "Slow"],
  ["normal", "Normal"],
  ["fast", "Fast"],
  ["burst", "Bursty"],
];
/** [min chunk, max chunk, min gap ms, max gap ms]. */
const PACE: Record<Pace, [number, number, number, number]> = {
  slow: [1, 6, 60, 180],
  normal: [2, 14, 30, 140],
  fast: [8, 30, 20, 70],
  burst: [1, 60, 20, 650],
};
const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

/** Simulated stream: bursty chunks of REPLY, scaled by the lab speed. */
function useStream(pace: Pace, rate: number, run: number) {
  const [len, setLen] = useState(0);
  const lenRef = useRef(0);
  useEffect(() => {
    lenRef.current = 0;
    setLen(0);
    let id: ReturnType<typeof setTimeout>;
    const [c0, c1, g0, g1] = PACE[pace];
    const step = () => {
      lenRef.current = Math.min(REPLY.length, lenRef.current + rand(c0, c1));
      setLen(lenRef.current);
      if (lenRef.current < REPLY.length) id = setTimeout(step, rand(g0, g1) / rate);
    };
    id = setTimeout(step, 400 / rate);
    return () => clearTimeout(id);
  }, [pace, rate, run]);
  return { text: REPLY.slice(0, len), streaming: len < REPLY.length };
}

type Pick = "all" | RevealMode;
const PICKS: Array<[Pick, string]> = [
  ["all", "All"],
  ...REVEALS.map((r): [Pick, string] => [r.mode, `${r.n}`]),
  ["none", "Off"],
];

function Message({
  mode,
  text,
  streaming,
  rate,
}: {
  mode: RevealMode;
  text: string;
  streaming: boolean;
  rate: number;
}) {
  return (
    <View style={s.msg}>
      <View style={s.head}>
        <View style={s.diamond} />
        <T style={s.who}>Claude</T>
      </View>
      <RevealMarkdown text={text} mode={mode} streaming={streaming} rate={rate} />
    </View>
  );
}

function StreamDemo() {
  const rate = Number(useLab((st) => st.speed));
  const [pace, setPace] = useState<Pace>("burst");
  const [pick, setPick] = useState<Pick>("all");
  const [run, setRun] = useState(0);
  const replay = useCallback(() => setRun((n) => n + 1), []);
  const { text, streaming } = useStream(pace, rate, run);
  const shown = pick === "all" ? REVEALS : REVEALS.filter((r) => r.mode === pick);
  return (
    <Stack>
      <Controls>
        <Act label="Replay stream" run={replay} primary />
        <Seg options={PACES} value={pace} onChange={setPace} />
        <Seg options={PICKS} value={pick} onChange={setPick} />
      </Controls>
      <T v="mono" style={s.line}>
        {`${text.length}/${REPLY.length} chars · ${streaming ? "streaming" : "done"} · lab speed ${rate}×`}
      </T>
      {pick === "none" ? (
        <Cases>
          <Case name="Markdown" props="(production, no reveal)" w={680}>
            <Message mode="none" text={text} streaming={streaming} rate={rate} />
          </Case>
        </Cases>
      ) : null}
      <Cases>
        {shown.map((r) => (
          <OptionCases
            key={`${r.mode}${run}`}
            r={r}
            single={pick !== "all"}
            text={text}
            streaming={streaming}
            rate={rate}
          />
        ))}
      </Cases>
    </Stack>
  );
}

function OptionCases({
  r,
  single,
  text,
  streaming,
  rate,
}: {
  r: (typeof REVEALS)[number];
  single: boolean;
  text: string;
  streaming: boolean;
  rate: number;
}) {
  const name = `${r.n}. ${r.label}`;
  const props = `mode="${r.mode}"`;
  return (
    <>
      {single && (
        <Case name={name} props={props} note={r.spec} w={680}>
          <Message mode={r.mode} text={text} streaming={streaming} rate={rate} />
        </Case>
      )}
      <Case name={name} props={props} note={single ? "Phone width." : r.spec} w={W.phone}>
        <Message mode={r.mode} text={text} streaming={streaming} rate={rate} />
      </Case>
    </>
  );
}

const TITLES = ["What do you want to know?", "Agent crashed", "Source control"];

function TitleDemo() {
  const rate = Number(useLab((st) => st.speed));
  const [run, setRun] = useState(0);
  const replay = useCallback(() => setRun((n) => n + 1), []);
  useEffect(() => {
    const id = setInterval(replay, 2600 / rate);
    return () => clearInterval(id);
  }, [replay, rate]);
  return (
    <Stack>
      <Controls>
        <Act label="Replay" run={replay} primary />
      </Controls>
      <Cases>
        {TITLE_REVEALS.map((t) => (
          <TitleCase
            key={t.mode}
            mode={t.mode}
            label={t.label}
            spec={t.spec}
            run={run}
            rate={rate}
          />
        ))}
      </Cases>
    </Stack>
  );
}

function TitleCase({
  mode,
  label,
  spec,
  run,
  rate,
}: {
  mode: TitleMode;
  label: string;
  spec: string;
  run: number;
  rate: number;
}) {
  return (
    <Case name={label} props={`mode="${mode}"`} note={spec} w={W.phone}>
      <View style={s.titles}>
        <RevealTitle key={`a${run}`} text={TITLES[0]} mode={mode} style={s.hero} rate={rate} />
        <RevealTitle
          key={`b${run}`}
          text={TITLES[1]}
          mode={mode}
          style={s.crash}
          rate={rate}
          tone="coral"
        />
        <RevealTitle key={`c${run}`} text={TITLES[2]} mode={mode} style={s.panel} rate={rate} />
      </View>
    </Case>
  );
}

export const textReveal: Entry = {
  id: "text-reveal",
  name: "Text reveal",
  category: "Chat",
  path: "components/chat/TextReveal.tsx",
  purpose:
    "How streamed assistant text and one-shot titles appear. Production uses these (Settings → Design options): chat replies via RevealMarkdown, panel titles, the home heading and the session title via RevealHeading. Web animates with CSS; native runs every mode from a shared frame clock.",
  usedBy: 0,
  polish:
    REVEALS.map((r) => `${r.n} ${r.label}: ${r.spec}`).join(" · ") +
    ` · only pieces younger than their animation are spans; the rest is plain text (pruned on a timer) · ` +
    `history present at mount never animates · no reflow: opacity/filter/mask/top/left on inline spans, scramble overlays transparent real text · ` +
    `reduced motion (prefers-reduced-motion / OS setting): instant · native equivalents are text-colour alpha/tint on a shared rAF clock (only live spans re-render): fade has no rise, blur is an alpha fade from a cool cyan tint (no blur), slide is a whole-chunk alpha fade (no translate), wipe is per-char alpha/tint with a soft edge, scramble swaps glyphs in place at ~30fps (minor reflow), caret blinks via the clock · caret idle after ${revealMs.caretIdle}ms`,
  decision:
    "Pick the streaming text reveal (1–8) and heading reveal. Switchable on-device in Settings → Design options.",
  variants: [
    {
      id: "stream",
      label: "Streaming reply",
      note: "Bursty stream by default; pick one option to see it at 680 and 390, or All at 390. Lab speed slows the stream too.",
      C: StreamDemo,
    },
    {
      id: "titles",
      label: "Heading reveals",
      note: "One-shot on mount; replays every 2.6s.",
      C: TitleDemo,
    },
  ],
};

const s = StyleSheet.create({
  line: { color: color.faint },
  msg: { padding: 16, gap: 8, minHeight: 420 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  diamond: { width: 7, height: 7, backgroundColor: color.cyan, transform: [{ rotate: "45deg" }] },
  who: { fontSize: 12, color: color.muted },
  titles: { padding: 20, gap: 18 },
  hero: { fontSize: 24 },
  crash: { fontSize: 18, color: color.coral },
  panel: { fontSize: 13, color: color.text },
});
