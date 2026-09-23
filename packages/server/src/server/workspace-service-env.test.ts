import { describe, expect, it } from "vitest";

import { buildWorkspaceServiceEnv, normalizeServiceEnvName } from "./workspace-service-env.js";

describe("normalizeServiceEnvName", () => {
  it("normalizes punctuation and spaces to stable env names", () => {
    expect(normalizeServiceEnvName("app-server")).toBe("APP_SERVER");
    expect(normalizeServiceEnvName("app.server")).toBe("APP_SERVER");
    expect(normalizeServiceEnvName("app server")).toBe("APP_SERVER");
  });

  it("trims leading and trailing separators", () => {
    expect(normalizeServiceEnvName("  app server  ")).toBe("APP_SERVER");
  });
});

describe("buildWorkspaceServiceEnv", () => {
  const bindHostFor = (workspaceServiceBindHost: string | null) =>
    buildWorkspaceServiceEnv({
      scriptName: "daemon",
      projectSlug: "frogg",
      branchName: "main",
      daemonPort: 9999,
      workspaceServiceBindHost,
      peers: [{ scriptName: "daemon", port: 5173 }],
    }).HOST;

  it("binds services to loopback when nothing is configured", () => {
    // The default no longer follows the daemon's own listen host: binding the
    // daemon to every interface must not publish workspace dev servers too.
    expect(bindHostFor(null)).toBe("127.0.0.1");
    expect(bindHostFor("")).toBe("127.0.0.1");
    expect(bindHostFor("   ")).toBe("127.0.0.1");
  });

  it("binds services to the configured host when the operator opts in", () => {
    expect(bindHostFor("0.0.0.0")).toBe("0.0.0.0");
    expect(bindHostFor("::")).toBe("::");
    expect(bindHostFor("100.64.0.20")).toBe("100.64.0.20");
    expect(bindHostFor("  0.0.0.0  ")).toBe("0.0.0.0");
  });

  it("builds default branch self and service URLs", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "daemon",
        projectSlug: "frogg",
        branchName: "main",
        daemonPort: 9999,
        workspaceServiceBindHost: null,
        peers: [{ scriptName: "daemon", port: 5173 }],
      }),
    ).toEqual({
      HOST: "127.0.0.1",
      FROGG_PORT: "5173",
      FROGG_URL: "http://daemon--frogg.localhost:9999",
      FROGG_SERVICE_DAEMON_PORT: "5173",
      FROGG_SERVICE_DAEMON_URL: "http://daemon--frogg.localhost:9999",
    });
  });

  it("builds feature branch self and service URLs", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "daemon",
        projectSlug: "frogg",
        branchName: "feature-x",
        daemonPort: 9999,
        workspaceServiceBindHost: null,
        peers: [{ scriptName: "daemon", port: 5173 }],
      }),
    ).toEqual({
      HOST: "127.0.0.1",
      FROGG_PORT: "5173",
      FROGG_URL: "http://daemon--feature-x--frogg.localhost:9999",
      FROGG_SERVICE_DAEMON_PORT: "5173",
      FROGG_SERVICE_DAEMON_URL: "http://daemon--feature-x--frogg.localhost:9999",
    });
  });

  it("omits PORT while keeping FROGG_PORT", () => {
    const env = buildWorkspaceServiceEnv({
      scriptName: "daemon",
      projectSlug: "frogg",
      branchName: "main",
      daemonPort: 9999,
      workspaceServiceBindHost: null,
      peers: [{ scriptName: "daemon", port: 5173 }],
    });

    expect(env.FROGG_PORT).toBe("5173");
    expect(env).not.toHaveProperty("PORT");
  });

  it("omits URL variables when daemon port is absent while keeping port aliases", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "daemon",
        projectSlug: "frogg",
        branchName: "main",
        daemonPort: null,
        workspaceServiceBindHost: null,
        peers: [{ scriptName: "daemon", port: 5173 }],
      }),
    ).toEqual({
      HOST: "127.0.0.1",
      FROGG_PORT: "5173",
      FROGG_SERVICE_DAEMON_PORT: "5173",
    });
  });

  it("adds peer service ports and URLs", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "web",
        projectSlug: "frogg",
        branchName: "feature-x",
        daemonPort: 9999,
        workspaceServiceBindHost: null,
        peers: [
          { scriptName: "api", port: 4000 },
          { scriptName: "web", port: 5173 },
        ],
      }),
    ).toEqual({
      HOST: "127.0.0.1",
      FROGG_PORT: "5173",
      FROGG_URL: "http://web--feature-x--frogg.localhost:9999",
      FROGG_SERVICE_API_PORT: "4000",
      FROGG_SERVICE_API_URL: "http://api--feature-x--frogg.localhost:9999",
      FROGG_SERVICE_WEB_PORT: "5173",
      FROGG_SERVICE_WEB_URL: "http://web--feature-x--frogg.localhost:9999",
    });
  });

  it("uses public service URLs when a public base URL is configured", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "web",
        projectSlug: "frogg",
        branchName: "feature-x",
        daemonPort: 9999,
        workspaceServiceBindHost: null,
        serviceProxyPublicBaseUrl: "https://services.example.com",
        peers: [
          { scriptName: "api", port: 4000 },
          { scriptName: "web", port: 5173 },
        ],
      }),
    ).toMatchObject({
      FROGG_URL: "https://web--feature-x--frogg.services.example.com",
      FROGG_SERVICE_API_URL: "https://api--feature-x--frogg.services.example.com",
      FROGG_SERVICE_WEB_URL: "https://web--feature-x--frogg.services.example.com",
    });
  });

  it("throws when normalized peer env names collide", () => {
    expect(() =>
      buildWorkspaceServiceEnv({
        scriptName: "app-server",
        projectSlug: "frogg",
        branchName: "main",
        daemonPort: 9999,
        workspaceServiceBindHost: null,
        peers: [
          { scriptName: "app-server", port: 5173 },
          { scriptName: "app.server", port: 4000 },
        ],
      }),
    ).toThrow("Service env name collision for APP_SERVER: app-server, app.server");
  });
});
