import { runGitCommand, type RunGitCommand } from "../../utils/run-git-command.js";
import type { ForgeResolution } from "../forge-resolver.js";
import { readCiConfig } from "./ci-service.js";
import type { CiWatchScope, CiWatchScopeResolver } from "./ci-run-watcher.js";

interface ScopeDeps {
  resolveForge(cwd: string): Promise<ForgeResolution | null>;
  runGit?: RunGitCommand;
  readConfig?: typeof readCiConfig;
}

async function git(run: RunGitCommand, cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await run(args, { cwd, timeout: 5_000, acceptExitCodes: [0, 128] });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Scopes a checkout to GitHub Actions runs for its HEAD and its upstream tip: what the workspace
 * pushed (branch pushes and tags alike), not everyone else's runs on a shared branch. Null (watch nothing, silently) when the remote is not on GitHub, the GitHub adapter cannot
 * reach `gh`, the checkout has no commit, or frogg.json turns GitHub Actions off.
 */
export function createGitHubCiScopeResolver(deps: ScopeDeps): CiWatchScopeResolver {
  const run = deps.runGit ?? runGitCommand;
  const readConfig = deps.readConfig ?? readCiConfig;
  return async (cwd) => {
    const forge = await deps.resolveForge(cwd).catch(() => null);
    if (!forge || forge.forge !== "github") return null;
    const service = forge.service as { apiGet?: (input: { cwd: string; path: string }) => unknown };
    if (typeof service.apiGet !== "function") return null;
    const apiGet = service.apiGet.bind(service);
    const repoRoot = await git(run, cwd, ["rev-parse", "--show-toplevel"]);
    if (readConfig(repoRoot).githubActions === false) return null;
    const head = await git(run, cwd, ["rev-parse", "HEAD"]);
    if (!head) return null;
    const upstreamSha = await git(run, cwd, ["rev-parse", "@{upstream}"]);
    const scope: CiWatchScope = {
      api: async (path) => apiGet({ cwd, path }),
      shas: upstreamSha && upstreamSha !== head ? [head, upstreamSha] : [head],
    };
    return scope;
  };
}
