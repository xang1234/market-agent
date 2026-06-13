import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { QueryExecutor } from "./types.ts";

// Grid columns are issuer-scoped, but universe sources hand back what they
// store: watchlist/portfolio members and screen rows are listing-kind refs.
// Map each ref to its issuer (listing -> instrument -> issuer) so columns see
// the subject kind they understand; refs that don't map (other kinds, or
// dangling ids) pass through and columns report missing/no_coverage honestly.
// Dedupes by the mapped ref preserving first-seen order, so two listings of
// the same issuer become one grid row.
export async function normalizeUniverseToIssuers(
  db: QueryExecutor,
  refs: ReadonlyArray<SubjectRef>,
): Promise<SubjectRef[]> {
  const listingIds = refs.filter((r) => r.kind === "listing").map((r) => r.id);
  const instrumentIds = refs.filter((r) => r.kind === "instrument").map((r) => r.id);

  const issuerByListing = new Map<string, string>();
  if (listingIds.length > 0) {
    const { rows } = await db.query<{ listing_id: string; issuer_id: string }>(
      `select l.listing_id::text as listing_id, i.issuer_id::text as issuer_id
         from listings l
         join instruments i on i.instrument_id = l.instrument_id
        where l.listing_id = any($1::uuid[])`,
      [listingIds],
    );
    for (const row of rows) issuerByListing.set(row.listing_id, row.issuer_id);
  }

  const issuerByInstrument = new Map<string, string>();
  if (instrumentIds.length > 0) {
    const { rows } = await db.query<{ instrument_id: string; issuer_id: string }>(
      `select instrument_id::text as instrument_id, issuer_id::text as issuer_id
         from instruments
        where instrument_id = any($1::uuid[])`,
      [instrumentIds],
    );
    for (const row of rows) issuerByInstrument.set(row.instrument_id, row.issuer_id);
  }

  const out: SubjectRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const issuerId =
      ref.kind === "listing"
        ? issuerByListing.get(ref.id)
        : ref.kind === "instrument"
          ? issuerByInstrument.get(ref.id)
          : undefined;
    const mapped: SubjectRef = issuerId ? { kind: "issuer", id: issuerId } : ref;
    const key = `${mapped.kind}:${mapped.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapped);
  }
  return out;
}
