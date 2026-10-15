import { beforeEach, describe, expect, it } from "vitest";
import {
  STEP_IDS,
  conceptsFor,
  nextStep,
  prevStep,
  progressOf,
  settingsFor,
  showDeep,
  startersFor,
  doneSet,
  type StepId,
} from "./model";
import {
  INITIAL,
  finishOnboarding,
  openOnboarding,
  restartOnboarding,
  sanitize,
  setLevel,
  setOnboardingPersist,
  toggleWork,
  useOnboarding,
} from "./store";

const none = new Set<StepId>();

describe("step order", () => {
  it("walks every step in order for people who asked to be walked through", () => {
    let at: StepId = "level";
    const seen: StepId[] = [at];
    while (at !== "done") {
      at = nextStep(at, new Set(["host", "providers"]), "new");
      seen.push(at);
    }
    expect(seen).toEqual([...STEP_IDS]);
  });

  it("lets experts skip set-up steps that already finished themselves", () => {
    const done = new Set<StepId>(["host", "providers"]);
    expect(nextStep("work", done, "expert")).toBe("session");
    // Not-yet-done set-up steps still show.
    expect(nextStep("work", none, "expert")).toBe("host");
  });

  it("stops at the first step going back", () => {
    expect(prevStep("level")).toBe("level");
    expect(prevStep("host")).toBe("work");
  });
});

describe("tailoring", () => {
  it("adds one concept per kind of work without repeating the core set", () => {
    const ids = conceptsFor("some", ["web", "infra", "explore"]).map((c) => c.id);
    expect(ids).toContain("scripts");
    expect(ids).toContain("multi-host");
    expect(ids).toContain("ask");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("trims the tour of the rail for experts and keeps detail for beginners", () => {
    expect(conceptsFor("expert", []).map((c) => c.id)).not.toContain("tools");
    expect(showDeep("new")).toBe(true);
    expect(showDeep("expert")).toBe(false);
  });

  it("suggests settings by level first, then by work, capped and unique", () => {
    const pages = settingsFor("expert", ["infra", "backend"]).map((t) => t.page);
    expect(pages.slice(0, 3)).toEqual(["keys", "worktrees", "tools"]);
    expect(pages).toContain("security");
    expect(pages.length).toBeLessThanOrEqual(6);
    expect(new Set(pages).size).toBe(pages.length);
    expect(settingsFor(null, [])[0].page).toBe("modes");
  });

  it("offers up to three starter prompts, filling in when little was picked", () => {
    expect(startersFor([])).toHaveLength(2);
    expect(startersFor(["data"])[0]).toMatch(/data files/);
    expect(startersFor(["web", "backend", "mobile", "data"])).toHaveLength(3);
  });
});

describe("progress", () => {
  it("ticks set-up steps from live host state", () => {
    const done = doneSet(["level"], { online: true, providerReady: false, hasSession: true });
    expect([...done].sort()).toEqual(["host", "level", "session"]);
  });

  it("counts tasks, not the closing page", () => {
    expect(progressOf(new Set<StepId>(["level", "done"]))).toEqual({ done: 1, total: 7 });
  });
});

describe("store", () => {
  beforeEach(() => {
    setOnboardingPersist(false);
    useOnboarding.setState({ ...INITIAL, loaded: true });
  });

  it("records answers and marks their steps seen", () => {
    setLevel("expert");
    toggleWork("data");
    toggleWork("infra");
    expect(useOnboarding.getState()).toMatchObject({
      level: "expert",
      work: ["data", "infra"],
      seen: ["level", "work"],
    });
    toggleWork("data");
    toggleWork("infra");
    expect(useOnboarding.getState().seen).toEqual(["level"]);
  });

  it("resumes where it was left, and restarts a finished walkthrough from the top", () => {
    useOnboarding.setState({ status: "minimised", step: "providers" });
    openOnboarding();
    expect(useOnboarding.getState()).toMatchObject({ status: "active", step: "providers" });
    finishOnboarding();
    openOnboarding();
    expect(useOnboarding.getState()).toMatchObject({ status: "active", step: "level" });
  });

  it("keeps answers on restart but clears progress", () => {
    setLevel("new");
    restartOnboarding();
    expect(useOnboarding.getState()).toMatchObject({ level: "new", seen: [], step: "level" });
  });

  it("drops unknown saved values", () => {
    const st = sanitize({
      status: "bogus" as never,
      step: "gone" as never,
      seen: ["level", "nope" as never],
    });
    expect(st).toMatchObject({ status: "new", step: "level", seen: ["level"], work: [] });
  });
});
