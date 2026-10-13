import { Component, useCallback, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { anim, color, ease, web } from "../../theme/tokens";
import { Button } from "../Button";
import { T } from "../Text";
import { copyText } from "./copy";

interface State {
  error: Error | null;
  stack: string;
}

/** Root error boundary: a crash in any view shows the "This view crashed" page instead of a blank app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.setState({ stack: (error.stack ?? info.componentStack ?? "").trim() });
  }

  reset = () => this.setState({ error: null, stack: "" });

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return <Crashed error={error} stack={stack} onRetry={this.reset} />;
  }
}

const EDGES_ALL = ["top", "bottom", "left", "right"] as const;

/** First few frames, without the message line `Error.stack` repeats on V8. */
function frames(stack: string): string {
  return stack
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("at ") || l.includes("@"))
    .slice(0, 4)
    .join("\n");
}

export function Crashed({
  error,
  stack,
  onRetry,
}: {
  error: Error;
  stack: string;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const trace = frames(stack);
  const copy = useCallback(() => {
    void copyText(`${error.name}: ${error.message}\n${stack}`).then(setCopied);
  }, [error, stack]);
  return (
    <SafeAreaView edges={EDGES_ALL} style={s.root}>
      <View style={s.head}>
        <View style={s.inEyebrow}>
          <T v="label">Something broke</T>
        </View>
        <View style={s.inTitle}>
          <T v="display" style={s.title}>
            This view crashed
          </T>
        </View>
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.inMark}>
          <View style={s.mark} />
        </View>
        <View style={s.inMsg}>
          <T style={s.msg}>
            {error.name}: {error.message}. Your sessions keep running on their hosts.
          </T>
        </View>
        {!!trace && (
          <View style={[s.trace, s.inTrace]}>
            <T v="mono" style={s.traceT}>
              {trace}
            </T>
          </View>
        )}
        <View style={[s.acts, s.inActs]}>
          <Button kind="primary" label="Try again" onPress={onRetry} />
          <View key={copied ? "copied" : "copy"} style={s.swap}>
            <Button label={copied ? "Copied" : "Copy details"} onPress={copy} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Entry motion (web; native renders the settled state, and the global reduced-motion rule
 * collapses it): eyebrow glitches once, title rises, the coral glyph snaps 1.3 -> 1 with a
 * flash, message rises, trace slides in, buttons last. Everything settles by ~420ms on `ease`.
 */
const glow = `${color.coral}cc`;
const crashFrames = {
  glitch: {
    "0%": { opacity: 0, transform: "translateX(-6px)" },
    "30%": { opacity: 1, transform: "translateX(3px)" },
    "45%": { opacity: 0.3, transform: "translateX(-2px)" },
    "60%": { opacity: 1, transform: "translateX(1px)" },
    "100%": { opacity: 1, transform: "translateX(0px)" },
  },
  rise: {
    "0%": { opacity: 0, transform: "translateY(8px)" },
    "100%": { opacity: 1, transform: "translateY(0px)" },
  },
  snap: {
    "0%": { opacity: 0, transform: "scale(1.3)", boxShadow: `0 0 0px 0px ${glow}` },
    "35%": { opacity: 1, transform: "scale(0.96)", boxShadow: `0 0 18px 6px ${glow}` },
    "100%": { opacity: 1, transform: "scale(1)", boxShadow: `0 0 0px 0px ${color.coral}00` },
  },
  slide: {
    "0%": { opacity: 0, transform: "translateY(10px) scaleY(0.96)" },
    "100%": { opacity: 1, transform: "translateY(0px) scaleY(1)" },
  },
  fade: { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
};
const step = (kf: Record<string, Record<string, string | number>>, ms: number, delay: number) => ({
  ...anim(kf, `${ms}ms`, ease),
  ...web({ animationDelay: `${delay}ms` }),
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  inEyebrow: step(crashFrames.glitch, 180, 0),
  inTitle: step(crashFrames.rise, 220, 40),
  inMark: step(crashFrames.snap, 260, 60),
  inMsg: step(crashFrames.rise, 220, 120),
  inTrace: step(crashFrames.slide, 240, 170),
  inActs: step(crashFrames.rise, 200, 220),
  swap: step(crashFrames.fade, 140, 0),
  head: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 14,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  title: { fontSize: 21 },
  body: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  mark: { width: 18, height: 16, backgroundColor: color.coral },
  msg: { color: color.muted, textAlign: "center", maxWidth: 460, lineHeight: 21 },
  trace: {
    maxWidth: "100%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: color.panel,
  },
  traceT: { color: color.text, fontSize: 11.5, lineHeight: 19 },
  acts: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
});
