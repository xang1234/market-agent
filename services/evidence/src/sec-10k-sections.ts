import { blockText, type ReleaseExhibit } from "./sec-earnings-release-extraction.ts";

export const TEN_K_ITEMS = ["1", "1A"] as const;
export type TenKItem = (typeof TEN_K_ITEMS)[number];

// Each Form 10-K item's title and the variants filers print, matched on a
// block's letters and digits in lower case, so case, spacing, punctuation and
// a word split by markup ("B usiness", "1<span>A</span>") do not matter.
const TITLES: ReadonlyArray<readonly [item: string, title: string]> = [
  ["1", "(description of)? business (and properties)?"],
  ["1A", "risk factors"],
  ["1B", "unresolved staff comments"],
  ["1C", "cybersecurity (risk management and strategy)?"],
  ["2", "(description of)? propert(y|ies)"],
  ["3", "legal proceedings"],
  ["4", "mine safety disclosures? | removed and reserved | submission of matters to a vote of security holders"],
  ["5", "market for registrants? common equity related stockholder matters (and)? issuer purchases of equity securities"],
  ["6", "reserved | selected financial data"],
  ["7", "managements discussion and analysis (of financial condition and results of operations)?"],
  ["7A", "quantitative and qualitative disclosures? about market risks?"],
  ["8", "financial statements and supplementary data"],
  ["9", "changes in and disagreements with accountants on accounting and financial disclosures?"],
  ["9A", "controls and procedures"],
  ["9B", "other information"],
  ["9C", "disclosure regarding foreign jurisdictions that prevent inspections"],
  ["10", "directors executive officers (and)? corporate governance"],
  ["11", "executive compensation"],
  ["12", "security ownership of certain beneficial owners and management and related stockholder matters"],
  ["13", "certain relationships and related transactions (and)? director independence"],
  ["14", "principal account(ant|ing) fees and services"],
  ["15", "exhibits? (and)? financial statement schedules?"],
  ["16", "form 10k summary"],
];
// "PART I ITEM 1." shares a block in some filings, and some filers type "ltem".
const PART = "(?:part[iv]+)?";
const LABEL = "[il]tems?";
const HEADINGS = TITLES.map(([item, title]) => ({
  item,
  // "Items 1 and 2. Business and Properties" heads Item 1.
  pattern: new RegExp(`^${PART}${LABEL}${item.toLowerCase()}(?:and\\d{1,2}[a-c]?)?(?:${title.replace(/\s+/g, "")})`),
}));
const LABEL_ONLY = new RegExp(`^${PART}${LABEL}\\d{1,2}[a-c]?(?:and\\d{1,2}[a-c]?)?$`);
const PART_PREFIX = /^part[iv]+(?=[il]tems?\d)/;

// A block's first letters and digits in lower case, each with its index in
// the block. A label and the longest title take under 100.
const HEADING_LETTERS = 200;
function letters(block: string): { key: string; at: number[] } {
  let key = "";
  const at: number[] = [];
  for (const { 0: char, index } of block.matchAll(/[a-z0-9&]/gi)) {
    if (key.length >= HEADING_LETTERS) break;
    const kept = char === "&" ? "and" : char.toLowerCase();
    key += kept;
    for (const _ of kept) at.push(index);
  }
  return { key, at };
}

// A block heads an item when it opens with the item's label and title, and
// the title ends the block or a new sentence follows it ("Item 1B.
// Unresolved Staff Comments None."). A sentence that cites the item runs on
// past the title ("Item 1A. Risk Factors, above, describes") or names no
// title ("Item 7 for details"), so it heads nothing.
// ponytail: a title printed in none of TITLES' wordings heads nothing, so the
// item before it runs on to the next heading. Add the wording when a filing shows it.
function headedItem(block: string): { item: string; labelAt: number } | null {
  const { key, at } = letters(block);
  for (const { item, pattern } of HEADINGS) {
    const heading = pattern.exec(key);
    if (heading === null) continue;
    const after = block.slice(at[heading[0].length - 1]! + 1);
    if (!/^[\s.:\-–—\])]*$|^\s*[.:\-–—]*\s+[\p{Lu}\p{N}]/u.test(after)) return null;
    return { item, labelAt: at[PART_PREFIX.exec(key)?.[0].length ?? 0]! };
  }
  return null;
}

// An HTML list item is one block, its bullet the browser's: a paragraph
// inside it is no item of its own. ponytail: a nested list merges into its
// parent item.
const LIST_ITEM = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const listItemBlock = (_: string, inner: string) => `<br><li>• ${inner.replace(/<\/?(?:p|div|br)\b[^>]*>/gi, " ")}</li>`;

export type TenKSection = ReleaseExhibit & { type: TenKItem };
export type SectionNotFound = { type: TenKItem; error: "section_not_found" };
type Heading = { at: number; item: string };
const MIN_ITEM_BODY_CHARS = 1_000;

// An item runs from its heading to the next heading of another item, so a
// page header that repeats its own heading stays inside it. A repeat closer
// than an item body restarts it, as after a table of contents written as one
// block. Of an item's headings, the one with the longest span is the item,
// since the table of contents' entry spans one line.
// ponytail: a heading inside a block ("Employees: 100. Item 1A. Risk
// Factors") heads nothing, so that 10-K's Item 1 runs through its Item 1A.
export function tenKSections(html: string): Record<TenKItem, TenKSection | SectionNotFound> {
  const { text, edges } = blockText(html.replace(LIST_ITEM, listItemBlock));
  const sorted = [...edges].sort((a, b) => a - b);
  const blockEnd = (n: number) => sorted[n + 1] ?? text.length;
  const headings: Heading[] = [];
  for (const [n, start] of sorted.entries()) {
    const block = text.slice(start, blockEnd(n));
    // A label alone in its block (a table cell) takes the next block's title.
    const heading = headedItem(LABEL_ONLY.test(letters(block).key) ? text.slice(start, blockEnd(n + 2)) : block);
    if (heading !== null) headings.push({ at: start + heading.labelAt, item: heading.item });
  }
  const longestHeadedSpan = (item: TenKItem): TenKSection | SectionNotFound => {
    let best: { start: number; end: number } | null = null;
    for (const [n, heading] of headings.entries()) {
      if (heading.item !== item) continue;
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
