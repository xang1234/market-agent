import type { FinancialAnswerContent } from "../../financial-core/src/index.ts";
import { isUuid } from "./chat-ids.ts";
import type { PacketClaim, PacketFigure } from "./evidence-packet.ts";
import { isRecord } from "../../shared/src/http.ts";

type Block = Record<string, unknown>;

export type Segment =
  | { type: "text"; text: string }
  | { type: "ref"; ref_kind: "fact" | "claim" | "series"; ref_id: string; format: string }
  // An engine result, as its answer shows it: its text and its period's.
  | { type: "ref"; ref_kind: "result"; ref_id: string; format: string; period: string };

export type Sealer = {
  // A figure's value: a result ref for an engine result, a series ref for a
  // price return, a fact ref when a block's bindings seal its fact (recorded
  // packets only), otherwise the packet's value as plain text.
  value: (figure: PacketFigure) => Segment;
  // A claim's text: a claim ref when its id is a UUID, otherwise plain text.
  quote: (claim: PacketClaim) => Segment;
  // What the segments written so far need to seal.
  sealed: () => { fact_bindings: ReadonlyArray<Record<string, unknown>>; source_refs: ReadonlyArray<string> };
};

export function createSealer(factBlocks: ReadonlyArray<Block>): Sealer {
  const bindings = bindingsByFact(factBlocks);
  const factBindings: Array<Record<string, unknown>> = [];
  const sourceRefs = new Set<string>();
  return {
    value: (figure) => {
      if (figure.result_id) return { type: "ref", ref_kind: "result", ref_id: figure.result_id, format: figure.value, period: figure.period ?? "" };
      if (!figure.fact_id && figure.series_ref && isUuid(figure.series_ref)) {
        figure.source_ids.forEach((id) => sourceRefs.add(id));
        return { type: "ref", ref_kind: "series", ref_id: figure.series_ref, format: figure.value };
      }
      const binding = figure.fact_id ? bindings.get(figure.fact_id) : undefined;
      if (!figure.fact_id || !isUuid(figure.fact_id) || !binding) return { type: "text", text: figure.value };
      factBindings.push(binding);
      figure.source_ids.forEach((id) => sourceRefs.add(id));
      return { type: "ref", ref_kind: "fact", ref_id: figure.fact_id, format: figure.value };
    },
    quote: (claim) => {
      if (!isUuid(claim.claim_id)) return { type: "text", text: claim.text };
      sourceRefs.add(claim.source_id);
      return { type: "ref", ref_kind: "claim", ref_id: claim.claim_id, format: claim.text };
    },
    sealed: () => ({ fact_bindings: factBindings, source_refs: [...sourceRefs] }),
  };
}

function bindingsByFact(blocks: ReadonlyArray<Block>): Map<string, Record<string, unknown>> {
  return new Map(blocks.flatMap((block) => {
    const params = (block.data_ref as { params?: { fact_bindings?: unknown } } | undefined)?.params;
    const list = Array.isArray(params?.fact_bindings) ? params.fact_bindings : [];
    return list.flatMap((binding) =>
      binding !== null && typeof binding === "object" && typeof (binding as { fact_id?: unknown }).fact_id === "string"
        ? [[(binding as { fact_id: string }).fact_id, binding as Record<string, unknown>] as const]
        : []
    );
  }));
}

/**
 * Why prose written on an engine answer may not be saved beside it, or null
 * when it may: every ref is a result ref naming a verified value or ranking
 * of that answer, showing that result's text and its period's.
 */
export function resultRefProblem(prose: Block, answer: { financial: FinancialAnswerContent }): string | null {
  const { labels, results } = answer.financial;
  const cited = (kind: string) => kind === "value" || kind === "ranking";
  const verified = new Map(results.flatMap((result) => result.disposition === "verified" && cited(result.presented.kind) ? [[result.result_id, result] as const] : []));
  for (const segment of Array.isArray(prose.segments) ? prose.segments : []) {
    if (!isRecord(segment) || segment.type !== "ref") continue;
    if (segment.ref_kind !== "result") return `a ${String(segment.ref_kind)} ref is not a result ref`;
    const result = verified.get(segment.ref_id as string);
    if (!result) return `ref ${String(segment.ref_id)} names no verified result of this answer`;
    if (segment.format !== result.presented.text) return `ref ${result.result_id} shows ${JSON.stringify(segment.format)}, not its result's ${JSON.stringify(result.presented.text)}`;
    const period = labels[result.period_label_id]?.text;
    if (segment.period !== period) return `ref ${result.result_id} is dated ${JSON.stringify(segment.period)}, not its result's ${JSON.stringify(period)}`;
  }
  return null;
}
