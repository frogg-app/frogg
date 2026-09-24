import { useCallback, useMemo } from "react";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { CiJob } from "./model";

export interface CiJobLogToChat {
  /** Whether this job's log can be attached: a finished GitHub Actions job, with a chat to add to. */
  canAdd: (job: CiJob) => boolean;
  /** Save the log on the daemon and attach it to the focused chat. Throws with the daemon's reason. */
  add: (job: CiJob) => Promise<void>;
}

/** Only GitHub Actions serves a job's log, and only once the job has finished. */
export function isJobLogAttachable(job: CiJob): boolean {
  return (
    job.id.startsWith("githubActions:job:") && job.status !== "queued" && job.status !== "running"
  );
}

export function useCiJobLogToChat(input: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
}): CiJobLogToChat | null {
  const { serverId, workspaceId, cwd } = input;
  const client = useHostRuntimeClient(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.ciJobLogs === true,
  );
  const { addUploadedFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  const available = Boolean(workspaceId && client && supported);

  const add = useCallback(
    async (job: CiJob) => {
      if (!client) return;
      const payload = await client.checkoutCiDownloadJobLog({
        cwd,
        jobId: job.id,
        jobName: job.name,
      });
      if (payload.error || !payload.file) {
        throw new Error(payload.error?.message ?? "The daemon returned no log");
      }
      await addUploadedFile(payload.file);
    },
    [addUploadedFile, client, cwd],
  );
  const canAdd = useCallback(
    (job: CiJob) => canAddToChat && isJobLogAttachable(job),
    [canAddToChat],
  );

  return useMemo(() => (available ? { canAdd, add } : null), [add, available, canAdd]);
}
