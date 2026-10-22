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

// An unsupported inference goes beyond the figures without contradicting
// them, so it shows, labelled as such (render-assertions.ts
// unverifiedInference).
const SHOWN_AS: Readonly<Record<Verdict, ShownAs>> = { entailed: "shown", unsupported: "unverified", contradicted: "hidden" };

// What the reader is shown of an inference. One the judge flags as stating an
// amount in words shows no higher than unverified, so the page never vouches
// for an amount that is not a packet value.
export function shownAs(verdict: InferenceVerdict): ShownAs {
  if (verdict.verdict === "error") return "hidden";
  const as = SHOWN_AS[verdict.verdict];
  return verdict.worded_amount && as === "shown" ? "unverified" : as;
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
