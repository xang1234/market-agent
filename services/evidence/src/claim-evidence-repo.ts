import type { QueryExecutor } from "./types.ts";
import {
  assertOptionalNonEmptyString,
  assertUuidV4,
} from "./validators.ts";

const RAW_TEXT_LOCATOR_KEYS = new Set(["text", "body", "content", "excerpt", "raw_text"]);

export type ClaimEvidenceInput = {
  claim_id: string;
  document_id: string;
  locator: Record<string, unknown>;
  excerpt_hash?: string | null;
  confidence: number;
};

export type ClaimEvidenceRow = {
  claim_evidence_id: string;
  claim_id: string;
  document_id: string;
  locator: Readonly<Record<string, unknown>>;
  excerpt_hash: string | null;
  confidence: number;
  created_at: string;
};

type ClaimEvidenceDbRow = Omit<ClaimEvidenceRow, "locator" | "confidence" | "created_at"> & {
  locator: Record<string, unknown> | string;
  confidence: number | string;
  created_at: Date | string;
};

const CLAIM_EVIDENCE_COLUMNS = `claim_evidence_id,
               claim_id,
               document_id,
               locator,
               excerpt_hash,
               confidence,
               created_at`;

export async function createClaimEvidence(
  db: QueryExecutor,
  input: ClaimEvidenceInput,
): Promise<ClaimEvidenceRow> {
  const normalized = normalizeClaimEvidenceInput(input);

  const { rows } = await db.query<ClaimEvidenceDbRow>(
    `insert into claim_evidence
       (claim_id, document_id, locator, excerpt_hash, confidence)
     values ($1::uuid, $2::uuid, $3::jsonb, $4, $5)
     returning ${CLAIM_EVIDENCE_COLUMNS}`,
    [
      normalized.claim_id,
      normalized.document_id,
      JSON.stringify(normalized.locator),
      normalized.excerpt_hash,
      normalized.confidence,
    ],
  );

  return claimEvidenceRowFromDb(rows[0]);
}

export async function listClaimEvidenceForClaim(
  db: QueryExecutor,
  claimId: string,
): Promise<readonly ClaimEvidenceRow[]> {
  assertUuidV4(claimId, "claim_id");

  const { rows } = await db.query<ClaimEvidenceDbRow>(
    `select ${CLAIM_EVIDENCE_COLUMNS}
       from claim_evidence
      where claim_id = $1
      order by confidence desc,
               claim_evidence_id`,
    [claimId],
  );

  return Object.freeze(rows.map(claimEvidenceRowFromDb));
}

function normalizeClaimEvidenceInput(input: ClaimEvidenceInput): Required<ClaimEvidenceInput> {
  assertUuidV4(input.claim_id, "claim_id");
  assertUuidV4(input.document_id, "document_id");
  assertLocator(input.locator, "locator");
  assertOptionalNonEmptyString(input.excerpt_hash, "excerpt_hash");
  assertConfidence(input.confidence, "confidence");

  return {
    claim_id: input.claim_id,
    document_id: input.document_id,
    locator: input.locator,
    excerpt_hash: input.excerpt_hash ?? null,
    confidence: input.confidence,
  };
}

function assertLocator(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: must be a JSON object`);
  }
  assertNoRawTextLocatorKeys(value as Record<string, unknown>, label);
}

function claimEvidenceRowFromDb(row: ClaimEvidenceDbRow | undefined): ClaimEvidenceRow {
  if (!row) {
    throw new Error("claim evidence insert/select did not return a row");
  }

  const confidence = Number(row.confidence);
  assertConfidence(confidence, "confidence");

  return Object.freeze({
    claim_evidence_id: row.claim_evidence_id,
    claim_id: row.claim_id,
    document_id: row.document_id,
    locator: Object.freeze(parseLocator(row.locator)),
    excerpt_hash: row.excerpt_hash,
    confidence,
    created_at: isoString(row.created_at),
  });
}

function parseLocator(value: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    assertLocator(parsed, "locator");
    return parsed;
  }

  assertLocator(value, "locator");
  return value;
}

function assertConfidence(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label}: must be a finite number in [0, 1]`);
  }
}

function assertNoRawTextLocatorKeys(value: Record<string, unknown>, path: string): void {
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (RAW_TEXT_LOCATOR_KEYS.has(key.toLowerCase())) {
      throw new Error(`${childPath}: raw text is not allowed in claim evidence locators`);
    }
    assertNoRawTextLocatorValue(child, childPath);
  }
}

function assertNoRawTextLocatorValue(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawTextLocatorValue(item, `${path}[${index}]`));
    return;
  }

  if (value !== null && typeof value === "object") {
    assertNoRawTextLocatorKeys(value as Record<string, unknown>, path);
  }
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
