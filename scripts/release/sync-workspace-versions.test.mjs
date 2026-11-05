import assert from "node:assert/strict";
import test from "node:test";
import {
  CARGO_VERSIONED,
  syncCargoLockVersions,
  syncCargoPackageVersion,
  syncCargoWorkspaceVersion,
} from "./sync-workspace-versions.mjs";

test("the package table version follows the root, other tables keep theirs", () => {
  const manifest = '[package]\nname = "x"\nversion = "1.0.0"\n\n[dependencies]\ny = "2"\n';
  assert.equal(
    syncCargoPackageVersion(manifest, "1.6.14-next.5"),
    '[package]\nname = "x"\nversion = "1.6.14-next.5"\n\n[dependencies]\ny = "2"\n',
  );
});

test("the workspace.package version follows the root, other tables keep theirs", () => {
  const manifest = [
    "[workspace]",
    'members = ["core"]',
    "",
    "[workspace.package]",
    'version = "1.6.14-next.3"',
    'edition = "2021"',
    "",
    "[workspace.dependencies]",
    'version = "untouched"',
    "",
  ].join("\n");
  const next = syncCargoWorkspaceVersion(manifest, "1.6.14-next.5");
  assert.match(next, /\[workspace\.package\]\nversion = "1\.6\.14-next\.5"/);
  assert.match(next, /\[workspace\.dependencies\]\nversion = "untouched"/);
  assert.equal(
    syncCargoWorkspaceVersion('[package]\nversion = "1"\n', "2"),
    '[package]\nversion = "1"\n',
  );
});

test("Cargo.lock entries of the named local crates follow the root, nothing else", () => {
  const lock = [
    "[[package]]",
    'name = "frogg-ui"',
    'version = "1.6.14-next.3"',
    "",
    "[[package]]",
    'name = "frogg-ui-extra"',
    'version = "0.1.0"',
    "",
    "[[package]]",
    'name = "leptos"',
    'version = "0.8.2"',
    "",
  ].join("\n");
  const next = syncCargoLockVersions(lock, ["frogg-ui", "absent"], "1.6.14-next.5");
  assert.match(next, /name = "frogg-ui"\nversion = "1\.6\.14-next\.5"/);
  assert.match(next, /name = "frogg-ui-extra"\nversion = "0\.1\.0"/);
  assert.match(next, /name = "leptos"\nversion = "0\.8\.2"/);
});

test("the Rust daemon and the Rust client are both version-synced", () => {
  assert.deepEqual(
    CARGO_VERSIONED.map(({ directory, table }) => [directory, table]),
    [
      ["apps/daemon-rs", "package"],
      ["apps/client", "workspace"],
    ],
  );
});
