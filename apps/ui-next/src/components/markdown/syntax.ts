// Block syntax shared by Markdown.tsx and the streaming RevealMarkdown: GFM pipe tables and
// images. Offsets are relative to the start of the line (cells) or the text passed in (images),
// so the reveal renderer can map them back onto the streamed text.

export type Align = "left" | "center" | "right";

export interface Cell {
  text: string;
  /** Offset of `text` from the start of its line. */
  off: number;
}

export interface Table {
  head: Cell[];
  align: Align[];
  /** Body rows, each padded or cut to the header's column count. */
  rows: Cell[][];
  /** Index of the first line after the table. */
  end: number;
}

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Cells of one pipe row; escaped pipes (`\|`) stay inside their cell. */
export function splitRow(line: string): Cell[] {
  const cells: Cell[] = [];
  let i = 0;
  while (i < line.length && /\s/.test(line[i])) i++;
  if (line[i] === "|") i++;
  let start = i;
  for (; i <= line.length; i++) {
    if (i < line.length && line[i] === "\\" && line[i + 1] === "|") {
      i++;
      continue;
    }
    if (i === line.length || line[i] === "|") {
      const raw = line.slice(start, i);
      const lead = raw.length - raw.trimStart().length;
      cells.push({ text: raw.trim().replace(/\\\|/g, "|"), off: start + lead });
      start = i + 1;
    }
  }
  // A closing pipe leaves one empty trailing cell.
  if (cells.length > 1 && !cells[cells.length - 1].text && /\|\s*$/.test(line)) cells.pop();
  return cells;
}

function alignOf(spec: string): Align {
  const s = spec.trim();
  if (s.startsWith(":") && s.endsWith(":")) return "center";
  if (s.endsWith(":")) return "right";
  return "left";
}

/** A pipe table starting at line `i` (header, separator, then rows), or null. */
export function parseTable(lines: string[], i: number): Table | null {
  const headLine = lines[i];
  const sep = lines[i + 1];
  if (!headLine?.includes("|") || sep === undefined || !SEPARATOR.test(sep) || !sep.includes("-"))
    return null;
  const head = splitRow(headLine);
  const specs = splitRow(sep);
  // Without outer pipes a one-column separator is just a horizontal rule.
  if (specs.length !== head.length || (head.length === 1 && !headLine.trim().startsWith("|")))
    return null;
  const rows: Cell[][] = [];
  let end = i + 2;
  while (end < lines.length && lines[end].includes("|") && lines[end].trim()) {
    const cells = splitRow(lines[end]).slice(0, head.length);
    while (cells.length < head.length) cells.push({ text: "", off: lines[end].length });
    rows.push(cells);
    end++;
  }
  return { head, align: specs.map((c) => alignOf(c.text)), rows, end };
}

export type Piece =
  | { kind: "text"; text: string; off: number }
  | { kind: "img"; alt: string; src: string; off: number };

const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

export const hasImage = (text: string) => text.includes("![") && new RegExp(IMAGE).test(text);

/** Splits text around `![alt](src)` images; empty text runs between images are dropped. */
export function splitImages(text: string): Piece[] {
  if (!text.includes("![")) return [{ kind: "text", text, off: 0 }];
  const out: Piece[] = [];
  let pos = 0;
  for (const m of text.matchAll(IMAGE)) {
    const at = m.index ?? 0;
    if (text.slice(pos, at).trim()) out.push({ kind: "text", text: text.slice(pos, at), off: pos });
    out.push({ kind: "img", alt: m[1], src: m[2], off: at });
    pos = at + m[0].length;
  }
  if (text.slice(pos).trim() || !out.length)
    out.push({ kind: "text", text: text.slice(pos), off: pos });
  return out;
}

export type ImageSource =
  | { kind: "uri"; uri: string }
  | { kind: "host"; cwd: string; path: string };

function decodePath(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/**
 * Where an image lives. http(s), data and blob URLs load directly; `file://` URLs and paths are
 * on the agent's host, so they are read through the daemon (relative paths from `cwd`).
 */
export function resolveImage(src: string, cwd: string | undefined): ImageSource | null {
  const s = src.trim();
  if (!s) return null;
  if (/^(https?:|data:|blob:)/i.test(s)) return { kind: "uri", uri: s };
  if (/^file:/i.test(s)) {
    // file:///abs, file://localhost/abs, file:///C:/abs
    let p = decodePath(s.replace(/^file:\/\/(localhost)?/i, ""));
    if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1);
    return { kind: "host", cwd: rootOf(p), path: p };
  }
  if (/^[a-z][\w+.-]*:/i.test(s) && !/^[A-Za-z]:[\\/]/.test(s)) return null;
  const p = decodePath(s);
  if (p === "~" || p.startsWith("~/")) return { kind: "host", cwd: "~", path: p };
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p))
    return { kind: "host", cwd: rootOf(p), path: p };
  if (!cwd) return null;
  return { kind: "host", cwd, path: p.replace(/^\.\//, "") };
}

function rootOf(abs: string): string {
  const drive = /^([A-Za-z]:)[\\/]/.exec(abs);
  return drive ? `${drive[1]}/` : "/";
}
