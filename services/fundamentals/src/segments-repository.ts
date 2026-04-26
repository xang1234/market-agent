import {
  buildSegmentFacts,
  type BuildSegmentFactsInput,
  type SegmentAxis,
  type SegmentFactsEnvelope,
} from "./segment-facts.ts";
import type { FiscalPeriod, StatementBasis } from "./statement.ts";
import type { UUID } from "./subject-ref.ts";

export type SegmentsLookup = {
  issuer_id: UUID;
  axis: SegmentAxis;
  basis: StatementBasis;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
};

export type SegmentsRepository = {
  find(lookup: SegmentsLookup): Promise<SegmentFactsEnvelope | null>;
};

export type SegmentsRepositoryRecord = {
  inputs: BuildSegmentFactsInput;
};

export function createInMemorySegmentsRepository(
  records: ReadonlyArray<SegmentsRepositoryRecord>,
): SegmentsRepository {
  const byKey = new Map<string, SegmentFactsEnvelope>();
  for (const { inputs } of records) {
    const envelope = buildSegmentFacts(inputs);
    byKey.set(lookupKey({
      issuer_id: envelope.subject.id,
      axis: envelope.axis,
      basis: envelope.basis,
      fiscal_year: envelope.fiscal_year,
      fiscal_period: envelope.fiscal_period,
    }), envelope);
  }
  return {
    async find(lookup: SegmentsLookup): Promise<SegmentFactsEnvelope | null> {
      return byKey.get(lookupKey(lookup)) ?? null;
    },
  };
}

function lookupKey(lookup: SegmentsLookup): string {
  return `${lookup.issuer_id}|${lookup.axis}|${lookup.basis}|${lookup.fiscal_year}-${lookup.fiscal_period}`;
}
