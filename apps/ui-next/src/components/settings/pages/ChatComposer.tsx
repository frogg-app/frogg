import { usePrefs, prefSetter } from "../../../prefs";
import { Row, Section, Seg, Toggle } from "../controls";

const BUSY: Array<["steer" | "queue" | "interrupt", string]> = [
  ["steer", "Steer"],
  ["queue", "Queue"],
  ["interrupt", "Interrupt"],
];
const TOOLS: Array<["full" | "summary", string]> = [
  ["full", "Full detail"],
  ["summary", "Summary"],
];
const SUBAGENTS: Array<["tab" | "pane", string]> = [
  ["tab", "In a tab"],
  ["pane", "Side pane"],
];
const URLS: Array<["ask" | "frogg" | "external", string]> = [
  ["ask", "Ask"],
  ["frogg", "In Frogg"],
  ["external", "External browser"],
];
const PRS: Array<["tool" | "pane" | "browser", string]> = [
  ["tool", "PRs & CI tool"],
  ["pane", "Side pane"],
  ["browser", "Browser"],
];
const DOWNLOADS: Array<["ask" | "folder", string]> = [
  ["ask", "Ask every time"],
  ["folder", "Save to folder"],
];

export function ChatComposer() {
  const p = usePrefs();
  return (
    <>
      <Section title="Sending">
        <Row label="While the agent is working, ⏎" hint="⌘⏎ does the other one" last>
          <Seg options={BUSY} value={p.busyEnter} onChange={prefSetter("busyEnter")} />
        </Row>
      </Section>
      <Section title="Transcript">
        <Row label="Tool calls">
          <Seg options={TOOLS} value={p.toolCalls} onChange={prefSetter("toolCalls")} />
        </Row>
        <Row label="Expand reasoning">
          <Toggle value={p.expandReasoning} onChange={prefSetter("expandReasoning")} />
        </Row>
        <Row label="Chat outline" hint="Jump list of your messages at the right edge">
          <Toggle value={p.chatOutline} onChange={prefSetter("chatOutline")} />
        </Row>
        <Row label="Open subagents" last>
          <Seg options={SUBAGENTS} value={p.subagents} onChange={prefSetter("subagents")} />
        </Row>
      </Section>
      <Section title="Links and files from chat">
        <Row label="Service URLs">
          <Seg options={URLS} value={p.serviceUrls} onChange={prefSetter("serviceUrls")} />
        </Row>
        <Row label="Pull requests open in">
          <Seg options={PRS} value={p.prLinks} onChange={prefSetter("prLinks")} />
        </Row>
        <Row label="Downloads">
          <Seg options={DOWNLOADS} value={p.downloads} onChange={prefSetter("downloads")} />
        </Row>
        <Row label="Show hidden folders in pickers" last>
          <Toggle value={p.hiddenFolders} onChange={prefSetter("hiddenFolders")} />
        </Row>
      </Section>
    </>
  );
}
