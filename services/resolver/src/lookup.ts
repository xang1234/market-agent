import type { QueryResult } from "pg";
import {
  ambiguous,
  CONFIDENCE_NAME_ALIAS_LISTING,
  CONFIDENCE_NAME_FORMER,
  CONFIDENCE_NAME_LEGAL,
  CONFIDENCE_NAME_SHORT,
  CONFIDENCE_TICKER_AMBIGUOUS,
  CONFIDENCE_TICKER_SINGLE,
  CONFIDENCE_UNIQUE_IDENTIFIER,
  notFound,
  resolved,
  type AmbiguityAxis,
  type NotFoundReason,
  type ResolverCandidate,
  type ResolverEnvelope,
} from "./envelope.ts";
import { normalizeCik } from "./normalize.ts";

// Minimal queryable surface — a `pg.Client` or `pg.Pool` both satisfy it,
// and callers can stub it in tests without dragging the full pg type in.
export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

type IssuerRow = {
  issuer_id: string;
  legal_name: string;
};

type IssuerNameRow = IssuerRow & {
  matched_name: string;
  match_reason: "legal_name" | "former_name";
};

type InstrumentRow = {
  instrument_id: string;
  issuer_id: string;
  asset_type: string;
  share_class: string | null;
  legal_name: string;
};

type ListingRow = {
  listing_id: string;
  instrument_id: string;
  issuer_id: string;
  mic: string;
  ticker: string;
  share_class: string | null;
  legal_name: string;
};

type TickerInput = { kind: "ticker"; value: string; mic?: string };
type CikInput = { kind: "cik"; value: string };
type IsinInput = { kind: "isin"; value: string };
type LeiInput = { kind: "lei"; value: string };
type NameInput = { kind: "name"; value: string };
export type ResolverInput = TickerInput | CikInput | IsinInput | LeiInput | NameInput;

export async function resolveByInput(
  db: QueryExecutor,
  input: ResolverInput,
): Promise<ResolverEnvelope> {
  switch (input.kind) {
    case "ticker":
      return resolveByTicker(db, input.value, { mic: input.mic });
    case "cik":
      return resolveByCik(db, input.value);
    case "isin":
      return resolveByIsin(db, input.value);
    case "lei":
      return resolveByLei(db, input.value);
    case "name":
      return resolveByNameCandidate(db, input.value);
    default: {
      const _exhaustive: never = input;
      throw new Error(`Unhandled resolver input kind: ${(_exhaustive as ResolverInput).kind}`);
    }
  }
}

export async function resolveByNameCandidate(
  db: QueryExecutor,
  name: string,
): Promise<ResolverEnvelope> {
  const normalized = normalizeNameForLookup(name);
  const result: QueryResult<IssuerNameRow> = await db.query(
    `select iss.issuer_id,
            iss.legal_name,
            ia.raw_name as matched_name,
            ia.match_reason
       from issuer_aliases ia
       join issuers iss on iss.issuer_id = ia.issuer_id
      where ia.normalized_name = $1
      order by case ia.match_reason when 'legal_name' then 0 else 1 end,
               iss.legal_name,
               ia.raw_name`,
    [normalized],
  );

  const matchedRows = result.rows;

  if (matchedRows.length === 0) {
    return notFound({ normalized_input: normalized, reason: "no_candidates" });
  }

  const issuerRows = dedupeIssuerNameRows(matchedRows);
  const issuerCandidates = issuerRows.map((row) => ({
    subject_ref: { kind: "issuer" as const, id: row.issuer_id },
    display_name: row.legal_name,
    confidence:
      row.match_reason === "legal_name" ? CONFIDENCE_NAME_LEGAL : CONFIDENCE_NAME_FORMER,
    match_reason: row.match_reason,
  }));
  const aliasIssuerIds = issuerRows
    .filter((row) => row.match_reason === "former_name")
    .map((row) => row.issuer_id);
  const listingCandidates = await listingCandidatesForAliasIssuers(db, aliasIssuerIds);
  const candidates = dedupeCandidates([...issuerCandidates, ...listingCandidates])
    .sort((a, b) => b.confidence - a.confidence);

  if (candidates.length === 1 && candidates[0].subject_ref.kind === "issuer") {
    const candidate = candidates[0];
    return resolved({
      subject_ref: candidate.subject_ref,
      display_name: candidate.display_name,
      confidence: candidate.confidence,
      canonical_kind: "issuer",
    });
  }

  return ambiguous({ candidates, ambiguity_axis: inferNameAmbiguityAxis(candidates) });
}

/**
 * A name no legal or former name equals, matched by the names a company goes
 * by (namesGoneBy), the most specific first. "Apple" is Apple Inc., never
 * Apple Hospitality REIT Inc, "Graham Holdings" is Graham Holdings Co, and
 * "Graham", which both Graham companies go by, asks which one. A SEC
 * registrant outranks issuers with no CIK that go by its name.
 */
export async function resolveByShortName(
  db: QueryExecutor,
  name: string,
): Promise<ResolverEnvelope> {
  const normalized = normalizeNameForLookup(name);
  const first = normalized.replace(/^the /, "").charAt(0);
  if (!first) return notFound({ normalized_input: normalized, reason: "no_candidates" });
  // ponytail: a sequential scan for the names with the input's first letter, 5.5 to 14 ms over 10k aliases under load; index normalized_name with text_pattern_ops if that grows tenfold.
  const result: QueryResult<IssuerRow & { cik: string | null; normalized_name: string }> = await db.query(
    `select iss.issuer_id, iss.legal_name, iss.cik, ia.normalized_name
       from issuer_aliases ia
       join issuers iss on iss.issuer_id = ia.issuer_id
      where starts_with(ia.normalized_name, $1) or starts_with(ia.normalized_name, 'the ' || $1)
      order by iss.legal_name, iss.issuer_id`,
    [first],
  );
  const aliases = result.rows.map((row) => ({ row, names: namesGoneBy(row.normalized_name, STORED_FORM) }));
  const goneBy = namesGoneBy(normalized, ASKED_FORM).map((level) => aliases.filter(({ names }) => names.includes(level))).find((found) => found.length > 0) ?? [];
  const matches = [...new Map(goneBy.map(({ row }) => [row.issuer_id, row])).values()];
  const registrants = matches.filter((row) => row.cik !== null);
  const candidates = (registrants.length > 0 ? registrants : matches).map((row) => ({
    subject_ref: { kind: "issuer" as const, id: row.issuer_id },
    display_name: row.legal_name,
    confidence: CONFIDENCE_NAME_SHORT,
    match_reason: "short_name",
  }));
  if (candidates.length === 0) return notFound({ normalized_input: normalized, reason: "no_candidates" });
  if (candidates.length === 1) return resolved({ ...candidates[0]!, canonical_kind: "issuer" });
  return ambiguous({ candidates, ambiguity_axis: "multiple_issuers" });
}

export async function resolveByCik(
  db: QueryExecutor,
  cik: string,
): Promise<ResolverEnvelope> {
  return resolveByIssuerIdentifier(db, {
    normalized: normalizeCik(cik.trim()),
    column: "cik",
    reason: "unknown_cik",
  });
}

export async function resolveByLei(
  db: QueryExecutor,
  lei: string,
): Promise<ResolverEnvelope> {
  return resolveByIssuerIdentifier(db, {
    normalized: lei.trim().toUpperCase(),
    column: "lei",
    reason: "unknown_lei",
  });
}

export async function resolveByIsin(
  db: QueryExecutor,
  isin: string,
): Promise<ResolverEnvelope> {
  const normalized = isin.trim().toUpperCase();
  const result: QueryResult<InstrumentRow> = await db.query(
    `select i.instrument_id, i.issuer_id, i.asset_type, i.share_class, iss.legal_name
       from instruments i
       join issuers iss on iss.issuer_id = i.issuer_id
      where upper(i.isin) = $1`,
    [normalized],
  );

  if (result.rows.length === 0) {
    return notFound({ normalized_input: normalized, reason: "unknown_isin" });
  }

  const row = result.rows[0];
  return resolved({
    subject_ref: { kind: "instrument", id: row.instrument_id },
    display_name: instrumentDisplayName(row),
    confidence: CONFIDENCE_UNIQUE_IDENTIFIER,
    canonical_kind: "instrument",
  });
}

// Resolve a CUSIP to a tracked issuer_id (not a ResolverEnvelope — callers want
// the id). Two deterministic phases — explicit cusip, then US-ISIN derivation
// (a US ISIN embeds the 9-char CUSIP) — and >1 distinct issuer in a phase is
// ambiguous → null rather than an arbitrary row (which would misattribute
// holdings). The canonical CUSIP resolver; evidence/src/cusip-issuer-map.ts holds
// a parallel copy pending cross-service consolidation (see fra-* follow-up).
export async function resolveIssuerByCusip(db: QueryExecutor, cusip: string): Promise<string | null> {
  const normalized = cusip.trim().toUpperCase();
  if (normalized.length !== 9) return null;

  const direct = await matchCusipIssuers(
    db,
    `select distinct issuer_id::text as issuer_id from instruments where upper(cusip) = $1 limit 2`,
    normalized,
  );
  if (direct.length > 1) return null; // ambiguous explicit match → don't guess
  if (direct.length === 1) return direct[0]!;

  const derived = await matchCusipIssuers(
    db,
    `select distinct issuer_id::text as issuer_id
       from instruments
      where upper(isin) like 'US%' and upper(substr(isin, 3, 9)) = $1
      limit 2`,
    normalized,
  );
  return derived.length === 1 ? derived[0]! : null; // none, or ambiguous → null
}

async function matchCusipIssuers(db: QueryExecutor, sql: string, cusip: string): Promise<string[]> {
  const { rows } = await db.query<{ issuer_id: string }>(sql, [cusip]);
  return rows.map((row) => row.issuer_id);
}

export async function resolveByTicker(
  db: QueryExecutor,
  ticker: string,
  opts: { mic?: string } = {},
): Promise<ResolverEnvelope> {
  const normalized = ticker.trim().toUpperCase();

  const base = `select l.listing_id, l.instrument_id, l.mic, l.ticker,
                       i.issuer_id, i.share_class, iss.legal_name
                  from listings l
                  join instruments i on i.instrument_id = l.instrument_id
                  join issuers iss on iss.issuer_id = i.issuer_id
                 where l.ticker = $1
                   and (l.active_from is null or l.active_from <= now())
                   and (l.active_to is null or l.active_to > now())`;

  let result: QueryResult<ListingRow>;
  if (opts.mic) {
    result = await db.query(`${base} and l.mic = $2 order by l.mic`, [
      normalized,
      opts.mic.toUpperCase(),
    ]);
  } else {
    result = await db.query(`${base} order by l.mic`, [normalized]);
  }

  if (result.rows.length === 0) {
    return notFound({ normalized_input: normalized, reason: "unknown_ticker" });
  }

  if (result.rows.length === 1) {
    const row = result.rows[0];
    return resolved({
      subject_ref: { kind: "listing", id: row.listing_id },
      display_name: listingDisplayName(row),
      confidence: CONFIDENCE_TICKER_SINGLE,
      canonical_kind: "listing",
    });
  }

  const candidates: ResolverCandidate[] = result.rows.map((row) => ({
    subject_ref: { kind: "listing", id: row.listing_id },
    display_name: listingDisplayName(row),
    display_labels: listingDisplayLabels(row),
    confidence: CONFIDENCE_TICKER_AMBIGUOUS,
    match_reason: "exact_ticker_match",
  }));

  const distinctIssuers = new Set(result.rows.map((row) => row.issuer_id));
  const axis = distinctIssuers.size > 1 ? "multiple_issuers" : "multiple_listings";

  return ambiguous({ candidates, ambiguity_axis: axis });
}

async function resolveByIssuerIdentifier(
  db: QueryExecutor,
  args: { normalized: string; column: "cik" | "lei"; reason: NotFoundReason },
): Promise<ResolverEnvelope> {
  // `column` is a typed literal, not user input, so the interpolation is safe.
  const result: QueryResult<IssuerRow> = await db.query(
    `select issuer_id, legal_name from issuers where upper(${args.column}) = $1`,
    [args.normalized],
  );

  if (result.rows.length === 0) {
    return notFound({ normalized_input: args.normalized, reason: args.reason });
  }

  const row = result.rows[0];
  return resolved({
    subject_ref: { kind: "issuer", id: row.issuer_id },
    display_name: row.legal_name,
    confidence: CONFIDENCE_UNIQUE_IDENTIFIER,
    canonical_kind: "issuer",
  });
}

function instrumentDisplayName(row: InstrumentRow): string {
  return row.share_class ? `${row.legal_name} (${row.share_class})` : row.legal_name;
}

function listingDisplayName(row: ListingRow): string {
  const base = row.share_class ? `${row.legal_name} (${row.share_class})` : row.legal_name;
  return `${row.ticker} · ${row.mic} — ${base}`;
}

function listingDisplayLabels(row: ListingRow): ResolverCandidate["display_labels"] {
  return stripUndefined({
    primary: listingDisplayName(row),
    legal_name: row.legal_name,
    ticker: row.ticker,
    mic: row.mic,
    share_class: row.share_class ?? undefined,
  });
}

async function listingCandidatesForAliasIssuers(
  db: QueryExecutor,
  issuerIds: string[],
): Promise<ResolverCandidate[]> {
  if (issuerIds.length === 0) return [];

  const result: QueryResult<ListingRow> = await db.query(
    `select l.listing_id, l.instrument_id, l.mic, l.ticker,
            i.issuer_id, i.share_class, iss.legal_name
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
      where i.issuer_id = any($1::uuid[])
        and (l.active_from is null or l.active_from <= now())
        and (l.active_to is null or l.active_to > now())
      order by iss.legal_name, l.mic, l.ticker`,
    [issuerIds],
  );

  return result.rows.map((row) => ({
    subject_ref: { kind: "listing", id: row.listing_id },
    display_name: listingDisplayName(row),
    display_labels: listingDisplayLabels(row),
    confidence: CONFIDENCE_NAME_ALIAS_LISTING,
    match_reason: "alias_related_listing",
  }));
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

function dedupeCandidates(candidates: ResolverCandidate[]): ResolverCandidate[] {
  const bySubject = new Map<string, ResolverCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.subject_ref.kind}:${candidate.subject_ref.id}`;
    const existing = bySubject.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      bySubject.set(key, candidate);
    }
  }
  return [...bySubject.values()];
}

function inferNameAmbiguityAxis(candidates: ResolverCandidate[]): AmbiguityAxis {
  const kinds = new Set(candidates.map((candidate) => candidate.subject_ref.kind));
  if (kinds.has("issuer") && kinds.has("listing")) return "issuer_vs_listing";
  if (kinds.size === 1 && kinds.has("issuer")) return "multiple_issuers";
  if (kinds.size === 1 && kinds.has("listing")) return "multiple_listings";
  if (kinds.size === 1 && kinds.has("instrument")) return "multiple_instruments";
  return "other";
}

export function normalizeNameForLookup(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LEGAL_FORMS: Readonly<Record<string, string>> = { corporation: "corp", company: "co", incorporated: "inc", limited: "ltd" };
const FORM = "(?:class|series) [a-z]|(?:common |capital |ordinary )?(?:stock|shares)|adrs?|ads|inc|corp|co|ltd|plc|llc|lp|sa|ag|nv|se|as|asa|spa|ab|oyj|na|bv|sab de cv";
// A legal form or a security names no other company, so a name sheds it
// either side. "Holdings" and "Group" can: a company goes by its name
// without them ("Graham" is Graham Holdings Co), but "Apple Holdings" is
// not Apple Inc.
const ASKED_FORM = new RegExp(` (?:${FORM})$`);
const STORED_FORM = new RegExp(` (?:${FORM}|holdings?|group|com)$`);

// ponytail: a brand that is no legal name ("Google", "AMD") stays unresolved; a sourced alias feed would cover it.
function namesGoneBy(normalized: string, form: RegExp): string[] {
  const joined = normalized.replace(/^the /, "").replace(/\b([a-z]) (?=[a-z]\b)/g, "$1");
  const names = [joined.split(" ").map((word) => LEGAL_FORMS[word] ?? word).join(" ")];
  while (form.test(names.at(-1)!)) names.push(names.at(-1)!.replace(form, ""));
  return names;
}

function dedupeIssuerNameRows(rows: IssuerNameRow[]): IssuerNameRow[] {
  const byIssuer = new Map<string, IssuerNameRow>();
  for (const row of rows) {
    const existing = byIssuer.get(row.issuer_id);
    if (!existing || (existing.match_reason !== "legal_name" && row.match_reason === "legal_name")) {
      byIssuer.set(row.issuer_id, row);
    }
  }
  return [...byIssuer.values()];
}
