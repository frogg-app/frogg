import { bugReportEndpoint } from "@frogg/protocol/usage-stats/events";
import type { RedactionResult } from "@frogg/protocol/usage-stats/redact";
import { useCallback, useMemo, useState } from "react";
import { Platform, Share } from "react-native";
import { getClient, useDaemon } from "../../../daemon/store";
import {
  bugReportFileName,
  bugReportPayload,
  buildBugReport,
  chatTranscript,
  type TranscriptItem,
} from "../../../usage-stats/bug-report";
import { appIdentity, COLLECTOR_URL, track } from "../../../usage-stats/store";
import { Button } from "../../Button";
import { Select, type Option } from "../../Select";
import { copyText } from "../../shell/copy";
import { T } from "../../Text";
import { Area, Note, Row, Section, Toggle } from "../controls";
import { Acts, Block, ErrorLine, useAction } from "./kit";

const ENDPOINT = bugReportEndpoint(COLLECTOR_URL);

function describeRedactions(r: RedactionResult): string {
  const parts = Object.entries(r.counts)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`);
  return parts.length
    ? `Removed before preview: ${parts.join(", ")}. Check the rest yourself before sending.`
    : "Nothing identifying was found automatically. Check the text yourself before sending.";
}

/** Saves the report where the user can share it: a download on web/desktop, the share sheet on phones. */
async function saveReport(text: string): Promise<void> {
  if (Platform.OS !== "web") {
    await Share.share({ message: text, title: "Frogg bug report" });
    return;
  }
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) throw new Error("Saving is not available here");
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = doc.createElement("a");
  a.href = url;
  a.download = bugReportFileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Report a bug: describe it, optionally attach one chat, then review a redacted preview, edit it,
 * and send it to the brand's collector or save it as a file. Nothing leaves the device until
 * Send or Save is pressed, and what leaves is exactly the edited text.
 */
export function BugReport() {
  const sessions = useDaemon((st) => st.sessions);
  const [description, setDescription] = useState("");
  const [attach, setAttach] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [redactions, setRedactions] = useState<RedactionResult | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();

  const options = useMemo<Array<Option<string>>>(
    () =>
      Object.values(sessions)
        .filter((s) => !s.hostId)
        .sort((a, b) => String(b.agent.updatedAt).localeCompare(String(a.agent.updatedAt)))
        .slice(0, 30)
        .map((s) => ({
          value: s.agent.id,
          label: s.agent.title || "Untitled session",
          hint: s.agent.provider,
        })),
    [sessions],
  );

  const preview = useCallback(() => {
    void act.run("preview", async () => {
      let chat: string | null = null;
      const session = attach && sessionId ? sessions[sessionId] : undefined;
      if (session) {
        const res = await getClient()?.fetchAgentTimeline(session.agent.id, {
          direction: "tail",
          limit: 200,
        });
        chat = chatTranscript((res?.entries ?? []).map((e) => e.item as TranscriptItem));
      }
      const info = getClient()?.getLastServerInfoMessage() as { version?: string } | null;
      const built = buildBugReport({
        description,
        app: appIdentity(),
        daemonVersion: info?.version ?? null,
        provider: session?.agent.provider ?? null,
        chat,
      });
      setRedactions(built);
      setDraft(built.text);
      setDone(null);
    });
  }, [act, attach, description, sessionId, sessions]);

  const withChat = attach && !!sessionId;
  const send = useCallback(() => {
    if (draft === null || !ENDPOINT) return;
    void act.run("send", async () => {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bugReportPayload(draft, appIdentity(), withChat)),
      });
      if (!res.ok) throw new Error(`The collector refused the report (${res.status})`);
      track("bug_report_sent", { withChat });
      setDone("Report sent. Thank you.");
      setDraft(null);
      setDescription("");
    });
  }, [act, draft, withChat]);
  const save = useCallback(() => {
    if (draft === null) return;
    void act.run("save", async () => {
      await saveReport(draft);
      setDone("Report saved. Attach the file wherever you report issues.");
    });
  }, [act, draft]);
  const copy = useCallback(() => {
    if (draft !== null) void copyText(draft).then((ok) => setDone(ok ? "Copied." : null));
  }, [draft]);
  const discard = useCallback(() => {
    setDraft(null);
    setRedactions(null);
  }, []);

  return (
    <>
      <Section title="Report a bug">
        <Block>
          <Area
            value={description}
            onChange={setDescription}
            placeholder="What happened, and what did you expect?"
          />
        </Block>
        <Row label="Attach a chat" hint="Messages and tool names from one session, redacted">
          <Toggle value={attach} onChange={setAttach} label="Attach a chat" />
        </Row>
        {attach && (
          <Row label="Session">
            <Select
              value={sessionId}
              options={options}
              onChange={setSessionId}
              placeholder={options.length ? "Choose a session" : "No sessions on this host"}
            />
          </Row>
        )}
        <Row label="Preview" hint="Builds the report on this device; nothing is sent yet" last>
          <Button
            label={act.pending === "preview" ? "Building…" : "Preview report"}
            kind="primary"
            onPress={preview}
            disabled={!!act.pending || (attach && !sessionId)}
          />
        </Row>
      </Section>
      {draft !== null && (
        <Section title="Review before sending">
          <Block>
            <Area value={draft} onChange={setDraft} />
            {redactions && <T v="label">{describeRedactions(redactions)}</T>}
          </Block>
          <Block last>
            <Acts>
              {ENDPOINT && (
                <Button
                  label={act.pending === "send" ? "Sending…" : "Send report"}
                  kind="primary"
                  onPress={send}
                  disabled={!!act.pending || !draft.trim()}
                />
              )}
              <Button
                label="Save as file"
                kind={ENDPOINT ? "ghost" : "primary"}
                onPress={save}
                disabled={!!act.pending}
              />
              <Button label="Copy" onPress={copy} />
              <Button label="Discard" onPress={discard} />
            </Acts>
          </Block>
        </Section>
      )}
      <ErrorLine text={act.error} />
      {done && <Note>{done}</Note>}
      {!ENDPOINT && (
        <Note>This build has no report collector: save the report and attach it to an issue.</Note>
      )}
    </>
  );
}
