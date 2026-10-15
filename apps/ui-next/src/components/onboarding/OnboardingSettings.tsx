// Settings → Getting started: reopen the walkthrough, see progress, change the answers.
import { Play, RotateCcw } from "lucide-react-native";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../Button";
import { Row, Section, Seg } from "../settings/controls";
import { LEVELS, WORKS, progressOf, type Level } from "./model";
import { Choice, Progress } from "./parts";
import { useDone } from "./progress";
import {
  openOnboarding,
  resetOnboarding,
  restartOnboarding,
  setLevel,
  toggleWork,
  useOnboarding,
} from "./store";

const LEVEL_OPTIONS = LEVELS.map((l) => [l.id, l.title] as [Level, string]);
const resume = () => openOnboarding();

export function OnboardingSettings() {
  const status = useOnboarding((st) => st.status);
  const level = useOnboarding((st) => st.level);
  const work = useOnboarding((st) => st.work);
  const done = useDone();
  const { done: n, total } = progressOf(done);
  const pickLevel = useCallback((v: Level) => setLevel(v), []);
  const finished = status === "finished";
  return (
    <>
      <Section title="Walkthrough">
        <Row
          label="Progress"
          hint={finished ? "Finished. Run it again any time." : `${n} of ${total} steps done`}
        >
          <View style={s.progress}>
            <Progress done={n} total={total} />
          </View>
        </Row>
        <Row
          label={
            finished || status === "new" ? "Open the walkthrough" : "Resume where you left off"
          }
          hint="Also in the command palette: Getting started."
        >
          <Button label="Open" icon={Play} kind="primary" onPress={resume} />
        </Row>
        <Row label="Start over" hint="Back to the first question; your answers are kept." last>
          <Button label="Restart" icon={RotateCcw} onPress={restartOnboarding} />
        </Row>
      </Section>
      <Section title="Your answers">
        <Row label="How much to explain" hint="Changes how much each step and hint spells out.">
          <Seg options={LEVEL_OPTIONS} value={level ?? "some"} onChange={pickLevel} />
        </Row>
        <Row label="Your work" hint="Picks the starter prompts, concepts and suggested settings.">
          <View style={s.work}>
            {WORKS.map((w) => (
              <Choice
                key={w.id}
                id={w.id}
                title={w.title}
                on={work.includes(w.id)}
                onPick={toggleWork}
                multi
                compact
              />
            ))}
          </View>
        </Row>
        <Row
          label="Forget answers"
          hint="Clears answers and progress on this device. Nothing on the host changes."
          last
        >
          <Button label="Forget" kind="danger" onPress={resetOnboarding} />
        </Row>
      </Section>
    </>
  );
}

const s = StyleSheet.create({
  progress: { width: 200 },
  work: { flexBasis: "100%", flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
