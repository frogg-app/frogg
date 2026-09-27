import { describe, expect, it, vi } from "vitest";
import {
  createNativeExecuteScript,
  splitSshDestination,
  type FroggSshModule,
} from "./native-ssh-executor";

function fakeModule() {
  let listener: Parameters<FroggSshModule["addListener"]>[1] | null = null;
  const removed = vi.fn();
  const module = {
    exec: vi.fn(async (options: Parameters<FroggSshModule["exec"]>[0]) => {
      listener?.({ runId: "other", stream: "stdout", text: "not mine" });
      listener?.({ runId: options.runId, stream: "stderr", text: "hello" });
      return { stdout: "out", stderr: "hello\n", code: 3 as number | null };
    }),
    cancel: vi.fn(),
    addListener: vi.fn((_event, next) => {
      listener = next;
      return { remove: removed };
    }),
  } satisfies FroggSshModule;
  return { module, removed };
}

describe("splitSshDestination", () => {
  it("splits user, host and bracketed IPv6", () => {
    expect(splitSshDestination("me@box")).toEqual({ user: "me", host: "box" });
    expect(splitSshDestination("me@[::1]")).toEqual({ user: "me", host: "::1" });
    expect(splitSshDestination("box")).toEqual({ user: "", host: "box" });
  });
});

describe("createNativeExecuteScript", () => {
  it("maps the target, streams only its own lines and cleans up", async () => {
    const { module, removed } = fakeModule();
    const lines: string[] = [];
    const result = await createNativeExecuteScript(module)({
      target: { host: "me@box", sshPort: 2200, sshPassword: "pw", privateKey: "KEY" },
      command: "sh -s",
      script: "echo",
      signal: new AbortController().signal,
      timeoutMs: 1000,
      onLine: (stream, text) => lines.push(`${stream}:${text}`),
    });
    expect(result).toEqual({ stdout: "out", stderr: "hello\n", code: 3 });
    expect(lines).toEqual(["stderr:hello"]);
    expect(module.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "box",
        port: 2200,
        user: "me",
        password: "pw",
        privateKey: "KEY",
        command: "sh -s",
        stdin: "echo",
      }),
    );
    expect(removed).toHaveBeenCalled();
  });

  it("cancels the native run on abort", async () => {
    const { module } = fakeModule();
    const controller = new AbortController();
    module.exec.mockImplementationOnce(async () => {
      controller.abort();
      return { stdout: "", stderr: "", code: null };
    });
    await createNativeExecuteScript(module)({
      target: { host: "me@box" },
      command: "sh -s",
      script: "",
      signal: controller.signal,
      timeoutMs: 1000,
    });
    expect(module.cancel).toHaveBeenCalledTimes(1);
  });
});
