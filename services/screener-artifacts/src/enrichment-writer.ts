import type { QueryExecutor } from "./types.ts";

// The only field_names the issuer_profile_enrichments CHECK constraint permits
// (migration 0027). country/employees from the bundle have no home here yet.
const ENRICHMENT_FIELDS = ["domicile", "sector", "industry"] as const;
export type EnrichmentFieldName = (typeof ENRICHMENT_FIELDS)[number];

export type EnrichmentProvenance = {
  sourceId: string;
  provider: string;
  retrievedAt: string; // ISO-8601
  expiresAt?: string | null;
};

// Upserts the provenance-carrying enrichment rows (sector/industry/domicile) for
// an issuer. Mirrors the 0027 model: the issuer columns hold the canonical value
// (set with coalesce by the universe-seed), while these rows record which source
// supplied which value and when. Returns the number of fields written. Empty/null
// values are skipped (field_value has a length > 0 CHECK).
export async function writeIssuerEnrichments(
  db: QueryExecutor,
  issuerId: string,
  fields: Partial<Record<EnrichmentFieldName, string | null | undefined>>,
  provenance: EnrichmentProvenance,
): Promise<number> {
  let written = 0;
  for (const fieldName of ENRICHMENT_FIELDS) {
    const raw = fields[fieldName];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length === 0) continue;
    await db.query(
      `insert into issuer_profile_enrichments
         (issuer_id, field_name, field_value, source_id, provider, retrieved_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (issuer_id, field_name, source_id) do update
          set field_value = excluded.field_value,
              retrieved_at = excluded.retrieved_at,
              expires_at = excluded.expires_at,
              updated_at = now()`,
      [
        issuerId,
        fieldName,
        value,
        provenance.sourceId,
        provenance.provider,
        provenance.retrievedAt,
        provenance.expiresAt ?? null,
      ],
    );
    written++;
  }
  return written;
}
