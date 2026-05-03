import type { QueryExecutor } from "./types.ts";
import {
  assertIso8601WithOffset,
  assertNonEmptyString,
  assertOneOf,
  assertOptionalNonEmptyString,
  assertUuidV4,
} from "./validators.ts";

export const CLAIM_MODALITIES = Object.freeze([
  "asserted",
  "estimated",
  "speculative",
  "rumored",
  "quoted",
] as const);

export const CLAIM_STATUSES = Object.freeze([
  "extracted",
  "corroborated",
  "disputed",
  "rejected",
] as const);

export const CLAIM_POLARITIES = Object.freeze([
  "positive",
  "negative",
  "neutral",
  "mixed",
] as const);

export type ClaimModality = (typeof CLAIM_MODALITIES)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type ClaimPolarity = (typeof CLAIM_POLARITIES)[number];

export type ClaimInput = {
  document_id: string;
  predicate: string;
  text_canonical: string;
  polarity: ClaimPolarity;
  modality: ClaimModality;
  reported_by_source_id: string;
  attributed_to_type?: string | null;
  attributed_to_id?: string | null;
  effective_time?: string | null;
  confidence: number;
  status: ClaimStatus;
};

export type ClaimRow = {
  claim_id: string;
  document_id: string;
  predicate: string;
  text_canonical: string;
  polarity: ClaimPolarity;
  modality: ClaimModality;
  reported_by_source_id: string;
  attributed_to_type: string | null;
  attributed_to_id: string | null;
  effective_time: string | null;
  confidence: number;
  status: ClaimStatus;
  created_at: string;
  updated_at: string;
};

type ClaimDbRow = Omit<ClaimRow, "effective_time" | "confidence" | "created_at" | "updated_at"> & {
  effective_time: Date | string | null;
  confidence: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

const CLAIM_COLUMNS = `claim_id,
               document_id,
               predicate,
               text_canonical,
               polarity,
               modality,
               reported_by_source_id,
               attributed_to_type,
               attributed_to_id,
               effective_time,
               confidence,
               status,
               created_at,
               updated_at`;

export async function createClaim(db: QueryExecutor, input: ClaimInput): Promise<ClaimRow> {
  const normalized = normalizeClaimInput(input);

  const { rows } = await db.query<ClaimDbRow>(
    `insert into claims
       (document_id,
        predicate,
        text_canonical,
        polarity,
        modality,
        reported_by_source_id,
        attributed_to_type,
        attributed_to_id,
        effective_time,
        confidence,
        status)
     values ($1::uuid, $2, $3, $4::polarity, $5::claim_modality, $6::uuid, $7, $8, $9, $10, $11::claim_status)
     returning ${CLAIM_COLUMNS}`,
    [
      normalized.document_id,
      normalized.predicate,
      normalized.text_canonical,
      normalized.polarity,
      normalized.modality,
      normalized.reported_by_source_id,
      normalized.attributed_to_type,
      normalized.attributed_to_id,
      normalized.effective_time,
      normalized.confidence,
      normalized.status,
    ],
  );

  return claimRowFromDb(rows[0]);
}

export async function listClaimsForDocument(
  db: QueryExecutor,
  documentId: string,
): Promise<readonly ClaimRow[]> {
  assertUuidV4(documentId, "document_id");

  const { rows } = await db.query<ClaimDbRow>(
    `select ${CLAIM_COLUMNS}
       from claims
      where document_id = $1
      order by effective_time nulls last,
               created_at,
               claim_id`,
    [documentId],
  );

  return Object.freeze(rows.map(claimRowFromDb));
}

function normalizeClaimInput(input: ClaimInput): Required<ClaimInput> {
  assertUuidV4(input.document_id, "document_id");
  assertNonEmptyString(input.predicate, "predicate");
  assertNonEmptyString(input.text_canonical, "text_canonical");
  assertOneOf(input.polarity, CLAIM_POLARITIES, "polarity");
  assertOneOf(input.modality, CLAIM_MODALITIES, "modality");
  assertUuidV4(input.reported_by_source_id, "reported_by_source_id");
  assertOptionalNonEmptyString(input.attributed_to_type, "attributed_to_type");
  assertOptionalNonEmptyString(input.attributed_to_id, "attributed_to_id");
  if (input.effective_time != null) {
    assertIso8601WithOffset(input.effective_time, "effective_time");
  }
  assertConfidence(input.confidence, "confidence");
  assertOneOf(input.status, CLAIM_STATUSES, "status");

  return {
    document_id: input.document_id,
    predicate: input.predicate,
    text_canonical: input.text_canonical,
    polarity: input.polarity,
    modality: input.modality,
    reported_by_source_id: input.reported_by_source_id,
    attributed_to_type: input.attributed_to_type ?? null,
    attributed_to_id: input.attributed_to_id ?? null,
    effective_time: input.effective_time ?? null,
    confidence: input.confidence,
    status: input.status,
  };
}

function assertConfidence(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label}: must be a finite number in [0, 1]`);
  }
}

function claimRowFromDb(row: ClaimDbRow | undefined): ClaimRow {
  if (!row) {
    throw new Error("claim insert/select did not return a row");
  }

  return Object.freeze({
    claim_id: row.claim_id,
    document_id: row.document_id,
    predicate: row.predicate,
    text_canonical: row.text_canonical,
    polarity: row.polarity,
    modality: row.modality,
    reported_by_source_id: row.reported_by_source_id,
    attributed_to_type: row.attributed_to_type,
    attributed_to_id: row.attributed_to_id,
    effective_time: nullableIsoString(row.effective_time),
    confidence: Number(row.confidence),
    status: row.status,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function nullableIsoString(value: Date | string | null): string | null {
  return value == null ? null : isoString(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
