import { test } from "../support/fixtures";
import {
  expectComposerDraft,
  expectComposerFocused,
  expectComposerVisible,
  submitMessage,
  typeIntoFocusedComposer,
} from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("submitting a message leaves the composer ready for the next message", async ({ page }) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "composer-focus-",
    title: "Composer focus",
  });

  try {
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);

    await submitMessage(page, "First message");
    await expectComposerFocused(page);

    await typeIntoFocusedComposer(page, "Second message");
    await expectComposerDraft(page, "Second message");
  } finally {
    await agent.cleanup();
  }
});

test("clicking the chat box chrome focuses the message input", async ({ page }) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "composer-background-focus-",
    title: "Composer background focus",
  });

  try {
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);

    const composerBox = page.getByTestId("message-input-root");
    await composerBox.click({ position: { x: 4, y: 4 } });
    await expectComposerFocused(page);

    // The empty stretch of the toolbar row, between the left and right groups.
    const box = await composerBox.boundingBox();
    if (!box) throw new Error("composer has no bounding box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6);
    await expectComposerFocused(page);

    await typeIntoFocusedComposer(page, "Typed after clicking chrome");
    await expectComposerDraft(page, "Typed after clicking chrome");
  } finally {
    await agent.cleanup();
  }
});
