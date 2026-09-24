import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanGitHubActionsLog,
  fetchGitHubActionsJobLog,
  parseGitHubActionsJobId,
} from "./github-actions.js";
import { saveCiJobLog } from "./job-log-file.js";

describe("CI job logs", () => {
  let home: string | null = null;
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
    home = null;
  });

  it("reads the GitHub job id out of a CI job id", () => {
    expect(parseGitHubActionsJobId("githubActions:job:1000008222")).toBe(1000008222);
    expect(parseGitHubActionsJobId("jenkins:job:12")).toBeNull();
    expect(parseGitHubActionsJobId("githubActions:job:abc")).toBeNull();
  });

  it("drops timestamps and colour codes but keeps the text", () => {
    const raw =
      "﻿2026-09-24T11:00:53.1429260Z ##[group]Run tests\r\n" +
      "2026-09-24T11:00:53.1431446Z \u001b[31mFAIL\u001b[0m src/a.test.ts\n" +
      "no timestamp here";
    expect(cleanGitHubActionsLog(raw)).toBe(
      "##[group]Run tests\nFAIL src/a.test.ts\nno timestamp here",
    );
  });

  it("fetches the job's log endpoint", async () => {
    const paths: string[] = [];
    const text = await fetchGitHubActionsJobLog({
      apiText: async (path) => {
        paths.push(path);
        return "2026-09-24T11:00:53Z hello";
      },
      jobId: 42,
    });
    expect(paths).toEqual(["repos/{owner}/{repo}/actions/jobs/42/logs"]);
    expect(text).toBe("hello");
  });

  it("saves the log under uploads as an attachable file", async () => {
    home = await mkdtemp(join(tmpdir(), "ci-log-"));
    const file = await saveCiJobLog({
      froggHome: home,
      jobKey: "42",
      jobName: "unit tests (server) 5/5",
      text: "hello",
      now: 1,
    });
    expect(file).toMatchObject({
      type: "uploaded_file",
      id: "ci-log_42_1",
      fileName: "unit-tests-_server_-5_5.log",
      mimeType: "text/plain",
      size: 5,
    });
    expect(file.path.startsWith(join(home, "uploads", "ci-log_42_1"))).toBe(true);
    expect(await readFile(file.path, "utf8")).toBe("hello");
  });
});
