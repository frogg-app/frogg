import { describe, expect, test } from "vitest";

import { buildAppBatch, productSlug } from "./batch";
import { buildBugReport, chatTranscript } from "./bug-report";

const app = { product: "frogg-next", version: "1.6.14-beta.3", os: "linux", platform: "desktop" };
const ID = "0b6f3c1e-7f2a-4c55-9a31-2b8e7d1f0c42";

describe("app usage batches", () => {
  test("carry the app identity and allowlisted events", () => {
    const batch = buildAppBatch(ID, app, [
      { name: "panel_opened", at: "2026-11-02T10:00:00.000Z", props: { panel: "tasks" } },
    ]);
    expect(batch?.client).toEqual({
      product: "frogg-next",
      version: "1.6.14-beta.3",
      os: "linux",
      platform: "desktop",
    });
    expect(batch?.source).toBe("app");
  });

  test("an off-schema event drops the whole batch", () => {
    const bad = {
      name: "panel_opened",
      at: "2026-11-02T10:00:00.000Z",
      props: { panel: "My Repo" },
    };
    expect(buildAppBatch(ID, app, [bad as never])).toBeNull();
  });

  test("product names become slugs", () => {
    expect(productSlug("Frogg-Next")).toBe("frogg-next");
    expect(productSlug("")).toBe("app");
  });
});

describe("bug reports", () => {
  test("the transcript keeps messages and tool names, never tool input", () => {
    const text = chatTranscript([
      { type: "user_message", text: "fix it" },
      { type: "tool_call", name: "Bash", status: "completed" },
      { type: "reasoning" },
      { type: "assistant_message", text: "done" },
    ]);
    expect(text).toBe("## You\nfix it\n\n[tool Bash: completed]\n\n## Agent\ndone");
  });

  test("the draft is redacted before it is shown", () => {
    const draft = buildBugReport({
      description:
        "Crashed reading /home/alice/repo/.env with OPENAI_API_KEY=sk-proj-abcdefghijklmnop1234",
      app,
      daemonVersion: "1.6.14-beta.3",
      chat: "## You\nmail me at alice@example.com",
    });
    expect(draft.text).not.toMatch(/alice|sk-proj/);
    expect(draft.text).toContain("~/repo/.env");
    expect(draft.text).toContain("# Attached chat");
    expect(draft.counts).toMatchObject({ secret: 1, email: 1, path: 1 });
  });
});
