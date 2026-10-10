// The evidence an answer is written from (#207): the turn's route and cutoff,
// each figure shown with a short packet id bound to its fact and sources,
// which companies have figures and which do not, what could not be shown, and
// the bounds the readers applied. Built from the deterministic fact blocks
// and the turn's research scope, never from raw tool results.
//
// The model sees short ids ("F1"); the fact and source ids stay here, so the
// prompt stays compact (#181) and an assertion citing "F1" can be bound back
// to its fact (#208).
//
// ponytail: figures only; claim selection (route predicates, older decisive
// claims, duplicates, disagreement) is #207's second slice.

import { displayedFigures, QUARTERS_SHOWN, type DisplayedFigure } from "./fact-blocks.ts";
import type { ResearchScope } from "./research-scope.ts";

type Block = Record<string, unknown>;

export type PacketFigure = Omit<DisplayedFigure, "fact_id" | "block_id"> & {
  id: string;
  fact_id?: string;
  source_ids: ReadonlyArray<string>;
};

export type EvidencePacket = {
  route: string;
  cutoff: string;
  companies: ReadonlyArray<string>;
  figures: ReadonlyArray<PacketFigure>;
  // Each company the turn covers: shown when the answer has a figure for it.
  coverage: ReadonlyArray<{ company: string; status: "shown" | "not_shown" }>;
  // What could not be shown, as the gap notes say it.
  gaps: ReadonlyArray<string>;
  query_bounds: Readonly<Record<string, string>>;
};

export function buildEvidencePacket(input: {
  scope?: ResearchScope;
  factBlocks: ReadonlyArray<Block>;
  cutoff: string;
}): EvidencePacket {
  const blockSources = new Map(input.factBlocks.flatMap((block) =>
    typeof block.id === "string" ? [[block.id, sourceIds(block)] as const] : []
  ));
  const figures = displayedFigures(input.factBlocks).map(({ fact_id, block_id, ...figure }, index) => ({
    id: `F${index + 1}`,
    ...figure,
    ...(fact_id ? { fact_id } : {}),
    source_ids: (block_id && blockSources.get(block_id)) || [],
  }));
  // Every company the scope covers, whether or not a block shows it. An
  // auto-selected peer carries no label in the scope: the comparison names it,
  // and without one it is still covered, by issuer.
  const blockLabels = new Map(input.factBlocks.flatMap((block) => {
    const subjects = Array.isArray(block.subjects) ? block.subjects : [];
    const labels = Array.isArray(block.subject_labels) ? block.subject_labels : [];
    return subjects.flatMap((subject, index) =>
      isRecord(subject) && isString(subject.id) && isString(labels[index]) ? [[subject.id, labels[index]] as const] : []
    );
  }));
  const companies = unique([
    ...(input.scope?.companies.map((company) =>
      company.label ?? blockLabels.get(company.issuer_id) ?? `issuer:${company.issuer_id.slice(0, 8)}`
    ) ?? []),
    ...input.factBlocks.flatMap((block) => Array.isArray(block.subject_labels) ? block.subject_labels.filter(isString) : []),
  ]);
  // A single company's figures name no company: they are all its own.
  const shown = (company: string) =>
    figures.some((figure) => figure.company === company) ||
    (companies.length === 1 && figures.length > 0);
  return {
    route: input.scope?.route ?? "unknown",
    cutoff: input.cutoff,
    companies,
    figures,
    coverage: companies.map((company) => ({ company, status: shown(company) ? "shown" : "not_shown" })),
    gaps: input.factBlocks.flatMap((block) =>
      block.kind === "rich_text" && Array.isArray(block.segments)
        ? block.segments.flatMap((segment) => (isRecord(segment) && isString(segment.text) ? [segment.text] : []))
        : []
    ),
    query_bounds: input.scope ? queryBounds(input.scope) : {},
  };
}

// The packet as the model sees it: short ids only, no fact or source ids.
export function packetForModel(packet: EvidencePacket): Record<string, unknown> {
  return {
    route: packet.route,
    cutoff: packet.cutoff,
    figures: packet.figures.map(({ fact_id: _factId, source_ids: _sourceIds, ...figure }) => figure),
    ...(packet.coverage.length > 0 ? { coverage: packet.coverage } : {}),
    ...(packet.gaps.length > 0 ? { gaps: packet.gaps } : {}),
    ...(Object.keys(packet.query_bounds).length > 0 ? { query_bounds: packet.query_bounds } : {}),
  };
}

// The periods and window the readers were asked for (fact-blocks.ts), so the
// answer can say what the data covers and what it was never asked to cover.
function queryBounds(scope: ResearchScope): Record<string, string> {
  const periods: Partial<Record<ResearchScope["reads"], string>> = {
    latest_quarter: `latest quarter, with revenue for the last ${QUARTERS_SHOWN} quarters`,
    trend: `last ${QUARTERS_SHOWN} quarters`,
    derived_margin: `latest quarter, with revenue for the last ${QUARTERS_SHOWN} quarters`,
    segments: "latest quarter's segments",
    comparison: scope.fiscal_year === null ? "latest fiscal year per company" : `fiscal year ${scope.fiscal_year} per company`,
  };
  return {
    ...(periods[scope.reads] ? { periods: periods[scope.reads]! } : {}),
    ...(scope.price_window ? { price_window: `year to date, to the ${scope.price_window.cutoff.slice(0, 10)} cutoff` } : {}),
  };
}

function sourceIds(block: Block): string[] {
  const refs = Array.isArray(block.source_refs) ? block.source_refs : [];
  return unique(refs.flatMap((ref) => isString(ref) ? [ref] : isRecord(ref) && isString(ref.id) ? [ref.id] : []));
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
