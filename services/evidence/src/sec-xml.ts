// Minimal, dependency-free XML helpers for SEC filing extractors. Namespace-prefix
// tolerant (`<ns:tag>` and `<tag>`) and attribute tolerant, since 13F information
// tables ship with a default namespace but some filers use prefixes.
// (The Form 4 extractor predates this and keeps its own slice-based helpers; a
// later tidy-up can converge it here.)

function tagPattern(tag: string, flags = ""): RegExp {
  return new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, flags);
}

// Inner text of the first `<tag>…</tag>`, trimmed; null when absent or empty.
export function tagText(xml: string, tag: string): string | null {
  const match = tagPattern(tag).exec(xml);
  if (!match) return null;
  const inner = match[1].trim();
  return inner === "" ? null : inner;
}

export function requireTagText(xml: string, tag: string, context: string): string {
  const value = tagText(xml, tag);
  if (value === null) throw new Error(`required tag <${tag}> not found in ${context}`);
  return value;
}

// Iterate the inner content of every `<tag>…</tag>` occurrence, in order.
export function* iterateBlocks(xml: string, tag: string): Generator<string> {
  const re = tagPattern(tag, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    yield match[1];
  }
}
