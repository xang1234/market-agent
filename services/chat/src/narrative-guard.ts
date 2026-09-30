// The model writes the narrative; it must not introduce figures. A sentence
// survives only if every number in it also appears in something the user can
// check: the fact blocks shown with the answer, or a cited claim. Everything
// else is dropped rather than shown unsupported.
//
// A figure that belongs to one company (a comparison cell) must also be
// credited to that company in the same sentence, even when a claim or title
// repeats the number. Nothing carries across sentences: "Its margin..." could
// mean any company named earlier, so it is dropped. Within the sentence:
// - the companies named between the previous such figure (or the sentence
//   start) and this one must all own it ("NVDA's 74.6%, ahead of AMD at 49.2%");
//   a company introduced as a comparison ("compared with", "unlike", "versus")
//   yields to another company or a pronoun there;
// - if none is named there, the first one named after it when for/at/in ties
//   them ("74.6% at NVDA"; not "49.2%, exceeding AMD"), which is then used up,
//   unless a pronoun is the subject ("its margin was 49.2% in AMD's filing");
// - if none, the company of the previous figure ("NVDA's revenue was $130.5B
//   and margin 74.6%").
// Anything else (two companies before a figure, "respectively", no company) is
// dropped: the guard cannot parse who the figure belongs to, so it only keeps
// what is unambiguous. The cost, valid sentences dropped, is tracked in #144.
//
// ponytail: compares numbers by value ("62.1" in "$62.1B" and "62.1 billion"),
// not by magnitude or unit; a derived figure that coincidentally equals a shown
// one would pass. Tighten to unit-aware matching if that shows up in the eval.
// ponytail: companies are recognized by their displayed label (ticker) only,
// case-sensitively, and never by a one-letter ticker (the article "A"); the
// prompt asks the model to use the label. Add legal-name aliases if the eval
// shows "NVIDIA" sentences being dropped (#144).

// A leading minus is part of the figure ("-10.0%" is not "10.0%"), across any
// currency prefix the formatter writes ("-$3.1B", "-CN¥3.1B", "-CHF 3.1B",
// "-F CFA 3.1B", "-Cg. 3.1B"; a test checks every supported currency), unless
// it joins two numbers or words ("2025-2026").
const NUMBER =
  /(?:(?<![A-Za-z0-9.])[-−](?:[A-Za-z]{1,4}\.?(?:[ \u00a0\u202f][A-Za-z]{1,4})?)?\p{Sc}?[ \u00a0\u202f]?)?\d+(?:,\d{3})*(?:\.\d+)?/gu;
// Ordinary whitespace only: the formatter puts a no-break space inside a figure
// ("-Cg. 3.1B"), prose separates sentences with ordinary spaces.
const SENTENCE_BREAK = /(?<=[.!?])[^\S\u00a0\u202f]+/;
const COMPARED_WITH = /(?:compared (?:with|to)|unlike|versus|vs\.?|than|relative to|against)\s+$/i;
// Between a comparison company and a figure it owns: nothing but a possessive
// or "at"/"with" ("versus AMD's 49.2%", "compared with AMD at 49.2%").
const ATTACHED = /^(?:['’]s)?\s*(?:(?:at|with)\s+)?$/i;
const PRONOUN = /\b(?:its|it|their|they|the former|the latter)\b/i;
// Between a figure and the company that owns it: its unit, then a preposition
// ("% for ", "B at ", " percent in "). No punctuation and no other words, so a
// comparison ("74.6%, ahead of NVDA", "beaten by NVDA", "49.2% from AMD's
// level") never reads as owner.
const OWNED_BY = /^[^\s,;:]*\s*(?:(?:percent|billion|million|trillion|bn|mn)\s+)?(?:for|at|in)\s+$/i;

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
  // A one-letter ticker ("A") cannot be told from the article, so it is never
  // recognized; sentences quoting its figures are dropped.
  const companies = [...new Set(attributedFigures.map((figure) => figure.company))]
    .filter((company) => company.length > 1);

  const removed: string[] = [];
  const lines: string[] = [];
  // Lines are boundaries too, so each bullet of a list is judged on its own.
  for (const line of text.trim().split(/\r?\n/)) {
    if (line.trim() === "") {
      lines.push("");
      continue;
    }
    const kept = line.trim().split(SENTENCE_BREAK).filter((sentence) => {
      const named = companyMentions(sentence, companies);
      // Digits inside a label ("issuer:12ab34cd") are not figures.
      const numbers = numberMatches(maskMentions(sentence, named));
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
        const stretch = named.filter((mention) => mention.index >= from && mention.index < index);
        // A company introduced as a comparison is not the figure's owner
        // ("Unlike AMD, the company achieved 49.2%"; "Compared with AMD,
        // NVDA's 74.6%"), unless it is directly attached to the figure
        // ("NVDA grew faster, versus AMD's 49.2%"), which then outranks any
        // other company in the stretch.
        const comparisons = stretch.filter((mention) => COMPARED_WITH.test(sentence.slice(0, mention.index)));
        const subjects = stretch.filter((mention) => !comparisons.includes(mention));
        // A pronoun with no company subject ("Its margin was 49.2% in AMD's
        // filing") refers back to an earlier figure's company in the sentence,
        // if any: nothing named near this figure may claim it.
        const pronounSubject = subjects.length === 0 && PRONOUN.test(sentence.slice(from, index));
        const attached = comparisons.filter((mention) =>
          ATTACHED.test(sentence.slice(mention.index + mention.company.length, index))
        );
        const before = attached.length > 0 ? attached : subjects;
        // Only the first name after it, and only when a preposition ties it to
        // the figure ("74.6% for NVDA"); "49.2%, exceeding AMD" names a comparison.
        const next = named.find((mention) => mention.index >= end && mention.index < to);
        const after = before.length === 0 && !pronounSubject && next !== undefined &&
            OWNED_BY.test(sentence.slice(end, next.index))
          ? next
          : undefined;
        if (after !== undefined) usedUpTo = after.index + after.company.length;
        const credited = before.length > 0
          ? before.map((mention) => mention.company)
          : after !== undefined
          ? [after.company]
          : carried;
        carried = credited;
        return credited.length > 0 && credited.every((company) => owners.get(number)!.has(company));
      });
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
    number: numberKey(match[0]),
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

// The sentence with each company label blanked out, same length, so indices hold.
function maskMentions(sentence: string, named: ReadonlyArray<{ company: string; index: number }>): string {
  let masked = sentence;
  for (const { company, index } of named) {
    masked = masked.slice(0, index) + " ".repeat(company.length) + masked.slice(index + company.length);
  }
  return masked;
}

// The comparable value: "62.1" for "$62.1B", "-10" for "-10.0%", and "-0" kept
// apart from "0" ("-0.0%" is a displayed decline).
function numberKey(raw: string): string {
  // The sign plus the digits: a currency prefix ("-Cg. ") must not leak in.
  const sign = /^[-−]/.test(raw) ? "-" : "";
  const value = Number(sign + raw.match(/\d+(?:,\d{3})*(?:\.\d+)?$/)![0].replaceAll(",", ""));
  return Object.is(value, -0) ? "-0" : String(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
