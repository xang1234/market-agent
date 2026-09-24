// Append-only writers for verified-finance proofs. These are server-side
// ingestion paths only: nothing here is reachable from model output, and a
// proof must name the exact source version (content hash) it attests.

import {
  canonicalDecimalString,
  compareExactDecimals,
  parseDerivedDecimalText,
  parseFinancialDecimal,
} from "../../financial-core/src/exact-decimal.ts";
import type { QueryExecutor } from "./types.ts";
import { assertIso8601WithOffset, assertNonEmptyString, assertOneOf, assertUuidV4 } from "./validators.ts";

export const PUBLICATION_TIMING_PRECISIONS = Object.freeze(["instant", "date", "observed_public"] as const);
export const PUBLICATION_PROOF_METHODS = Object.freeze([
  "controlled_public_fetch",
  "provider_publication_mapping",
  "accession_bound_archive",
] as const);
export const PRECISION_CLASSES = Object.freeze(["source_token_preserved", "revalidated_against_source", "legacy_unverified"] as const);

export type PublicationTimingPrecision = (typeof PUBLICATION_TIMING_PRECISIONS)[number];
export type PublicationProofMethod = (typeof PUBLICATION_PROOF_METHODS)[number];
export type PrecisionClass = (typeof PRECISION_CLASSES)[number];

export class FinancialAttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialAttestationError";
  }
}

export type SourcePublicationAttestationInput = Readonly<{
  source_id: string;
  document_id: string | null;
  source_version_hash: string;
  available_not_before: string | null;
  available_no_later_than: string;
  timing_precision: PublicationTimingPrecision;
  source_timezone: string;
  proof_method: PublicationProofMethod;
  proof_ref: string;
  proof_hash: string;
  mapping_version: string;
}>;

export type SourcePublicationAttestationRow = SourcePublicationAttestationInput & Readonly<{
  attestation_id: string;
  attested_at: string;
  supersedes: string | null;
  supersession_reason: "correction" | "reclassification" | null;
}>;

const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** Content hashes are stored as bare hex or `sha256:<hex>`; proofs compare the hex. */
export function normalizeContentHash(hash: string | null): string | null {
  if (hash === null) return null;
  const hex = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
  return SHA256_HEX.test(hex) ? hex : null;
}

export async function recordSourcePublicationAttestation(
  db: QueryExecutor,
  input: SourcePublicationAttestationInput,
): Promise<SourcePublicationAttestationRow> {
  await assertPublicationInput(db, input);
  return insertPublicationAttestation(db, input, null, null);
}

/** Corrections are new rows linked to the attestation they replace; nothing is rewritten. */
export async function supersedeSourcePublicationAttestation(
  db: QueryExecutor,
  previousAttestationId: string,
  input: SourcePublicationAttestationInput,
  reason: "correction" | "reclassification",
): Promise<SourcePublicationAttestationRow> {
  assertUuidV4(previousAttestationId, "previousAttestationId");
  assertOneOf(reason, ["correction", "reclassification"] as const, "reason");
  const previous = await db.query<{ source_id: string; source_version_hash: string }>(
    `select source_id::text, source_version_hash from source_publication_attestations where attestation_id = $1`,
    [previousAttestationId],
  );
  const row = previous.rows[0];
  if (!row) throw new FinancialAttestationError("superseded attestation does not exist");
  if (row.source_id !== input.source_id || row.source_version_hash !== input.source_version_hash) {
    throw new FinancialAttestationError("a correction must attest the same source version");
  }
  await assertPublicationInput(db, input);
  return insertPublicationAttestation(db, input, previousAttestationId, reason);
}

export type FactPrecisionAttestationInput = Readonly<
  | {
      fact_id: string;
      precision_class: "source_token_preserved" | "revalidated_against_source";
      raw_token: string;
      token_proof_hash: string;
      source_locator: string | null;
      validation_method: string;
    }
  | { fact_id: string; precision_class: "legacy_unverified"; validation_method: string }
>;

export type FactPrecisionAttestationRow = Readonly<{
  precision_attestation_id: string;
  fact_id: string;
  source_id: string;
  precision_class: PrecisionClass;
  raw_token: string | null;
  token_proof_hash: string | null;
  value_text: string | null;
  scale_text: string | null;
  source_locator: string | null;
  validation_method: string;
  attested_at: string;
  supersedes: string | null;
}>;

/**
 * Records precision evidence for a stored fact. A proven class requires the
 * source token to equal the stored value exactly; a rounded value can never be
 * promoted by converting it back to text.
 */
export async function recordFactPrecisionAttestation(
  db: QueryExecutor,
  input: FactPrecisionAttestationInput,
): Promise<FactPrecisionAttestationRow> {
  assertUuidV4(input.fact_id, "fact_id");
  assertOneOf(input.precision_class, PRECISION_CLASSES, "precision_class");
  assertNonEmptyString(input.validation_method, "validation_method");
  const fact = (await db.query<{ source_id: string; value_text: string | null; scale_text: string }>(
    `select source_id::text, value_num::text as value_text, scale::text as scale_text from facts where fact_id = $1`,
    [input.fact_id],
  )).rows[0];
  if (!fact) throw new FinancialAttestationError("fact does not exist");
  const previous = (await db.query<{ precision_attestation_id: string }>(
    `select a.precision_attestation_id::text
       from fact_precision_attestations a
      where a.fact_id = $1
        and not exists (select 1 from fact_precision_attestations s where s.supersedes = a.precision_attestation_id)`,
    [input.fact_id],
  )).rows[0];

  let proof: { raw_token: string | null; token_proof_hash: string | null; value_text: string | null; scale_text: string | null; source_locator: string | null } = {
    raw_token: null,
    token_proof_hash: null,
    value_text: null,
    scale_text: null,
    source_locator: null,
  };
  if (input.precision_class !== "legacy_unverified") {
    if (!SHA256_HEX.test(input.token_proof_hash)) throw new FinancialAttestationError("token_proof_hash must be a sha256 hex digest");
    const check = checkTokenAgainstStoredValue(input.raw_token, fact.value_text);
    if (check !== "match") {
      throw new FinancialAttestationError(check === "invalid_token" ? "raw_token is not a supported decimal" : "raw_token does not equal the stored fact value");
    }
    const scale = parseDerivedDecimalText(fact.scale_text);
    if (!scale.ok || scale.value.coefficient <= 0n) throw new FinancialAttestationError("stored fact scale is not a positive decimal");
    const token = parseFinancialDecimal(input.raw_token);
    proof = {
      raw_token: input.raw_token,
      token_proof_hash: input.token_proof_hash,
      value_text: token.ok ? canonicalDecimalString(token.value) : null,
      scale_text: canonicalDecimalString(scale.value),
      source_locator: input.source_locator,
    };
  }

  const inserted = await db.query<FactPrecisionAttestationRow>(
    `insert into fact_precision_attestations
       (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text, source_locator, validation_method, supersedes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning precision_attestation_id::text, fact_id::text, source_id::text, precision_class, raw_token, token_proof_hash,
               value_text, scale_text, source_locator, validation_method, attested_at::text, supersedes::text`,
    [
      input.fact_id,
      fact.source_id,
      input.precision_class,
      proof.raw_token,
      proof.token_proof_hash,
      proof.value_text,
      proof.scale_text,
      proof.source_locator,
      input.validation_method,
      previous?.precision_attestation_id ?? null,
    ],
  );
  return inserted.rows[0]!;
}

/** Whether a source token equals a stored numeric value exactly (text from `value_num::text`). */
export function checkTokenAgainstStoredValue(rawToken: string, storedValueText: string | null): "match" | "value_mismatch" | "invalid_token" {
  const token = parseFinancialDecimal(rawToken);
  if (!token.ok) return "invalid_token";
  const stored = storedValueText === null ? null : parseDerivedDecimalText(storedValueText);
  if (stored === null || !stored.ok) return "value_mismatch";
  return compareExactDecimals(token.value, stored.value) === 0 ? "match" : "value_mismatch";
}

async function assertPublicationInput(db: QueryExecutor, input: SourcePublicationAttestationInput): Promise<void> {
  assertUuidV4(input.source_id, "source_id");
  if (input.document_id !== null) assertUuidV4(input.document_id, "document_id");
  if (!SHA256_HEX.test(input.source_version_hash)) throw new FinancialAttestationError("source_version_hash must be a sha256 hex digest");
  if (!SHA256_HEX.test(input.proof_hash)) throw new FinancialAttestationError("proof_hash must be a sha256 hex digest");
  assertIso8601WithOffset(input.available_no_later_than, "available_no_later_than");
  if (input.available_not_before !== null) {
    assertIso8601WithOffset(input.available_not_before, "available_not_before");
    if (Date.parse(input.available_not_before) > Date.parse(input.available_no_later_than)) {
      throw new FinancialAttestationError("available_not_before must not follow available_no_later_than");
    }
  }
  assertOneOf(input.timing_precision, PUBLICATION_TIMING_PRECISIONS, "timing_precision");
  assertOneOf(input.proof_method, PUBLICATION_PROOF_METHODS, "proof_method");
  assertNonEmptyString(input.proof_ref, "proof_ref");
  assertNonEmptyString(input.mapping_version, "mapping_version");
  if (!isKnownTimeZone(input.source_timezone)) throw new FinancialAttestationError("source_timezone must be an IANA time zone");

  const version = (await db.query<{ source_hash: string | null; document_hash: string | null; document_source_id: string | null }>(
    `select s.content_hash as source_hash, d.content_hash as document_hash, d.source_id::text as document_source_id
       from sources s
       left join documents d on d.document_id = $2
      where s.source_id = $1`,
    [input.source_id, input.document_id],
  )).rows[0];
  if (!version) throw new FinancialAttestationError("source does not exist");
  if (input.document_id !== null && version.document_source_id !== input.source_id) {
    throw new FinancialAttestationError("document does not belong to the attested source");
  }
  const attestedVersion = normalizeContentHash(input.document_id !== null ? version.document_hash : version.source_hash);
  if (attestedVersion !== input.source_version_hash) {
    throw new FinancialAttestationError("source_version_hash does not identify the stored source version");
  }
}

async function insertPublicationAttestation(
  db: QueryExecutor,
  input: SourcePublicationAttestationInput,
  supersedes: string | null,
  reason: "correction" | "reclassification" | null,
): Promise<SourcePublicationAttestationRow> {
  const result = await db.query<SourcePublicationAttestationRow>(
    `insert into source_publication_attestations
       (source_id, document_id, source_version_hash, available_not_before, available_no_later_than, timing_precision,
        source_timezone, proof_method, proof_ref, proof_hash, mapping_version, supersedes, supersession_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning attestation_id::text, source_id::text, document_id::text, source_version_hash,
               to_char(available_not_before at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as available_not_before,
               to_char(available_no_later_than at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as available_no_later_than,
               timing_precision, source_timezone, proof_method, proof_ref, proof_hash, mapping_version,
               attested_at::text, supersedes::text, supersession_reason`,
    [
      input.source_id,
      input.document_id,
      input.source_version_hash,
      input.available_not_before,
      input.available_no_later_than,
      input.timing_precision,
      input.source_timezone,
      input.proof_method,
      input.proof_ref,
      input.proof_hash,
      input.mapping_version,
      supersedes,
      reason,
    ],
  );
  return result.rows[0]!;
}

function isKnownTimeZone(zone: string): boolean {
  if (typeof zone !== "string" || zone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
