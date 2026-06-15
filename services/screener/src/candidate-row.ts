// Shared candidate-row shaping for the screener's candidate repositories.
//
// Both repos (db-candidates.ts = reported SEC fundamentals; db-candidates-vendor.ts
// = the screener-artifacts vendor universe) select the same listing + instrument +
// issuer identity columns and turn them into the same display + universe shapes.
// Centralizing that here keeps the two reads from drifting on the display format or
// the universe-filter gate; each repo's row type extends ScreenerIdentityRow with
// its own quote and fundamentals columns.

import type { ScreenerCandidateUniverse } from "./candidate.ts";
import type { AssetType } from "./fields.ts";
import type { ScreenerDisplay } from "./result.ts";

export type ScreenerIdentityRow = {
  listing_id: string;
  legal_name: string;
  share_class: string | null;
  asset_type: AssetType;
  mic: string;
  ticker: string;
  trading_currency: string;
  domicile: string | null;
  sector: string | null;
  industry: string | null;
};

// A row only enters the screenable universe with non-null domicile/sector/industry —
// the universe filters key on them, so a candidate missing any is excluded.
export function universeFromRow(row: ScreenerIdentityRow): ScreenerCandidateUniverse | null {
  if (!row.domicile || !row.sector || !row.industry) return null;
  return {
    asset_type: row.asset_type,
    mic: row.mic,
    trading_currency: row.trading_currency,
    domicile: row.domicile,
    sector: row.sector,
    industry: row.industry,
  };
}

export function displayFromRow(row: ScreenerIdentityRow): ScreenerDisplay {
  return {
    primary: `${row.ticker} · ${row.mic} — ${row.legal_name}`,
    ticker: row.ticker,
    mic: row.mic,
    legal_name: row.legal_name,
    ...(row.share_class ? { share_class: row.share_class } : {}),
  };
}

export function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
