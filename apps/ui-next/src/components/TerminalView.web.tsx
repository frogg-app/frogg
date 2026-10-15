import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { getClient } from "../daemon/store";
import { usePrefs } from "../prefs";
import { color } from "../theme/tokens";

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

export function TerminalSurface({ terminalId }: { terminalId: string }) {
  const host = useRef<View>(null);
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
  return <View ref={host} style={st.fill} />;
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg, padding: 10 },
});
