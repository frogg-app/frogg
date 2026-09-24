import path from "node:path";
import { expect, test, vi } from "vitest";

// Non-FROGG prefix: under the stock brand a hardcoded FROGG_ name is
// indistinguishable from `${brand.envPrefix}_…`.
vi.mock("@frogg/branding", async () => {
  const { resolveBrandManifest } = await import("@frogg/branding/schema");
  return {
    brand: resolveBrandManifest({
      schemaVersion: 1,
      id: "acme",
      name: "Acme Studio",
      applicationId: "com.acme.studio",
      daemonPort: 10099,
      assets: { icon: "icon.png" },
    }),
  };
});

import { DEFAULT_SERVICE_LISTEN, resolveServicePlan, type ServicePlanInput } from "./plan.js";

const HOME_DIR = path.join("/scratch", "home", "dev");

function planInput(overrides: Partial<ServicePlanInput> = {}): ServicePlanInput {
  return {
    platform: "linux",
    homeDir: HOME_DIR,
    env: { PATH: "/usr/bin:/bin" },
    command: { program: "/opt/acme/bin/acme", args: ["daemon", "start", "--foreground"] },
    listen: "127.0.0.1:10099",
    froggHome: path.join(HOME_DIR, ".acme"),
    pathPrepend: "/opt/acme/bin",
    ...overrides,
  };
}

test("branded service default listen is the brand's loopback bind", () => {
  expect(DEFAULT_SERVICE_LISTEN).toBe("127.0.0.1:10099");
});

test("systemd unit uses the brand env prefix for listen and web UI", () => {
  const contents = resolveServicePlan(planInput()).file?.contents ?? "";
  expect(contents).toContain("Environment=ACME_LISTEN=127.0.0.1:10099");
  expect(contents).toContain("Environment=ACME_WEB_UI_ENABLED=true");
  expect(contents).not.toMatch(/FROGG_(LISTEN|WEB_UI_ENABLED)/);
});

test("launchd plist uses the brand env prefix for listen and web UI", () => {
  const contents = resolveServicePlan(planInput({ platform: "darwin" })).file?.contents ?? "";
  expect(contents).toContain("<key>ACME_LISTEN</key><string>127.0.0.1:10099</string>");
  expect(contents).toContain("<key>ACME_WEB_UI_ENABLED</key><string>true</string>");
  expect(contents).not.toMatch(/FROGG_(LISTEN|WEB_UI_ENABLED)/);
});
