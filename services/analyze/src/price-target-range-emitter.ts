// The earnings_quality playbook's deterministic emitter for the price_targets
// section: fetch the consensus price_target + the issuer's current quote,
// materialize the target facts (lean) + current-price fact (full), build the
// block, and seal it (with the pricing disclosure the price fact requires).
// Returns null (section omitted) when there is no price_target or no quote.

import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { ConsensusRepository } from "../../fundamentals/src/consensus-repository.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import { materializePriceTargetFacts } from "./price-target-materializer.ts";
import { materializePriceFact } from "./price-fact-materializer.ts";
import { buildPriceTargetRangeBlock } from "./price-target-range-block-builder.ts";
import { buildPriceTargetRangeSealInput } from "./price-target-range-snapshot.ts";
import type { CurrentPriceSource } from "./current-price-source.ts";
import type { FactRow } from "./block-seal-input.ts";

export type PriceTargetRangeEmitterDeps = {
  db: QueryExecutor;
  consensus: ConsensusRepository;
  price: CurrentPriceSource;
  clock?: () => Date;
};

export type PriceTargetRangeEmitInput = {
  primary: IssuerSubjectRef;
  snapshotId: UUID;
  blockId: string;
  asOf: string;
  title?: string;
};

export async function emitPriceTargetRangeBlock(
  deps: PriceTargetRangeEmitterDeps,
  input: PriceTargetRangeEmitInput,
): Promise<SnapshotSealInput | null> {
  const envelope = await deps.consensus.find(input.primary.id);
  if (envelope === null || envelope.price_target === null) return null;
  const quote = await deps.price.findByIssuer(input.primary.id);
  if (quote === null) return null;

  const targets = await materializePriceTargetFacts(deps.db, {
    issuer: input.primary,
    priceTarget: envelope.price_target,
    clock: deps.clock,
  });
  const priceFact = await materializePriceFact(deps.db, { quote, clock: deps.clock });

  const facts: FactRow[] = [...targets.factRows, priceFact];
  const block = buildPriceTargetRangeBlock({
    currentPriceRef: priceFact.fact_id,
    current: quote.price,
    low: targets.low,
    mean: targets.mean,
    high: targets.high,
    currency: targets.currency,
    base: {
      id: input.blockId,
      snapshot_id: input.snapshotId,
      as_of: input.asOf,
      source_refs: distinct(facts.map((fact) => fact.source_id)),
      ...(input.title === undefined ? {} : { title: input.title }),
    },
  });

  return buildPriceTargetRangeSealInput({ block, facts, primary: input.primary, listing: quote.listing });
}

function distinct(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}
