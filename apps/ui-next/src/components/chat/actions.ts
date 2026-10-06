// Chat-side daemon calls that the shared store does not wrap: slash commands, attachments,
// questions, rename, fork, rewind, clean cut, accounts and auto-resume.
import { Buffer } from "buffer";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { getClient, openTimeline, useDaemon } from "../../daemon/store";
import type { Agent } from "../../daemon/types";

type Client = DaemonClient;
export type SlashCommand = Awaited<ReturnType<Client["listCommands"]>>["commands"][number];
export type Account = Awaited<ReturnType<Client["listProviderAccounts"]>>["accounts"][number];
export type UploadedFile = NonNullable<Awaited<ReturnType<Client["uploadFile"]>>["file"]>;
export type ForkContext = NonNullable<
  Awaited<ReturnType<Client["buildAgentForkContext"]>>["attachment"]
>;

/** A picked file, before it goes to the daemon. */
export interface Picked {
  name: string;
  mimeType: string;
  /** base64, no data: prefix */
  base64: string;
  size: number;
}

/** What rides along with the next message: images inline, other files uploaded to the host. */
export type Attachment =
  | { kind: "image"; id: string; name: string; mimeType: string; data: string }
  | { kind: "file"; id: string; name: string; file: UploadedFile }
  | { kind: "fork"; id: string; name: string; context: ForkContext };

function client(): Client {
  const c = getClient();
  if (!c) throw new Error("Not connected to a host");
  return c;
}

export function hasFeature(name: string): boolean {
  const info = getClient()?.getLastServerInfoMessage() as {
    features?: Record<string, unknown>;
  } | null;
  return info?.features?.[name] === true;
}

export async function listCommands(agentId: string): Promise<SlashCommand[]> {
  const res = await client().listCommands(agentId);
  if (res.error) throw new Error(res.error);
  return res.commands;
}

let attachSeq = 0;
export async function prepareAttachment(p: Picked): Promise<Attachment> {
  attachSeq += 1;
  const id = `a${attachSeq}`;
  if (p.mimeType.startsWith("image/"))
    return { kind: "image", id, name: p.name, mimeType: p.mimeType, data: p.base64 };
  const res = await client().uploadFile({
    fileName: p.name,
    mimeType: p.mimeType || "application/octet-stream",
    bytes: base64ToBytes(p.base64),
  });
  if (res.error || !res.file) throw new Error(res.error ?? "Upload failed");
  return { kind: "file", id, name: p.name, file: res.file };
}

export async function sendWithAttachments(
  agentId: string,
  text: string,
  attachments: Attachment[],
): Promise<void> {
  const images = attachments.flatMap((a) =>
    a.kind === "image" ? [{ data: a.data, mimeType: a.mimeType }] : [],
  );
  const files = attachments.flatMap<UploadedFile | ForkContext>((a) => {
    if (a.kind === "file") return [a.file];
    if (a.kind === "fork") return [a.context];
    return [];
  });
  await client().sendMessage(agentId, text, {
    ...(images.length ? { images } : {}),
    ...(files.length ? { attachments: files } : {}),
  });
}

type Permission = Agent["pendingPermissions"][number];

export async function answerQuestion(
  agentId: string,
  p: Permission,
  answers: Record<string, string>,
): Promise<void> {
  await client().respondToPermission(agentId, p.id, {
    behavior: "allow",
    updatedInput: { ...p.input, answers },
  });
}

export async function denyWithMessage(
  agentId: string,
  requestId: string,
  message: string,
): Promise<void> {
  await client().respondToPermission(agentId, requestId, { behavior: "deny", message });
}

export async function renameSession(agentId: string, name: string): Promise<void> {
  await client().updateAgent(agentId, { name });
}

export async function rewind(
  agentId: string,
  messageId: string,
  mode: "conversation" | "files" | "both",
): Promise<void> {
  await client().rewindAgent(agentId, messageId, mode);
  await openTimeline(agentId);
}

/** Pending fork contexts, keyed by the new session, sent with its first message. */
export const forkDrafts = new Map<string, Attachment>();

/** A new session on the same checkout carrying this conversation (up to a message) as context. */
export async function fork(agent: Agent, boundaryMessageId?: string): Promise<string> {
  const c = client();
  const res = await c.buildAgentForkContext(
    agent.id,
    boundaryMessageId ? { boundaryMessageId } : {},
  );
  if (res.error || !res.attachment) throw new Error(res.error ?? "Nothing to fork");
  const created = await c.createAgent({
    provider: agent.provider as never,
    cwd: agent.cwd,
    model: agent.model ?? undefined,
    modeId: agent.currentModeId ?? undefined,
    ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
    title: `Fork of ${agent.title || "session"}`,
  });
  attachSeq += 1;
  forkDrafts.set(created.id, {
    kind: "fork",
    id: `a${attachSeq}`,
    name: `Forked conversation · ${res.itemCount} items`,
    context: res.attachment,
  });
  useDaemon.setState((st) => ({
    sessions: {
      ...st.sessions,
      [created.id]: { agent: created, project: st.sessions[agent.id]?.project ?? null },
    },
  }));
  return created.id;
}

export async function cleanCut(agentId: string, providerAccountId?: string | null): Promise<void> {
  await client().cleanCutAgent(
    agentId,
    providerAccountId === undefined ? {} : { providerAccountId },
  );
}

export async function cancelAutoResume(agentId: string): Promise<void> {
  await client().cancelAgentAutoResume(agentId);
}

export async function listAccounts(provider: string): Promise<Account[]> {
  const res = await client().listProviderAccounts({ provider: provider as never });
  return res.accounts;
}

export async function moveToAccount(agentId: string, accountId: string | null): Promise<void> {
  await client().transferAgentProviderAccount(agentId, accountId);
}

export async function checkoutRisk(
  cwd: string,
): Promise<{ dirty: boolean; unpushed: number; branch: string | null } | null> {
  const st = (await client().getCheckoutStatus(cwd)) as {
    isGit?: boolean;
    isDirty?: boolean | null;
    aheadOfOrigin?: number | null;
    currentBranch?: string | null;
  };
  if (!st.isGit) return null;
  return {
    dirty: !!st.isDirty,
    unpushed: st.aheadOfOrigin ?? 0,
    branch: st.currentBranch ?? null,
  };
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}
