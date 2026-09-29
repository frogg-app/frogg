import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { MODES, commandFor, parseArgs } from "./brand-dev.mjs";

const script = fileURLToPath(new URL("./brand-dev.mjs", import.meta.url));

test("brand and mode are positional; preview is the default", () => {
  assert.deepEqual(parseArgs(["brands/acme"]), {
    brand: "brands/acme",
    mode: "preview",
    dryRun: false,
    help: false,
    passthrough: [],
  });
  const live = parseArgs(["brands/acme", "live", "--dry-run", "--", "--keep"]);
  assert.equal(live.mode, "live");
  assert.equal(live.dryRun, true);
  assert.deepEqual(live.passthrough, ["--keep"]);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs([]), /brand directory/u);
  assert.throws(() => parseArgs(["brands/acme", "nightly"]), /Unknown mode/u);
  assert.throws(() => parseArgs(["brands/acme", "--nope"]), /Unknown option/u);
});

test("every mode runs an npm script with the brand selected", () => {
  for (const mode of Object.keys(MODES)) {
    const { command, args, env } = commandFor({ mode, passthrough: [] }, "brands/acme");
    assert.equal(command, "npm");
    assert.equal(args[1], MODES[mode].script);
    assert.equal(env.FROGG_BRAND_DIR, "brands/acme");
  }
  assert.deepEqual(commandFor({ mode: "check", passthrough: ["--json"] }, "brands/acme").args, [
    "run",
    "brand:check",
    "--",
    "--brand",
    "brands/acme",
    "--json",
  ]);
  assert.deepEqual(commandFor({ mode: "live", passthrough: [] }, "brands/acme").args, [
    "run",
    "dev:live",
  ]);
});

test("dry run on the example brand prints the command and runs nothing", () => {
  const output = execFileSync(process.execPath, [script, "brands/example", "live", "--dry-run"], {
    encoding: "utf8",
    env: { ...process.env, PREVIEW_PORT: "7950" },
  });
  assert.match(output, /Acme Studio \(brands\/example\), live/u);
  assert.match(output, /web 7950, daemon 7951/u);
  assert.match(output, /FROGG_BRAND_DIR=brands\/example npm run dev:live/u);
});

test("a directory without brand.json is refused", () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [script, "brands/does-not-exist", "--dry-run"], {
        stdio: ["ignore", "pipe", "pipe"],
      }),
    /No brand.json/u,
  );
});
