import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { openSettingsSection } from "../support/helpers/settings";

/**
 * Settings renders as a split view — a fixed sidebar beside a detail pane — inside a modal that
 * tracks the window, so the detail pane is at its narrowest when the window is. A settings row
 * puts a label beside its controls, and the controls have an intrinsic width the label does not:
 * without a wrap the row takes the difference out of the label, and a sentence ends up one
 * character wide and the height of the pane. This drives the real app at the widths a window
 * actually gets and asserts each row's label keeps a legible width.
 *
 * `SETTINGS_LAYOUT_GALLERY` writes a screenshot per width, for looking at the layouts rather than
 * asserting about them:
 *
 *   SETTINGS_LAYOUT_GALLERY=/tmp/settings npx playwright test --project=browser \
 *     e2e/browser/settings-narrow-layout.spec.ts
 */
const WINDOW_WIDTHS = [740, 900, 1180, 1440];

/**
 * A text block this narrow, this tall, holding this much text, is not a paragraph any more: it is
 * a column of single letters. The check is deliberately shape-based rather than tied to a
 * particular row, so it holds for every settings section without each one naming itself.
 */
const CRUSHED_TEXT = { maxWidth: 80, minHeight: 80, minCharacters: 20 };

const SECTIONS = ["about", "general", "appearance"] as const;

/**
 * About's update row only renders inside the desktop shell, and it is the widest row settings
 * has — a sentence beside two buttons — so it is the row that breaks first and the one worth
 * measuring. Standing in a minimal shell bridge puts it on screen in the browser harness.
 *
 * The shell reports no update until the test asks for one: an update found at startup raises a
 * toast over the app's own chrome, which then sits between the harness and the settings button.
 */
async function stubDesktopShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const available = {
      hasUpdate: true,
      readyToInstall: true,
      currentVersion: "1.5.21",
      latestVersion: "1.5.22",
      installKind: "installer",
      strategy: "github-release",
      releaseUrl: "https://example.invalid/releases/v1.5.22",
      checkedAt: Date.now(),
      notes: null,
    };
    const none = { hasUpdate: false, readyToInstall: false, currentVersion: "1.5.22" };
    const state = { offerUpdate: false };
    (window as unknown as { __e2eDesktopUpdate: typeof state }).__e2eDesktopUpdate = state;
    window.froggDesktop = {
      platform: "linux",
      supportsLocalDaemon: false,
      async invoke(command: string) {
        if (command === "check_app_update") return state.offerUpdate ? available : none;
        if (command === "install_app_update") return { installed: false };
        return null;
      },
    } as unknown as Window["froggDesktop"];
  });
}

/** Asks the stubbed shell for an update and clicks About's own check button to fetch it. */
async function revealUpdateRow(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { __e2eDesktopUpdate: { offerUpdate: boolean } }
    ).__e2eDesktopUpdate.offerUpdate = true;
  });
  await page.getByTestId("desktop-update-check").click();
  const card = page.getByTestId("desktop-update-available");
  await expect(card).toBeVisible({ timeout: 15_000 });
  // The card renders below the sections already on screen, so bring it into the pane's view:
  // it is the row being measured, and in the gallery it is the row worth looking at.
  await card.scrollIntoViewIfNeeded();
}

async function captureGallery(page: Page, name: string): Promise<void> {
  const directory = process.env.SETTINGS_LAYOUT_GALLERY;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const modal = page.getByTestId("settings-modal");
  await writeFile(path.join(directory, `${name}.png`), await modal.screenshot());
}

interface CrushedText {
  text: string;
  width: number;
  height: number;
}

/** Every run of text in the open settings pane that has been squeezed into a vertical strip. */
async function findCrushedText(page: Page): Promise<CrushedText[]> {
  return await page.getByTestId("settings-modal").evaluate((root, limits) => {
    const crushed: { text: string; width: number; height: number }[] = [];
    for (const node of root.querySelectorAll("*")) {
      // Leaf elements only: a wrapper's text is its children's, measured on the wrapper's box.
      if (node.children.length > 0) continue;
      const text = node.textContent?.trim() ?? "";
      if (text.length < limits.minCharacters) continue;
      const { width, height } = node.getBoundingClientRect();
      if (width <= limits.maxWidth && height >= limits.minHeight) {
        crushed.push({
          text: text.slice(0, 40),
          width: Math.round(width),
          height: Math.round(height),
        });
      }
    }
    return crushed;
  }, CRUSHED_TEXT);
}

test.describe("settings layout at narrow widths", () => {
  for (const width of WINDOW_WIDTHS) {
    test(`rows stay legible at ${width}px`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 900 });
      await stubDesktopShell(page);
      // Deep link rather than clicking the sidebar: standing in the desktop shell brings the
      // app's own desktop chrome with it, which overlays the sidebar's settings button.
      await page.goto(buildSettingsSectionRoute("general"));
      await expect(page.getByTestId("settings-modal")).toBeVisible({ timeout: 30_000 });

      for (const section of SECTIONS) {
        await openSettingsSection(page, section);
        await expect(page.getByTestId("settings-modal")).toBeVisible();
        if (section === "about") await revealUpdateRow(page);
        await captureGallery(page, `${width}-${section}`);

        const crushed = await findCrushedText(page);
        expect(
          crushed,
          `${section} at ${width}px renders text as a vertical strip: ${JSON.stringify(crushed)}`,
        ).toEqual([]);
      }
    });
  }
});
