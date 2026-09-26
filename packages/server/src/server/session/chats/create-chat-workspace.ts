import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { WorkspaceProvisioningService } from "../workspace-provisioning/workspace-provisioning-service.js";

/**
 * Creates a chat: a fresh directory under the chats root, registered as a
 * workspace of the single project rooted at the chats root. Agents launched in
 * it get the chat profile from their cwd (see agent/chat-profile.ts).
 */
export async function createChatWorkspace(input: {
  chatsRoot: string;
  title: string | null;
  expectsInitialAgent: boolean;
  workspaceProvisioning: Pick<
    WorkspaceProvisioningService,
    "findOrCreateChatsProject" | "createWorkspaceForDirectory"
  >;
}): Promise<PersistedWorkspaceRecord> {
  const directory = join(input.chatsRoot, randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const project = await input.workspaceProvisioning.findOrCreateChatsProject(input.chatsRoot);
  return input.workspaceProvisioning.createWorkspaceForDirectory(
    directory,
    input.title,
    project.projectId,
    { expectsInitialAgent: input.expectsInitialAgent },
  );
}
