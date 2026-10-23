// A judge's verdict on an analyst inference, and what the reader sees of it.
// Apart from inference-judge.ts, which calls a model: the assertion report
// keeps verdicts, and code that reads the report (financial-engine's
// typecheck reaches assertions.ts) must not reach the LLM client.

export const VERDICTS = ["entailed", "unsupported", "contradicted"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type InferenceVerdict =
  // worded_amount: it states an amount in words, asked apart from the verdict
  // so a right or unsupported one is still caught.
  | { index: number; verdict: Verdict; worded_amount: boolean; reason?: string }
  // The judge gave no usable verdict: never read as entailed.
  | { index: number; verdict: "error"; reason: string };

export type ShownAs = "shown" | "unverified" | "hidden";

// Which answer an inference is in: an analyst answer, written from claims and
// the year-to-date chart, or the commentary on an engine answer.
export type AnswerPath = "analyst" | "engine";

// An unsupported inference goes beyond the figures without contradicting
// them, so it shows, labelled as such (render-assertions.ts
// unverifiedInference).
const SHOWN_AS: Readonly<Record<Verdict, ShownAs>> = { entailed: "shown", unsupported: "unverified", contradicted: "hidden" };

// What the reader is shown of an inference. One the judge flags as stating an
// amount in words is not shown in an analyst answer, whose numbers are only
// its claims' and its chart's (#398), and shows no higher than unverified in
// an engine answer's commentary (#509), so neither page vouches for an amount
// that is not a packet value, as far as the judge's flag catches them.
export function shownAs(verdict: InferenceVerdict, path: AnswerPath): ShownAs {
  if (verdict.verdict === "error") return "hidden";
  const as = SHOWN_AS[verdict.verdict];
  if (!verdict.worded_amount) return as;
  return path === "analyst" ? "hidden" : as === "shown" ? "unverified" : as;
}

// A worded amount goes to repair even when it shows: a rewrite without the
// amount can show clean (inference-repair.ts).
export function sentToRepair(verdict: InferenceVerdict): boolean {
  return verdict.verdict !== "error" && (verdict.verdict === "contradicted" || verdict.worded_amount);
}

// A verdict as a log or report line reads it: "unsupported, worded_amount: <reason>".
export function verdictText(verdict: InferenceVerdict): string {
  const worded = verdict.verdict !== "error" && verdict.worded_amount ? ", worded_amount" : "";
  return `${verdict.verdict}${worded}${verdict.reason ? `: ${verdict.reason}` : ""}`;
}
