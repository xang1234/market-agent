import type { SubjectKind, SubjectRef } from "../../resolver/src/subject-ref.ts";
import { SUBJECT_KINDS } from "../../resolver/src/subject-ref.ts";

import type { QueryExecutor } from "./types.ts";
import {
  assertOneOf,
  assertUuidV4,
} from "./validators.ts";

export const IMPACT_DIRECTIONS = Object.freeze([
  "positive",
  "negative",
  "mixed",
  "unknown",
] as const);

export const ENTITY_IMPACT_CHANNELS = Object.freeze([
  "demand",
  "pricing",
  "supply_chain",
  "regulation",
  "competition",
  "balance_sheet",
  "sentiment",
] as const);

export const IMPACT_HORIZONS = Object.freeze([
  "near_term",
  "medium_term",
  "long_term",
] as const);

export type ImpactDirection = (typeof IMPACT_DIRECTIONS)[number];
export type EntityImpactChannel = (typeof ENTITY_IMPACT_CHANNELS)[number];
export type ImpactHorizon = (typeof IMPACT_HORIZONS)[number];

export type EntityImpactInput = {
  claim_id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  direction: ImpactDirection;
  channel: EntityImpactChannel;
  horizon: ImpactHorizon;
  confidence: number;
};

export type EntityImpactRow = {
  entity_impact_id: string;
  claim_id: string;
  subject_ref: SubjectRef;
  direction: ImpactDirection;
  channel: EntityImpactChannel;
  horizon: ImpactHorizon;
  confidence: number;
  created_at: string;
};

type EntityImpactDbRow = {
  entity_impact_id: string;
  claim_id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  direction: string;
  channel: string;
  horizon: string;
  confidence: number | string;
  created_at: Date | string;
};

const ENTITY_IMPACT_COLUMNS = `entity_impact_id,
               claim_id,
               subject_kind,
               subject_id,
               direction,
               channel,
               horizon,
               confidence,
               created_at`;

export async function createEntityImpact(
  db: QueryExecutor,
  input: EntityImpactInput,
): Promise<EntityImpactRow> {
  validateEntityImpactInput(input);

  const { rows } = await db.query<EntityImpactDbRow>(
    `insert into entity_impacts
       (claim_id, subject_kind, subject_id, direction, channel, horizon, confidence)
     values ($1::uuid, $2::subject_kind, $3::uuid, $4::impact_direction, $5, $6::impact_horizon, $7)
     returning ${ENTITY_IMPACT_COLUMNS}`,
    [
      input.claim_id,
      input.subject_kind,
      input.subject_id,
      input.direction,
      input.channel,
      input.horizon,
      input.confidence,
    ],
  );

  return entityImpactRowFromDb(rows[0]);
}

export async function listEntityImpactsForClaim(
  db: QueryExecutor,
  claimId: string,
): Promise<readonly EntityImpactRow[]> {
  assertUuidV4(claimId, "claim_id");

  const { rows } = await db.query<EntityImpactDbRow>(
    `select ${ENTITY_IMPACT_COLUMNS}
       from entity_impacts
      where claim_id = $1
      order by subject_kind,
               subject_id,
               entity_impact_id`,
    [claimId],
  );

  return Object.freeze(rows.map(entityImpactRowFromDb));
}

function validateEntityImpactInput(input: EntityImpactInput): void {
  assertUuidV4(input.claim_id, "claim_id");
  assertOneOf(input.subject_kind, SUBJECT_KINDS, "subject_kind");
  assertUuidV4(input.subject_id, "subject_id");
  assertOneOf(input.direction, IMPACT_DIRECTIONS, "direction");
  assertOneOf(input.channel, ENTITY_IMPACT_CHANNELS, "channel");
  assertOneOf(input.horizon, IMPACT_HORIZONS, "horizon");
  assertConfidence(input.confidence, "confidence");
}

function entityImpactRowFromDb(row: EntityImpactDbRow | undefined): EntityImpactRow {
  if (!row) {
    throw new Error("entity impact insert/select did not return a row");
  }

  assertOneOf(row.direction, IMPACT_DIRECTIONS, "direction");
  assertOneOf(row.channel, ENTITY_IMPACT_CHANNELS, "channel");
  assertOneOf(row.horizon, IMPACT_HORIZONS, "horizon");

  const confidence = Number(row.confidence);
  assertConfidence(confidence, "confidence");

  return Object.freeze({
    entity_impact_id: row.entity_impact_id,
    claim_id: row.claim_id,
    subject_ref: Object.freeze({ kind: row.subject_kind, id: row.subject_id }),
    direction: row.direction,
    channel: row.channel,
    horizon: row.horizon,
    confidence,
    created_at: isoString(row.created_at),
  });
}

function assertConfidence(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label}: must be a finite number in [0, 1]`);
  }
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
