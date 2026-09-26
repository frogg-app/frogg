// Screenshot a screen of the running `npm run preview` with headless Chromium. Output lands in
// .dev/shots/<name>.png. Run `npm run shot -- --help` for usage.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { byTestId, openPreview, root } from "./preview-page.mts";

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
  --chrome <windows|linux|mac>  reserve desktop window-control space (dev override)

Examples
  npm run shot
  npm run shot -- host/providers --click provider-settings-claude
  npm run shot -- chat --crop message-input-root --width 1800`;

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
    chrome: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const pageErrors: string[] = [];
const consoleErrors: string[] = [];

async function main(): Promise<void> {
  const target = positionals[0] ?? "chat";
  const viewport = values.mobile
    ? { width: 390, height: 844 }
    : { width: Number(values.width), height: Number(values.height) };
  const { browser, page } = await openPreview({
    target,
    viewport,
    theme: values.theme === "light" ? "light" : "dark",
    mobile: values.mobile,
    query: values.chrome ? { chrome: values.chrome } : undefined,
    pageErrors,
    consoleErrors,
  });
  const errors = pageErrors;
  try {
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
