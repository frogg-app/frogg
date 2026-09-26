import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  applyChatLaunchConfig,
  isChatCwd,
  isChatWebAccessEnabled,
  resolveChatsRoot,
  sanitizeChatSessionConfig,
} from "./chat-profile.js";

const root = resolveChatsRoot("/home/me/.frogg");

describe("chat profile", () => {
  test("only a directory inside the chats root is a chat", () => {
    expect(root).toBe(join("/home/me/.frogg", "chats"));
    expect(isChatCwd(root, join(root, "abc"))).toBe(true);
    expect(isChatCwd(root, join(root, "abc", "nested"))).toBe(true);
    expect(isChatCwd(root, root)).toBe(false);
    expect(isChatCwd(root, "/home/me/.frogg/chats-other/abc")).toBe(false);
    expect(isChatCwd(root, "/home/me/project")).toBe(false);
    expect(isChatCwd(null, join(root, "abc"))).toBe(false);
  });

  test("sanitizing drops everything that could widen a chat", () => {
    const sanitized = sanitizeChatSessionConfig({
      provider: "claude",
      cwd: join(root, "abc"),
      modeId: "bypassPermissions",
      model: "opus",
      mcpServers: { x: { type: "stdio", command: "x" } },
      toolPolicy: { preapproved: [{ kind: "mcp", server: "x", tool: "y" }] },
      providerOptions: { allowedTools: ["Bash"] },
      featureValues: { web_access: false },
    });
    expect(sanitized).toEqual({
      provider: "claude",
      cwd: join(root, "abc"),
      model: "opus",
      featureValues: { web_access: false },
    });
  });

  test("launch config is marked as a chat and carries the chat instructions", () => {
    const launch = applyChatLaunchConfig({
      provider: "claude",
      cwd: join(root, "abc"),
      daemonAppendSystemPrompt: "daemon prompt",
    });
    expect(launch.chat).toBe(true);
    expect(launch.daemonAppendSystemPrompt).toMatch(/^daemon prompt\n\n.*standalone chat/s);
  });

  test("web access defaults on and follows the feature value", () => {
    expect(isChatWebAccessEnabled({})).toBe(true);
    expect(isChatWebAccessEnabled({ featureValues: { web_access: true } })).toBe(true);
    expect(isChatWebAccessEnabled({ featureValues: { web_access: false } })).toBe(false);
  });
});
