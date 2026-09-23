import { PassThrough } from "node:stream";
import { connect, createServer, type Server } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { SshForwardManager, type SshChild } from "./forward.js";

/** A fake `ssh -W`: whatever is written to stdin comes back through a real echo server. */
function fakeSsh(): { spawnSsh: ReturnType<typeof vi.fn>; children: SshChild[]; args: string[][] } {
  const children: SshChild[] = [];
  const args: string[][] = [];
  const spawnSsh = vi.fn((sshArgs: string[]) => {
    args.push(sshArgs);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.on("data", (chunk: Buffer) => stdout.write(Buffer.from(`echo:${chunk.toString()}`)));
    const handlers: Record<string, ((...rest: unknown[]) => void)[]> = {};
    const child: SshChild = {
      stdin,
      stdout,
      stderr: new PassThrough(),
      killed: false,
      kill() {
        child.killed = true;
        for (const handler of handlers.exit ?? []) handler();
      },
      on(event, handler) {
        (handlers[event] ??= []).push(handler);
      },
    };
    children.push(child);
    return child;
  });
  return { spawnSsh, children, args };
}

function manager(spawnSsh: ReturnType<typeof vi.fn>) {
  return new SshForwardManager({
    passwordEnvironment: async () => ({ env: {}, cleanup: () => undefined }),
    spawnSsh: spawnSsh as never,
  });
}

/** Opens one connection to the forward so its ssh child is spawned. */
async function touch(endpoint: string): Promise<void> {
  const port = Number(endpoint.split(":")[1]);
  await new Promise<void>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write("x");
      socket.end();
      resolve();
    });
    socket.on("error", reject);
  });
}

describe("ssh pairing forward", () => {
  it("forwards a loopback connection to the daemon's own port", async () => {
    const ssh = fakeSsh();
    const forwards = manager(ssh.spawnSsh);
    const forward = await forwards.open({ host: "u@box", sshPort: 2222 }, 9999);
    expect(forward.endpoint).toMatch(/^127\.0\.0\.1:\d+$/u);

    const port = Number(forward.endpoint.split(":")[1]);
    const echoed = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => socket.write("claim"));
      socket.on("data", (chunk: Buffer) => {
        resolve(chunk.toString());
        socket.destroy();
      });
      socket.on("error", reject);
    });
    expect(echoed).toBe("echo:claim");
    expect(ssh.args[0]).toEqual(expect.arrayContaining(["-W", "127.0.0.1:9999", "u@box"]));
    expect(ssh.args[0]).toEqual(expect.arrayContaining(["-p", "2222"]));
    forwards.closeAll();
  });

  it("uses the deploy's key file so the forward authenticates like the deploy did", async () => {
    const ssh = fakeSsh();
    const forwards = manager(ssh.spawnSsh);
    const forward = await forwards.open({ host: "box", identityFile: "~/.ssh/id_ed25519" }, 9999);
    await touch(forward.endpoint);
    expect(ssh.args[0]).toEqual(
      expect.arrayContaining(["-i", "~/.ssh/id_ed25519", "-o", "IdentitiesOnly=yes"]),
    );
    forwards.closeAll();
  });

  it("closes the listener and kills its ssh children, and refuses connections after", async () => {
    const ssh = fakeSsh();
    const forwards = manager(ssh.spawnSsh);
    const forward = await forwards.open({ host: "box" }, 9999);
    const port = Number(forward.endpoint.split(":")[1]);
    await touch(forward.endpoint);

    expect(forwards.close(forward.forwardId)).toEqual({ closed: true });
    expect(forwards.close(forward.forwardId)).toEqual({ closed: false });
    for (const child of ssh.children) expect(child.killed).toBe(true);

    await expect(
      new Promise((resolve, reject) => {
        const socket = connect(port, "127.0.0.1", () => resolve("connected"));
        socket.on("error", reject);
      }),
    ).rejects.toThrow();
  });

  it("binds loopback only, so nothing off this machine can borrow the forward", async () => {
    const ssh = fakeSsh();
    const forwards = manager(ssh.spawnSsh);
    const forward = await forwards.open({ host: "box" }, 9999);
    const port = Number(forward.endpoint.split(":")[1]);
    // The same port is still free on another local address.
    const other: Server = createServer();
    await new Promise<void>((resolve, reject) => {
      other.once("error", reject);
      other.listen(port, "127.0.0.2", () => resolve());
    });
    other.close();
    forwards.closeAll();
  });
});
