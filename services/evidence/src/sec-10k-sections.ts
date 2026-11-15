import { blockText, type ReleaseExhibit } from "./sec-earnings-release-extraction.ts";

export const TEN_K_ITEMS = ["1", "1A"] as const;
export type TenKItem = (typeof TEN_K_ITEMS)[number];

// canonicalText turns every tag into a space, so a tag inside a word splits it.
const tagSplitTolerant = (title: string) => title.split(" ").map((word) => [...word].join(" ?")).join("\\s+");
// Some filers type "ltem" for "Item" (1-800-Flowers' Item 1A), so every heading
// pattern accepts a leading l.
const HEADINGS: Readonly<Record<TenKItem, RegExp>> = {
  "1": new RegExp(`^[il]tems?\\s*1(?:\\s*(?:and|&)\\s*2)?\\s*[.:-]?\\s*(?:description\\s+of\\s+)?${tagSplitTolerant("business")}\\b`, "i"),
  "1A": new RegExp(`^[il]tem\\s*1a\\s*[.:-]?\\s*${tagSplitTolerant("risk factors")}\\b`, "i"),
};
const ANY_HEADING = /^(?:[Il]tems?|ITEMS?|items?)\s*\d{1,2}[A-Ca-c]?(?:\s*(?:and|And|AND|&)\s*\d{1,2}[A-Ca-c]?)?\s*(?:[.:-]\s*[A-Za-z[]|[A-Z[])/;
const MIN_ITEM_BODY_CHARS = 1_000;

// An HTML list item is one block, its bullet the browser's: a paragraph
// inside it is no item of its own. ponytail: a nested list merges into its
// parent item.
const LIST_ITEM = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const listItemBlock = (_: string, inner: string) => `<br><li>• ${inner.replace(/<\/?(?:p|div|br)\b[^>]*>/gi, " ")}</li>`;

export type TenKSection = ReleaseExhibit & { type: TenKItem };
export type SectionNotFound = { type: TenKItem; error: "section_not_found" };

export function tenKSections(html: string): Record<TenKItem, TenKSection | SectionNotFound> {
  const { text, edges } = blockText(html.replace(LIST_ITEM, listItemBlock));
  const starts = [...edges].sort((a, b) => a - b);
  const headings = starts.filter((at) => ANY_HEADING.test(text.slice(at, at + 40)));
  const longestHeadedSpan = (item: TenKItem): TenKSection | SectionNotFound => {
    let best: { start: number; end: number } | null = null;
    for (const [n, start] of headings.entries()) {
      if (!HEADINGS[item].test(text.slice(start, start + 60))) continue;
      const end = headings[n + 1] ?? text.length;
      if (best === null || end - start > best.end - best.start) best = { start, end };
    }
    if (best === null || best.end - best.start < MIN_ITEM_BODY_CHARS) return { type: item, error: "section_not_found" };
    const sectionText = text.slice(best.start, best.end).trimEnd();
    const sectionEdges = new Set(starts.filter((at) => at >= best.start && at - best.start <= sectionText.length).map((at) => at - best.start));
    return { type: item, text: sectionText, edges: sectionEdges };
  };
  return { "1": longestHeadedSpan("1"), "1A": longestHeadedSpan("1A") };
}
