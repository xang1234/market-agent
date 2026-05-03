import type { QueryExecutor } from "./types.ts";
import {
  assertIso8601WithOffset,
  assertNonEmptyString,
  assertOneOf,
  assertOptionalNonEmptyString,
  assertUuidV4,
} from "./validators.ts";

export const SOURCE_KINDS = Object.freeze([
  "filing",
  "press_release",
  "transcript",
  "article",
  "research_note",
  "social_post",
  "upload",
  "internal",
] as const);

export const TRUST_TIERS = Object.freeze([
  "primary",
  "secondary",
  "tertiary",
  "user",
] as const);

export type SourceKind = (typeof SOURCE_KINDS)[number];
export type TrustTier = (typeof TRUST_TIERS)[number];

export type SourceInput = {
  provider: string;
  kind: SourceKind;
  canonical_url?: string | null;
  trust_tier: TrustTier;
  license_class: string;
  retrieved_at: string;
  content_hash?: string | null;
  user_id?: string | null;
};

export type SourceRow = {
  source_id: string;
  provider: string;
  kind: SourceKind;
  canonical_url: string | null;
  trust_tier: TrustTier;
  license_class: string;
  retrieved_at: string;
  content_hash: string | null;
  user_id: string | null;
  created_at: string;
};

type SourceDbRow = {
  source_id: string;
  provider: string;
  kind: SourceKind;
  canonical_url: string | null;
  trust_tier: TrustTier;
  license_class: string;
  retrieved_at: Date | string;
  content_hash: string | null;
  user_id: string | null;
  created_at: Date | string;
};

export async function createSource(
  db: QueryExecutor,
  input: SourceInput,
): Promise<SourceRow> {
  validateSourceInput(input);

  const { rows } = await db.query<SourceDbRow>(
    `insert into sources
       (provider, kind, canonical_url, trust_tier, license_class, retrieved_at, content_hash, user_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning source_id,
               provider,
               kind,
               canonical_url,
               trust_tier,
               license_class,
               retrieved_at,
               content_hash,
               user_id,
               created_at`,
    [
      input.provider,
      input.kind,
      input.canonical_url ?? null,
      input.trust_tier,
      input.license_class,
      input.retrieved_at,
      input.content_hash ?? null,
      input.user_id ?? null,
    ],
  );

  return sourceRowFromDb(rows[0]);
}

export async function getSource(
  db: QueryExecutor,
  sourceId: string,
): Promise<SourceRow | null> {
  assertUuidV4(sourceId, "source_id");

  const { rows } = await db.query<SourceDbRow>(
    `select source_id,
            provider,
            kind,
            canonical_url,
            trust_tier,
            license_class,
            retrieved_at,
            content_hash,
            user_id,
            created_at
       from sources
      where source_id = $1`,
    [sourceId],
  );

  return rows[0] ? sourceRowFromDb(rows[0]) : null;
}

export async function deleteSource(db: QueryExecutor, sourceId: string): Promise<void> {
  assertUuidV4(sourceId, "source_id");
  await db.query(`delete from sources where source_id = $1`, [sourceId]);
}

function validateSourceInput(input: SourceInput): void {
  assertNonEmptyString(input.provider, "provider");
  assertOneOf(input.kind, SOURCE_KINDS, "kind");
  assertOptionalNonEmptyString(input.canonical_url, "canonical_url");
  assertOneOf(input.trust_tier, TRUST_TIERS, "trust_tier");
  assertNonEmptyString(input.license_class, "license_class");
  assertIso8601WithOffset(input.retrieved_at, "retrieved_at");
  assertOptionalNonEmptyString(input.content_hash, "content_hash");
  if (input.user_id != null) {
    assertUuidV4(input.user_id, "user_id");
  }
}

function sourceRowFromDb(row: SourceDbRow | undefined): SourceRow {
  if (!row) {
    throw new Error("source insert did not return a row");
  }

  return Object.freeze({
    source_id: row.source_id,
    provider: row.provider,
    kind: row.kind,
    canonical_url: row.canonical_url,
    trust_tier: row.trust_tier,
    license_class: row.license_class,
    retrieved_at: isoString(row.retrieved_at),
    content_hash: row.content_hash,
    user_id: row.user_id,
    created_at: isoString(row.created_at),
  });
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
