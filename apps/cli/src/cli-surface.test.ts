import { describe, expect, it } from "vitest";
import { createCli } from "./cli.js";

/** Commands moved under `frogg agent`; look them up there. */
function agentCommand(name: string) {
  const agent = createCli().commands.find((command) => command.name() === "agent");
  return agent?.commands.find((command) => command.name() === name);
}

describe("canonical CLI surface", () => {
  it("lists namespaces separately from plain commands", () => {
    // `helpInformation()` renders commander's own sections only; the groups
    // section is appended via addHelpText, so assert the split by checking that
    // namespaces are absent from the flat list and lifecycle verbs are present.
    const help = createCli().helpInformation();
    for (const name of ["start", "stop", "restart", "status", "update", "onboard"]) {
      expect(help).toContain(name);
    }
    for (const name of ["agent", "auth", "workspace", "project"]) {
      expect(help).not.toContain(`  ${name} `);
    }
    expect(help).not.toContain("worktree");
  });

  it("keeps agent commands in one place instead of duplicating them at the root", () => {
    const cli = createCli();
    const rootNames = cli.commands.filter((c) => !("_hidden" in c)).map((c) => c.name());
    // These used to exist at the root and under `frogg agent` simultaneously.
    for (const name of ["ls", "run", "send", "inspect", "wait", "archive", "attach", "logs"]) {
      expect(rootNames).not.toContain(name);
      expect(agentCommand(name), `agent ${name} should exist`).toBeDefined();
    }
  });

  it("drops commands the client owns", () => {
    const cli = createCli();
    const names = cli.commands.map((command) => command.name());
    expect(names).not.toContain("clone");
    expect(names).not.toContain("import");
    expect(names).not.toContain("speech");
    expect(agentCommand("import")).toBeUndefined();
    expect(agentCommand("open")).toBeUndefined();
  });

  it("has no schedule or heartbeat commands", () => {
    const cli = createCli();
    const names = cli.commands.map((command) => command.name());
    expect(names).not.toContain("schedule");
    expect(names).not.toContain("heartbeat");
    expect(agentCommand("heartbeat")).toBeUndefined();
  });

  it("keeps hooks working but out of the help output", () => {
    const cli = createCli();
    // The agent hook installer shells out to it, so it must still parse.
    expect(cli.commands.find((command) => command.name() === "hooks")).toBeDefined();
    expect(cli.helpInformation()).not.toContain("hooks");
  });

  it("keeps access control under auth, with pairing a device at the root", () => {
    const cli = createCli();
    const auth = cli.commands.find((command) => command.name() === "auth");
    expect(auth?.commands.map((command) => command.name()).sort()).toEqual([
      "claim",
      "claim-mode",
      "claim-status",
      "pair",
      "reset-claim",
      "set-password",
      "trust-lan",
    ]);
    // `pair` at the root mints a pairing code for a device; `auth pair` prints
    // the relay or LAN claim offer, which is a different question.
    expect(cli.commands.map((command) => command.name())).toContain("pair");
  });

  it("promotes daemon lifecycle to the root while hiding legacy compatibility", () => {
    const cli = createCli();
    const names = cli.commands.map((command) => command.name());
    expect(names).toContain("daemon");
    expect(cli.helpInformation()).not.toMatch(/^\s+daemon(?:\s|$)/m);
    // `self-update` said the same thing twice; it is just `update` now.
    expect(names).toContain("update");
    expect(names).not.toContain("self-update");

    const reload = cli.commands.find((command) => command.name() === "reload");
    expect(reload?.helpInformation()).toContain("--host <host>");
    expect(reload?.helpInformation()).toContain("--json");
  });

  it("names explicit workspace creation without exposing older syntax", () => {
    const help = agentCommand("run")?.helpInformation();
    expect(help).toContain("--new-workspace <local|worktree>");
    expect(help).not.toContain("--isolation");
    expect(help).not.toContain("--worktree <name>");
  });

  it("offers the worktree creation options on run", () => {
    const help = agentCommand("run")?.helpInformation();
    expect(help).toContain("--worktree-mode <mode>");
    expect(help).toContain("--worktree-slug <slug>");
    expect(help).toContain("--new-branch <name>");
    expect(help).toContain("--branch <name>");
    expect(help).toContain("--pr-number <n>");
    expect(help).toContain("--forge <forge>");
  });

  it("uses background for execution and reserves detach for ownership", () => {
    const run = agentCommand("run");
    expect(run?.helpInformation()).toContain("--background");
    expect(run?.helpInformation()).not.toContain("--detach");
  });

  it("offers thinking configuration when running and updating agents", () => {
    const run = agentCommand("run");
    const update = agentCommand("update");

    expect(run?.helpInformation()).toContain("--thinking <id>");
    expect(update?.helpInformation()).toContain("--thinking <id>");
  });
});
