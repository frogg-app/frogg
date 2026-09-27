import { test } from "node:test";
import assert from "node:assert/strict";
import { BrandManifestSchema, resolveBrandManifest } from "./schema.js";
import { brandEnv, matchesBrand, normalizeBrandEnvironment, storageKey } from "./identity.js";
import { daemonArtifactName } from "./artifacts.js";
import { isModelAllowed, isProviderAllowed } from "./provider-policy.js";

const minimal = {
  schemaVersion: 1,
  id: "acme",
  name: "Acme Studio",
  applicationId: "com.acme.studio",
  daemonPort: 10099,
  assets: { icon: "./icon.png" },
};

test("custom defaults have independent identities and no upstream services", () => {
  const brand = resolveBrandManifest(minimal);
  assert.equal(brand.homeDir, ".acme");
  assert.equal(brand.desktopBinaryName, "acme-desktop");
  assert.notEqual(brand.desktopBinaryName, brand.cliName);
  assert.equal(brand.scheme, "acme");
  assert.equal(brand.serviceName, "acme-daemon");
  assert.equal(brand.envPrefix, "ACME");
  assert.equal(brand.distribution.updateMode, "disabled");
  assert.equal(brand.distribution.releaseBase, null);
  assert.equal(brand.services.pairingUrl, null);
  assert.equal(brand.distribution.iosStoreId, null);
  assert.equal(brand.links.docs, null);
  assert.equal(storageKey(brand, "settings"), "com.acme.studio:settings");
});
test("installer presentation defaults to the dark palette and accepts overrides", () => {
  const brand = resolveBrandManifest({
    ...minimal,
    colors: {
      dark: {
        accent: "#c4b5fd",
        accentForeground: "#27143d",
        background: "#20152e",
        foreground: "#faf5ff",
      },
    },
  });
  assert.equal(brand.installer.colors.background, "#20152e");
  assert.equal(brand.installer.colors.accent, "#c4b5fd");
  assert.equal(brand.installer.copy.ready, "Acme Studio is ready");
  const custom = resolveBrandManifest({
    ...minimal,
    installer: {
      tagline: "Build with {name}",
      colors: { success: "#00ff00" },
      copy: { installing: "Setting up {name}" },
    },
  });
  assert.equal(custom.installer.tagline, "Build with Acme Studio");
  assert.equal(custom.installer.colors.success, "#00ff00");
  assert.equal(custom.installer.copy.installing, "Setting up Acme Studio");
  for (const installer of [
    { colors: { success: "green" } },
    { copy: { unknown: "x" } },
    { tagline: "x".repeat(81) },
  ]) {
    assert.equal(BrandManifestSchema.safeParse({ ...minimal, installer }).success, false);
  }
  assert.throws(
    () =>
      resolveBrandManifest({
        ...minimal,
        installer: { colors: { background: "#ffffff", foreground: "#fefefe" } },
      }),
    /installer colors require text contrast/,
  );
});

test("invalid identity, unsupported version, unknown fields and bad contrast are rejected", () => {
  for (const patch of [
    { id: "../frogg" },
    { applicationId: "not-valid" },
    { daemonPort: 99999 },
    { schemaVersion: 2 },
    { secret: "not-a-brand-field" },
  ]) {
    assert.equal(BrandManifestSchema.safeParse({ ...minimal, ...patch }).success, false);
  }
  assert.throws(
    () =>
      resolveBrandManifest({
        ...minimal,
        colors: {
          light: {
            accent: "#ffffff",
            accentForeground: "#ffffff",
            background: "#ffffff",
            foreground: "#000000",
          },
        },
      }),
    /contrast/,
  );
});
test("updates require a source and signed mode requires a public key", () => {
  assert.throws(
    () =>
      resolveBrandManifest({
        ...minimal,
        distribution: { updates: "github-release" },
      }),
    /repository/,
  );
  assert.throws(
    () =>
      resolveBrandManifest({
        ...minimal,
        distribution: { updates: "tauri-signed", repository: "acme/studio" },
      }),
    /updaterPublicKey/,
  );
  const brand = resolveBrandManifest({
    ...minimal,
    distribution: { repository: "acme/studio" },
  });
  assert.equal(brand.distribution.releasesApi, "https://api.github.com/repos/acme/studio/releases");
});
test("custom home selection ignores inherited Frogg homes", () => {
  const brand = resolveBrandManifest(minimal);
  assert.equal(brandEnv(brand, { FROGG_HOME: "/frogg" }, "HOME"), undefined);
  assert.equal(brandEnv(brand, { ACME_HOME: " /acme " }, "HOME"), "/acme");
  const official = resolveBrandManifest({
    ...minimal,
    id: "frogg",
    envPrefix: "FROGG",
  });
  assert.equal(brandEnv(official, { FROGG_HOME: "/official" }, "HOME"), "/official");
});

test("normalizes branded environment variables to internal names", () => {
  const brand = resolveBrandManifest(minimal);
  const env: Record<string, string | undefined> = { ACME_LISTEN: "0.0.0.0:1234" };
  normalizeBrandEnvironment(brand, env);
  assert.equal(env.FROGG_LISTEN, "0.0.0.0:1234");
});

test("branded normalization rejects the legacy FROGG namespace", () => {
  const brand = resolveBrandManifest(minimal);
  const env: Record<string, string | undefined> = {
    ACME_LISTEN: "0.0.0.0:1234",
    FROGG_LISTEN: "127.0.0.1:1",
  };
  normalizeBrandEnvironment(brand, env);
  assert.equal(env.FROGG_LISTEN, "0.0.0.0:1234");
  const unset: Record<string, string | undefined> = { FROGG_LISTEN: "127.0.0.1:1" };
  normalizeBrandEnvironment(brand, unset);
  assert.equal(unset.FROGG_LISTEN, undefined);
});
test("management accepts legacy metadata only for Frogg and rejects other products", () => {
  const brand = resolveBrandManifest(minimal);
  assert.equal(matchesBrand(brand, null), false);
  assert.equal(matchesBrand(brand, { id: "other", applicationId: brand.applicationId }), false);
  assert.equal(matchesBrand(brand, { id: brand.id, applicationId: brand.applicationId }), true);
  assert.equal(matchesBrand({ id: "frogg", applicationId: "app.frogg.frogg" }, null), true);
});
test("artifact names carry the selected brand across daemon targets", () => {
  const brand = resolveBrandManifest(minimal);
  assert.equal(
    daemonArtifactName(brand, "1.2.3", "win", "arm64"),
    "acme-daemon-1.2.3-win-arm64.zip",
  );
  assert.equal(
    daemonArtifactName(brand, "1.2.3", "linux", "x64"),
    "acme-daemon-1.2.3-linux-x64.tar.gz",
  );
});
test("project browsing starts at the brand's directory when it names one", () => {
  assert.equal(resolveBrandManifest(minimal).projects.defaultDirectory, "~");
  assert.equal(resolveBrandManifest({ ...minimal, projects: {} }).projects.defaultDirectory, "~");
  assert.equal(
    resolveBrandManifest({ ...minimal, projects: { defaultDirectory: "/srv/projects" } }).projects
      .defaultDirectory,
    "/srv/projects",
  );
  assert.throws(
    () => resolveBrandManifest({ ...minimal, projects: { defaultDirectory: "" } }),
    /defaultDirectory/,
  );
  assert.throws(
    () => resolveBrandManifest({ ...minimal, projects: { root: "/srv/projects" } }),
    /projects/,
  );
});

test("local pairing links ask for confirmation unless a brand opts in", () => {
  assert.equal(resolveBrandManifest(minimal).pairing.autoConfirmLocal, false);
  assert.equal(
    resolveBrandManifest({ ...minimal, pairing: { autoConfirmLocal: true } }).pairing
      .autoConfirmLocal,
    true,
  );
  assert.throws(
    () => resolveBrandManifest({ ...minimal, pairing: { autoConfirm: true } }),
    /pairing/,
  );
});
test("a brand can ship host settings sections hidden", () => {
  assert.deepEqual(resolveBrandManifest(minimal).hostSettings.hiddenSections, []);
  assert.deepEqual(
    resolveBrandManifest({
      ...minimal,
      hostSettings: { hiddenSections: ["pair-device", "agents"] },
    }).hostSettings.hiddenSections,
    ["pair-device", "agents"],
  );
  assert.throws(
    () => resolveBrandManifest({ ...minimal, hostSettings: { hiddenSections: ["nonsense"] } }),
    /hiddenSections/,
  );
  assert.throws(
    () => resolveBrandManifest({ ...minimal, hostSettings: { hidden: ["agents"] } }),
    /hostSettings/,
  );
});

test("branded distributions default the daemon locked down; upstream stays open", () => {
  assert.deepEqual(resolveBrandManifest(minimal).daemon, {
    bind: "loopback",
    bindHost: "127.0.0.1",
    workspaceServicesBind: "loopback",
    workspaceServicesBindHost: "127.0.0.1",
    claimMode: true,
    trustLan: false,
    claimScope: "any",
    providerUpdateChecks: true,
  });
  assert.deepEqual(resolveBrandManifest({ ...minimal, id: "frogg" }).daemon, {
    bind: "all",
    bindHost: "0.0.0.0",
    workspaceServicesBind: "loopback",
    workspaceServicesBindHost: "127.0.0.1",
    claimMode: false,
    trustLan: true,
    claimScope: "any",
    providerUpdateChecks: true,
  });
  assert.deepEqual(
    resolveBrandManifest({ ...minimal, daemon: { bind: "all", claimMode: false } }).daemon,
    {
      bind: "all",
      bindHost: "0.0.0.0",
      workspaceServicesBind: "loopback",
      workspaceServicesBindHost: "127.0.0.1",
      claimMode: false,
      trustLan: false,
      claimScope: "any",
      providerUpdateChecks: true,
    },
  );
  assert.throws(() => resolveBrandManifest({ ...minimal, daemon: { bind: "lan" } }), /bind/);
});

test("a managed brand pins trustLan, claimScope and providerUpdateChecks", () => {
  const daemon = resolveBrandManifest({
    ...minimal,
    daemon: { trustLan: true, claimScope: "local", providerUpdateChecks: false },
  }).daemon;
  assert.equal(daemon.trustLan, true);
  assert.equal(daemon.claimScope, "local");
  assert.equal(daemon.providerUpdateChecks, false);
  // Upstream can opt out of LAN trust too.
  assert.equal(
    resolveBrandManifest({ ...minimal, id: "frogg", daemon: { trustLan: false } }).daemon.trustLan,
    false,
  );
  assert.throws(
    () => resolveBrandManifest({ ...minimal, daemon: { claimScope: "lan" } }),
    /claimScope/,
  );
});

test("a brand can opt workspace services back onto every interface", () => {
  const daemon = resolveBrandManifest({
    ...minimal,
    daemon: { workspaceServicesBind: "all" },
  }).daemon;
  assert.equal(daemon.workspaceServicesBind, "all");
  assert.equal(daemon.workspaceServicesBindHost, "0.0.0.0");
  // The daemon's own bind is unaffected by the workspace-service bind.
  assert.equal(daemon.bindHost, "127.0.0.1");
  assert.throws(
    () => resolveBrandManifest({ ...minimal, daemon: { workspaceServicesBind: "lan" } }),
    /workspaceServicesBind/,
  );
});

test("mobile defaults on and can be turned off", () => {
  assert.equal(resolveBrandManifest(minimal).mobile.enabled, true);
  assert.equal(
    resolveBrandManifest({ ...minimal, mobile: { enabled: false } }).mobile.enabled,
    false,
  );
});

test("provider policy locks providers and keeps OpenCode's hosted models off for brands", () => {
  const open = resolveBrandManifest({ ...minimal, id: "frogg" }).providers;
  assert.deepEqual(open, { allowed: null, models: {} });
  assert.equal(isModelAllowed(open, ["opencode"], "opencode/big-pickle"), true);

  const branded = resolveBrandManifest({
    ...minimal,
    providers: { allowed: ["claude", "opencode"] },
  }).providers;
  assert.equal(isProviderAllowed(branded, "claude"), true);
  assert.equal(isProviderAllowed(branded, "codex"), false);
  assert.equal(isModelAllowed(branded, ["opencode"], "opencode/big-pickle"), false);
  assert.equal(isModelAllowed(branded, ["opencode"], "ollama/llama3.1:8b"), true);
  // A derived profile inherits the policy of the provider it extends.
  assert.equal(isModelAllowed(branded, ["local-oc", "opencode"], "opencode/grok-code"), false);

  const local = resolveBrandManifest({
    ...minimal,
    providers: { models: { opencode: { allow: ["ollama/*", "lmstudio/*"] } } },
  }).providers;
  assert.equal(isModelAllowed(local, ["opencode"], "ollama/qwen3"), true);
  assert.equal(isModelAllowed(local, ["opencode"], "anthropic/claude-sonnet-5"), false);
  // Naming an OpenCode policy replaces the branded default.
  assert.equal(
    isModelAllowed(
      resolveBrandManifest({ ...minimal, providers: { models: { opencode: {} } } }).providers,
      ["opencode"],
      "opencode/big-pickle",
    ),
    true,
  );
  assert.throws(() => resolveBrandManifest({ ...minimal, providers: { allowed: [] } }), /allowed/);
});

test("the beta channel installs beside stable under its own identity", () => {
  const official = {
    ...minimal,
    id: "frogg",
    name: "frogg",
    applicationId: "app.frogg.frogg",
    daemonPort: 9999,
    distribution: { repository: "frogg-app/frogg", iosStoreId: "123" },
  };
  const stable = resolveBrandManifest(official);
  const beta = resolveBrandManifest(official, { channel: "beta" });
  assert.equal(stable.channel, "stable");
  assert.equal(beta.channel, "beta");
  assert.equal(beta.id, "frogg-beta");
  assert.equal(beta.name, "frogg beta");
  assert.equal(beta.applicationId, "app.frogg.frogg.beta");
  assert.equal(beta.daemonPort, 9998);
  assert.equal(beta.cliName, "frogg-beta");
  assert.equal(beta.desktopBinaryName, "frogg-beta");
  assert.equal(beta.homeDir, ".frogg-beta");
  assert.equal(beta.envPrefix, "FROGG_BETA");
  assert.equal(beta.scheme, "frogg-beta");
  assert.equal(beta.serviceName, "frogg-beta-daemon");
  assert.equal(beta.launchdLabel, "app.frogg.frogg.beta-daemon");
  assert.equal(beta.artifactPrefix, "frogg-beta");
  assert.equal(beta.legacyFrogg, false);
  assert.equal(beta.distribution.iosStoreId, null);
  assert.equal(beta.distribution.repository, "frogg-app/frogg");
  // Behaviour follows the product: frogg beta keeps frogg's open defaults and theme.
  assert.equal(beta.stockFrogg, true);
  assert.equal(beta.daemon.bind, stable.daemon.bind);
  assert.equal(beta.daemon.trustLan, stable.daemon.trustLan);
  assert.equal(beta.channelBadge, true);
  assert.equal(stable.channelBadge, false);
  // Both builds know each other's identity.
  assert.deepEqual(stable.channels, beta.channels);
  assert.equal(stable.channels.beta.cliName, "frogg-beta");
  assert.equal(beta.channels.stable.daemonPort, 9999);
  for (const key of [
    "applicationId",
    "daemonPort",
    "cliName",
    "homeDir",
    "envPrefix",
    "scheme",
    "serviceName",
    "launchdLabel",
    "artifactPrefix",
    "desktopBinaryName",
  ] as const) {
    assert.notEqual(beta[key], stable[key], key);
  }
});

test("a brand can rename its beta channel and keeps its casing", () => {
  const beta = resolveBrandManifest(
    {
      ...minimal,
      channels: { beta: { name: "Acme Preview", daemonPort: 10200, badge: false } },
    },
    { channel: "beta" },
  );
  assert.equal(beta.name, "Acme Preview");
  assert.equal(beta.daemonPort, 10200);
  assert.equal(beta.channelBadge, false);
  assert.equal(beta.stockFrogg, false);
  assert.equal(beta.daemon.bind, "loopback");
  assert.equal(resolveBrandManifest(minimal, { channel: "beta" }).name, "Acme Studio Beta");
  assert.throws(
    () =>
      resolveBrandManifest(
        { ...minimal, channels: { beta: { daemonPort: minimal.daemonPort } } },
        { channel: "beta" },
      ),
    /must differ/,
  );
});

test("a beta build ignores the stable build's inherited environment", () => {
  const beta = resolveBrandManifest(
    { ...minimal, id: "frogg", applicationId: "app.frogg.frogg", daemonPort: 9999 },
    { channel: "beta" },
  );
  const env: Record<string, string | undefined> = {
    FROGG_HOME: "/home/me/.frogg",
    FROGG_BETA_HOME: "/home/me/.frogg-beta",
    FROGG_LISTEN: "0.0.0.0:9999",
  };
  normalizeBrandEnvironment(beta, env);
  assert.equal(env.FROGG_HOME, "/home/me/.frogg-beta");
  assert.equal(env.FROGG_LISTEN, undefined);
  assert.equal(brandEnv(beta, { FROGG_HOME: "/stable" }, "HOME"), undefined);
});
