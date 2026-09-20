// Screenshot a screen of the running `npm run preview` with headless Chromium. Output lands in
// .dev/shots/<name>.png. Run `npm run shot -- --help` for usage.
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Locator, type Page } from "@playwright/test";
import {
  buildHostAgentDetailRoute,
  buildSettingsHostRoute,
} from "../../apps/ui/src/utils/host-routes.ts";
import { buildSeededHost } from "../../apps/ui/e2e/support/helpers/daemon-registry.ts";

const HELP = `npm run shot -- [target] [options]

Targets (default: chat)
  chat | chat2              the seeded chats
  settings[/<section>]      app settings, e.g. settings/appearance
  host[/<section>]          this host's settings, e.g. host/providers
  /any/route                any app route

Options
  --width <px>              viewport width (default 1400)
  --height <px>             viewport height (default 900)
  --mobile                  390x844 touch viewport
  --theme <dark|light>      colour scheme (default dark)
  --click <testID>          click an element first; repeat for a sequence
  --hover <testID>          leave the pointer over an element, for hover-only UI
  --wait <testID>           wait for an element before capturing
  --crop <testID>           capture only this element
  --full                    capture the full scrollable page
  --out <name>              file name (default: derived from the target)

Examples
  npm run shot
  npm run shot -- host/providers --click provider-settings-claude
  npm run shot -- chat --crop message-input-root --width 1800`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    width: { type: "string", default: "1400" },
    height: { type: "string", default: "900" },
    mobile: { type: "boolean", default: false },
    theme: { type: "string", default: "dark" },
    click: { type: "string", multiple: true, default: [] },
    hover: { type: "string" },
    wait: { type: "string" },
    crop: { type: "string" },
    full: { type: "boolean", default: false },
    out: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

interface PreviewState {
  localWebUrl: string;
  daemonEndpoint: string;
  serverId: string;
  workspaceId?: string;
  agents?: Array<{ id: string; title: string }>;
}

async function readState(): Promise<PreviewState> {
  try {
    return JSON.parse(await readFile(path.join(root, ".dev/preview/state.json"), "utf8"));
  } catch {
    throw new Error("No running preview found. Start one with: npm run preview");
  }
}

function resolveRoute(target: string, state: PreviewState): string {
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
  throw new Error(`Unknown target "${target}". See npm run shot -- --help`);
}

function byTestId(page: Page, testId: string): Locator {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

const pageErrors: string[] = [];
const consoleErrors: string[] = [];

async function main(): Promise<void> {
  const state = await readState();
  const target = positionals[0] ?? "chat";
  const route = resolveRoute(target, state);
  const viewport = values.mobile
    ? { width: 390, height: 844 }
    : { width: Number(values.width), height: Number(values.height) };

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport,
      colorScheme: values.theme === "light" ? "light" : "dark",
      hasTouch: values.mobile,
      isMobile: values.mobile,
      deviceScaleFactor: values.mobile ? 2 : 1,
    });
    // Register the preview daemon before the app boots, as the E2E fixtures do; otherwise a
    // deep route can load before the host is known and fall back to Home.
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
    const errors = pageErrors;
    page.on("pageerror", (error) => errors.push(error.message));
    // Console errors are mostly dev-mode React warnings; they are only worth showing when the
    // capture itself fails.
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().split("\n")[0] ?? "");
    });

    await page.goto(new URL(route, state.localWebUrl).href, { timeout: 180_000 });
    if (route.includes("?open=")) {
      // The workspace screen consumes `?open=` and then replaces the URL.
      await page.waitForURL((url) => !url.searchParams.has("open"), { timeout: 60_000 });
    }
    await page.waitForLoadState("networkidle").catch(() => undefined);
    // Every screen renders some text once its route chunk has loaded and the host has connected.
    await page
      .waitForFunction(() => (document.body?.innerText ?? "").trim().length > 20, undefined, {
        timeout: 60_000,
      })
      .catch(() => undefined);
    // A chat is ready once its composer is.
    if (target.startsWith("chat")) {
      await byTestId(page, "message-input-root").waitFor({ timeout: 60_000 });
    }
    for (const testId of values.click ?? []) {
      await byTestId(page, testId).click({ timeout: 30_000 });
      await page.waitForTimeout(300);
    }
    if (values.wait) await byTestId(page, values.wait).waitFor({ timeout: 30_000 });
    // Last, so a click sequence cannot move the pointer off again.
    if (values.hover) await byTestId(page, values.hover).hover({ timeout: 30_000 });

    // Let entering animations and late layout settle.
    await page.waitForTimeout(600);

    const name = values.out ?? target.replace(/^\//, "").replace(/[^a-z0-9-]+/gi, "-") ?? "shot";
    const file = path.join(root, ".dev/shots", `${name || "root"}.png`);
    await mkdir(path.dirname(file), { recursive: true });
    if (values.crop) {
      await byTestId(page, values.crop).screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: values.full });
    }
    console.log(file);
    for (const message of errors) console.error(`[page error] ${message}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  for (const message of [...pageErrors, ...consoleErrors.slice(-10)]) {
    console.error(`[page] ${message}`);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
