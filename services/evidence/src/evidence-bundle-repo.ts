import type { TrustTier } from "./source-repo.ts";
import { TRUST_TIERS } from "./source-repo.ts";
import type { QueryExecutor } from "./types.ts";
import {
  assertOneOf,
  assertUuidV4,
} from "./validators.ts";

const RAW_TEXT_LOCATOR_KEYS = new Set(["text", "body", "content", "excerpt", "raw_text"]);

export type EvidenceBundleInput = Readonly<{
  claim_ids?: readonly string[];
  event_ids?: readonly string[];
}>;

export type EvidenceBundleDocument = Readonly<{
  document_id: string;
  title: string | null;
  author: string | null;
  published_at: string | null;
  canonical_url: string | null;
  source: Readonly<{
    trust_tier: TrustTier;
  }>;
}>;

export type EvidenceBundleEvidence = Readonly<{
  claim_id: string;
  document_id: string;
  locator: Readonly<Record<string, unknown>>;
  excerpt_hash: string | null;
  confidence: number;
}>;

export type AssembledEvidenceBundle = Readonly<{
  documents: readonly EvidenceBundleDocument[];
  evidence: readonly EvidenceBundleEvidence[];
}>;

type EvidenceBundleDbRow = {
  claim_evidence_id: string;
  claim_id: string;
  document_id: string;
  locator: Record<string, unknown> | string;
  excerpt_hash: string | null;
  confidence: number | string;
  title: string | null;
  author: string | null;
  published_at: Date | string | null;
  canonical_url: string | null;
  trust_tier: TrustTier;
};

export async function assembleEvidenceBundle(
  db: QueryExecutor,
  input: EvidenceBundleInput,
): Promise<AssembledEvidenceBundle> {
  const normalized = normalizeEvidenceBundleInput(input);

  const { rows } = await db.query<EvidenceBundleDbRow>(
    `with requested_claims as (
       select unnest($1::uuid[]) as claim_id
     ),
     event_claims as (
       select (jsonb_array_elements_text(e.source_claim_ids))::uuid as claim_id
         from events e
        where e.event_id = any($2::uuid[])
     ),
     all_claims as (
       select claim_id from requested_claims
       union
       select claim_id from event_claims
     )
     select ce.claim_evidence_id,
            ce.claim_id,
            ce.document_id,
            ce.locator,
            ce.excerpt_hash,
            ce.confidence,
            d.title,
            d.author,
            d.published_at,
            s.canonical_url,
            s.trust_tier
       from all_claims ac
       join claims c on c.claim_id = ac.claim_id
       join claim_evidence ce on ce.claim_id = c.claim_id
       join documents d on d.document_id = ce.document_id
       join sources s on s.source_id = d.source_id`,
    [normalized.claim_ids, normalized.event_ids],
  );

  return bundleFromRows(rows);
}

function normalizeEvidenceBundleInput(input: EvidenceBundleInput): Required<EvidenceBundleInput> {
  const claimIds = uniqueSorted(input.claim_ids ?? [], "claim_ids");
  const eventIds = uniqueSorted(input.event_ids ?? [], "event_ids");
  if (claimIds.length === 0 && eventIds.length === 0) {
    throw new Error("claim_ids or event_ids: at least one id is required");
  }

  return {
    claim_ids: claimIds,
    event_ids: eventIds,
  };
}

function uniqueSorted(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) {
    throw new Error(`${label}: must be an array`);
  }
  values.forEach((value, index) => assertUuidV4(value, `${label}[${index}]`));
  return Object.freeze([...new Set(values)].sort());
}

function bundleFromRows(rows: readonly EvidenceBundleDbRow[]): AssembledEvidenceBundle {
  const documents = new Map<string, EvidenceBundleDocument>();
  const evidenceRows = rows.map((row) => {
    const document = documentFromRow(row);
    documents.set(document.document_id, document);
    return evidenceFromRow(row);
  });

  return Object.freeze({
    documents: Object.freeze([...documents.values()].sort(compareDocuments)),
    evidence: Object.freeze(evidenceRows.sort(compareEvidence).map(omitEvidenceSortKey)),
  });
}

function documentFromRow(row: EvidenceBundleDbRow): EvidenceBundleDocument {
  assertUuidV4(row.document_id, "document_id");
  assertOneOf(row.trust_tier, TRUST_TIERS, "trust_tier");

  return Object.freeze({
    document_id: row.document_id,
    title: row.title,
    author: row.author,
    published_at: nullableIsoString(row.published_at),
    canonical_url: row.canonical_url,
    source: Object.freeze({ trust_tier: row.trust_tier }),
  });
}

function evidenceFromRow(row: EvidenceBundleDbRow): EvidenceBundleEvidence & { claim_evidence_id: string } {
  assertUuidV4(row.claim_evidence_id, "claim_evidence_id");
  assertUuidV4(row.claim_id, "claim_id");
  assertUuidV4(row.document_id, "document_id");
  const confidence = Number(row.confidence);
  assertConfidence(confidence, "confidence");

  return Object.freeze({
    claim_evidence_id: row.claim_evidence_id,
    claim_id: row.claim_id,
    document_id: row.document_id,
    locator: Object.freeze(parseLocator(row.locator)),
    excerpt_hash: row.excerpt_hash,
    confidence,
  });
}

function parseLocator(value: Record<string, unknown> | string): Record<string, unknown> {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  assertLocator(parsed, "locator");
  return parsed;
}

function assertLocator(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: must be a JSON object`);
  }
  assertNoRawTextLocatorKeys(value as Record<string, unknown>, label);
}

function assertNoRawTextLocatorKeys(value: Record<string, unknown>, path: string): void {
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (RAW_TEXT_LOCATOR_KEYS.has(key.toLowerCase())) {
      throw new Error(`${childPath}: raw text is not allowed in evidence bundle locators`);
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

function assertConfidence(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label}: must be a finite number in [0, 1]`);
  }
}

function compareDocuments(left: EvidenceBundleDocument, right: EvidenceBundleDocument): number {
  const leftPublished = left.published_at ?? "9999-12-31T23:59:59.999Z";
  const rightPublished = right.published_at ?? "9999-12-31T23:59:59.999Z";
  return leftPublished.localeCompare(rightPublished) || left.document_id.localeCompare(right.document_id);
}

function compareEvidence(
  left: EvidenceBundleEvidence & { claim_evidence_id: string },
  right: EvidenceBundleEvidence & { claim_evidence_id: string },
): number {
  return (
    left.claim_id.localeCompare(right.claim_id) ||
    right.confidence - left.confidence ||
    left.claim_evidence_id.localeCompare(right.claim_evidence_id)
  );
}

function omitEvidenceSortKey(evidence: EvidenceBundleEvidence & { claim_evidence_id: string }): EvidenceBundleEvidence {
  return Object.freeze({
    claim_id: evidence.claim_id,
    document_id: evidence.document_id,
    locator: evidence.locator,
    excerpt_hash: evidence.excerpt_hash,
    confidence: evidence.confidence,
  });
}

function nullableIsoString(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
