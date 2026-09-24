import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBrand } from "../dev/branding/load.cjs";
const brand = loadBrand();
const repo = path.resolve(import.meta.dirname, "../..");

test("installer service launch paths use the generated environment namespace", () => {
  const source = readFileSync(path.join(repo, "deploy/install.sh"), "utf8");
  for (const suffix of ["LISTEN", "WEB_UI_ENABLED", "INSTALL_DIR"]) {
    assert.match(source, new RegExp(`\\$\\{BRAND_ENV_PREFIX\\}_${suffix}`));
  }
  assert.match(source, /Environment=\$\{BRAND_ENV_PREFIX\}_EXECUTION_SERVICE=1/);
  assert.doesNotMatch(source, /Environment=FROGG_(?:LISTEN|WEB_UI_ENABLED|EXECUTION_SERVICE)/);
  assert.doesNotMatch(source, /<key>FROGG_(?:LISTEN|WEB_UI_ENABLED|INSTALL_DIR)<\/key>/);
});

test("generated installer defaults the service bind to the brand's bind host", () => {
  const script = readFileSync(path.join(repo, ".generated/branding/scripts/install.sh"), "utf8");
  assert.match(
    script,
    new RegExp(`^BRAND_BIND_HOST='${brand.daemon.bindHost.replaceAll(".", "\\.")}'$`, "m"),
  );
  assert.match(script, /FROGG_LISTEN="\$\{FROGG_LISTEN:-\$\{BRAND_BIND_HOST\}:\$\{BRAND_PORT\}\}"/);
  assert.doesNotMatch(script, /FROGG_LISTEN:-0\.0\.0\.0/);
  // Evaluate the defaults block plus the listen default with no override set.
  const block = script.match(/^BRAND_ID=[\s\S]*?^BRAND_COMMANDS=.*$/m)[0];
  const listen = execFileSync(
    "bash",
    [
      "-c",
      `${block}\nFROGG_LISTEN="\${FROGG_LISTEN:-\${BRAND_BIND_HOST}:\${BRAND_PORT}}"\nprintf %s "$FROGG_LISTEN"`,
    ],
    { encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.equal(listen, `${brand.daemon.bindHost}:${brand.daemonPort}`);
});

test(
  "generated installer owns only its commands and rejects a foreign uninstall",
  { skip: process.platform === "win32" },
  () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), "brand installer "));
    try {
      const bundle = path.join(scratch, "bundle");
      mkdirSync(path.join(bundle, "node/bin"), { recursive: true });
      mkdirSync(path.join(bundle, "bin"));
      symlinkSync(process.execPath, path.join(bundle, "node/bin/node"));
      const commands = brand.legacyFrogg ? [brand.cliName, "frogg"] : [brand.cliName];
      for (const name of commands)
        writeFileSync(path.join(bundle, "bin", name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      writeFileSync(
        path.join(bundle, "manifest.json"),
        JSON.stringify(
          {
            version: "1.2.3",
            platform: process.platform,
            arch: process.arch,
            brand: { id: brand.id, applicationId: brand.applicationId },
          },
          null,
          2,
        ),
      );
      const archive = path.join(scratch, "fixture.tar.gz");
      execFileSync("tar", ["-czf", archive, "-C", scratch, "bundle"]);
      const install = path.join(scratch, "install root");
      const bin = path.join(scratch, "commands");
      const env = {
        ...process.env,
        HOME: path.join(scratch, "home"),
        [`${brand.envPrefix}_INSTALL_DIR`]: install,
        [`${brand.envPrefix}_BIN_DIR`]: bin,
        [`${brand.envPrefix}_BUNDLE_FILE`]: archive,
        [`${brand.envPrefix}_NO_SERVICE`]: "1",
        [`${brand.envPrefix}_NO_MODIFY_PATH`]: "1",
      };
      const run = (script) =>
        spawnSync("bash", [path.join(repo, ".generated/branding/scripts", script)], {
          env,
          encoding: "utf8",
        });
      const installed = run("install.sh");
      assert.equal(installed.status, 0, installed.stdout + installed.stderr);
      assert.equal(existsSync(path.join(bin, brand.cliName)), true);
      assert.equal(
        readFileSync(path.join(install, ".brand-identity"), "utf8").trim(),
        `${brand.id}:${brand.applicationId}`,
      );
      if (!brand.legacyFrogg) {
        assert.equal(existsSync(path.join(bin, "frogg")), false);
        assert.equal(existsSync(path.join(bin, "frogg")), false);
      }
      const manifestPath = path.join(bundle, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const repack = (fields) => {
        writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...fields }));
        execFileSync("tar", ["-czf", archive, "-C", scratch, "bundle"]);
      };
      repack({ version: "1.2.4", configFingerprint: "new-cosmetic-branding" });
      const upgraded = run("install.sh");
      assert.equal(upgraded.status, 0, upgraded.stdout + upgraded.stderr);
      const current = realpathSync(path.join(install, "current"));
      assert.equal(path.basename(current), "1.2.4");
      assert.equal(
        existsSync(path.join(install, "versions/1.2.3")),
        true,
        "previous version remains available",
      );
      repack({ version: "1.2.5", brand: { id: "foreign", applicationId: "com.foreign.app" } });
      const wrongAsset = run("install.sh");
      assert.notEqual(
        wrongAsset.status,
        0,
        "another product's archive cannot replace this installation",
      );
      assert.equal(realpathSync(path.join(install, "current")), current);
      writeFileSync(path.join(install, ".brand-identity"), "foreign:com.foreign.app\n");
      const refused = run("uninstall.sh");
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /another product/);
      assert.equal(existsSync(path.join(install, "current")), true);
      // No service was created: hide service-manager binaries during the scratch uninstall.
      const safePath = path.join(scratch, "safe tools");
      mkdirSync(safePath);
      for (const name of ["bash", "uname", "cat", "readlink", "rm"])
        symlinkSync(
          execFileSync("which", [name], { encoding: "utf8" }).trim(),
          path.join(safePath, name),
        );
      env.PATH = safePath;
      writeFileSync(path.join(install, ".brand-identity"), `${brand.id}:${brand.applicationId}\n`);
      const removed = run("uninstall.sh");
      assert.equal(removed.status, 0, removed.stderr);
      assert.equal(existsSync(install), false);
      assert.equal(existsSync(bundle), true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
);
