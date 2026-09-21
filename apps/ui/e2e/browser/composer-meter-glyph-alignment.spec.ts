import { expect, test, type Page } from "../support/fixtures";
import type { Locator } from "@playwright/test";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { installProviderUsageFixture } from "../support/helpers/provider-usage";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Three device pixels to the point, so a correction of a twentieth of an em is several pixels. */
const DEVICE_SCALE = 3;

/**
 * Radius of the ring's well, as a fraction of the slot's shorter side. The ring is 20pt inside a
 * 26x28pt slot, so its stroke sits at 0.35 of the slot and everything inside 0.28 is the glyph
 * and nothing else — not the stroke, and not the antialiasing that spreads inwards off it.
 */
const WELL_RATIO = 0.28;

/** A decoded screenshot: RGBA rows, as the browser itself read them back. */
interface Bitmap {
  width: number;
  height: number;
  data: number[];
}

/**
 * Decodes a PNG through the page's own canvas rather than a Node image library: the harness has
 * no decoder among its dependencies, and the browser that drew these pixels is already open.
 */
async function decodePng(page: Page, png: Buffer): Promise<Bitmap> {
  return await page.evaluate(async (base64: string) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context to decode the screenshot with");
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: image.width, height: image.height, data: Array.from(image.data) };
  }, png.toString("base64"));
}

/**
 * How far a ring's letter sits from the centre of the ring's own slot, in device pixels.
 *
 * The slot's centre is the ring's centre by construction — the SVG is centred in it — so this
 * measures the glyph against layout rather than against a circle fitted to the arc, which would
 * carry the fit's own error. The glyph is taken as the bounding box of the ink inside the well,
 * not its intensity centroid: a centroid follows how a letterform distributes its weight, and C
 * is heavier on its left, which is not what "centred" means for a letter.
 */
function measureGlyphOffset(png: Bitmap): { dx: number; dy: number } {
  const { width, height, data } = png;
  const lum = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
  };
  // The slot's corner is capsule background: the ring never reaches it.
  const background = lum(0, 0);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const well = Math.min(width, height) * WELL_RATIO;

  let x0 = Number.POSITIVE_INFINITY;
  let x1 = -1;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.hypot(x - centerX, y - centerY) > well) continue;
      // A tenth of the ink's own contrast: enough to take the glyph's antialiased edge with it,
      // which is where a sub-pixel shift shows up, while ignoring the panel's own gradient.
      if (Math.abs(lum(x, y) - background) < 12) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) throw new Error("no glyph ink found inside the ring's well");
  return { dx: (x0 + x1) / 2 - centerX, dy: (y0 + y1) / 2 - centerY };
}

async function measureRing(page: Page, ring: Locator): Promise<{ dx: number; dy: number }> {
  return measureGlyphOffset(await decodePng(page, await ring.screenshot({ scale: "device" })));
}

async function openMockAgent(page: Page) {
  await page.setViewportSize(MOBILE_VIEWPORT);
  const session = await seedMockAgentWorkspace({
    repoPrefix: "composer-meter-glyph-",
    title: "Composer meter glyph alignment e2e",
    initialPrompt: "emit 1 coalesced agent stream update for meter glyph alignment.",
  });
  await openAgentRoute(page, session);
  await expectComposerVisible(page);
  await expect(page.getByTestId("context-window-meter")).toBeVisible({ timeout: 30_000 });
  return session;
}

/**
 * The composer's rings letter themselves with a single character, and a character off the ring's
 * centre reads as a wobble along the row — the rings sit side by side, so the error is visible by
 * comparison even when it is under a pixel. Centring the text box does not centre the character
 * vertically, which `meterGlyphRise` corrects; this measures the correction where it matters, in
 * a rendered ring, rather than trusting the layout that needed correcting.
 */
test.describe("composer meter glyphs", () => {
  test.use({ deviceScaleFactor: DEVICE_SCALE });

  test("every ring's letter is centred on the ring it labels", async ({ page }) => {
    test.setTimeout(180_000);
    await installProviderUsageFixture(page, [
      {
        fetchedAt: "2026-09-21T00:00:00.000Z",
        providers: [
          {
            providerId: "mock",
            displayName: "Mock provider",
            status: "available",
            planLabel: "Test plan",
            windows: [
              {
                id: "session",
                label: "Session",
                // Both windows report nothing used, so no arc is drawn and the only ink inside
                // the ring is the letter being measured.
                usedPct: 0,
                remainingPct: 100,
                resetsAt: "2026-09-21T05:00:00.000Z",
              },
              {
                id: "weekly",
                label: "Weekly",
                usedPct: 0,
                remainingPct: 100,
                resetsAt: "2026-09-26T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    ]);
    const session = await openMockAgent(page);
    try {
      await expect(page.getByTestId("composer-usage-cluster")).toBeVisible({ timeout: 30_000 });
      const rings = {
        S: page.getByTestId("composer-quota-ring-session"),
        W: page.getByTestId("composer-quota-ring-weekly"),
        C: page.getByTestId("context-window-meter"),
      };
      for (const ring of Object.values(rings)) await expect(ring).toBeVisible();

      for (const [glyph, ring] of Object.entries(rings)) {
        const { dx, dy } = await measureRing(page, ring);
        // One device pixel at three pixels to the point, which is a third of a point: the
        // uncorrected glyph is a device pixel or more off here, so this fails on the drift it
        // exists to catch, and it holds for any font because the correction is measured from
        // the font rather than assumed.
        expect(
          Math.abs(dx),
          `${glyph} sits ${dx} device px off centre horizontally`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(dy),
          `${glyph} sits ${dy} device px off centre vertically`,
        ).toBeLessThanOrEqual(1);
      }
    } finally {
      await session.cleanup();
    }
  });
});
