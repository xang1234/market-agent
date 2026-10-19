import { isUuid } from "./chat-ids.ts";
import type { PacketClaim, PacketFigure } from "./evidence-packet.ts";

type Block = Record<string, unknown>;

export type Segment =
  | { type: "text"; text: string }
  | { type: "ref"; ref_kind: "fact" | "claim" | "series"; ref_id: string; format: string };

export type Sealer = {
  // A figure's value: a fact ref when its fact can seal here (a UUID with the
  // binding its fact block carries, or its own for a value no block shows), a
  // series ref for a price return read off its chart line, otherwise the
  // packet's value as plain text.
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
      if (!figure.fact_id && figure.series_ref && isUuid(figure.series_ref)) {
        figure.source_ids.forEach((id) => sourceRefs.add(id));
        return { type: "ref", ref_kind: "series", ref_id: figure.series_ref, format: figure.value };
      }
      const binding = figure.fact_id ? (figure.displayed === false ? figure.binding : bindings.get(figure.fact_id)) : undefined;
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
