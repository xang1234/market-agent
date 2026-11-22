import { blockText, canonicalText, type ReleaseExhibit } from "./sec-earnings-release-extraction.ts";

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
// "PART I ITEM 1." shares a block in some filings, some filers type "ltem",
// and some write "Item No. 1".
const PART = "(?:part[iv]+)?";
const LABEL = "[il]tems?(?:no)?";
const HEADINGS = TITLES.map(([item, title]) => ({
  item,
  // "Items 1 and 2. Business and Properties" heads Item 1, and so does "ITEM 1.
  // I Business", whose "I" is a typeset separator.
  labeled: new RegExp(`^${PART}${LABEL}${item.toLowerCase()}(?:and\\d{1,2}[a-c]?)?i?(?:${title.replace(/\s+/g, "")})`),
  bare: new RegExp(`^(?:${title.replace(/\s+/g, "")})`),
}));
const LABEL_ONLY = new RegExp(`^${PART}${LABEL}\\d{1,2}[a-c]?(?:and\\d{1,2}[a-c]?)?$`);
const PART_PREFIX = new RegExp(`^part[iv]+(?=${LABEL}\\d)`);

// A block's first letters and digits in lower case, each with its index in
// the block. The longest heading, Item 5's with "PART II", takes 104.
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
// title ("Item 7 for details"), so it heads nothing. A note in parentheses
// may close the heading ("ITEM 1. BUSINESS (dollars in millions)"), but a
// page, bare or in parentheses, is a contents entry's ("Item 1A. Risk Factors
// 9", "Item 1A. Risk Factors (F-1)").
// A title with no label heads its item when it ends the block, or when it
// is in capitals and a full stop ends it ("RISK FACTORS. The following").
// A run-in subheading is in sentence case ("Properties. The Company owns",
// inside a Business section) or runs on ("Cybersecurity - Increased").
// ponytail: a title printed in none of TITLES' wordings heads nothing, so the
// item before it runs on to the next heading. Add the wording when a filing shows it.
const TITLE_ENDS_BLOCK = /^[\s.:\-–—\])]*$/;
const SENTENCE_FOLLOWS = /^\s*[.:\-–—]*\s+[\p{Lu}\p{N}]/u;
const RUN_IN_SENTENCE_FOLLOWS = /^\s*[.:]\s+[\p{Lu}\p{N}]/u;
// A contents page reads "9", "9-21", "F-1 - F-40" or "IV", alone or after
// "Page", "p." or "pp.", and may be in parentheses. A styled "F" reads "F -1".
// ponytail: a 10-K contents page number has at most three digits; four reads as a year ("Risk Factors 2025").
const PAGE = String.raw`(?:[a-z]\s*-\s*)?\d{1,3}|[ivx]+`;
const PAGES = String.raw`(?:(?:pages?|pp?\.)\s*)?(?:${PAGE})(?:\s*-\s*(?:${PAGE}))?`;
const HEADING_NOTE = new RegExp(String.raw`^\s*\((?!\s*(?:(?:pages?|pp?\.?)\s*)?\d|\s*${PAGES}\s*\))[^)]*\)`, "i");
const CONTENTS_PAGE = new RegExp(String.raw`^[\s.:-]*(?:${PAGES}|\(\s*${PAGES}\s*\))\s*$`, "i");
function headedItem(block: string): Heading | null {
  const { key, at } = letters(block);
  for (const { item, labeled, bare } of HEADINGS) {
    const label = labeled.exec(key);
    const heading = label ?? bare.exec(key);
    if (heading === null) continue;
    const titleEnd = at[heading[0].length - 1]! + 1;
    const after = block.slice(titleEnd).replace(HEADING_NOTE, "");
    if (CONTENTS_PAGE.test(after)) return null;
    const runIn = label !== null
      ? SENTENCE_FOLLOWS.test(after)
      : !/\p{Ll}/u.test(block.slice(0, titleEnd)) && RUN_IN_SENTENCE_FOLLOWS.test(after);
    if (!TITLE_ENDS_BLOCK.test(after) && !runIn) return null;
    return { item, at: at[label === null ? 0 : PART_PREFIX.exec(key)?.[0].length ?? 0]!, labeled: label !== null };
  }
  return null;
}

// An HTML list item is one block, its bullet the browser's: a paragraph
// inside it is no item of its own. ponytail: a nested list merges into its
// parent item.
const LIST_ITEM = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const listItemBlock = (_: string, inner: string) => `<br><li>• ${inner.replace(/<\/?(?:p|div|br)\b[^>]*>/gi, " ")}</li>`;
// A table row is a contents entry ("Item 1A. | Risk Factors | 9") when its
// cells but the last head an item and, with the last cell's page, head
// nothing. It is read as one block, so it heads nothing. Any other row keeps
// its blocks: quotes start and end at them, and a layout row whose heading a
// sentence follows ("Item 1. Business | Our company... | 12") keeps its
// headings. A page footer's number under a real heading sits in a row of its
// own. HTML may leave </tr> and </td> unwritten, so a row ends at the next row
// or table tag. The pattern steps a run of text at a time, since a step per
// character overflows V8's stack on a row that holds a whole filing.
const TABLE_ROW = /<tr\b[^>]*>[^<]*(?:<(?!\/?(?:tr|table)\b)[^<]*)*/gi;
function contentsRowBlock(row: string): string {
  const cells = row.split(/<t[dh]\b[^>]*>/i).map(canonicalText).filter((cell) => cell !== "");
  const page = cells.pop() ?? "";
  const title = cells.join(" ");
  const entry = CONTENTS_PAGE.test(page) && headedItem(title) !== null && headedItem(`${title} ${page}`) === null;
  return entry ? `<br>${row.replace(/<[^>]*>/g, " ")}<br>` : row;
}

export type TenKSection = ReleaseExhibit & { type: TenKItem };
export type SectionNotFound = { type: TenKItem; error: "section_not_found" };
type Heading = { at: number; item: string; labeled: boolean };
const MIN_ITEM_BODY_CHARS = 1_000;
// ponytail: an unlabeled item ends at another item's title, so a subheading
// printed as one (Cardinal Health's "Other Information" inside its Business)
// ends the item early, and an item that runs on through sections no Form 10-K
// title names (Citi's Risk Factors into Sustainability) is not found. The
// longest real one seen is 105,000 characters. In the filings seen, neither the
// Form's order, the contents' order, nor capitals tell such a subheading from an
// item heading. Its typeset style would, if blockText kept it.
const MAX_UNLABELED_ITEM_CHARS = 300_000;

// An item runs from its heading to the next heading of another item, so a
// page header that repeats its own heading stays inside it. A repeat closer
// than an item body restarts it, as after a table of contents written as one
// block. Of an item's headings, the one with the longest span is the item,
// since the table of contents' entry spans one line. A 10-K that heads none
// of its items by label (an annual report's order, with the labels only in a
// cross-reference index) is read by its titles alone.
// ponytail: a heading inside a block ("Employees: 100. Item 1A. Risk
// Factors") heads nothing, so that 10-K's Item 1 runs through its Item 1A.
export function tenKSections(html: string): Record<TenKItem, TenKSection | SectionNotFound> {
  const { text, edges } = blockText(html.replace(LIST_ITEM, listItemBlock).replace(TABLE_ROW, contentsRowBlock));
  const sorted = [...edges].sort((a, b) => a - b);
  const blockEnd = (n: number) => sorted[n + 1] ?? text.length;
  const headings: Heading[] = [];
  for (const [n, start] of sorted.entries()) {
    const block = text.slice(start, blockEnd(n));
    // A label alone in its block (a table cell) takes the next block's title.
    const heading = headedItem(LABEL_ONLY.test(letters(block).key) ? text.slice(start, blockEnd(n + 2)) : block);
    if (heading !== null) headings.push({ ...heading, at: start + heading.at });
  }
  const longestHeadedSpan = (item: TenKItem, headings: Heading[], maxChars: number): TenKSection | SectionNotFound => {
    let best: { start: number; end: number } | null = null;
    for (const [n, heading] of headings.entries()) {
      if (heading.item !== item) continue;
      let next = n + 1;
      while (headings[next]?.item === item && headings[next]!.at - heading.at >= MIN_ITEM_BODY_CHARS) next++;
      const end = headings[next]?.at ?? text.length;
      if (best === null || end - heading.at > best.end - best.start) best = { start: heading.at, end };
    }
    const chars = best === null ? 0 : best.end - best.start;
    if (best === null || chars < MIN_ITEM_BODY_CHARS || chars > maxChars) return { type: item, error: "section_not_found" };
    const sectionText = text.slice(best.start, best.end).trimEnd();
    const sectionEdges = new Set([0, ...sorted.filter((at) => at >= best.start && at - best.start <= sectionText.length).map((at) => at - best.start)]);
    return { type: item, text: sectionText, edges: sectionEdges };
  };
  const sections = (headings: Heading[], maxChars: number) =>
    ({ "1": longestHeadedSpan("1", headings, maxChars), "1A": longestHeadedSpan("1A", headings, maxChars) });
  const byLabel = sections(headings.filter((heading) => heading.labeled), Infinity);
  return TEN_K_ITEMS.some((item) => !("error" in byLabel[item])) ? byLabel : sections(headings, MAX_UNLABELED_ITEM_CHARS);
}
