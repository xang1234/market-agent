// The model writes the narrative; it must not introduce figures. A sentence
// survives only if every number in it also appears in something the user can
// check: the fact blocks shown with the answer, or a cited claim. Everything
// else is dropped rather than shown unsupported.
//
// ponytail: compares numbers by value ("62.1" in "$62.1B" and "62.1 billion"),
// not by magnitude or unit; a derived figure that coincidentally equals a shown
// one would pass. Tighten to unit-aware matching if that shows up in the eval.

const NUMBER = /\d+(?:,\d{3})*(?:\.\d+)?/g;
const SENTENCE_BREAK = /(?<=[.!?])\s+/;

export function keepSupportedSentences(
  text: string,
  supportingTexts: ReadonlyArray<string>,
): { text: string; removed: string[] } {
  const supported = new Set(supportingTexts.flatMap(numbersIn));
  const removed: string[] = [];
  const lines: string[] = [];
  // Lines are boundaries too, so each bullet of a list is judged on its own.
  for (const line of text.trim().split(/\r?\n/)) {
    if (line.trim() === "") {
      lines.push("");
      continue;
    }
    const kept = line.trim().split(SENTENCE_BREAK).filter((sentence) => {
      const isSupported = numbersIn(sentence).every((number) => supported.has(number));
      if (!isSupported) removed.push(sentence);
      return isSupported;
    });
    if (kept.length > 0) lines.push(line.match(/^\s*/)![0] + kept.join(" "));
  }
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((raw) => String(Number(raw.replaceAll(",", ""))));
}
