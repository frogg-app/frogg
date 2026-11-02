import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "./agent-sdk-types.js";
import {
  capOutput,
  parseShellEscape,
  prependShellContext,
  runShellEscape,
  shellEscape,
  shellEscapeContext,
} from "./shell-escape.js";

describe("parseShellEscape", () => {
  it("takes the command of a !cmd prompt", () => {
    expect(parseShellEscape("!ls -la")).toBe("ls -la");
    expect(parseShellEscape("  ! git status ")).toBe("git status");
    expect(parseShellEscape([{ type: "text", text: "!pwd" }])).toBe("pwd");
  });
  it("ignores everything else", () => {
    expect(parseShellEscape("ls")).toBeNull();
    expect(parseShellEscape("!")).toBeNull();
    expect(parseShellEscape("say !hi")).toBeNull();
    expect(
      parseShellEscape([
        { type: "text", text: "!ls" },
        { type: "image", data: "", mimeType: "image/png" },
      ]),
    ).toBeNull();
  });
});

describe("context", () => {
  it("uses Claude Code's bash-mode tags", () => {
    const ctx = shellEscapeContext("echo hi", {
      stdout: "hi\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
    expect(ctx).toBe(
      "<bash-input>echo hi</bash-input>\n<bash-stdout>hi\n</bash-stdout><bash-stderr></bash-stderr>",
    );
  });
  it("goes ahead of the next prompt, string or blocks", () => {
    expect(prependShellContext("next", ["A", "B"])).toBe("A\n\nB\n\nnext");
    expect(prependShellContext([{ type: "text", text: "next" }], ["A"])).toEqual([
      { type: "text", text: "A" },
      { type: "text", text: "next" },
    ]);
    expect(prependShellContext("next", [])).toBe("next");
  });
  it("keeps the tail of long output", () => {
    const out = capOutput("x".repeat(15) + "END", 10);
    expect(out.endsWith("xxxxxxxEND")).toBe(true);
    expect(out).toContain("8 earlier characters dropped");
  });
});

describe.skipIf(process.platform === "win32")("running", () => {
  it("runs in the cwd and reports a shell tool call", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shell-escape-"));
    const events: AgentStreamEvent[] = [];
    const ctx = await shellEscape({
      command: "pwd; echo oops >&2; exit 3",
      cwd,
      provider: "claude",
      emit: (e) => events.push(e),
    });
    expect(
      events.map((e) =>
        e.type === "timeline" && e.item.type === "tool_call" ? e.item.status : null,
      ),
    ).toEqual(["running", "failed"]);
    const last = events[1];
    expect(
      last?.type === "timeline" && last.item.type === "tool_call" && last.item.detail,
    ).toMatchObject({
      type: "shell",
      command: "pwd; echo oops >&2; exit 3",
      exitCode: 3,
    });
    expect(ctx).toContain(cwd);
    expect(ctx).toContain("<bash-stderr>oops");
  });
  it("stops a command that runs too long", async () => {
    const r = await runShellEscape("sleep 5", tmpdir(), 200);
    expect(r.timedOut).toBe(true);
  });
});
