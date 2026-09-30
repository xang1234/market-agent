// The model writes the narrative; it must not introduce figures. A sentence
// survives only if every number in it also appears in something the user can
// check: the fact blocks shown with the answer, or a cited claim. Everything
// else is dropped rather than shown unsupported.
//
// A figure that belongs to one company (a comparison cell) must also be
// credited to that company: the company named last before it in the sentence
// ("AMD's margin is 49.2%"), else first after it ("49.2% at AMD"), else the
// last one named in a kept sentence earlier on the line ("Its margin..."),
// must be one the figure belongs to. Otherwise a real value quoted for the
// wrong company would pass.
//
// ponytail: compares numbers by value ("62.1" in "$62.1B" and "62.1 billion"),
// not by magnitude or unit; a derived figure that coincidentally equals a shown
// one would pass. Tighten to unit-aware matching if that shows up in the eval.
// ponytail: companies are recognized by their displayed label (ticker) only;
// the prompt asks the model to use it. Add legal-name aliases if the eval shows
// "NVIDIA" sentences being dropped.

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
      companies.add(figure.company.toLowerCase());
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
      const isSupported = numberMatches(sentence).every(({ number, index }) => {
        if (supported.has(number)) return true;
        const belongsTo = owners.get(number);
        if (belongsTo === undefined) return false;
        const credited = creditedCompany(named, index) ?? lastNamed;
        return credited !== undefined && belongsTo.has(credited);
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

function numberMatches(text: string): Array<{ number: string; index: number }> {
  return [...text.matchAll(NUMBER)].map((match) => ({
    number: String(Number(match[0].replaceAll(",", ""))),
    index: match.index,
  }));
}

// Where each company label appears in the sentence, in order.
function companyMentions(
  sentence: string,
  companies: ReadonlyArray<string>,
): Array<{ company: string; index: number }> {
  return companies
    .flatMap((company) => {
      const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(company)}(?![A-Za-z0-9])`, "gi");
      return [...sentence.matchAll(pattern)].map((match) => ({ company: company.toLowerCase(), index: match.index }));
    })
    .sort((a, b) => a.index - b.index);
}

function creditedCompany(
  mentions: ReadonlyArray<{ company: string; index: number }>,
  index: number,
): string | undefined {
  const before = mentions.filter((mention) => mention.index < index);
  return (before.at(-1) ?? mentions.find((mention) => mention.index > index))?.company;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
