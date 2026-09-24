import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UploadedFileAttachment } from "@frogg/protocol/messages";

function sanitizeName(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "job"
  );
}

/**
 * Write a CI job log beside the daemon's other uploads and describe it the way
 * an uploaded file is described, so a composer attaches it like any other file
 * and the agent reads it from disk on demand.
 */
export async function saveCiJobLog(input: {
  froggHome: string;
  jobKey: string;
  jobName?: string;
  text: string;
  now: number;
}): Promise<UploadedFileAttachment> {
  const id = `ci-log_${sanitizeName(input.jobKey)}_${input.now}`;
  const directory = join(input.froggHome, "uploads", id);
  await mkdir(directory, { recursive: true });
  const fileName = `${sanitizeName(input.jobName ?? input.jobKey)}.log`;
  const path = join(directory, fileName);
  await writeFile(path, input.text, "utf8");
  return {
    type: "uploaded_file",
    id,
    fileName,
    mimeType: "text/plain",
    size: Buffer.byteLength(input.text, "utf8"),
    path,
  };
}
