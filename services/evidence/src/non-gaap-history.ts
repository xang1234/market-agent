// A company's non-GAAP add-backs over its last 8 reported quarters (#734),
// from the reconciliations stored for its earnings releases
// (sec-non-gaap-reconciliations.ts). Every figure is a cell of one release, or
// a difference or ratio of cells of that release, and names it. A category's
// "recurring" flag is a count: in 5 or more of the quarters read, never a
// judgment of what the item is.

import type { RowQueryExecutor } from "./types.ts";

export type TableScale = "thousands" | "millions" | "billions";
export type ReconciliationValue = { label: string; value_num: number };

export type StoredReconciliation = {
  exhibit: string;
  measure_key: string;
  gaap: ReconciliationValue;
  non_gaap: ReconciliationValue;
  adjustments: ReadonlyArray<ReconciliationValue>;
  unit: "currency" | "number";
  scale: TableScale | null;
};

export type ReleaseRevenue = { exhibit: string; label: string; value_num: number; scale: TableScale | null };

export type StoredRelease = {
  document_id: string;
  source_id: string;
  accession: string | null;
  filed_on: string;
  quarter_end: string | null;
  revenue: ReleaseRevenue | null;
  reconciliations: ReadonlyArray<StoredReconciliation>;
};

export type SbcBasis = "net_income" | "operating_income" | "gross_profit_and_operating_expenses";

export type NonGaapQuarter = Pick<StoredRelease, "document_id" | "source_id" | "accession" | "filed_on"> & {
  quarter_end: string;
  scale: TableScale | null;
  eps: { gaap: number; non_gaap: number; spread: number } | null;
  operating_income: { gaap: number; non_gaap: number } | null;
  // Percent of the release's own revenue, the spread in percentage points.
  operating_margin: { revenue: number; gaap_pct: number; non_gaap_pct: number; spread_pp: number } | null;
  sbc: { value: number; basis: SbcBasis; non_gaap_net_income: number | null; share_pct: number | null } | null;
  // The categories of the quarter's add-backs, in any of its reconciliations.
  categories: ReadonlyArray<string>;
  reconciled: boolean;
};

export type AddBackCategory = { key: string; label: string; quarters: number; of: number; recurring: boolean; quarter_ends: ReadonlyArray<string> };

export type NonGaapHistory = {
  quarters: ReadonlyArray<NonGaapQuarter>;
  categories: ReadonlyArray<AddBackCategory>;
  // Releases read whose quarter could not be dated, so none of the quarters.
  undated: number;
};

export const HISTORY_QUARTERS = 8;
export const RECURRING_QUARTERS = 5;

// Matched in order: an "income tax effect of stock-based compensation" is a tax line.
const CATEGORIES: ReadonlyArray<readonly [key: string, label: string, pattern: RegExp]> = [
  ["income_tax_effect", "income tax effects", /\btax/i],
  ["stock_based_compensation", "stock-based compensation", /\b(?:stock|share|equity)[\s-]*based\b|\bstock compensation\b/i],
  ["amortization_of_intangibles", "amortization of acquired intangibles", /\bamorti[sz]ation\b/i],
  ["restructuring", "restructuring and severance", /\brestructur|\bseverance\b|\bworkforce\b/i],
  ["impairment", "impairments and write-downs", /\bimpairment|\bwrite[\s-]?(?:down|off)/i],
  ["acquisition_related", "acquisition-related costs", /\bacqui|\bmerger|\bintegration\b|\bdivest/i],
  ["litigation", "legal and litigation", /\blitigation\b|\blegal\b|\bsettlement/i],
  ["investment_gains_losses", "gains and losses on investments", /\binvestments?\b|\bequity securities\b/i],
];

// A line's category: a known kind, else its own label, footnote marks dropped.
export function addBackCategory(label: string): { key: string; label: string } {
  for (const [key, name, pattern] of CATEGORIES) if (pattern.test(label)) return { key, label: name };
  const own = label.replace(/\s*\((?:[A-Z]|[a-z]|\d{1,2})\)/g, "").trim();
  return { key: `other:${own.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`, label: own };
}

const round = (value: number, places: number) => Number(value.toFixed(places));

export function nonGaapHistory(releases: ReadonlyArray<StoredRelease>): NonGaapHistory {
  // The release that first reported each quarter.
  const firsts = new Map<string, StoredRelease>();
  for (const release of [...releases].sort((a, b) => a.filed_on.localeCompare(b.filed_on) || a.document_id.localeCompare(b.document_id))) {
    if (release.quarter_end !== null && !firsts.has(release.quarter_end)) firsts.set(release.quarter_end, release);
  }
  const quarters = [...firsts.values()]
    .sort((a, b) => b.quarter_end!.localeCompare(a.quarter_end!))
    .slice(0, HISTORY_QUARTERS)
    .map(quarterOf);
  const labels = new Map<string, string>();
  const seen = new Map<string, string[]>();
  for (const quarter of quarters) {
    for (const key of quarter.categories) seen.set(key, [...(seen.get(key) ?? []), quarter.quarter_end]);
  }
  for (const release of firsts.values()) {
    for (const line of release.reconciliations.flatMap((reconciliation) => reconciliation.adjustments)) {
      const category = addBackCategory(line.label);
      if (!labels.has(category.key)) labels.set(category.key, category.label);
    }
  }
  const categories = [...seen.entries()]
    .map(([key, ends]) => ({ key, label: labels.get(key)!, quarters: ends.length, of: quarters.length, recurring: ends.length >= RECURRING_QUARTERS, quarter_ends: ends }))
    .sort((a, b) => b.quarters - a.quarters);
  return { quarters, categories, undated: releases.filter((release) => release.quarter_end === null).length };
}

function quarterOf(release: StoredRelease): NonGaapQuarter {
  const of = (key: string) => release.reconciliations.find((reconciliation) => reconciliation.measure_key === key);
  const eps = of("eps_diluted");
  const operating = of("operating_income");
  const net = of("net_income");
  const revenue = release.revenue;
  const sameScale = operating && revenue && operating.scale === revenue.scale && revenue.value_num > 0;
  return {
    document_id: release.document_id,
    source_id: release.source_id,
    accession: release.accession,
    filed_on: release.filed_on,
    quarter_end: release.quarter_end!,
    scale: (operating ?? net)?.scale ?? null,
    eps: eps ? { gaap: eps.gaap.value_num, non_gaap: eps.non_gaap.value_num, spread: round(eps.non_gaap.value_num - eps.gaap.value_num, 4) } : null,
    operating_income: operating ? { gaap: operating.gaap.value_num, non_gaap: operating.non_gaap.value_num } : null,
    operating_margin: sameScale
      ? {
        revenue: revenue.value_num,
        gaap_pct: round((operating.gaap.value_num / revenue.value_num) * 100, 1),
        non_gaap_pct: round((operating.non_gaap.value_num / revenue.value_num) * 100, 1),
        spread_pp: round(((operating.non_gaap.value_num - operating.gaap.value_num) / revenue.value_num) * 100, 1),
      }
      : null,
    sbc: sbcOf(release, net),
    categories: [...new Set(release.reconciliations.flatMap((reconciliation) => reconciliation.adjustments)
      .filter((line) => line.value_num !== 0)
      .map((line) => addBackCategory(line.label).key))],
    reconciled: release.reconciliations.length > 0,
  };
}

// The stock-based compensation a release adds back: in net income's
// reconciliation, else operating income's, else gross profit's and operating
// expenses' together (which a release that itemises only those splits it into).
function sbcOf(release: StoredRelease, net: StoredReconciliation | undefined): NonGaapQuarter["sbc"] {
  const sbcLines = (reconciliation: StoredReconciliation) =>
    reconciliation.adjustments.filter((line) => line.value_num !== 0 && addBackCategory(line.label).key === "stock_based_compensation");
  const bases: ReadonlyArray<readonly [SbcBasis, ReadonlyArray<string>]> = [
    ["net_income", ["net_income"]],
    ["operating_income", ["operating_income"]],
    ["gross_profit_and_operating_expenses", ["gross_profit", "operating_expenses"]],
  ];
  for (const [basis, keys] of bases) {
    const used = release.reconciliations.filter((reconciliation) => keys.includes(reconciliation.measure_key));
    const lines = used.flatMap(sbcLines);
    if (lines.length === 0) continue;
    const value = lines.reduce((sum, line) => sum + Math.abs(line.value_num), 0);
    const comparable = net && net.non_gaap.value_num > 0 && used.every((reconciliation) => reconciliation.scale === net.scale);
    return {
      value: round(value, 4),
      basis,
      non_gaap_net_income: comparable ? net.non_gaap.value_num : null,
      share_pct: comparable ? round((value / net.non_gaap.value_num) * 100, 1) : null,
    };
  }
  return null;
}

// The company's releases read for reconciliations, filed by the cutoff from a
// source the user may see.
export async function loadNonGaapHistory(
  db: RowQueryExecutor,
  input: { issuer_id: string; as_of: string; user_id?: string | null },
): Promise<NonGaapHistory> {
  const { rows } = await db.query<StoredRelease>(
    `select distinct on (r.document_id)
            r.document_id::text as document_id, d.source_id::text as source_id, d.provider_doc_id as accession,
            to_char(c.effective_time at time zone 'UTC', 'YYYY-MM-DD') as filed_on,
            r.quarter_end::text as quarter_end, r.revenue, r.reconciliations
       from non_gaap_reconciliations r
       join documents d on d.document_id = r.document_id and d.deleted_at is null
       join sources s on s.source_id = d.source_id
       join claims c on c.document_id = r.document_id and c.predicate = 'material_event.guidance_update'
       join claim_arguments ca on ca.claim_id = c.claim_id and ca.subject_kind = 'issuer'
      where ca.subject_id = $1::uuid
        and c.effective_time <= $2::timestamptz
        and (s.user_id is null or s.user_id = $3::uuid)
      order by r.document_id, c.effective_time`,
    [input.issuer_id, input.as_of, input.user_id ?? null],
  );
  return nonGaapHistory(rows);
}
