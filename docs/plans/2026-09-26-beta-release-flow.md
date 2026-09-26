# Beta Release Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Frogg a working beta channel for internal dogfooding (Dan + co-owner only): a long-lived `beta` git branch that cuts `X.Y.0-beta.N` releases while `main` keeps cutting stable patches, plus the client/pipeline fixes that make a beta safe to install and leave.

**Architecture:** Two release branches. `main` cuts stable (`1.5.46`, `1.5.47`, ...). `beta` cuts prereleases of the *next minor* (`1.6.0-beta.1`, `-beta.2`, ...). `main` is merged into `beta` after every stable cut (`release:sync-beta`); `beta` is merged into `main` to ship the minor (`release:promote`), after which `beta` is fast-forwarded to `main`. Branch policy lives in one pure module (`scripts/release/release-branches.mjs`) enforced both locally (version scripts) and in CI (`release.yml` meta job). The existing channel plumbing (electron-beta feeds, `releaseChannel` setting, `frogg daemon self-update --channel beta`, Android channel picker) is kept; its bugs are fixed.

**Tech Stack:** Node ESM release scripts (`node --test` style tests in `scripts/release/*.test.mjs` — check the existing ones and match), GitHub Actions, Electron + electron-updater 6.8.x, React Native/Expo UI (`apps/ui`, vitest), `@frogg/protocol/release-version` shared version ordering.

**Spec:** This document. Background: a read-only review on 2026-09-26 found the beta path has never run (v1.5.0-beta.1 run was cancelled, no release exists), stable is frozen while `main` is on a prerelease (`release-version-utils.mjs:94`), desktop can downgrade (`auto-updater.ts:184`, `app-update-service.ts:318`), `release.yml:783` publishes without `--latest`, the Rosetta link 404s (`desktop-updates.ts:287`), Android has its own comparator (`mobile-updates.ts:69-90`) and keeps a stale offer after a channel switch.

## Global Constraints

- **All work happens on branch `chore/beta-release-flow`** in worktree `~/frogg-beta-flow` (already created off `origin/main` @ 319504ab). Never commit to `main` directly. Finish with a PR to `main`.
- Do **not** push tags, create GitHub releases, delete drafts/tags, change branch protection, or create the remote `beta` branch without Dan's explicit go-ahead (Task 9 is gated).
- Only `-beta.N` prereleases are in scope. No rc/alpha work.
- Branch names are exactly `main` (stable) and `beta` (prerelease).
- Versioning rule (Dan's): on `main` every landed change is a patch; on `beta` the equivalent is `beta-next` (`-beta.N+1`), never a patch. Promoting beta is the feature (minor) bump.
- This PR itself ships as a **patch** (`1.5.46`) — it is tooling + bug fixes, not a feature — so it does not collide with `1.6.0-beta.*`.
- No commit trailers beyond what the repo already uses; match existing commit style (`fix(desktop): ...`, `chore(release): ...`, `ci(release): ...`).
- Any change to the release pipeline updates `website/src/content/docs/docs/contributing/release-process.mdx` and `.claude/skills/frogg-release/SKILL.md` in the same PR (AGENTS.md:79 rule).
- `node_modules` is not installed in the worktree. Run `npm install` once at the start (Task 0).

## Review Focus

1. **A stable cut while `beta` exists** — `release:minor` on main that would reach or pass beta's base version (main 1.5.x → 1.6.0 while beta is 1.6.0-beta.2) must refuse with a clear message; `release:patch` must always work. (Task 1 tests.)
2. **Switching desktop from beta to stable while on a beta build** — must show "up to date", never download an older stable. (Task 4 test.)
3. **Two release runs finishing out of order** — the older version must not become GitHub Latest. (Task 3, shell guard + manual check.)
4. **Merging main into beta with version-line conflicts** — after `release:sync-beta` the tree must carry beta's version everywhere (root, workspaces, Cargo, lockfile). (Task 2 test on `resolveSyncedVersion`; manual run in Task 9.)
5. **Android on stable seeing a prerelease with a non-`-beta` tag or the GitHub prerelease flag** — must be skipped on stable. (Task 5 tests.)

---

### Task 0: Workspace setup

- [ ] **Step 1:** `cd ~/frogg-beta-flow && git status -sb` — expect `## chore/beta-release-flow...origin/main`, clean apart from this plan file.
- [ ] **Step 2:** `npm install` (root; workspaces are wired from root `package.json`).
- [x] **Step 3:** Plan already committed on this branch.

---

### Task 1: Release-branch policy module

**Files:**
- Create: `scripts/release/release-branches.mjs`
- Create: `scripts/release/release-branches.test.mjs` (match the runner/assert style of `release-version-utils.test.mjs`)
- Modify: `scripts/release/set-release-version.mjs` (enforce policy before `npm version`)

**Interfaces:**
- Consumes: `parseReleaseVersion(version)` from `release-version-utils.mjs` (returns `{ major, minor, patch, isPrerelease, baseVersion, ... }`).
- Produces:
  - `STABLE_BRANCH = "main"`, `BETA_BRANCH = "beta"`
  - `requiredBranchForMode(mode: string): "main" | "beta"`
  - `requiredBranchForVersion(version: string): "main" | "beta"`
  - `assertBranchForMode(mode: string, branch: string): void` — throws
  - `assertStableBelowBeta(nextStable: string, betaVersion: string | null): void` — throws when `nextStable >= base(betaVersion)`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  requiredBranchForMode,
  requiredBranchForVersion,
  assertBranchForMode,
  assertStableBelowBeta,
} from "./release-branches.mjs";

describe("release branches", () => {
  it("routes stable modes to main and beta modes to beta", () => {
    for (const mode of ["patch", "minor", "major", "promote"]) {
      assert.equal(requiredBranchForMode(mode), "main");
    }
    for (const mode of ["beta-patch", "beta-minor", "beta-major", "beta-next"]) {
      assert.equal(requiredBranchForMode(mode), "beta");
    }
    assert.throws(() => requiredBranchForMode("nope"), /Unknown release mode/);
  });

  it("routes versions by prerelease suffix", () => {
    assert.equal(requiredBranchForVersion("1.5.46"), "main");
    assert.equal(requiredBranchForVersion("1.6.0-beta.2"), "beta");
  });

  it("refuses a mode on the wrong branch", () => {
    assert.doesNotThrow(() => assertBranchForMode("patch", "main"));
    assert.throws(() => assertBranchForMode("patch", "beta"), /cut from main.*on beta/);
    assert.throws(() => assertBranchForMode("beta-next", "main"), /cut from beta.*on main/);
    assert.throws(() => assertBranchForMode("patch", "feat/x"), /cut from main/);
  });

  it("keeps stable strictly below the beta line", () => {
    assert.doesNotThrow(() => assertStableBelowBeta("1.5.46", "1.6.0-beta.2"));
    assert.doesNotThrow(() => assertStableBelowBeta("1.6.0", null));
    assert.throws(() => assertStableBelowBeta("1.6.0", "1.6.0-beta.2"), /would reach beta 1\.6\.0/);
    assert.throws(() => assertStableBelowBeta("2.0.0", "1.6.0-beta.2"), /would reach beta/);
  });
});
```

- [ ] **Step 2:** Run `node --test scripts/release/release-branches.test.mjs` — expect FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// Which branch cuts which release. main cuts stable, beta cuts -beta.N of
// the next minor; the release scripts and release.yml both enforce this.
import { parseReleaseVersion } from "./release-version-utils.mjs";

export const STABLE_BRANCH = "main";
export const BETA_BRANCH = "beta";

const STABLE_MODES = new Set(["patch", "minor", "major", "promote"]);
const BETA_MODES = new Set(["beta-patch", "beta-minor", "beta-major", "beta-next"]);

export function requiredBranchForMode(mode) {
  if (STABLE_MODES.has(mode)) return STABLE_BRANCH;
  if (BETA_MODES.has(mode)) return BETA_BRANCH;
  throw new Error(`Unknown release mode "${mode}".`);
}

export function requiredBranchForVersion(version) {
  return parseReleaseVersion(version).isPrerelease ? BETA_BRANCH : STABLE_BRANCH;
}

export function assertBranchForMode(mode, branch) {
  const required = requiredBranchForMode(mode);
  if (branch !== required) {
    throw new Error(`${mode} releases are cut from ${required}; you are on ${branch || "(detached)"}.`);
  }
}

function rank({ major, minor, patch }) {
  return [major, minor, patch];
}

function compareCore(a, b) {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < 3; i += 1) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i] ? 1 : -1;
  }
  return 0;
}

export function assertStableBelowBeta(nextStable, betaVersion) {
  if (!betaVersion) return;
  const beta = parseReleaseVersion(betaVersion);
  if (!beta.isPrerelease) return;
  if (compareCore(parseReleaseVersion(nextStable), beta) >= 0) {
    throw new Error(
      `Stable ${nextStable} would reach beta ${beta.baseVersion}. Ship that line with release:promote instead.`,
    );
  }
}
```

Confirm `parseReleaseVersion` returns `baseVersion`, `major`, `minor`, `patch`, `isPrerelease` (see `release-version-utils.mjs:12-52`); adjust field names if they differ.

- [ ] **Step 4:** Run the test — expect PASS.

- [ ] **Step 5: Enforce in `set-release-version.mjs`.** Leave `--print` branch-agnostic. Immediately before `execFileSync("npm", ["version", ...])`, add:

```js
const branch = execFileSync("git", ["branch", "--show-current"], { cwd: rootDir, encoding: "utf8" }).trim();
assertBranchForMode(args.mode, branch);
if (branch === STABLE_BRANCH) {
  assertStableBelowBeta(nextVersion, readRemoteBetaVersion());
}
```

with

```js
function readRemoteBetaVersion() {
  try {
    execFileSync("git", ["fetch", "--quiet", "origin", BETA_BRANCH], { cwd: rootDir });
    const pkg = execFileSync("git", ["show", `origin/${BETA_BRANCH}:package.json`], { cwd: rootDir, encoding: "utf8" });
    return JSON.parse(pkg).version ?? null;
  } catch {
    return null; // no beta branch yet
  }
}
```

- [ ] **Step 6:** Remove the now-wrong guard text in `computeNextReleaseVersion` ("Promote it first") only if it still makes sense — it does (a stable mode on a prerelease *version* is still invalid); keep it. Run `node --test scripts/release/` — all PASS.

- [ ] **Step 7:** Commit: `feat(release): enforce main=stable, beta=prerelease branch policy`.

---

### Task 2: Branch-flow scripts (beta cut, sync, promote)

**Files:**
- Create: `scripts/release/branch-flow.mjs` (CLI: `sync-beta`, `promote-merge`, `promote-cut`, `fast-forward-beta`)
- Create: `scripts/release/branch-flow-core.mjs` (pure helpers) + `branch-flow-core.test.mjs`
- Modify: `package.json` scripts

**Interfaces:**
- Consumes: Task 1 exports; `parseReleaseVersion`.
- Produces (pure, tested):
  - `resolveSyncedVersion({ targetBranch, preMergeVersion }): string` — the version the tree must carry after merging another branch in: always `preMergeVersion` (the target branch's own), validated against `requiredBranchForVersion(preMergeVersion) === targetBranch`.
  - `promotionVersion({ betaVersion, mainVersion }): string` — `baseVersion` of beta; throws if beta is not a prerelease or base ≤ main.
- npm scripts produced:
  - `release:beta:minor` = `release:check && version:all:beta:minor && release:push` (start a beta line)
  - `release:beta:next` = `release:check && version:all:beta:next && release:push`
  - `release:sync-beta` = `node scripts/release/branch-flow.mjs sync-beta`
  - `release:promote` = `node scripts/release/branch-flow.mjs promote-merge && npm run release:check && node scripts/release/branch-flow.mjs promote-cut && npm run release:push && node scripts/release/branch-flow.mjs fast-forward-beta`

- [ ] **Step 1: Failing tests** (`branch-flow-core.test.mjs`)

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSyncedVersion, promotionVersion } from "./branch-flow-core.mjs";

describe("branch flow", () => {
  it("keeps the target branch's version after a sync merge", () => {
    assert.equal(resolveSyncedVersion({ targetBranch: "beta", preMergeVersion: "1.6.0-beta.2" }), "1.6.0-beta.2");
    assert.throws(
      () => resolveSyncedVersion({ targetBranch: "beta", preMergeVersion: "1.5.46" }),
      /beta must carry a -beta\.N version/,
    );
  });

  it("promotes beta to its base version", () => {
    assert.equal(promotionVersion({ betaVersion: "1.6.0-beta.3", mainVersion: "1.5.49" }), "1.6.0");
    assert.throws(() => promotionVersion({ betaVersion: "1.6.0", mainVersion: "1.5.49" }), /not a beta/);
    assert.throws(() => promotionVersion({ betaVersion: "1.5.0-beta.1", mainVersion: "1.5.49" }), /not above main/);
  });
});
```

- [ ] **Step 2:** `node --test scripts/release/branch-flow-core.test.mjs` — FAIL.

- [ ] **Step 3: Implement `branch-flow-core.mjs`**

```js
import { parseReleaseVersion } from "./release-version-utils.mjs";
import { BETA_BRANCH, requiredBranchForVersion } from "./release-branches.mjs";

export function resolveSyncedVersion({ targetBranch, preMergeVersion }) {
  if (requiredBranchForVersion(preMergeVersion) !== targetBranch) {
    throw new Error(
      targetBranch === BETA_BRANCH
        ? `beta must carry a -beta.N version, found ${preMergeVersion}.`
        : `${targetBranch} must carry a stable version, found ${preMergeVersion}.`,
    );
  }
  return preMergeVersion;
}

export function promotionVersion({ betaVersion, mainVersion }) {
  const beta = parseReleaseVersion(betaVersion);
  if (!beta.isPrerelease) throw new Error(`origin/beta is ${betaVersion}, not a beta.`);
  const main = parseReleaseVersion(mainVersion);
  const above =
    beta.major !== main.major ? beta.major > main.major
    : beta.minor !== main.minor ? beta.minor > main.minor
    : beta.patch > main.patch;
  if (!above) throw new Error(`Beta base ${beta.baseVersion} is not above main ${mainVersion}.`);
  return beta.baseVersion;
}
```

- [ ] **Step 4:** Test PASS.

- [ ] **Step 5: Implement `branch-flow.mjs`** (thin git/npm wrapper; no logic beyond calling the core):

  - Shared helpers: `git(...args)` (inherit stdio), `gitOut(...args)`, `assertClean()` (`git status --porcelain` empty), `assertOnBranch(name)`, `readVersion(ref)` (`git show <ref>:package.json`), `restamp(version)` = write root `package.json` `version` field then `npm run version` (the existing lifecycle script: syncs workspaces + Cargo, reinstalls, refreshes Nix hash, `git add -A`).
  - `sync-beta`: assert on `beta`, clean; `git fetch origin main beta`; `pre = readVersion("HEAD")`; `git merge --no-ff --no-commit origin/main`. If exit non-zero, list `git diff --name-only --diff-filter=U`; for each conflicted path that is a version-owned file (`package.json`, `*/package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, the nix hash file used by `npm run nix:hash`), print it as "will be restamped"; if **any other** path conflicts, print them and exit 1 with: "Resolve these, `git add` them, then run `npm run release:sync-beta -- --continue`". With `--continue` (or no conflicts): for version-owned conflicted files take the merged side for dependency changes by running `git checkout --theirs -- <file>` **only for `package-lock.json` / `Cargo.lock`** (regenerated anyway), then `restamp(resolveSyncedVersion({ targetBranch: "beta", preMergeVersion: pre }))`; if `package.json`-family files still hold conflict markers, stop and ask the human to resolve them (versions can be either side — restamp fixes them) and re-run `--continue`. Finally `git commit --no-edit` and `git push origin beta`.
  - `promote-merge`: assert on `main`, clean; fetch; `git merge --no-ff --no-commit origin/beta` with the same conflict handling as sync, but restamp to `readVersion("HEAD")` (main's pre-merge version) so `release:check` runs on a consistent tree; commit `chore(release): merge beta for promotion`.
  - `promote-cut`: assert on `main`; `v = promotionVersion({ betaVersion: readVersion("origin/beta"), mainVersion: readVersion("HEAD") })`; `restamp(v)`; `git commit -m "chore(release): cut ${v}"` (same message format `npm version` uses so the changelog/tag flow is unchanged).
  - `fast-forward-beta`: `git push origin main:beta` (fast-forward only — if rejected, print that beta has commits not on main and stop; never force).
  - Record `pre` before merging in both merge commands; during a merge `HEAD` is still the pre-merge commit, so `readVersion("HEAD")` is safe even on `--continue`.

- [ ] **Step 6:** Add the npm scripts listed under Interfaces to root `package.json` next to `release:patch` (lines ~83-85).

- [ ] **Step 7: Local dry run in a throwaway clone** (no pushes):

```bash
tmp=$(mktemp -d) && git clone -q ~/frogg-beta-flow "$tmp/r" && cd "$tmp/r" && npm install --silent
git switch -c beta && node scripts/release/set-release-version.mjs --mode beta-minor --print   # expect 1.6.0-beta.1
git switch main 2>/dev/null || git switch -c main
node scripts/release/set-release-version.mjs --mode beta-next --print   # prints fine (print is branch-agnostic)
```

Exercise `branch-flow-core` only; the git/push paths are exercised for real in Task 9. Delete `$tmp` afterwards.

- [ ] **Step 8:** Commit: `feat(release): release:beta, release:sync-beta and release:promote`.

---

### Task 3: Release workflow guards (tag branch + Latest)

**Files:**
- Modify: `.github/workflows/release.yml` (meta checkout ~line 70, version step ~85-103, publish step ~783)
- Create: `scripts/release/assert-tag-branch.sh`

**Interfaces:**
- Consumes: branch names from Task 1 (duplicated as literals in the shell script — CI must not depend on node deps for this check; add a comment pointing at `release-branches.mjs`).
- Produces: meta job fails when a stable tag is not on `origin/main` or a beta tag is not on `origin/beta`.

- [ ] **Step 1: `assert-tag-branch.sh`**

```bash
#!/usr/bin/env bash
# Stable tags must be on main, -beta.N tags on beta (policy: scripts/release/release-branches.mjs).
set -euo pipefail
tag="$1"
case "${tag#v}" in
  *-*) branch=beta ;;
  *) branch=main ;;
esac
git fetch --quiet origin "$branch"
if ! git merge-base --is-ancestor "$tag^{commit}" "origin/$branch"; then
  echo "::error::$tag is not on origin/$branch. Stable releases are cut from main, betas from beta."
  exit 1
fi
```

`chmod +x`. Test locally: `bash scripts/release/assert-tag-branch.sh v1.5.45` → exit 0; `bash scripts/release/assert-tag-branch.sh v1.5.0-beta.1` → exit 1 (no origin/beta).

- [ ] **Step 2:** In meta, set `fetch-depth: 0` on the checkout and add a step after "Resolve version from tag and package.json": `run: bash scripts/release/assert-tag-branch.sh "$RELEASE_TAG"`. Skip it when `inputs.only == 'android'` (rebuilds of old tags).

- [ ] **Step 3: Latest guard.** Replace the publish step's `run:` with:

```bash
if [ "${{ needs.meta.outputs.prerelease }}" = "true" ]; then
  gh release edit "$RELEASE_TAG" --draft=false --prerelease --latest=false
  exit 0
fi
current="$(gh release view --json tagName --jq .tagName 2>/dev/null || true)"
newest="$(printf '%s\n%s\n' "${current#v}" "${RELEASE_TAG#v}" | sort -V | tail -n1)"
if [ -z "$current" ] || [ "$newest" = "${RELEASE_TAG#v}" ]; then
  gh release edit "$RELEASE_TAG" --draft=false --latest
else
  echo "::warning::$current is newer than $RELEASE_TAG; publishing without moving Latest."
  gh release edit "$RELEASE_TAG" --draft=false --latest=false
fi
```

(`gh release view` with no tag returns the current Latest.)

- [ ] **Step 4:** `actionlint .github/workflows/release.yml` if available (`brew install actionlint` is fine), otherwise `npx --yes @action-validator/cli .github/workflows/release.yml`. Fix any findings.

- [ ] **Step 5:** Commit: `ci(release): require tags on their release branch and never move Latest backwards`.

---

### Task 4: Desktop — no downgrades, correct Rosetta link

**Files:**
- Modify: `apps/desktop/src/features/app-update-service.ts:318`
- Modify: `apps/desktop/src/features/auto-updater.ts:184`
- Modify: `apps/ui/src/desktop/updates/desktop-updates.ts:287`
- Test: `apps/desktop/src/features/app-update-service.test.ts`, `apps/ui/src/desktop/updates/desktop-updates.test.ts`

**Interfaces:**
- Consumes: `isNewerVersion(candidate, current)` from `@frogg/protocol/release-version` (already a desktop dep; see `app-update-config.ts:6-8`).

- [ ] **Step 1: Failing test** in `app-update-service.test.ts` — follow the file's existing fake-updater setup; the case:

```ts
it("does not offer an older stable build to a beta install", async () => {
  // current app version 1.6.0-beta.1, feed returns updateInfo.version 1.5.45
  const result = await service.checkForUpdates(/* existing helper args with currentVersion "1.6.0-beta.1" and feed version "1.5.45" */);
  expect(result.hasUpdate).toBe(false);
});
it("still offers a newer build", async () => {
  // current 1.5.45, feed 1.5.46 → hasUpdate true
});
```

Write both using the concrete fakes already in that file (read how existing `hasUpdate: true` cases are built first).

- [ ] **Step 2:** Run `npx vitest run apps/desktop/src/features/app-update-service.test.ts` (or the workspace's test script — check `apps/desktop/package.json`) — first case FAILS.

- [ ] **Step 3:** Line 318: `const hasUpdate = isNewerVersion(latestVersion, currentVersion);` and import it.

- [ ] **Step 4:** `auto-updater.ts` after line 184 (`autoUpdater.channel = feed.channel;`):

```ts
        // electron-updater's channel setter turns allowDowngrade back on.
        autoUpdater.allowDowngrade = false;
```

Also after line 125 for the same reason (126 already does it — leave it, it runs after).

- [ ] **Step 5: Rosetta link.** Failing test in `desktop-updates.test.ts`:

```ts
expect(buildMacAppleSiliconDownloadUrl("1.5.45")).toMatch(/\/v1\.5\.45\/[^/]+-1\.5\.45-mac-arm64\.dmg$/);
```

Then change line 287's suffix from `-aarch64.dmg` to `-mac-arm64.dmg` (electron-builder `artifactName` is `${prefix}-${version}-${os}-${arch}.${ext}`, `electron-builder.cjs:21`).

- [ ] **Step 6:** Run both test files — PASS. Commit: `fix(desktop): never offer a downgrade and fix the Apple Silicon download link`.

---

### Task 5: Android — shared version ordering, no stale offer

**Files:**
- Modify: `apps/ui/src/mobile/updates/mobile-updates.ts:69-90,159`
- Modify: `apps/ui/src/mobile/updates/mobile-app-updater.ts` (add `discardAvailableUpdate`)
- Modify: `apps/ui/src/mobile/updates/mobile-updates-section.tsx:162`
- Test: `mobile-updates.test.ts`, `mobile-app-updater.test.ts`

**Interfaces:**
- Consumes: `compareVersionStrings`, `isStableVersion` from `@frogg/protocol/release-version` (already a dep of `apps/ui`).
- Produces: `MobileAppUpdater.discardAvailableUpdate(): void` — sets `availableUpdate: null`, `status: "idle"`; no-op while `downloading`/`installing`.

- [ ] **Step 1: Failing tests**

```ts
// mobile-updates.test.ts
it("skips a flagged prerelease on stable even without -beta in the tag", () => {
  const releases = [
    { tag_name: "v1.6.0-rc.1", prerelease: true, draft: false, assets: [] },
    { tag_name: "v1.5.45", prerelease: false, draft: false, assets: [] },
  ];
  expect(selectRelease(releases as never, "stable")?.tag_name).toBe("v1.5.45");
});
it("orders betas below their release", () => {
  expect(compareReleaseVersions("1.6.0-beta.2", "1.6.0")).toBe(-1);
  expect(compareReleaseVersions("1.6.0", "1.5.99")).toBe(1);
  expect(compareReleaseVersions("1.6.0-beta.2", "1.6.0-beta.10")).toBe(-1);
});

// mobile-app-updater.test.ts — using the file's fake port
it("drops the offer when told to", async () => {
  // port.check resolves hasUpdate: true for channel "beta"
  await updater.checkForUpdates({ channel: "beta" });
  expect(updater.getSnapshot().availableUpdate).not.toBeNull();
  updater.discardAvailableUpdate();
  expect(updater.getSnapshot()).toMatchObject({ availableUpdate: null, status: "idle" });
});
```

- [ ] **Step 2:** Run `npx vitest run apps/ui/src/mobile/updates` (check `apps/ui/package.json` for the test script/config) — new cases FAIL.

- [ ] **Step 3:** Replace `versionParts` + the body of `compareReleaseVersions` with a delegate (keep the exported name so callers don't change):

```ts
import { compareVersionStrings, isStableVersion } from "@frogg/protocol/release-version";

/** Release ordering shared with desktop and the daemon. */
export function compareReleaseVersions(left: string, right: string): number {
  return Math.sign(compareVersionStrings(left, right));
}
```

Line 159: `const isPrerelease = release.prerelease === true || !isStableVersion(version);`

- [ ] **Step 4:** Implement `discardAvailableUpdate` in `mobile-app-updater.ts` (add to the `MobileAppUpdater` interface and the returned object):

```ts
    discardAvailableUpdate() {
      if (snapshot.status === "downloading" || snapshot.status === "installing") return;
      checkVersion++; // an in-flight check for the old channel must not land
      commit({ status: "idle", availableUpdate: null });
    },
```

- [ ] **Step 5:** In `mobile-updates-section.tsx` channel handler (~line 162), call `updater.discardAvailableUpdate()` before `updateSettings({ mobileUpdateChannel })` (use whatever name the section uses for the updater instance).

- [ ] **Step 6:** Tests PASS; `npm run typecheck --workspace=@frogg/ui` (or the ui package's actual name) clean. Commit: `fix(mobile): use shared version ordering and drop the offer on channel switch`.

---

### Task 6: install.sh fallback picks only stable semver

**Files:**
- Modify: `deploy/install.sh:125-142`

- [ ] **Step 1:** Replace `resolve_latest_prerelease_version` (rename to `resolve_newest_stable_version`, update its caller) so it asks for `per_page=30` and takes the first `tag_name` matching `^v[0-9]+\.[0-9]+\.[0-9]+$`:

```bash
# Fallback when /releases/latest does not resolve (e.g. every newer release is
# still a draft): newest plain vX.Y.Z from the API, skipping betas and the old
# companion-preview / execution-test prereleases.
resolve_newest_stable_version() {
  local api body tag
  api="$(printf '%s' "${FROGG_RELEASE_BASE}" |
    sed -n 's#^https://github.com/\([^/]*\)/\([^/]*\)/releases/*$#https://api.github.com/repos/\1/\2/releases?per_page=30#p')"
  [ -n "${api}" ] || die "could not resolve the latest release from ${FROGG_RELEASE_BASE}/latest"
  body="$(curl -fsSL "${api}")" || die "could not resolve the latest release from ${api}"
  tag="$(printf '%s\n' "${body}" | tr ',{' '\n\n' |
    sed -n 's/^ *"tag_name" *: *"\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)" *$/\1/p' | sed -n '1p')"
  FROGG_VERSION="${tag#v}"
  [ -n "${FROGG_VERSION}" ] || die "no stable release found at ${api}"
}
```

- [ ] **Step 2:** `bash -n deploy/install.sh && shellcheck deploy/install.sh` (if installed). Smoke the function in isolation: `FROGG_RELEASE_BASE=https://github.com/frogg-app/frogg/releases bash -c 'source <(sed -n "/^die()/,/^}/p;/^resolve_newest_stable_version()/,/^}/p" deploy/install.sh); resolve_newest_stable_version; echo $FROGG_VERSION'` → `1.5.45`. Also run `scripts/release/verify-install-routes.sh` if it runs offline.
- [ ] **Step 3:** Commit: `fix(install): fallback resolves the newest stable release only`.

---

### Task 7: Remove dead Paseo-era release scripts

**Files:**
- Delete (each only after `git grep -n <basename-without-ext>` shows no references outside itself and its own test): `scripts/release/sync-release-notes-from-changelog.mjs` (+ `.test.mjs`), `scripts/release/github-release.mjs`, `scripts/release/emit-release-env.mjs`, `scripts/release/build-updater-manifest.mjs` (+ `.test.mjs`), `scripts/release/install-companion-preview.sh`, `scripts/release/smoke-daemon-bundle.sh`
- Modify: `apps/ui/src/desktop/updates/desktop-updates.ts:8-15` — drop the `"tauri-signed"` strategy and the `src/updates/assets.rs` comment if nothing reads that value (`git grep -n tauri-signed`).

- [ ] **Step 1:** For each file run the grep; keep any file that is referenced (note it in the PR description instead).
- [ ] **Step 2:** `git rm` the unreferenced ones; `node --test scripts/release/` and `npm run typecheck` for `apps/ui` still pass.
- [ ] **Step 3:** Commit: `chore(release): remove unused Paseo-era release scripts`.

---

### Task 8: Docs and release skill

**Files:**
- Modify: `website/src/content/docs/docs/contributing/release-process.mdx` (Version modes section ~line 60-90, and add a "Branches" section before it)
- Modify: `.claude/skills/frogg-release/SKILL.md` (~line 93)
- Modify: `CHANGELOG.md` (add the `## 1.5.46` entry lines for this work, following the existing heading format)

- [ ] **Step 1:** Add to `release-process.mdx`:

```md
## Branches

| Branch | Cuts | Commands |
| ------ | ---- | -------- |
| `main` | stable `X.Y.Z` | `release:patch` (every landed change), `release:promote` (ships the beta line as `X.Y.0`) |
| `beta` | `X.Y.0-beta.N` of the next minor | `release:beta:minor` (start a line), `release:beta:next` (every landed change) |

- Feature work targets `beta` once a beta line is open; fixes target `main`.
- After every stable cut, run `npm run release:sync-beta` on `beta` to bring the fix over. It keeps beta's version.
- `release:minor`/`release:major` refuse while beta is open on that minor or lower; ship it with `release:promote`.
- `release:promote` (on `main`): merges `origin/beta`, runs `release:check`, cuts `X.Y.0`, pushes the tag, fast-forwards `beta` to `main`. Start the next line with `release:beta:minor` on `beta`.
- `release.yml` fails a stable tag that is not on `main` and a beta tag that is not on `beta`, and never moves GitHub Latest to an older version.
- Betas are for internal testers only: set Settings → Updates → channel to Beta (desktop, Android) and `frogg daemon self-update --channel beta` (daemon, or the host's channel in Settings).
```

Replace the sentence "There are no `release:beta` or `release:promote` scripts..." (line ~83-85) with a pointer to the Branches section.

- [ ] **Step 2:** In `SKILL.md`, add one line under the beta paragraph: "Betas are cut only from `beta`, stable only from `main`; use `release:beta:*`, `release:sync-beta`, `release:promote` (see release-process.mdx → Branches)."
- [ ] **Step 3:** Commit: `docs(release): document the main/beta branch flow`.

---

### Task 9: PR, then first real beta — GATED on Dan

- [ ] **Step 1:** Push the branch and open a PR to `main`: `git push -u origin chore/beta-release-flow && gh pr create --base main --title "Beta release flow" --body "<summary of tasks 1-8, what was verified, what was not>"`. Include the review findings this fixes. **Stop and tell Dan the PR is up.** Do not merge.
- [ ] **Step 2 (only after Dan merges and says go):** On `main`, `npm run release:patch` → `v1.5.46` (this PR's changes). Watch the run: `gh run watch`. Confirm v1.5.46 is Latest.
- [ ] **Step 3 (only after Dan says go):** Create beta: `git switch -c beta origin/main && git push -u origin beta`, then `npm run release:beta:minor` → `v1.6.0-beta.1`. Watch the run; confirm the release is a prerelease, **not** Latest, has `electron-beta*.yml`, `release.json` with `channel: beta`, daemon bundles and APKs, and `verify-release-assets` passed.
- [ ] **Step 4: End-to-end checks** (report each as pass/fail with evidence; list anything untested):
  - Mac desktop: Settings → Updates → Beta → update offered to 1.6.0-beta.1 → installs → relaunches on 1.6.0-beta.1.
  - Switch back to Stable → "up to date" (no 1.5.46 downgrade offered).
  - Daemon on `frogg-dev`: `frogg daemon self-update --channel beta --check` shows 1.6.0-beta.1; stable channel shows up to date / 1.5.46.
  - `curl -fsSL <install.sh> | FROGG_VERSION=1.6.0-beta.1 sh` on a scratch dir resolves the beta bundle; without `FROGG_VERSION` it resolves 1.5.46.
  - `release:sync-beta` on `beta` after any later stable patch: beta keeps `1.6.0-beta.N`.
- [ ] **Step 5:** Report results to Dan. Remaining known gaps (not in this plan, by decision): three channel settings stay separate (desktop, Android, per-host daemon — they are different devices); Android betas share a versionCode with their stable; desktop "auto-check off" still checks on mount; stale drafts v1.5.13/31/32 and orphan tags v1.5.43, v1.5.0-beta.1 left for Dan to clean.
