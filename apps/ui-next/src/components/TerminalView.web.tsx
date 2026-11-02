import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { X } from "lucide-react-native";
import { getClient } from "../daemon/store";
import { usePrefs } from "../prefs";
import { color, ease, web } from "../theme/tokens";
import { UploadBar, UploadProgress } from "./chat/Attach";
import { useDropFiles } from "./chat/dropFiles";
import { cancelUpload, isCancelled, uploadPicked, type Picked } from "./chat/upload";
import { droppedPaths } from "./terminalDrop";
import { T } from "./Text";
import { toastError } from "./toast/store";

const theme = {
  background: color.bg,
  foreground: color.text,
  cursor: color.cyan2,
  cursorAccent: color.bg,
  selectionBackground: "#25b5c855",
  black: "#0c1114",
  red: color.coral,
  green: color.mint,
  yellow: color.amber,
  blue: "#4aa3df",
  magenta: color.violet,
  cyan: color.cyan,
  white: "#d6dee0",
  brightBlack: color.faint,
  brightRed: "#ff8f8f",
  brightGreen: "#7fe3b2",
  brightYellow: "#ffd27a",
  brightBlue: "#7fc0ef",
  brightMagenta: "#b1a6fa",
  brightCyan: color.cyan2,
  brightWhite: "#ffffff",
};

const PAGE_KEYS: Record<string, string> = { PageUp: "\u001b[5~", PageDown: "\u001b[6~" };

let dropSeq = 0;

interface Sending {
  id: string;
  name: string;
  size: number;
}

type Client = NonNullable<ReturnType<typeof getClient>>;

function toDropped(p: Picked): { p: Picked; id: string } {
  dropSeq += 1;
  return { p, id: `drop${dropSeq}` };
}

const sendingRow = ({ p, id }: { p: Picked; id: string }): Sending => ({
  id,
  name: p.name,
  size: p.size,
});

/** Uploads each file to the host; the paths of those that made it, in drop order. */
async function uploadAll(client: Client, batch: { p: Picked; id: string }[]): Promise<string[]> {
  const paths = await Promise.all(
    batch.map(async ({ p, id }) => {
      try {
        return (await uploadPicked(client, p, id)).path;
      } catch (err) {
        if (!isCancelled(err)) toastError(`Could not upload ${p.name}`, err);
        return null;
      }
    }),
  );
  return paths.filter((x): x is string => !!x);
}

/**
 * Files dropped on the terminal upload to its host, then their paths are typed at the prompt,
 * the way a local terminal pastes a dropped file's path (Claude Code picks images up from it).
 */
function useTerminalDrop(target: RefObject<View | null>, terminalId: string) {
  const [sending, setSending] = useState<Sending[]>([]);
  const onDrop = useCallback(
    async (picked: Picked[]) => {
      const client = getClient();
      if (!client || !picked.length) return;
      const batch = picked.map(toDropped);
      setSending((s) => [...s, ...batch.map(sendingRow)]);
      const paths = await uploadAll(client, batch);
      const ids = new Set(batch.map((b) => b.id));
      setSending((s) => s.filter((x) => !ids.has(x.id)));
      const text = droppedPaths(paths);
      if (text) client.sendTerminalInput(terminalId, { type: "input", data: text });
    },
    [terminalId],
  );
  const over = useDropFiles(target, (p) => void onDrop(p), { enabled: true, inlineImages: false });
  return { over, sending };
}

export function TerminalSurface({ terminalId }: { terminalId: string }) {
  const host = useRef<View>(null);
  const frame = useRef<View>(null);
  const drop = useTerminalDrop(frame, terminalId);
  useEffect(() => {
    const el = host.current as unknown as HTMLElement | null;
    const client = getClient();
    if (!el || !client) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      theme,
      allowProposedApi: true,
      scrollback: usePrefs.getState().scrollback,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    // A click on the pane's padding or the strip the fitted grid leaves over lands outside xterm,
    // and the browser would move focus to the page; keep it in the terminal instead.
    const focus = (e: MouseEvent) => {
      if (e.target !== el) return;
      e.preventDefault();
      term.focus();
    };
    el.addEventListener("mousedown", focus);
    // Who gets the wheel:
    // - normal buffer: Frogg's scrollback, even when a program left mouse reporting on (or a
    //   restored snapshot carries it); Shift sends it to the program instead.
    // - alternate buffer (Claude Code's fullscreen mode, htop, less): the program, which keeps its
    //   own history; the daemon replays the program's mouse modes on attach so it gets real wheel
    //   reports, and xterm turns the wheel into arrow keys for programs without mouse reporting.
    term.attachCustomWheelEventHandler((e) => {
      if (e.shiftKey || term.buffer.active.type !== "normal") return true;
      if (term.modes.mouseTrackingMode === "none") return true;
      const lines = Math.round(e.deltaY / (e.deltaMode === 1 ? 1 : 40)) || Math.sign(e.deltaY);
      term.scrollLines(lines);
      e.preventDefault();
      return false;
    });
    // Shift+PageUp/PageDown page Frogg's scrollback; on the alternate buffer there is none, so
    // they reach the program as PageUp/PageDown (Claude Code scrolls its transcript with them).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.shiftKey || term.buffer.active.type === "normal") return true;
      const page = PAGE_KEYS[e.key];
      if (!page || e.ctrlKey || e.altKey || e.metaKey) return true;
      e.preventDefault();
      client.sendTerminalInput(terminalId, { type: "input", data: page });
      return false;
    });
    const off = client.onTerminalStreamEvent((e) => {
      if (e.terminalId !== terminalId) return;
      if (e.type === "output" || e.type === "restore") term.write(e.data);
    });
    const input = term.onData((data) =>
      client.sendTerminalInput(terminalId, { type: "input", data }),
    );
    const resize = () => {
      fit.fit();
      client.sendTerminalInput(terminalId, {
        type: "resize",
        rows: term.rows,
        cols: term.cols,
        intent: "claim",
      });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    void client
      .subscribeTerminal(terminalId, {
        restore: {
          mode: "full-snapshot",
          size: { rows: term.rows, cols: term.cols },
        },
      })
      .then(resize);
    term.focus();
    return () => {
      ro.disconnect();
      el.removeEventListener("mousedown", focus);
      off();
      input.dispose();
      client.unsubscribeTerminal(terminalId);
      term.dispose();
    };
  }, [terminalId]);
  return (
    <View ref={frame} style={st.frame} collapsable={false}>
      <View ref={host} style={st.fill} />
      <View pointerEvents="none" style={[st.dropRing, drop.over && st.dropOn]} />
      {drop.sending.length > 0 && (
        <View style={st.uploads}>
          {drop.sending.map((u) => (
            <View key={u.id} style={st.upload}>
              <T v="mono" style={st.uploadName} numberOfLines={1}>
                {u.name}
              </T>
              <UploadProgress id={u.id} size={u.size} />
              <CancelUpload id={u.id} name={u.name} />
              <UploadBar id={u.id} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function CancelUpload({ id, name }: { id: string; name: string }) {
  const cancel = useCallback(() => cancelUpload(id), [id]);
  return (
    <Pressable onPress={cancel} hitSlop={6} accessibilityLabel={`Cancel uploading ${name}`}>
      <X size={11} color={color.faint} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  frame: { flex: 1, position: "relative" },
  fill: { flex: 1, backgroundColor: color.bg, padding: 10 },
  dropRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1,
    borderColor: "transparent",
    ...web({ transition: `border-color 140ms ${ease}, background-color 140ms ${ease}` }),
  },
  dropOn: { borderColor: color.cyan2, backgroundColor: `${color.cyan2}12` },
  uploads: { position: "absolute", right: 12, bottom: 12, gap: 6, alignItems: "flex-end" },
  upload: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.raise,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 320,
    overflow: "hidden",
  },
  uploadName: { color: color.text, flexShrink: 1 },
});
