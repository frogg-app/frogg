import { test, expect } from "../support/fixtures";
import { openWorkspaceWithAgents } from "../support/helpers/archive-tab";
import { seedWorkspace } from "../support/helpers/seed-client";

// The pill row above the composer sits in its own absolutely positioned lane, so nothing in the
// layout ties it to the composer's edge; this pins them together at a narrow and a wide pane.
test.describe("Composer pill row alignment", () => {
  test.describe.configure({ timeout: 180_000 });

  for (const width of [900, 1800]) {
    test(`the first pill is flush with the composer's left edge at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const workspace = await seedWorkspace({ repoPrefix: "composer-pill-alignment-" });
      try {
        const seedAgent = async (title: string) => {
          const agent = await workspace.client.createAgent({
            provider: "mock",
            model: "ten-second-stream",
            modeId: "load-test",
            cwd: workspace.repoPath,
            workspaceId: workspace.workspaceId,
            title,
          });
          await workspace.client.waitForAgentUpsert(
            agent.id,
            (snapshot) => snapshot.status === "idle",
            30_000,
          );
          return {
            id: agent.id,
            title,
            cwd: workspace.repoPath,
            workspaceId: workspace.workspaceId,
          };
        };
        await openWorkspaceWithAgents(page, [
          await seedAgent("Pill alignment"),
          await seedAgent("Pill alignment 2"),
        ]);

        const pill = page.getByTestId("composer-workspace-directory").filter({ visible: true });
        const composer = page.getByTestId("message-input-root").filter({ visible: true });
        await expect(pill.first()).toBeVisible();
        await expect(composer.first()).toBeVisible();

        await page.screenshot({ path: testInfo.outputPath(`composer-pills-${width}.png`) });

        const pillBox = await pill.first().boundingBox();
        const composerBox = await composer.first().boundingBox();
        expect(pillBox && composerBox).toBeTruthy();
        expect(Math.abs(pillBox!.x - composerBox!.x)).toBeLessThanOrEqual(1);
      } finally {
        await workspace.cleanup();
      }
    });
  }
});
