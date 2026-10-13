/**
 * Splits user-message text into plain runs, links and markdown images. User bubbles are
 * plain text, but agent-relayed messages and provider-materialized images arrive with
 * markdown in them; without this they render as raw `![Image](file:///…)` and `[t](url)`.
 */
export interface UserMessageRun {
  text: string;
  url?: string;
}
export type UserMessageSegment =
  | { kind: "text"; runs: UserMessageRun[] }
  | { kind: "image"; alt: string; src: string };

const IMAGE = /!\[([^\]\n]*)\]\(((?:\\.|[^)\\\n])+)\)/g;
const LINK_OR_URL = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>()[\]]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;

function unescapeSource(src: string): string {
  return src.replace(/\\([\\)])/g, "$1");
}

export function splitTextRuns(text: string): UserMessageRun[] {
  const runs: UserMessageRun[] = [];
  let last = 0;
  const push = (run: UserMessageRun) => {
    if (run.text) runs.push(run);
  };
  for (const match of text.matchAll(LINK_OR_URL)) {
    const start = match.index ?? 0;
    let raw = match[0];
    let label: string;
    let url: string;
    if (match[2]) {
      label = match[1];
      url = match[2];
    } else {
      raw = raw.replace(TRAILING_PUNCTUATION, "");
      label = raw;
      url = raw;
    }
    push({ text: text.slice(last, start) });
    push({ text: label, url });
    last = start + raw.length;
  }
  push({ text: text.slice(last) });
  return runs;
}

export function hasMarkdownImage(text: string): boolean {
  return new RegExp(IMAGE.source).test(text);
}

export function splitUserMessage(text: string): UserMessageSegment[] {
  const segments: UserMessageSegment[] = [];
  let last = 0;
  const pushText = (chunk: string) => {
    const trimmed = chunk.replace(/^\n+|\n+$/g, "");
    if (trimmed.trim()) segments.push({ kind: "text", runs: splitTextRuns(trimmed) });
  };
  for (const match of text.matchAll(IMAGE)) {
    const start = match.index ?? 0;
    pushText(text.slice(last, start));
    segments.push({ kind: "image", alt: match[1], src: unescapeSource(match[2]) });
    last = start + match[0].length;
  }
  pushText(text.slice(last));
  return segments;
}
