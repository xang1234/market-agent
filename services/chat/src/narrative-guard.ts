// The model writes the narrative; it must not introduce figures. A sentence
// survives only if every number in it also appears in something the user can
// check: the fact blocks shown with the answer, or a cited claim. Everything
// else is dropped rather than shown unsupported.
//
// A figure that belongs to one company (a comparison cell) must also be
// credited to that company, even when a claim or title repeats the number. The
// companies named between the previous such figure (or the sentence start) and
// this one must all own it ("NVDA's 74.6%, ahead of AMD at 49.2%"); if none is
// named there, the first one named after it when a preposition ties them
// ("74.6% at NVDA, 49.2% at AMD"; not "49.2%, exceeding AMD"), which is then
// used up; if none, the company of the previous figure in the sentence ("NVDA's
// revenue was $130.5B and margin 74.6%"); if none, the one company named by
// the last kept sentence naming any on the line ("Its margin..."; none if that
// sentence named several). A "respectively" sentence pairs the companies named
// before its figures with them in order. Naming another company in that stretch
// ("AMD's margin, unlike NVDA, is 74.6%") is ambiguous and drops the sentence:
// the guard cannot parse who the figure belongs to, so it only keeps what is
// unambiguous.
//
// ponytail: compares numbers by value ("62.1" in "$62.1B" and "62.1 billion"),
// not by magnitude or unit; a derived figure that coincidentally equals a shown
// one would pass. Tighten to unit-aware matching if that shows up in the eval.
// ponytail: companies are recognized by their displayed label (ticker) only,
// case-sensitively (the ticker "A" is not the article "a"); the prompt asks the
// model to use it. Add legal-name aliases if the eval shows "NVIDIA" sentences
// being dropped.

// A leading minus is part of the figure ("-10.0%" is not "10.0%", "-$3.1B" is
// not "$3.1B"), unless it joins two numbers or words ("2025-2026").
const NUMBER = /(?:(?<![A-Za-z0-9.])[-−][$€£¥]?)?\d+(?:,\d{3})*(?:\.\d+)?/g;
const SENTENCE_BREAK = /(?<=[.!?])\s+/;
// Between a figure and the company that owns it: its unit, then a preposition
// ("% for ", "B at ", " percent in "). No punctuation and no other words, so a
// comparison ("74.6%, ahead of NVDA", "beaten by NVDA") never reads as owner.
const OWNED_BY = /^[^\s,;:]*\s*(?:(?:percent|billion|million|trillion|bn|mn)\s+)?(?:for|at|from|in)\s+$/i;

export type AttributedFigure = { company: string; value: string };

export function keepSupportedSentences(
  text: string,
  supportingTexts: ReadonlyArray<string>,
  attributedFigures: ReadonlyArray<AttributedFigure> = [],
): { text: string; removed: string[] } {
  const supported = new Set(supportingTexts.flatMap(numbersIn));
  const owners = new Map<string, Set<string>>();
  for (const figure of attributedFigures) {
    for (const number of numbersIn(figure.value)) {
      const companies = owners.get(number) ?? new Set<string>();
      companies.add(figure.company);
      owners.set(number, companies);
    }
  }
  const companies = [...new Set(attributedFigures.map((figure) => figure.company))];

  const removed: string[] = [];
  const lines: string[] = [];
  // Lines are boundaries too, so each bullet of a list is judged on its own.
  for (const line of text.trim().split(/\r?\n/)) {
    if (line.trim() === "") {
      lines.push("");
      continue;
    }
    let lastNamed: string | undefined;
    const kept = line.trim().split(SENTENCE_BREAK).filter((sentence) => {
      const named = companyMentions(sentence, companies);
      const numbers = numberMatches(sentence);
      if (numbers.some(({ number }) => !supported.has(number) && !owners.has(number))) {
        removed.push(sentence);
        return false;
      }
      // Figures that need a company (any comparison value, even one a claim or
      // title repeats); each claims the stretch of text around it.
      const attributed = numbers.filter(({ number }) => owners.has(number));
      let carried: string[] = [];
      // A name after a figure that the figure took is used up; the next figure's
      // stretch starts past it.
      let usedUpTo = 0;
      const respectively = respectivelyPairs(sentence, named, attributed);
      const isSupported = respectively !== undefined
        ? respectively.every(({ number, company }) => owners.get(number)!.has(company))
        : attributed.every(({ number, index, end }, i) => {
          const from = Math.max(i === 0 ? 0 : attributed[i - 1].end, usedUpTo);
          const to = i === attributed.length - 1 ? sentence.length : attributed[i + 1].index;
          const before = named.filter((mention) => mention.index >= from && mention.index < index);
          // Only the first name after it, and only when a preposition ties it to
          // the figure ("74.6% for NVDA"); "49.2%, exceeding AMD" names a comparison.
          const next = named.find((mention) => mention.index >= end && mention.index < to);
          const after = before.length === 0 && next !== undefined && OWNED_BY.test(sentence.slice(end, next.index))
            ? next
            : undefined;
          if (after !== undefined) usedUpTo = after.index + after.company.length;
          const credited = before.length > 0
            ? before.map((mention) => mention.company)
            : after !== undefined
            ? [after.company]
            : carried.length > 0
            ? carried
            : lastNamed === undefined ? [] : [lastNamed];
          carried = credited;
          return credited.length > 0 && credited.every((company) => owners.get(number)!.has(company));
        });
      // Only a sentence the user will see can name the company for the next one,
      // and only when it names one: "NVDA trails AMD. Its..." is ambiguous.
      if (isSupported && named.length > 0) {
        const distinct = new Set(named.map((mention) => mention.company));
        lastNamed = distinct.size === 1 ? named[0].company : undefined;
      }
      if (!isSupported) removed.push(sentence);
      return isSupported;
    });
    if (kept.length > 0) lines.push(line.match(/^\s*/)![0] + kept.join(" "));
  }
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

function numbersIn(text: string): string[] {
  return numberMatches(text).map(({ number }) => number);
}

function numberMatches(text: string): Array<{ number: string; index: number; end: number }> {
  return [...text.matchAll(NUMBER)].map((match) => ({
    number: String(Number(match[0].replace("−", "-").replace(/[$€£¥,]/g, ""))),
    index: match.index,
    end: match.index + match[0].length,
  }));
}

// Where each company label appears in the sentence, in order.
function companyMentions(
  sentence: string,
  companies: ReadonlyArray<string>,
): Array<{ company: string; index: number }> {
  return companies
    .flatMap((company) => {
      const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(company)}(?![A-Za-z0-9])`, "g");
      return [...sentence.matchAll(pattern)].map((match) => ({ company, index: match.index }));
    })
    .sort((a, b) => a.index - b.index);
}

// "NVDA and AMD had margins of 74.6% and 49.2%, respectively": one company named
// before the first figure per figure, paired in order. Undefined otherwise.
function respectivelyPairs(
  sentence: string,
  named: ReadonlyArray<{ company: string; index: number }>,
  figures: ReadonlyArray<{ number: string; index: number }>,
): Array<{ number: string; company: string }> | undefined {
  if (figures.length < 2 || !/\brespectively\b/i.test(sentence)) return undefined;
  const leading = named.filter((mention) => mention.index < figures[0].index);
  if (leading.length !== figures.length) return undefined;
  // Only a coordinated list ("NVDA and AMD", "NVDA, AMD, and INTC"); in
  // "Compared with NVDA, AMD's margins..." NVDA is a comparison, not an item.
  const joins = leading.slice(1).map((mention, i) =>
    sentence.slice(leading[i].index + leading[i].company.length, mention.index)
  );
  const isList = joins.every((join) => /^\s*,?\s*(?:(?:and|&)\s+)?$/i.test(join)) &&
    /\b(?:and)\b|&/i.test(joins[joins.length - 1]);
  if (!isList) return undefined;
  return figures.map((figure, i) => ({ number: figure.number, company: leading[i].company }));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
