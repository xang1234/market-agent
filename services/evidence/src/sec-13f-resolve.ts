// Shared 13F resolve/aggregate logic: turn parsed infoTable holdings into
// issuer-keyed read-model rows, resolving each CUSIP to a tracked issuer. Used by
// both the daily-crawl handler (sec-13f-handler) and the harvest+reprocess backfill
// (sec-13f-reprocess), so the resolution rules — aggregation, multi-class summing,
// value normalization, the "don't guess on a miss" policy — live in exactly one place.
import type { QueryExecutor } from "./types.ts";
import type { Form13fFiling, Form13fHolding } from "./sec-13f-extractor.ts";
import { resolveIssuerByCusip } from "./cusip-issuer-map.ts";

// SEC switched 13F <value> from thousands to whole USD for filings on/after this date.
export const WHOLE_USD_FROM = "2023-01-01";

// One aggregated, issuer-resolved holding — the read-model grain (per issuer).
export type ResolvedHolding = {
  issuerId: string;
  // For a multi-class issuer (e.g. GOOG/GOOGL), this is a *representative* CUSIP —
  // whichever class was iterated first — not an authoritative single identifier; the
  // grain is the issuer, and shares/value are summed across its classes.
  cusip: string;
  nameOfIssuer: string;
  shares: number;
  valueUsd: number;
};

// A reported holding whose CUSIP didn't resolve to a tracked issuer. Returned (not
// logged) so the caller owns the filing context for the message; CUSIP enrichment
// (fra-ajvd.7) grows coverage so a later reprocess resolves it.
export type UnresolvedHolding = { cusip: string; nameOfIssuer: string };

// A filer reports a position split across managers, so the same CUSIP appears in
// multiple rows — sum shares + value. Excluded: PRN (debt principal) rows, and
// option positions (a non-null putCall) which also use SH amounts but are not
// direct common-share holdings — this is an equity-holdings view.
function aggregateByCusip(
  holdings: ReadonlyArray<Form13fHolding>,
): Map<string, { nameOfIssuer: string; shares: number; valueRaw: number }> {
  const byCusip = new Map<string, { nameOfIssuer: string; shares: number; valueRaw: number }>();
  for (const h of holdings) {
    if (h.sshPrnamtType !== "SH" || h.putCall !== null) continue;
    const existing = byCusip.get(h.cusip);
    if (existing) {
      existing.shares += h.shares;
      existing.valueRaw += h.valueRaw;
    } else {
      byCusip.set(h.cusip, { nameOfIssuer: h.nameOfIssuer, shares: h.shares, valueRaw: h.valueRaw });
    }
  }
  return byCusip;
}

// Aggregate the filing's holdings by CUSIP, resolve each CUSIP to a tracked issuer,
// then sum BY ISSUER: a multi-class issuer (e.g. GOOG/GOOGL) reports multiple CUSIPs
// that resolve to one issuer, and the read model is unique per (filer, issuer,
// period) — so the issuer-level total must be summed before the upsert. Value is
// normalized here (thousands→whole USD) from the filing date.
export async function resolveHoldingsByIssuer(
  db: QueryExecutor,
  filing: Form13fFiling,
  filedDate: string,
): Promise<{ resolved: ResolvedHolding[]; unresolved: UnresolvedHolding[] }> {
  const valueMultiplier = filedDate < WHOLE_USD_FROM ? 1000 : 1;
  const byIssuer = new Map<string, ResolvedHolding>();
  const unresolved: UnresolvedHolding[] = [];
  for (const [cusip, agg] of aggregateByCusip(filing.holdings)) {
    const issuerId = await resolveIssuerByCusip(db, cusip);
    if (issuerId === null) {
      unresolved.push({ cusip, nameOfIssuer: agg.nameOfIssuer });
      continue;
    }
    const valueUsd = agg.valueRaw * valueMultiplier;
    const existing = byIssuer.get(issuerId);
    if (existing) {
      existing.shares += agg.shares;
      existing.valueUsd += valueUsd;
    } else {
      byIssuer.set(issuerId, { issuerId, cusip, nameOfIssuer: agg.nameOfIssuer, shares: agg.shares, valueUsd });
    }
  }
  return { resolved: [...byIssuer.values()], unresolved };
}
