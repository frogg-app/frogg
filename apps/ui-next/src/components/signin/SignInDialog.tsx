import { Check, Copy, ExternalLink } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, View } from "react-native";
import { color, motion } from "../../theme/tokens";
import { providerLabel } from "../../util";
import { Button } from "../Button";
import { Field } from "../settings/pages/kit";
import { copyText } from "../shell/copy";
import { T } from "../Text";
import { Dialog } from "../tools/Dialog";
import { stripAnsi } from "./login-flow";
import { useLoginSession } from "./session";
import { closeSignIn, useSignIn, type SignInTarget } from "./store";

/** Mount once at the app root; opens whenever something calls openSignIn. */
export function SignInDialog() {
  const target = useSignIn((st) => st.target);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!target) return null;
  // A new attempt remounts, which kills the old login process and starts a fresh one.
  return <SignIn key={attempt} target={target} onRetry={retry} />;
}

function SignIn({ target, onRetry }: { target: SignInTarget; onRetry: () => void }) {
  const login = useLoginSession(target);
  const { phase, account, state } = login;
  const name = providerLabel(target.provider);
  const failed = phase === "failed" || (phase === "waiting" && Boolean(state.error));
  const footer = useMemo(
    () => (
      <View style={s.foot}>
        {failed && <Button label="Try again" onPress={onRetry} />}
        <Button
          kind={phase === "done" ? "primary" : "ghost"}
          label={phase === "done" ? "Done" : "Cancel"}
          onPress={closeSignIn}
        />
      </View>
    ),
    [phase, failed, onRetry],
  );
  return (
    <Dialog
      open
      onClose={closeSignIn}
      eyebrow={account ? `${name} · ${account.name}` : name}
      title={phase === "done" ? "Signed in" : `Sign in to ${name}`}
      footer={footer}
      width={520}
    >
      {phase === "starting" && <Busy text="Starting sign-in on the host…" />}
      {phase === "failed" && <T style={s.err}>{login.error}</T>}
      {phase === "done" && (
        <View style={[s.doneRow, motion.enter]}>
          <Check size={16} color={color.mint} />
          <T style={s.muted}>New sessions with this account use the fresh sign-in.</T>
        </View>
      )}
      {phase === "waiting" && <Steps login={login} />}
      {phase === "waiting" && state.error && <T style={s.err}>{state.error}</T>}
    </Dialog>
  );
}

function Steps({ login }: { login: ReturnType<typeof useLoginSession> }) {
  const { state } = login;
  if (!login.headless) return <Interactive login={login} />;
  if (!state.url) return <Busy text="Waiting for the sign-in link…" />;
  return (
    <View style={s.steps}>
      <Step n={1} text="Open the sign-in page and approve access.">
        <UrlActions url={state.url} />
      </Step>
      {state.userCode && (
        <Step n={2} text="Enter this code on that page.">
          <View style={s.codeRow}>
            <T v="mono" style={s.code} selectable>
              {state.userCode}
            </T>
            <CopyButton text={state.userCode} />
          </View>
          <Busy text="Waiting for the provider to confirm…" />
        </Step>
      )}
      {state.wantsCode && !state.error && (
        <Step n={2} text="Paste the code the page shows after you approve.">
          <CodeInput onSubmit={login.sendCode} />
        </Step>
      )}
    </View>
  );
}

/** A provider without a headless flow: show what its CLI prints and pass typed lines through. */
function Interactive({ login }: { login: ReturnType<typeof useLoginSession> }) {
  const lines = stripAnsi(login.tail).trim().split("\n").slice(-12).join("\n");
  return (
    <View style={s.steps}>
      <T style={s.muted}>This provider signs in interactively. Its prompts appear below.</T>
      {login.state.url && <UrlActions url={login.state.url} />}
      <T v="mono" style={s.tail} selectable>
        {lines || "…"}
      </T>
      <CodeInput onSubmit={login.sendCode} placeholder="Type a reply and press Enter" />
    </View>
  );
}

function Step({ n, text, children }: { n: number; text: string; children?: React.ReactNode }) {
  return (
    <View style={s.step}>
      <T v="mono" style={s.stepN}>
        {n}
      </T>
      <View style={s.grow}>
        <T>{text}</T>
        {children}
      </View>
    </View>
  );
}

function UrlActions({ url }: { url: string }) {
  const open = useCallback(() => void Linking.openURL(url), [url]);
  return (
    <View style={s.actRow}>
      <Button kind="primary" icon={ExternalLink} label="Open sign-in page" onPress={open} />
      <CopyButton text={url} label="Copy link" />
    </View>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void copyText(text).then((ok) => ok && setCopied(true));
  }, [text]);
  return <Button icon={copied ? Check : Copy} label={copied ? "Copied" : label} onPress={copy} />;
}

function CodeInput({
  onSubmit,
  placeholder = "Paste code",
}: {
  onSubmit: (code: string) => void;
  placeholder?: string;
}) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const send = useCallback(() => {
    if (!code.trim()) return;
    onSubmit(code);
    setCode("");
    setSent(true);
  }, [code, onSubmit]);
  return (
    <View style={s.codeForm}>
      <View style={s.codeRow}>
        <Field
          grow
          mono
          value={code}
          onChangeText={setCode}
          onSubmitEditing={send}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button kind="primary" label="Submit" onPress={send} disabled={!code.trim()} />
      </View>
      {sent && <Busy text="Checking with the provider…" />}
    </View>
  );
}

function Busy({ text }: { text: string }) {
  return (
    <View style={s.busy}>
      <ActivityIndicator size="small" color={color.cyan2} />
      <T style={s.muted}>{text}</T>
    </View>
  );
}

const s = StyleSheet.create({
  steps: { gap: 16 },
  foot: { flexDirection: "row", gap: 8 },
  step: { flexDirection: "row", gap: 12, ...motion.enter },
  stepN: { color: color.cyan2, fontSize: 12, width: 14, paddingTop: 2 },
  grow: { flex: 1, gap: 10 },
  actRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  codeForm: { gap: 8 },
  code: { fontSize: 18, letterSpacing: 2, color: color.text },
  busy: { flexDirection: "row", alignItems: "center", gap: 8 },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  muted: { color: color.muted, fontSize: 13 },
  err: { color: color.coral, fontSize: 13 },
  tail: {
    fontSize: 11.5,
    color: color.muted,
    backgroundColor: color.bg,
    padding: 10,
    lineHeight: 17,
  },
});
