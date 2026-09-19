import { describe, expect, it } from "vitest";
import { buildJenkinsJobUrl, listJenkinsRuns } from "./jenkins.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("buildJenkinsJobUrl", () => {
  it("nests folders and double-encodes multibranch branch names", () => {
    expect(
      buildJenkinsJobUrl({ url: "https://ci.example.com/", job: "team/frogg" }, "feature/x"),
    ).toBe("https://ci.example.com/job/team/job/frogg/job/feature%252Fx/");
    expect(
      buildJenkinsJobUrl(
        { url: "https://ci.example.com", job: "frogg", multibranch: false },
        "main",
      ),
    ).toBe("https://ci.example.com/job/frogg/");
  });
});

describe("listJenkinsRuns", () => {
  const config = { url: "https://ci.example.com", job: "frogg" };

  it("reports the latest build with one job per pipeline stage", async () => {
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      if (url.includes("/api/json")) {
        return jsonResponse({
          displayName: "frogg",
          lastBuild: {
            number: 58,
            url: "https://ci.example.com/job/frogg/job/main/58/",
            building: true,
            result: null,
            timestamp: 1_000,
            estimatedDuration: 10_000,
            builtOn: "agent-linux-2",
            actions: [{ causes: [{ shortDescription: "Started by an SCM change" }] }, null],
          },
        });
      }
      return jsonResponse({
        stages: [
          {
            id: "6",
            name: "Build",
            status: "SUCCESS",
            startTimeMillis: 1_000,
            durationMillis: 3_000,
          },
          { id: "9", name: "Test", status: "IN_PROGRESS", startTimeMillis: 4_000 },
          { id: "12", name: "Deploy", status: "NOT_EXECUTED" },
        ],
      });
    };

    const runs = await listJenkinsRuns({
      config,
      branch: "main",
      credentials: { user: "me", token: "t" },
      fetch: fetchImpl,
      now: 6_000,
    });

    expect(seen[0]?.auth).toBe(`Basic ${Buffer.from("me:t").toString("base64")}`);
    expect(seen[1]?.url).toBe("https://ci.example.com/job/frogg/job/main/58/wfapi/describe");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      provider: "jenkins",
      number: 58,
      status: "running",
      progress: 0.5,
      trigger: "Started by an SCM change",
    });
    expect(runs[0]?.jobs.map((job) => [job.name, job.status])).toEqual([
      ["Build", "success"],
      ["Test", "running"],
      ["Deploy", "queued"],
    ]);
    expect(runs[0]?.jobs[0]?.runner?.name).toBe("agent-linux-2");
  });

  it("treats a branch Jenkins has never built as having no runs", async () => {
    const runs = await listJenkinsRuns({
      config,
      branch: "new",
      credentials: null,
      fetch: async () => jsonResponse({}, 404),
    });
    expect(runs).toEqual([]);
  });

  it("explains rejected credentials", async () => {
    await expect(
      listJenkinsRuns({
        config,
        branch: "main",
        credentials: null,
        fetch: async () => jsonResponse({}, 401),
      }),
    ).rejects.toThrow(/FROGG_JENKINS_TOKEN/);
  });
});
