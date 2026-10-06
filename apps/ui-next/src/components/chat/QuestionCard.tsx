import { MessageSquare } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { Agent } from "../../daemon/types";
import { color, font, web } from "../../theme/tokens";
import { providerLabel } from "../../util";
import { Button } from "../Button";
import { Cut } from "../Cut";
import { T } from "../Text";
import { toastError } from "../toast/store";
import { answerQuestion, denyWithMessage } from "./actions";

type Permission = Agent["pendingPermissions"][number];

interface Question {
  question: string;
  header: string;
  options: Array<{ label: string; description?: string }>;
  multi: boolean;
  other: boolean;
  placeholder?: string;
}

/** The provider's AskUserQuestion-style input, or null when it is not one. */
export function parseQuestions(input: unknown): Question[] | null {
  const raw = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(raw)) return null;
  const out: Question[] = [];
  for (const q of raw as Array<Record<string, unknown>>) {
    if (typeof q?.question !== "string") return null;
    const options = Array.isArray(q.options)
      ? (q.options as Array<Record<string, unknown>>)
          .filter((o) => typeof o?.label === "string")
          .map((o) => ({
            label: o.label as string,
            description: typeof o.description === "string" ? o.description : undefined,
          }))
      : [];
    out.push({
      question: q.question,
      header: typeof q.header === "string" ? q.header : q.question,
      options,
      multi: q.multiSelect === true,
      other: q.allowOther !== false && (q.isOther === true || options.length > 0),
      placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined,
    });
  }
  return out.length ? out : null;
}

const OTHER = -1;

/** Agent question with options, one question at a time, Other… for free text. */
export function QuestionCard({ agent, p }: { agent: Agent; p: Permission }) {
  const questions = useMemo(() => parseQuestions(p.input) ?? [], [p.input]);
  const [at, setAt] = useState(0);
  const [picks, setPicks] = useState<Record<number, number[]>>({});
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const q = questions[at];
  const chosen = picks[at] ?? [];
  const freeOnly = q ? q.options.length === 0 : false;
  const otherOn = freeOnly || chosen.includes(OTHER);
  const answered = otherOn ? !!texts[at]?.trim() : chosen.length > 0;
  const last = at === questions.length - 1;

  const choose = useCallback(
    (i: number) => {
      if (busy) return;
      setPicks((cur) => {
        const prev = cur[at] ?? [];
        if (!q?.multi || i === OTHER) return { ...cur, [at]: [i] };
        const base = prev.filter((x) => x !== OTHER);
        return { ...cur, [at]: base.includes(i) ? base.filter((x) => x !== i) : [...base, i] };
      });
    },
    [at, q?.multi, busy],
  );
  const setText = useCallback((t: string) => setTexts((cur) => ({ ...cur, [at]: t })), [at]);
  const next = useCallback(() => {
    if (busy || !answered) return;
    if (!last) {
      setAt((n) => n + 1);
      return;
    }
    const answers: Record<string, string> = {};
    questions.forEach((qq, n) => {
      const sel = picks[n] ?? [];
      const free = qq.options.length === 0 || sel.includes(OTHER);
      answers[qq.header] = free
        ? (texts[n] ?? "").trim()
        : sel.map((i) => qq.options[i]?.label ?? "").join(", ");
    });
    setBusy(true);
    answerQuestion(agent.id, p, answers).catch((e) => {
      setBusy(false);
      toastError("Could not send the answer", e);
    });
  }, [busy, answered, last, questions, picks, texts, agent.id, p]);
  const back = useCallback(() => setAt((n) => Math.max(0, n - 1)), []);
  const dismiss = useCallback(() => {
    setBusy(true);
    denyWithMessage(agent.id, p.id, "Dismissed by user").catch((e) => {
      setBusy(false);
      toastError("Could not dismiss", e);
    });
  }, [agent.id, p.id]);

  if (!q) return null;
  return (
    <Cut size={10} flip style={s.card}>
      <View style={s.head}>
        <MessageSquare size={13} color={color.amber} />
        <T style={s.kind}>
          {questions.length > 1 ? `Question ${at + 1} of ${questions.length}` : "Question"}
        </T>
        <T v="mono" style={s.who}>
          {providerLabel(agent.provider)}
        </T>
      </View>
      <T style={s.q}>{q.question}</T>
      <View style={s.opts}>
        {q.options.map((o, i) => (
          <Option
            key={o.label}
            index={i}
            label={o.label}
            hint={o.description}
            on={chosen.includes(i)}
            onPick={choose}
          />
        ))}
        {q.other && !freeOnly && (
          <Option index={OTHER} label="Other…" on={otherOn} onPick={choose} />
        )}
      </View>
      {otherOn && (
        <TextInput
          value={texts[at] ?? ""}
          onChangeText={setText}
          placeholder={q.placeholder ?? "Type your answer"}
          placeholderTextColor={color.faint}
          style={s.input}
          autoFocus={!freeOnly}
          onSubmitEditing={next}
        />
      )}
      <View style={s.actions}>
        <Pressable onPress={dismiss} disabled={busy} hitSlop={6}>
          <T style={s.link}>Dismiss</T>
        </Pressable>
        <View style={s.spacer} />
        {at > 0 && <Button label="Back" onPress={back} disabled={busy} />}
        <Button
          kind="primary"
          label={last ? "Send answer" : "Next"}
          kbd="⏎"
          onPress={next}
          disabled={!answered || busy}
        />
      </View>
    </Cut>
  );
}

function Option({
  index,
  label,
  hint,
  on,
  onPick,
}: {
  index: number;
  label: string;
  hint?: string;
  on: boolean;
  onPick: (i: number) => void;
}) {
  const checkedState = useMemo(() => ({ checked: on }), [on]);
  const press = useCallback(() => onPick(index), [index, onPick]);
  return (
    <Pressable onPress={press} accessibilityRole="radio" accessibilityState={checkedState}>
      {({ hovered }) => (
        <View style={[s.opt, hovered && s.optH, on && s.optOn]}>
          <View style={[s.radio, on && s.radioOn]} />
          <View style={s.optText}>
            <T style={s.optLabel}>{label}</T>
            {hint && <T style={s.optHint}>{hint}</T>}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: `${color.amber}73`,
    backgroundColor: `${color.amber}08`,
    paddingVertical: 14,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 },
  kind: { color: color.amber, fontWeight: "600", fontSize: 12.5 },
  who: { marginLeft: "auto" },
  q: { fontSize: 15, marginTop: 10, paddingHorizontal: 14, lineHeight: 22 },
  opts: { marginTop: 10 },
  opt: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  optH: { backgroundColor: color.wash },
  optOn: {
    backgroundColor: `${color.amber}24`,
    ...web({
      backgroundImage: `linear-gradient(90deg, ${color.amber}52, ${color.amber}0a)`,
    }),
  },
  radio: {
    width: 9,
    height: 9,
    marginTop: 5,
    borderWidth: 1,
    borderColor: color.muted,
    transform: [{ rotate: "45deg" }],
  },
  radioOn: { backgroundColor: color.amber, borderColor: color.amber },
  optText: { flex: 1 },
  optLabel: { fontSize: 14 },
  optHint: { fontSize: 12, color: color.muted, marginTop: 2 },
  input: {
    marginHorizontal: 14,
    marginTop: 6,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.bg,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13.5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...web({ outlineStyle: "none" }),
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 14,
  },
  spacer: { flex: 1 },
  link: { fontSize: 12.5, color: color.muted },
});
