import { Component, useCallback, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color } from "../../theme/tokens";
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
        <T v="label">Something broke</T>
        <T v="display" style={s.title}>
          This view crashed
        </T>
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.mark} />
        <T style={s.msg}>
          {error.name}: {error.message}. Your sessions keep running on their hosts.
        </T>
        {!!trace && (
          <View style={s.trace}>
            <T v="mono" style={s.traceT}>
              {trace}
            </T>
          </View>
        )}
        <View style={s.acts}>
          <Button kind="primary" label="Try again" onPress={onRetry} />
          <Button label={copied ? "Copied" : "Copy details"} onPress={copy} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
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
