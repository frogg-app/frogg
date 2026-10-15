// The two questions that tailor the walkthrough: how technical, and what kind of work.
import {
  BarChart3,
  Cloud,
  Compass,
  Globe,
  Lightbulb,
  Server,
  Smartphone,
  Sprout,
  Terminal,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { BracketScope } from "../Brackets";
import { LEVELS, WORKS, type Level, type Work } from "./model";
import { Choice, Para, StepHead } from "./parts";
import { setLevel, toggleWork, useOnboarding } from "./store";

const LEVEL_ICON: Record<Level, LucideIcon> = { new: Sprout, some: Compass, expert: Terminal };
const WORK_ICON: Record<Work, LucideIcon> = {
  web: Globe,
  backend: Server,
  mobile: Smartphone,
  data: BarChart3,
  infra: Cloud,
  explore: Lightbulb,
};

export function LevelStep() {
  const level = useOnboarding((st) => st.level);
  return (
    <>
      <StepHead
        title="Welcome to Frogg"
        lede="Two quick questions so this walkthrough fits you. First: how much should it explain?"
      />
      <BracketScope>
        <View style={s.grid}>
          {LEVELS.map((l) => (
            <Choice
              key={l.id}
              id={l.id}
              title={l.title}
              sub={l.sub}
              icon={LEVEL_ICON[l.id]}
              on={level === l.id}
              onPick={setLevel}
            />
          ))}
        </View>
      </BracketScope>
      <Para faint>
        Your answers stay on this device. Change them in Settings → Getting started.
      </Para>
    </>
  );
}

export function WorkStep() {
  const work = useOnboarding((st) => st.work);
  return (
    <>
      <StepHead
        title="What do you mostly work on?"
        lede="Pick any that fit. Frogg points you at the tools, starter prompts and settings that matter for them."
      />
      <View style={s.grid}>
        {WORKS.map((w) => (
          <Choice
            key={w.id}
            id={w.id}
            title={w.title}
            sub={w.sub}
            icon={WORK_ICON[w.id]}
            on={work.includes(w.id)}
            onPick={toggleWork}
            multi
            compact
          />
        ))}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
});
