import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { getClient } from "../daemon/store";
import { color } from "../theme/tokens";

const theme = {
  background: color.bg, foreground: color.text, cursor: color.cyan2, cursorAccent: color.bg,
  selectionBackground: "#25b5c855", black: "#0c1114", red: color.coral, green: color.mint, yellow: color.amber,
  blue: "#4aa3df", magenta: color.violet, cyan: color.cyan, white: "#d6dee0", brightBlack: color.faint,
  brightRed: "#ff8f8f", brightGreen: "#7fe3b2", brightYellow: "#ffd27a", brightBlue: "#7fc0ef",
  brightMagenta: "#b1a6fa", brightCyan: color.cyan2, brightWhite: "#ffffff",
};

export function TerminalSurface({ terminalId }: { terminalId: string }) {
  const host = useRef<View>(null);
  useEffect(() => {
    const el = host.current as unknown as HTMLElement | null;
    const client = getClient();
    if (!el || !client) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 13, lineHeight: 1.25,
      cursorBlink: true, theme, allowProposedApi: true, scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    const off = client.onTerminalStreamEvent((e) => {
      if (e.terminalId !== terminalId) return;
      if (e.type === "output" || e.type === "restore") term.write(e.data);
    });
    const input = term.onData((data) => client.sendTerminalInput(terminalId, { type: "input", data }));
    const resize = () => {
      fit.fit();
      client.sendTerminalInput(terminalId, { type: "resize", rows: term.rows, cols: term.cols, intent: "claim" });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    void client
      .subscribeTerminal(terminalId, { restore: { mode: "full-snapshot", size: { rows: term.rows, cols: term.cols } } })
      .then(resize);
    term.focus();
    return () => {
      ro.disconnect();
      off();
      input.dispose();
      client.unsubscribeTerminal(terminalId);
      term.dispose();
    };
  }, [terminalId]);
  return <View ref={host} style={{ flex: 1, backgroundColor: color.bg, padding: 10 }} />;
}
