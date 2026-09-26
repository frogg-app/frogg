import { describe, expect, test } from "vitest";

import { buildClaudeChatOptions, resolveClaudeChatPermission } from "./chat-options.js";

const cwd = "/home/me/.frogg/chats/abc";

describe("Claude chat options", () => {
  test("isolate the session from settings, skills, plugins and MCP", () => {
    const options = buildClaudeChatOptions({});
    expect(options).toMatchObject({
      permissionMode: "default",
      settingSources: [],
      skills: [],
      plugins: [],
      mcpServers: {},
      strictMcpConfig: true,
    });
    expect(options.agents).toBeUndefined();
    expect(options.tools).toEqual(
      expect.arrayContaining(["Read", "Glob", "Grep", "Write", "Edit", "WebSearch", "WebFetch"]),
    );
    expect(options.tools).not.toContain("Bash");
  });

  test("drop the web tools when web access is off", () => {
    const tools = buildClaudeChatOptions({
      featureValues: { web_access: false },
    }).tools;
    expect(tools).not.toContain("WebSearch");
    expect(tools).not.toContain("WebFetch");
  });

  test("allow reads anywhere and writes only inside the chat directory", () => {
    const decide = (toolName: string, toolInput: Record<string, unknown>, webAccess = true) =>
      resolveClaudeChatPermission({ toolName, toolInput, cwd, webAccess })?.behavior ?? "ask";

    expect(decide("Read", { file_path: "/etc/hosts" })).toBe("allow");
    expect(decide("Write", { file_path: `${cwd}/notes.md` })).toBe("allow");
    expect(decide("Edit", { file_path: "notes.md" })).toBe("allow");
    expect(decide("Write", { file_path: "/home/me/.bashrc" })).toBe("deny");
    expect(decide("Write", { file_path: `${cwd}/../other/x` })).toBe("deny");
    expect(decide("Bash", { command: "ls" })).toBe("deny");
    expect(decide("WebFetch", { url: "https://x" })).toBe("allow");
    expect(decide("WebFetch", { url: "https://x" }, false)).toBe("deny");
    expect(decide("AskUserQuestion", {})).toBe("ask");
  });
});
