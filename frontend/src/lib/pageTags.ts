// Facts about the user's own document come back with "(page N)" in the answer text, or "(document D, page N)" when the session has
// several documents (docs/CONTRACTS.md). The UI shows them as small inline tags instead of running text.

export interface TextPart {
  text: string;
  /** Set for a page marker: the short label to show ("p. 3", "doc 2 · p. 3"); `text` is then the marker as the backend wrote it. */
  tag?: string;
}

const PAGE_MARKER = /\((?:documents?\s+(\d+),\s*)?pages?\s+(\d+(?:\s*[-–]\s*\d+)?)\)/gi;

/** Splits an answer into plain text and page markers, in order. Text without markers comes back as one part. */
export function splitPageTags(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(PAGE_MARKER)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start) });
    const pages = m[2].replace(/\s+/g, "");
    parts.push({ text: m[0], tag: m[1] ? `doc ${m[1]} · p. ${pages}` : `p. ${pages}` });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
