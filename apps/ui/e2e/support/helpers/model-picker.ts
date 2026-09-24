import { expect, type Locator, type Page } from "@playwright/test";
import { connectDaemonClient } from "./daemon-client-loader";

interface ModelPickerDaemonClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  patchDaemonConfig(config: {
    providers?: Record<string, Record<string, unknown>>;
    removeProviders?: string[];
  }): Promise<unknown>;
}

export interface HostSeed {
  /** Puts the host's config back the way the test found it and drops the client. */
  restore(): Promise<void>;
}

export interface SeededProviderModel {
  id: string;
  label: string;
  description: string;
}

/**
 * Registers a second provider that reports a fixed catalog. The E2E daemon has
 * exactly one provider with models (`mock`), so nothing cross-provider can be
 * proven without one more.
 *
 * `extends: "mock"` is rejected — the config validator only accepts the six
 * shipped providers plus `acp`. Extending `claude` with a replacement `models`
 * list is what avoids running anything: replacement models skip catalog
 * discovery, and Claude's static modes mean the provider never spawns. The
 * command only has to resolve for the availability probe, hence `node`.
 * Providers with dynamic catalogs can pass a small RPC fixture as `command`.
 */
export async function seedModelProvider(input: {
  id: string;
  label: string;
  models: SeededProviderModel[];
  extends?: "claude" | "pi";
  command?: string[];
}): Promise<HostSeed> {
  const client = await connectDaemonClient<ModelPickerDaemonClient>({
    clientIdPrefix: "model-picker-e2e",
  });
  await client.patchDaemonConfig({
    providers: {
      [input.id]: {
        extends: input.extends ?? "claude",
        label: input.label,
        description: `${input.label} test provider`,
        enabled: true,
        command: input.command ?? ["node"],
        models: input.models,
      },
    },
  });
  return {
    async restore() {
      await client.patchDaemonConfig({ removeProviders: [input.id] }).catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
}

/** Desktop web renders the model browser inside the combobox popover. */
function pickerViewport(page: Page): Locator {
  return page.getByTestId("combobox-desktop-container");
}

export async function openModelPicker(page: Page): Promise<void> {
  await page.getByTestId("combined-model-selector").filter({ visible: true }).first().click();
  await expect(pickerViewport(page)).toBeVisible({ timeout: 30_000 });
}

export async function closeModelPicker(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(pickerViewport(page)).toHaveCount(0, { timeout: 30_000 });
}

/**
 * The picker opens on the selected provider; cross-provider search lives on the
 * root view, one step back.
 */
export async function showAllModels(page: Page): Promise<void> {
  const back = page.getByTestId("sheet-header-back").filter({ visible: true });
  if ((await back.count()) > 0) {
    await back.first().click();
  }
  await expect(page.getByTestId("model-search-all-input")).toBeVisible({ timeout: 30_000 });
}

export async function searchAllModels(page: Page, query: string): Promise<void> {
  const input = page.getByTestId("model-search-all-input");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(query);
}

export async function expectModelSearchResult(
  page: Page,
  expected: { provider: string; modelId: string; providerLabel: string; modelLabel: string },
): Promise<void> {
  const row = pickerViewport(page).getByTestId(
    `model-row-${expected.provider}-${expected.modelId}`,
  );
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText(expected.modelLabel, { exact: true })).toBeVisible();
  await expect(
    row.getByText(new RegExp(`^${escapeForRegex(expected.providerLabel)}\\b`)),
  ).toBeVisible();
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function expectModelSearchEmptyState(page: Page, query: string): Promise<void> {
  const empty = page.getByTestId("model-search-empty");
  await expect(empty).toBeVisible({ timeout: 30_000 });
  await expect(empty.getByText(`No models match "${query}"`, { exact: true })).toBeVisible();
}

export async function readModelPickerHeight(page: Page): Promise<number> {
  const box = await pickerViewport(page).boundingBox();
  if (!box) {
    throw new Error("Expected the model picker to be laid out");
  }
  return box.height;
}

export async function readModelPickerWidth(page: Page): Promise<number> {
  const box = await pickerViewport(page).boundingBox();
  if (!box) {
    throw new Error("Expected the model picker to be laid out");
  }
  return box.width;
}

export async function expectModelPickerHeight(page: Page, expectedHeight: number): Promise<void> {
  await expect.poll(() => readModelPickerHeight(page)).toBe(expectedHeight);
}

export async function expectModelPickerWidth(page: Page, expectedWidth: number): Promise<void> {
  await expect.poll(() => readModelPickerWidth(page)).toBe(expectedWidth);
}

export async function expectSearchResultsVirtualized(
  page: Page,
  input: { provider: string; total: number },
): Promise<void> {
  const mountedRows = pickerViewport(page).locator(`[data-testid^="model-row-${input.provider}-"]`);
  await expect.poll(() => mountedRows.count()).toBeGreaterThan(0);
  expect(await mountedRows.count()).toBeLessThan(input.total);
}
