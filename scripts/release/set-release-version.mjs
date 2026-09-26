import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeNextReleaseVersion, parseReleaseVersion } from "./release-version-utils.mjs";
import { readStreamsConfig } from "./streams-config.mjs";
import { assertStablePatch } from "./streams-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const rootPackagePath = path.join(rootDir, "package.json");

function usageAndExit(code = 1) {
  process.stderr.write(
    `Usage: node scripts/release/set-release-version.mjs (--mode <mode> | --version <x.y.z[-beta.n]>) [--print]\n`,
  );
  process.stderr.write(
    "Modes: patch, minor, major, beta-patch, beta-minor, beta-major, beta-next, promote\n",
  );
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    mode: "",
    version: "",
    print: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      args.mode = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--version") {
      args.version = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--print") {
      args.print = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usageAndExit(0);
    }
    usageAndExit();
  }

  if (!args.mode === !args.version) {
    usageAndExit();
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
const currentVersion = typeof rootPackage.version === "string" ? rootPackage.version.trim() : "";

if (!currentVersion) {
  throw new Error('Root package.json must contain a valid "version".');
}

const nextVersion = args.version
  ? parseReleaseVersion(args.version).version
  : computeNextReleaseVersion(currentVersion, args.mode);

if (args.print) {
  process.stdout.write(`${nextVersion}\n`);
  process.exit(0);
}

assertStreamBranch(nextVersion, args.mode);

/**
 * Betas are cut on the development branch and stable releases on the stable branch
 * (frogg.json "streams"); a stable patch also has to stay below the open beta line. Stable
 * minor and major versions are not cut directly: they arrive by promoting a beta line.
 */
function assertStreamBranch(version, mode) {
  if (process.env.FROGG_RELEASE_SKIP_STREAM_CHECK === "1") return;
  const streams = readStreamsConfig(rootDir);
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: rootDir,
    encoding: "utf8",
  }).trim();
  const beta = parseReleaseVersion(version).isPrerelease;
  const required = beta ? streams.development : streams.stable;
  if (branch !== required) {
    throw new Error(
      `${version} is a ${beta ? "beta" : "stable"} release, cut from ${required}; you are on ${branch || "(detached)"}.` +
        (beta
          ? " Use `npm run release:beta`."
          : " Use `npm run release:patch` or `npm run release:promote` there."),
    );
  }
  if (!beta && (mode === "minor" || mode === "major")) {
    throw new Error(
      `A stable ${mode} ships by promoting a beta line: \`npm run release:beta\` on ${streams.development}, then \`npm run release:promote\` on ${streams.stable}.`,
    );
  }
  if (!beta && mode === "patch") {
    let developmentVersion = null;
    try {
      execFileSync("git", ["fetch", "--quiet", "origin", streams.development], { cwd: rootDir });
      developmentVersion = JSON.parse(
        execFileSync("git", ["show", `origin/${streams.development}:package.json`], {
          cwd: rootDir,
          encoding: "utf8",
        }),
      ).version;
    } catch {
      // No remote development branch to compare with.
    }
    if (developmentVersion) assertStablePatch({ nextStable: version, developmentVersion });
  }
}

execFileSync(
  "npm",
  ["version", nextVersion, "--include-workspace-root", "--message", "chore(release): cut %s"],
  { cwd: rootDir, stdio: "inherit" },
);
