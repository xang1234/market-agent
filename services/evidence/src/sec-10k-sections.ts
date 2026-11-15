import { blockText, type ReleaseExhibit } from "./sec-earnings-release-extraction.ts";

export const TEN_K_ITEMS = ["1", "1A"] as const;
export type TenKItem = (typeof TEN_K_ITEMS)[number];

// canonicalText turns every tag into a space, so a tag inside a word splits it.
const tagSplitTolerant = (title: string) => title.split(" ").map((word) => [...word].join(" ?")).join("\\s+");
const TITLES: Readonly<Record<TenKItem, RegExp>> = {
  "1": new RegExp(`^(?:description\\s+of\\s+)?${tagSplitTolerant("business")}\\b`, "i"),
  "1A": new RegExp(`^${tagSplitTolerant("risk factors")}\\b`, "i"),
};
// A block opens with an item label, after a "PART I" that shares its block.
// Some filers type "ltem" for "Item" (1-800-Flowers' Item 1A).
const LABEL = /^(?:PART\s+[IV]+\s*[.:-]?\s*)?([il]tems?\s*(\d{1,2}[a-c]?)(?:\s*(?:and|&)\s*\d{1,2}[a-c]?)?\s*[.:-]?\s*)/i;
const MIN_ITEM_BODY_CHARS = 1_000;

// Words a title keeps in lower case ("Changes in and Disagreements with").
const TITLE_LINKS = new Set(["a", "an", "and", "about", "by", "for", "from", "in", "of", "on", "or", "regarding", "that", "the", "to", "with"]);
const LOWER_CASE_TITLE_WORDS = 6;

const CAPITALIZED = /^[^\p{L}\p{N}]*[\p{Lu}\p{N}(]/u;

// A label heads an item when its title ends the block, or a sentence ends
// the title ("Item 1A. Risk Factors. As a smaller reporting company").
// Lower-case words that run on past the title ("Item 1A. Risk Factors
// describes the risks") make a sentence that cites the item. One lower-case
// word right after a capitalized one ("Qualitat ive", "Statement s") is a
// title word split by markup. A title in lower case ("Item 1B. unresolved
// staff comments") is a heading only as a short line with no sentence end.
function isTitle(title: string): boolean {
  const words = title.split(" ").filter((word) => word !== "");
  let titled = false;
  let afterCapital = false;
  for (const word of words) {
    if (/^[.:]+$/.test(word)) return titled;
    if (/^[^\p{L}\p{N}]+$/u.test(word)) continue;
    const capital = CAPITALIZED.test(word);
    if (!capital && TITLE_LINKS.has(word.toLowerCase())) {
      afterCapital = false;
      continue;
    }
    if (!capital && !afterCapital) return !titled && words.length <= LOWER_CASE_TITLE_WORDS && !title.endsWith(".");
    if (/[.:]$/.test(word)) return true;
    titled = true;
    afterCapital = capital;
  }
  return titled || (words.length > 0 && words.length <= LOWER_CASE_TITLE_WORDS);
}

// Item 1's or 1A's own title heads it when no lower-case word runs on after
// it ("Item 1. Business Overview We are a leading", read as one block).
function headsKnownItem(item: string, title: string): boolean {
  const known = TITLES[item as TenKItem]?.exec(title);
  return known !== undefined && known !== null && !/^\s*\p{Ll}/u.test(title.slice(known[0].length));
}

// An HTML list item is one block, its bullet the browser's: a paragraph
// inside it is no item of its own. ponytail: a nested list merges into its
// parent item.
const LIST_ITEM = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const listItemBlock = (_: string, inner: string) => `<br><li>• ${inner.replace(/<\/?(?:p|div|br)\b[^>]*>/gi, " ")}</li>`;

export type TenKSection = ReleaseExhibit & { type: TenKItem };
export type SectionNotFound = { type: TenKItem; error: "section_not_found" };
type Heading = { at: number; item: string; title: string };

// An item runs from its heading to the next heading of another item, so a
// page header that repeats its own heading ("Item 1A. Risk Factors
// (continued)") stays inside it. A repeat closer than an item body restarts
// it, as after a table of contents written as one block. Of an item's
// headings, the one with the longest span is the item: the table of
// contents' entry spans one line.
// ponytail: a heading inside a block ("Employees: 100. Item 1A. Risk
// Factors") heads nothing, so that 10-K's Item 1 runs through its Item 1A.
export function tenKSections(html: string): Record<TenKItem, TenKSection | SectionNotFound> {
  const { text, edges } = blockText(html.replace(LIST_ITEM, listItemBlock));
  const sorted = [...edges].sort((a, b) => a - b);
  const blockEnd = (n: number) => sorted[n + 1] ?? text.length;
  const headings: Heading[] = [];
  for (const [n, start] of sorted.entries()) {
    const label = LABEL.exec(text.slice(start, blockEnd(n)));
    if (label === null) continue;
    const at = start + label[0].length - label[1]!.length;
    const after = start + label[0].length;
    // A label alone in its block (a table cell) takes the next block's title.
    const title = after < blockEnd(n) ? text.slice(after, blockEnd(n)) : text.slice(blockEnd(n) + 1, blockEnd(n + 2));
    const item = label[2]!.toUpperCase();
    if (isTitle(title) || headsKnownItem(item, title)) headings.push({ at, item, title: title.slice(0, 60) });
  }
  const longestHeadedSpan = (item: TenKItem): TenKSection | SectionNotFound => {
    let best: { start: number; end: number } | null = null;
    for (const [n, heading] of headings.entries()) {
      if (heading.item !== item || !TITLES[item].test(heading.title)) continue;
      const end = headings.slice(n + 1).find((next) => next.item !== item || next.at - heading.at < MIN_ITEM_BODY_CHARS)?.at ?? text.length;
      if (best === null || end - heading.at > best.end - best.start) best = { start: heading.at, end };
    }
    if (best === null || best.end - best.start < MIN_ITEM_BODY_CHARS) return { type: item, error: "section_not_found" };
    const sectionText = text.slice(best.start, best.end).trimEnd();
    const sectionEdges = new Set([0, ...sorted.filter((at) => at >= best.start && at - best.start <= sectionText.length).map((at) => at - best.start)]);
    return { type: item, text: sectionText, edges: sectionEdges };
  };
  return { "1": longestHeadedSpan("1"), "1A": longestHeadedSpan("1A") };
}
