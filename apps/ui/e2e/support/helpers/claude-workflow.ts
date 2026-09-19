import { writeFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { submitMessage } from "./composer";
import type { AgentHandle } from "./rewind-flow";
import { openSubagentsTrack } from "./subagents";

export const WORKFLOW_ROW_DESCRIPTION = "Verify the workflow row lifecycle";
export const WORKFLOW_ROW_MARKER = "FROGG_WORKFLOW_ROW_OK";

export async function askClaudeToRunWorkflow(
  handle: AgentHandle,
  scriptPath: string,
  gatePath: string,
): Promise<void> {
  await submitMessage(
    handle.page,
    `Use Claude Code's Workflow tool exactly once with scriptPath ${JSON.stringify(
      scriptPath,
    )} and args ${JSON.stringify({ gatePath })}. Wait for its completion notification, then reply with exactly ${WORKFLOW_ROW_MARKER}.`,
  );
  await expect(handle.page.getByTestId("subagents-track-header")).toBeVisible({ timeout: 60_000 });
  await openSubagentsTrack(handle.page);
}

export function releaseWorkflow(gatePath: string): void {
  writeFileSync(gatePath, "release\n", "utf8");
}

export function workflowRow(page: Page) {
  // The parent transcript's Workflow tool card has the same accessible name. The track has no
  // separate landmark, so its established row test id is the only unambiguous scope.
  return page
    .getByTestId(/^subagents-track-row-/)
    .filter({ has: page.getByText(WORKFLOW_ROW_DESCRIPTION, { exact: true }) });
}

export async function expectWorkflowRunning(page: Page): Promise<void> {
  const row = workflowRow(page);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row).toContainText(WORKFLOW_ROW_DESCRIPTION);
  await expect(row).toContainText(/Workflow(?: · .+)?/);
  await expect(row.getByRole("progressbar", { name: "Agent running" })).toBeVisible();
}

export async function expectWorkflowCompleted(page: Page): Promise<void> {
  const row = workflowRow(page);
  await expect(row.getByRole("progressbar", { name: "Agent running" })).toHaveCount(0, {
    timeout: 120_000,
  });
  await expect(page.getByTestId("subagents-track-archive-finished")).toBeVisible();
  await expect(
    page.getByTestId("assistant-message").filter({ hasText: WORKFLOW_ROW_MARKER }).last(),
  ).toBeVisible({ timeout: 120_000 });
}

export async function expectSingleWorkflowParentCard(page: Page): Promise<void> {
  const parentToolCards = page.getByTestId("tool-call-badge");
  await expect(
    parentToolCards.filter({ has: page.getByText("Workflow", { exact: true }) }),
  ).toHaveCount(1);
  await expect(parentToolCards.filter({ hasText: "Task Notification" })).toHaveCount(0);
}

/** The label the fixture workflow gives the single agent it fans out. */
export const WORKFLOW_CHILD_LABEL = "workflow-row-child";

export function workflowChildRow(page: Page) {
  return page
    .getByTestId(/^subagents-track-row-/)
    .filter({ has: page.getByText(WORKFLOW_CHILD_LABEL, { exact: true }) });
}

/**
 * The agent the workflow fanned out gets its own row while the run is still gated open, which is
 * the whole point: a child that only appeared once the run finished would not be live status.
 */
export async function expectWorkflowChildRunning(page: Page): Promise<void> {
  const row = workflowChildRow(page);
  await expect(row).toBeVisible({ timeout: 120_000 });
  await expect(row.getByRole("progressbar", { name: "Agent running" })).toBeVisible();
}

export async function expectWorkflowChildCompleted(page: Page): Promise<void> {
  const row = workflowChildRow(page);
  await expect(row.getByRole("progressbar", { name: "Agent running" })).toHaveCount(0, {
    timeout: 120_000,
  });
}

/** The child owns its own timeline; its work must not also be replayed onto the Workflow row. */
export async function openWorkflowChildTimeline(page: Page): Promise<void> {
  await workflowChildRow(page).click();
  const panel = page.getByTestId("provider-subagent-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText("Start chatting with this agent...", { exact: true })).toHaveCount(
    0,
  );
}

export async function openWorkflowTimeline(page: Page): Promise<void> {
  await workflowRow(page).click();
  const panel = page.getByTestId("provider-subagent-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("provider-subagent-pane-subtitle")).toHaveText(
    /Workflow(?: · .+)?/,
  );
  await expect(panel.getByText("Start chatting with this agent...", { exact: true })).toHaveCount(
    0,
  );
  await expect(panel.getByText(WORKFLOW_ROW_MARKER, { exact: true })).toBeVisible();
}
