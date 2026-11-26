// Figure and struck segments in prose (#800). A figure shows as verified and links its
// sources, so the seal reads each source's value from what it already verifies and
// recomputes the figure's verdict (financial-core/src/figure-check.ts): a chat bug cannot
// show a wrong number behind a verified link. A struck figure states a number the sources
// contradict, so only its sources are checked, as refs.

import { linkedVerdict, linksAs, presentedQuantity, statedFigures, statedQuantity, type LinkedFigure, type Quantity } from "../../financial-core/src/figure-check.ts";
import type { FinancialAnswerContent } from "../../financial-core/src/index.ts";
import { isRecord } from "../../shared/src/http.ts";
import type { JsonObject } from "./manifest-staging.ts";

type Source = Record<string, unknown>;

const isLinked = (segment: Source) => segment.type === "figure" || segment.type === "struck";
const sourcesOf = (segment: Source): Source[] => (Array.isArray(segment.sources) ? segment.sources.filter(isRecord) : []);

// The refs a prose segment cites: a ref itself, or each source of a figure or a struck one.
export function segmentRefs(segment: unknown): ReadonlyArray<Source> {
  if (!isRecord(segment)) return [];
  if (segment.type === "ref") return [segment];
  return isLinked(segment) ? sourcesOf(segment) : [];
}

export type SealedValues = Readonly<{
  // The certified engine answers the message shows beside its prose.
  answers: ReadonlyArray<FinancialAnswerContent>;
  // Each sealed series' values by the label its chart or spec shows for it.
  series: ReadonlyMap<string, ReadonlyMap<string, Quantity>>;
  // Each sealed claim's text.
  claims: ReadonlyMap<string, string>;
}>;

export type FigureSegmentFailure = Readonly<{ reason_code: "result_ref_format_mismatch" | "figure_text_mismatch"; details: JsonObject }>;

// ponytail: a fact source has no value here, since the seal loads no fact's value, so a
// figure on one fails. No packet figure with a fact id carries a quantity (#810), so chat
// links none; load facts' values when one does.
export function figureSegmentFailures(blocks: ReadonlyArray<{ id: string; kind: string; segments?: ReadonlyArray<unknown> }>, sealed: SealedValues): FigureSegmentFailure[] {
  const results = new Map(sealed.answers.flatMap((answer) =>
    answer.results.map((result) => [result.result_id, { presented: result.presented, period: answer.labels[result.period_label_id]?.text ?? null }] as const)
  ));
  const valueOf = (source: Source | undefined): Quantity | undefined => {
    const id = String(source?.ref_id);
    switch (source?.ref_kind) {
      case "result": {
        const result = results.get(id);
        return result?.presented.kind === "value" ? presentedQuantity(result.presented) : undefined;
      }
      case "series":
        return sealed.series.get(id)?.get(String(source.format));
      case "claim": {
        const numeral = typeof source.numeral === "number" ? statedFigures(sealed.claims.get(id) ?? "")[source.numeral - 1] : undefined;
        return numeral && statedQuantity(numeral);
      }
      default:
        return undefined;
    }
  };

  const failures: FigureSegmentFailure[] = [];
  for (const block of blocks) {
    if (block.kind !== "rich_text") continue;
    for (const segment of block.segments ?? []) {
      if (!isRecord(segment) || !isLinked(segment)) continue;
      const sources = sourcesOf(segment);
      for (const source of sources.filter((entry) => entry.ref_kind === "result")) {
        const shown = results.get(String(source.ref_id));
        if (shown && source.format === shown.presented.text && source.period === shown.period) continue;
        failures.push({
          reason_code: "result_ref_format_mismatch",
          details: {
            block_id: block.id,
            result_id: String(source.ref_id),
            format: typeof source.format === "string" ? source.format : null,
            period: typeof source.period === "string" ? source.period : null,
            shown: shown?.presented.text ?? null,
            shown_period: shown?.period ?? null,
          },
        });
      }
      if (segment.type === "struck") continue;
      const figure = { ...segment, text: typeof segment.text === "string" ? segment.text : "", sources } as LinkedFigure;
      const verdict = linkedVerdict(figure, (index) => valueOf(sources[index]));
      if (linksAs(figure, verdict)) continue;
      failures.push({
        reason_code: "figure_text_mismatch",
        details: {
          block_id: block.id,
          text: figure.text,
          verdict: verdict.kind,
          ...("expected" in verdict ? { expected: verdict.expected } : {}),
          ...("reason" in verdict ? { reason: verdict.reason } : {}),
        },
      });
    }
  }
  return failures;
}
