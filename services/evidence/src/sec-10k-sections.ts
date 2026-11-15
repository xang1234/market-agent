// Item 1 (Business) and Item 1A (Risk Factors) of a 10-K's primary document,
// as canonical text (blockText), each opening with its own heading. A heading
// counts only at the start of a block, so a cross-reference in prose ("see
// Item 1A") is never one. The table of contents repeats every heading, so each
// item is the occurrence that runs longest before the next item's heading.

import { blockText, type ReleaseExhibit } from "./sec-earnings-release-extraction.ts";

export const TEN_K_ITEMS = ["1", "1A"] as const;
export type TenKItem = (typeof TEN_K_ITEMS)[number];

const HEADINGS: Readonly<Record<TenKItem, RegExp>> = {
  "1": /^item\s*1\s*[.:-]?\s*business\b/i,
  "1A": /^item\s*1a\s*[.:-]?\s*risk\s+factors\b/i,
};
// Any item's heading: its number, then a capitalized title ("Item 2 .
// Properties", "ITEM 6. [RESERVED]", "Item 1C Cybersecurity").
const ANY_HEADING = /^(?:ITEM|Item)\s*\d{1,2}[A-Ca-c]?\s*[.:-]?\s*[A-Z[]/;
// Shorter than this, an occurrence is a table-of-contents row or an item
// marked "Not applicable", with nothing to extract.
const MIN_SECTION_CHARS = 1_000;

// A section's text: the exhibit shape, so verifyStatement and releasePrompts
// read it as they read an earnings release.
export type TenKSection = ReleaseExhibit & { type: TenKItem };
export type SectionNotFound = { type: TenKItem; error: "section_not_found" };

export function tenKSections(html: string): Record<TenKItem, TenKSection | SectionNotFound> {
  const { text, edges } = blockText(html);
  const starts = [...edges].sort((a, b) => a - b);
  const headings = starts.filter((at) => ANY_HEADING.test(text.slice(at, at + 40)));
  const section = (item: TenKItem): TenKSection | SectionNotFound => {
    let best: { start: number; end: number } | null = null;
    for (const [n, start] of headings.entries()) {
      if (!HEADINGS[item].test(text.slice(start, start + 40))) continue;
      const end = headings[n + 1] ?? text.length;
      if (best === null || end - start > best.end - best.start) best = { start, end };
    }
    if (best === null || best.end - best.start < MIN_SECTION_CHARS) return { type: item, error: "section_not_found" };
    const sectionText = text.slice(best.start, best.end).trimEnd();
    const sectionEdges = new Set(starts.filter((at) => at >= best.start && at - best.start <= sectionText.length).map((at) => at - best.start));
    return { type: item, text: sectionText, edges: sectionEdges };
  };
  return { "1": section("1"), "1A": section("1A") };
}
