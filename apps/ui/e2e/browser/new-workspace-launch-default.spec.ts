import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { openNewWorkspaceComposer } from "../support/helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  expectChatLaunchSelected,
  expectTerminalLaunchSelected,
  expectTerminalOutputContains,
  expectWorkspaceOpensWithTerminalTab,
  fillTerminalPrompt,
  seedTerminalProfiles,
  selectLaunchOption,
  submitTerminalLaunch,
  type TerminalProfile,
  type TerminalProfileSeed,
} from "../support/helpers/new-workspace-launch";

// `sleep` keeps the terminal alive long enough for the UI to attach and
// render output before the process exits — see new-workspace-launch-terminal.spec.ts.
const PROMPT_PROFILE: TerminalProfile = {
  id: "e2e-default-profile",
  name: "Default Profile",
  command: "/bin/sh",
  args: ["-c", 'echo launched: "$0"; sleep 10', "{{{prompt}}}"],
};

test.describe("New workspace: launch target default", () => {
  let workspace: SeededWorkspace;
  let profileSeed: TerminalProfileSeed;

  test.beforeEach(async () => {
    workspace = await seedWorkspace({ repoPrefix: "launch-default-" });
    profileSeed = await seedTerminalProfiles([PROMPT_PROFILE]);
  });

  test.afterEach(async () => {
    await profileSeed.restore();
    await workspace?.cleanup();
  });

  test("a terminal launch is not remembered: New workspace always reopens on Chat", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    const openNewWorkspace = () =>
      openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });

    await openNewWorkspace();
    await expectChatLaunchSelected(page);

    await selectLaunchOption(page, PROMPT_PROFILE.id);
    await expectTerminalLaunchSelected(page, PROMPT_PROFILE.name);
    await fillTerminalPrompt(page, "one off");
    await submitTerminalLaunch(page);
    await expectWorkspaceOpensWithTerminalTab(page);
    await expectTerminalOutputContains(page, "launched: one off");

    await openNewWorkspace();
    await expectChatLaunchSelected(page);
  });
});
