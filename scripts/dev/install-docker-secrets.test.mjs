import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../../deploy/install-docker.sh", import.meta.url));

// A fake `docker` records each argv plus what `docker run -d` sees in its
// environment; no container has been created yet.
const fakeDocker = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DOCKER_LOG"
if [ "$1" = "container" ] && [ "$2" = "inspect" ]; then exit 1; fi
if [ "$1" = "run" ] && [ "$2" = "-d" ]; then
  printf 'env FROGG_PASSWORD=%s OPENAI_API_KEY=%s\\n' "\${FROGG_PASSWORD-}" "\${OPENAI_API_KEY-}" >> "$DOCKER_LOG"
fi
exit 0
`;

test("install-docker.sh keeps the password and API keys out of docker's argv", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "install-docker-secrets-"));
  try {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "docker"), fakeDocker);
    chmodSync(path.join(bin, "docker"), 0o755);
    const log = path.join(dir, "docker.log");
    execFileSync("bash", [script], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        DOCKER_LOG: log,
        FROGG_HOME: path.join(dir, "state"),
        FROGG_NO_PULL: "1",
        FROGG_PASSWORD: "s3cret-pw",
        OPENAI_API_KEY: "sk-test-key",
      },
      stdio: "pipe",
    });
    const lines = readFileSync(log, "utf8").split("\n");
    const run = lines.find((line) => line.startsWith("run -d "));
    assert.ok(run, "docker run -d was invoked");
    assert.equal(run.includes("s3cret-pw"), false);
    assert.equal(run.includes("sk-test-key"), false);
    assert.match(run, /-e FROGG_PASSWORD(\s|$)/);
    assert.match(run, /-e OPENAI_API_KEY(\s|$)/);
    assert.ok(lines.includes("env FROGG_PASSWORD=s3cret-pw OPENAI_API_KEY=sk-test-key"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
