// Shared by shot.mts and probe.mts: open a route of the running `npm run preview` in headless
// Chromium with the preview daemon pre-registered.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Locator, type Page } from "@playwright/test";
import {
  buildHostAgentDetailRoute,
  buildSettingsHostRoute,
} from "../../apps/ui/src/utils/host-routes.ts";
import { buildSeededHost } from "../../apps/ui/e2e/support/helpers/daemon-registry.ts";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface PreviewState {
  localWebUrl: string;
  daemonEndpoint: string;
  serverId: string;
  workspaceId?: string;
  agents?: Array<{ id: string; title: string }>;
}

export async function readState(): Promise<PreviewState> {
  try {
    return JSON.parse(await readFile(path.join(root, ".dev/preview/state.json"), "utf8"));
  } catch {
    throw new Error("No running preview found. Start one with: npm run preview");
  }
}

export function resolveRoute(target: string, state: PreviewState): string {
  if (target.startsWith("/")) return target;
  const [head, section] = target.split("/");
  if (head === "chat" || head === "chat2") {
    const agent = state.agents?.[head === "chat" ? 0 : 1];
    if (!agent || !state.workspaceId) {
      throw new Error("The preview has no seeded chats (was it started with --keep?).");
    }
    return buildHostAgentDetailRoute(state.serverId, agent.id, state.workspaceId);
  }
  if (head === "settings") return section ? `/settings/${section}` : "/settings";
  if (head === "host") {
    const base = buildSettingsHostRoute(state.serverId);
    return section ? `${base}/${section}` : base;
  }
  throw new Error(`Unknown target "${target}". Use chat, chat2, settings[/x], host[/x] or /route`);
}

export function byTestId(page: Page, testId: string): Locator {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

export interface OpenPreviewOptions {
  target: string;
  viewport: { width: number; height: number };
  theme?: "dark" | "light";
  mobile?: boolean;
  /** Extra query params, e.g. { chrome: "windows" } for the dev window-chrome override. */
  query?: Record<string, string>;
  pageErrors?: string[];
  consoleErrors?: string[];
}

export async function openPreview(
  options: OpenPreviewOptions,
): Promise<{ browser: Browser; page: Page; state: PreviewState }> {
  const state = await readState();
  const route = resolveRoute(options.target, state);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: options.viewport,
    colorScheme: options.theme === "light" ? "light" : "dark",
    hasTouch: options.mobile,
    isMobile: options.mobile,
    deviceScaleFactor: options.mobile ? 2 : 1,
  });
  // Register the preview daemon before the app boots, as the E2E fixtures do; otherwise a deep
  // route can load before the host is known and fall back to Home.
  const host = buildSeededHost({
    serverId: state.serverId,
    // The same endpoint EXPO_PUBLIC_LOCAL_DAEMON hands the app, so it is one host, not two.
    endpoint: state.daemonEndpoint,
    label: "preview",
    nowIso: new Date().toISOString(),
  });
  await context.addInitScript((daemon) => {
    localStorage.setItem("@frogg:daemon-registry", JSON.stringify([daemon]));
  }, host);
  const page = await context.newPage();
  page.on("pageerror", (error) => options.pageErrors?.push(error.message));
  // Console errors are mostly dev-mode React warnings; only worth showing when a run fails.
  page.on("console", (message) => {
    if (message.type() === "error")
      options.consoleErrors?.push(message.text().split("\n")[0] ?? "");
  });

  const url = new URL(route, state.localWebUrl);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  await page.goto(url.href, { timeout: 180_000 });
  if (route.includes("?open=")) {
    // The workspace screen consumes `?open=` and then replaces the URL.
    await page.waitForURL((next) => !next.searchParams.has("open"), { timeout: 60_000 });
  }
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Every screen renders some text once its route chunk has loaded and the host has connected.
  await page
    .waitForFunction(() => (document.body?.innerText ?? "").trim().length > 20, undefined, {
      timeout: 60_000,
    })
    .catch(() => undefined);
  // A chat is ready once its composer is.
  if (options.target.startsWith("chat")) {
    await byTestId(page, "message-input-root").waitFor({ timeout: 60_000 });
  }
  return { browser, page, state };
}
