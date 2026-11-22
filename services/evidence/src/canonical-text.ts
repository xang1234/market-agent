// Filing text in the one form every check reads: quotes are matched and stored
// in it (sec-earnings-release-extraction.ts, sec-10k-claims.ts) and figures are
// read from it (release-figures.ts). A filing may spell one character many ways
// ("&minus;", U+2212 and "-"; "Non&#8209;GAAP" and "Non-GAAP"), and a check
// that reads a spelling it was not written for misreads the figure.

// Exhibit HTML (or text) as comparable text: tags dropped, entities decoded,
// then plain.
export function canonicalText(markup: string): string {
  return plainText(decodeEntities(
    markup
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ));
}

// Decoded text made plain: typographic quotes, every dash, minus and hyphen as
// "-", invisible characters (a soft hyphen, a zero-width space) dropped, and
// whitespace (a no-break or thin space too) one space. Plain text is its own
// plain text.
export function plainText(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/[­​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "-", ndash: "-", minus: "-", hyphen: "-", dash: "-",
  shy: "", hellip: "...", percnt: "%", dollar: "$",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

// What a sentence starts with: a capital, a figure, a quote, a bracket or a
// bullet. A full stop before anything else ("the U.S. due to") is an
// abbreviation's. ponytail: a sentence opening lower-case ("iPhone revenue")
// counts only at a block edge.
export const SENTENCE_START = /^["'($•[0-9A-Z]/;

// An abbreviation's full stop, which ends no sentence even before a capital
// ("the U.S. Data Center market"): initials ("U.S.", "e.g.", "J.") or a word
// shortened by convention ("Inc.", "approx.", "Dec."). ponytail: a sentence that ends
// in one ("...sales in the U.S.") counts only at a block edge.
const INITIALS = /(?:^|[\s("'])(?:(?:[A-Za-z]\.){2,}|[A-Z]\.)$/;
const SHORTENED = /(?:^|[\s("'])(?:inc|corp|co|ltd|no|nos|approx|vs|mr|ms|dr|jr|sr|st|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.$/i;

// Whether the text before `at` ends a sentence with one of `marks` (and a
// closing quote or bracket), not with an abbreviation's full stop.
export function endMarkBefore(text: string, at: number, marks: RegExp): boolean {
  const head = text.slice(Math.max(0, at - 16), at);
  if (!marks.test(head)) return false;
  const stop = head.replace(/["')]$/, "");
  return !(stop.endsWith(".") && (INITIALS.test(stop) || SHORTENED.test(stop)));
}

// Where each sentence after the first starts in plain text: after an end mark
// that is no abbreviation's, a space, and what a sentence starts with.
export function sentenceStarts(text: string): number[] {
  return [...text.matchAll(/[.!?]["')]? (?=["'($•[0-9A-Z])/g)]
    .filter((found) => endMarkBefore(text, found.index + found[0].length - 1, /[.!?]["')]?$/))
    .map((found) => found.index + found[0].length);
}
