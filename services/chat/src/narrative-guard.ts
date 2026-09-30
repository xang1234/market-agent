// The model writes the narrative; it must not introduce figures. A sentence
// survives only if every number in it also appears in something the user can
// check: the fact blocks shown with the answer, or a cited claim. Everything
// else is dropped rather than shown unsupported.
//
// A figure that belongs to one company (a comparison cell) must also be
// credited to that company, even when a claim or title repeats the number. The
// companies named between the previous such figure (or the sentence start) and
// this one must all own it ("NVDA's 74.6%, ahead of AMD at 49.2%"); if none is
// named there, the first one named after it, before the next figure ("74.6% at
// NVDA, 49.2% at AMD"), which is then used up; a possessive is skipped, as it
// points forward ("..., versus AMD's 49.2%"); if none, the company of the
// previous figure in the sentence ("NVDA's revenue was $130.5B and margin
// 74.6%"); if none, the last one named in a kept sentence earlier on the line
// ("Its margin..."). Naming another company in that
// stretch ("AMD's margin, unlike NVDA, is 74.6%") is ambiguous and drops the
// sentence: the guard cannot parse who the figure belongs to, so it only keeps
// what is unambiguous.
//
// ponytail: compares numbers by value ("62.1" in "$62.1B" and "62.1 billion"),
// not by magnitude or unit; a derived figure that coincidentally equals a shown
// one would pass. Tighten to unit-aware matching if that shows up in the eval.
// ponytail: companies are recognized by their displayed label (ticker) only,
// case-sensitively (the ticker "A" is not the article "a"); the prompt asks the
// model to use it. Add legal-name aliases if the eval shows "NVIDIA" sentences
// being dropped.

const NUMBER = /\d+(?:,\d{3})*(?:\.\d+)?/g;
const SENTENCE_BREAK = /(?<=[.!?])\s+/;

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
      const isSupported = attributed.every(({ number, index, end }, i) => {
        const from = Math.max(i === 0 ? 0 : attributed[i - 1].end, usedUpTo);
        const to = i === attributed.length - 1 ? sentence.length : attributed[i + 1].index;
        const before = named.filter((mention) => mention.index >= from && mention.index < index);
        // Only the first name after it ("74.6% for NVDA, compared with AMD...");
        // "AMD's" points forward to the figure it owns, never back to this one.
        const after = before.length > 0
          ? undefined
          : named.find((mention) => mention.index >= end && mention.index < to && !mention.possessive);
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
      // Only a sentence the user will see can name the company for the next one.
      if (isSupported && named.length > 0) lastNamed = named[named.length - 1].company;
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
    number: String(Number(match[0].replaceAll(",", ""))),
    index: match.index,
    end: match.index + match[0].length,
  }));
}

// Where each company label appears in the sentence, in order.
function companyMentions(
  sentence: string,
  companies: ReadonlyArray<string>,
): Array<{ company: string; index: number; possessive: boolean }> {
  return companies
    .flatMap((company) => {
      const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(company)}(?![A-Za-z0-9])`, "g");
      return [...sentence.matchAll(pattern)].map((match) => ({
        company,
        index: match.index,
        possessive: /^['’]s?(?![A-Za-z])/.test(sentence.slice(match.index + company.length)),
      }));
    })
    .sort((a, b) => a.index - b.index);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
