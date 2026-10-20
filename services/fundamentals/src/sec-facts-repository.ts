import {
  createMetricRegistry,
  mapStatement,
  type MappedStatement,
  type MetricDefinition,
  type MetricRegistry,
} from "./metric-mapper.ts";
import {
  buildSecSource,
  fetchCompanyFacts,
  extractStatementWithTokens,
  SecEdgarFetchError,
  SEC_INCOME_METRIC_KEYS,
  SEC_METRIC_KEYS_BY_FAMILY,
  US_GAAP_TO_METRIC_KEY,
  secFiscalYearWindow,
  selectSecConceptValue,
  type ExtractStatementInput,
  type SecCompanyFacts,
  type SecCompanyFactsFetch,
  type SecEdgarFetcher,
  type SecDerivation,
  type SecFetchEvidence,
  type SecSourceToken,
} from "./sec-edgar.ts";
import { compareExactDecimals, parseFinancialDecimal } from "../../financial-core/src/exact-decimal.ts";
import { checkTokenAgainstStoredValue, recordFactPrecisionAttestation } from "../../evidence/src/financial-attestations.ts";
import { recordFactFinancialContext } from "../../evidence/src/financial-context.ts";
import { withPinnedTransaction, type TransactionalQueryExecutor } from "./pinned-transaction.ts";
import { recordSecFetchPublication, secAccessionVersionHash } from "./sec-publication-proof.ts";
import { recordSecFilingAcceptances, type SecFilingRef } from "./sec-acceptance.ts";
import { createHash } from "node:crypto";
import { factActiveSql, factKnownAtSql } from "../../evidence/src/fact-activity.ts";
import { FundamentalsDataUnavailableError } from "./availability.ts";
import {
  normalizedStatement,
  type CoverageLevel,
  type FiscalPeriod,
  type StatementFamily,
  type NormalizedStatement,
  type StatementLine,
  type PeriodKind,
} from "./statement.ts";
import type {
  StatementLookup,
  StatementRepository,
} from "./statement-repository.ts";
import {
  buildKeyStats,
  type KeyStatsEnvelope,
} from "./key-stats.ts";
import type { StatsRepository } from "./stats-repository.ts";
import type { UUID } from "./subject-ref.ts";

export type FundamentalsQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

export type FundamentalsTransactionalQueryExecutor = TransactionalQueryExecutor<FundamentalsQueryExecutor>;

export type SecBackedStatementRepositoryOptions = {
  fetcher?: SecEdgarFetcher | null;
  sourceId: UUID;
  // Snapshot cutoff: read only facts known by then (fact-activity.ts). Omit ⇒ now.
  cutoff?: string;
  clock?: () => Date;
  logger?: Pick<Console, "warn">;
};

export function createSecBackedStatementRepository(
  db: FundamentalsTransactionalQueryExecutor,
  options: SecBackedStatementRepositoryOptions,
): StatementRepository {
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? console;

  return {
    async find(lookup: StatementLookup): Promise<NormalizedStatement | null> {
      const existing = await loadStatementFromFacts(db, lookup, options.cutoff);
      if (existing) return existing.normalized;
      // A cutoff-scoped lookup never fetches live: whatever SEC returns now was
      // not known at the cutoff.
      if (options.cutoff !== undefined) return null;

      if (lookup.family !== "income" || lookup.basis !== "as_reported") {
        return null;
      }
      if (!options.fetcher) {
        return null;
      }
      return hydrateSecIssuer(db, {
        issuerId: lookup.issuer_id,
        fiscal_year: lookup.fiscal_year,
        fiscal_period: lookup.fiscal_period,
        fetcher: options.fetcher,
        sourceId: options.sourceId,
        clock,
        logger,
      });
    },
  };
}

// Null when the issuer has no usable CIK or SEC has no such statement (a 404,
// or no us-gaap values for it); any other failure throws
// FundamentalsDataUnavailableError.
export async function hydrateSecIssuer(
  db: FundamentalsTransactionalQueryExecutor,
  input: {
    issuerId: UUID;
    fiscal_year: number;
    fiscal_period: FiscalPeriod;
    fetcher: SecEdgarFetcher;
    sourceId: UUID;
    clock?: () => Date;
    logger?: Pick<Console, "warn">;
  },
): Promise<NormalizedStatement | null> {
  const logger = input.logger ?? console;
  const issuer = await loadIssuer(db, input.issuerId);
  if (!issuer?.cik) {
    return null;
  }

  const cikNumber = Number(issuer.cik);
  if (!Number.isInteger(cikNumber) || cikNumber <= 0) {
    return null;
  }

  try {
    const fetched = await fetchCompanyFacts(input.fetcher, cikNumber);
    const ingested = await ingestFiling(db, {
      fetched,
      cik: cikNumber,
      issuerId: input.issuerId,
      fiscal_year: input.fiscal_year,
      fiscal_period: input.fiscal_period,
      fallbackSourceId: input.sourceId,
      income: "require",
      clock: input.clock ?? (() => new Date()),
      logger,
    });
    await recordSecFilingAcceptances(db, input.fetcher, { cik: cikNumber, filings: ingested.filing ? [ingested.filing] : [], logger });
    return ingested.statement;
  } catch (error) {
    const unavailable = classifySecIngestionError(error);
    logger.warn("sec_edgar fundamentals ingestion failed", {
      issuer_id: input.issuerId,
      fiscal_year: input.fiscal_year,
      fiscal_period: input.fiscal_period,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!unavailable) return null;
    throw unavailable;
  }
}

// For every SEC income period already on file for an issuer, from one
// companyfacts download: stores the cash flow and balance sheet, and repairs
// the income statement. Those periods are otherwise read from facts and never
// fetched again, so this is how they gain the families ingested since, and how
// facts the old period selector got wrong (a 10-K's oldest comparative, a
// framed prior-year quarter) are replaced.
export async function backfillSecCompanionStatements(
  db: FundamentalsTransactionalQueryExecutor,
  input: {
    issuerId: UUID;
    fetcher: SecEdgarFetcher;
    sourceId: UUID;
    clock?: () => Date;
    logger?: Pick<Console, "warn">;
  },
): Promise<{ periods: number }> {
  const issuer = await loadIssuer(db, input.issuerId);
  const cik = Number(issuer?.cik);
  if (!Number.isInteger(cik) || cik <= 0) return { periods: 0 };
  const { rows } = await db.query<{ fiscal_year: number; fiscal_period: FiscalPeriod }>(
    `select distinct f.fiscal_year, f.fiscal_period::text as fiscal_period
       from facts f
       join metrics m on m.metric_id = f.metric_id
       join sources s on s.source_id = f.source_id
      where f.subject_kind = 'issuer'
        and f.subject_id = $1
        and f.method = 'reported'
        and f.period_kind in ('fiscal_q', 'fiscal_y')
        and s.provider = 'sec_edgar'
        and ${factActiveSql("f")}
        and m.metric_key = any($2::text[])
      order by f.fiscal_year, f.fiscal_period`,
    [input.issuerId, SEC_INCOME_METRIC_KEYS],
  );
  if (rows.length === 0) return { periods: 0 };
  const fetched = await fetchCompanyFacts(input.fetcher, cik);
  const filings: SecFilingRef[] = [];
  for (const period of rows) {
    const { filing } = await ingestFiling(db, {
      fetched,
      cik,
      issuerId: input.issuerId,
      fiscal_year: period.fiscal_year,
      fiscal_period: period.fiscal_period,
      fallbackSourceId: input.sourceId,
      income: "repair",
      clock: input.clock ?? (() => new Date()),
      logger: input.logger ?? console,
    });
    if (filing) filings.push(filing);
  }
  await recordSecFilingAcceptances(db, input.fetcher, { cik, filings, logger: input.logger ?? console });
  return { periods: rows.length };
}

type Extracted = {
  statement: NormalizedStatement;
  tokens: ReadonlyMap<string, SecSourceToken>;
  derivations: ReadonlyMap<string, SecDerivation>;
};

// Stores one filing's statements for a fiscal period from a companyfacts
// download, in one transaction: the income statement, and the same filing's
// cash flow and balance sheet beside it. Income is "require" (a lookup: it must
// extract) or "repair" (a backfill: stored income facts that differ from the
// filing are replaced; a period it cannot extract is left as it is). Returns
// the income statement, or null without it, and the accession filing it stored
// facts on. Every period of one download is dated by that download's
// completion, never by when it was processed.
async function ingestFiling(
  db: FundamentalsTransactionalQueryExecutor,
  input: {
    fetched: SecCompanyFactsFetch;
    cik: number;
    issuerId: UUID;
    fiscal_year: number;
    fiscal_period: FiscalPeriod;
    fallbackSourceId: UUID;
    income: "require" | "repair";
    clock: () => Date;
    logger: Pick<Console, "warn">;
  },
): Promise<{ statement: NormalizedStatement | null; filing: SecFilingRef | null }> {
  const asOf = input.fetched.evidence.completed_at;
  const accessionNumber = statementAccession(input.fetched.facts, input.fiscal_year, input.fiscal_period);
  const sourceId = accessionNumber
    ? await upsertSecFilingSource(db, { cik: input.cik, accessionNumber, retrievedAt: asOf })
    : input.fallbackSourceId;
  const target = {
    subject: { kind: "issuer", id: input.issuerId },
    facts: input.fetched.facts,
    fiscal_year: input.fiscal_year,
    fiscal_period: input.fiscal_period,
    accession_number: accessionNumber ?? undefined,
    source_id: sourceId,
    as_of: asOf,
  } as const;
  const income: Extracted | null = input.income === "require"
    ? extracted(extractStatementWithTokens({ ...target, family: "income" }))
    : statementsOf(target, ["income"], input.logger)[0] ?? null;
  const companions = statementsOf(target, COMPANION_FAMILIES, input.logger);
  const registry = await loadMetricRegistry(
    db,
    [...(income ? [income] : []), ...companions].flatMap((entry) => entry.statement.lines.map((line) => line.metric_key)),
  );
  const mapped = [
    ...(income ? [{ ...income, mapped: mapStatement(registry, income.statement) }] : []),
    ...mapCompanions(registry, companions, target, input.logger),
  ];
  if (mapped.length === 0) return { statement: income?.statement ?? null, filing: null };
  await withPinnedTransaction(db, async (client) => {
    // The repair retires stored income facts the filing contradicts, then
    // stores the filing's in their place (the active identity is unique).
    const stale = input.income === "repair" && income
      ? await staleStatementFacts(client, input.issuerId, income)
      : new Map<string, string[]>();
    if (stale.size > 0) {
      await client.query(
        `update facts set invalidated_at = now(), updated_at = now() where fact_id = any($1::uuid[])`,
        [[...stale.values()].flat()],
      );
    }
    for (const entry of mapped) {
      const inserted = await persistStatementFacts(client, entry.mapped, input.clock, {
        cik: input.cik,
        tokens: entry.tokens,
        derivations: entry.derivations,
        retrievedAt: asOf,
      });
      if (entry.statement !== income?.statement) continue;
      for (const [metricKey, oldIds] of stale) {
        const newId = inserted.get(metricKey);
        if (newId) {
          await client.query(`update facts set superseded_by = $2, updated_at = now() where fact_id = any($1::uuid[])`, [oldIds, newId]);
        }
      }
    }
    await recordSecRestatements(client, {
      facts: input.fetched.facts,
      cik: input.cik,
      issuerId: input.issuerId,
      evidence: input.fetched.evidence,
      clock: input.clock,
    });
    if (accessionNumber) {
      await recordSecFetchPublication(client, { sourceId, accessionNumber, evidence: input.fetched.evidence });
    }
  });
  return { statement: income?.statement ?? null, filing: accessionNumber ? { sourceId, accessionNumber } : null };
}

// The stored, active SEC facts for a statement's period that the filing
// contradicts, their ids by metric_key: a metric the statement has, with another value
// or dates; or one of its family the statement lacks, dated for another
// period (the old selector's comparative, with nothing to replace it). A value
// is compared with its token as a precision proof compares them, since one
// stored from a JS number may round it.
async function staleStatementFacts(
  db: FundamentalsQueryExecutor,
  issuerId: UUID,
  { statement, tokens }: Extracted,
): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{
    fact_id: string;
    metric_key: string;
    stored_value: string | null;
    period_start: string | null;
    period_end: string;
  }>(
    // Dates as text: pg reads a date column as a local-time Date, which can
    // shift a day when written back as ISO.
    `select f.fact_id::text as fact_id, m.metric_key, f.value_num::text as stored_value,
            f.period_start::text as period_start, f.period_end::text as period_end
       from facts f
       join metrics m on m.metric_id = f.metric_id
       join sources s on s.source_id = f.source_id
      where f.subject_kind = 'issuer'
        and f.subject_id = $1
        and f.period_kind = $2
        and f.fiscal_year = $3
        and f.fiscal_period = $4
        and f.method = 'reported'
        and s.provider = 'sec_edgar'
        and ${factActiveSql("f")}
        and m.metric_key = any($5::text[])`,
    [issuerId, statement.period_kind, statement.fiscal_year, statement.fiscal_period, SEC_METRIC_KEYS_BY_FAMILY[statement.family]],
  );
  // A metric can have rows from several filings: every contradicted one goes.
  const stale = new Map<string, string[]>();
  for (const row of rows) {
    const line = statement.lines.find((candidate) => candidate.metric_key === row.metric_key);
    const otherDates = row.period_start !== statement.period_start || row.period_end !== statement.period_end;
    const token = tokens.get(row.metric_key);
    const otherValue = token
      ? checkTokenAgainstStoredValue(token.token, row.stored_value).status !== "match"
      : (row.stored_value === null ? null : Number(row.stored_value)) !== line?.value_num;
    const contradicted = otherDates || (line !== undefined && otherValue);
    if (contradicted) stale.set(row.metric_key, [...(stale.get(row.metric_key) ?? []), row.fact_id]);
  }
  return stale;
}

function extracted(result: ReturnType<typeof extractStatementWithTokens>): Extracted {
  return { statement: normalizedStatement(result.statement), tokens: result.tokens, derivations: result.derivations };
}

// The statements of these families for the filing being ingested. A filer that
// tags none of a family's concepts has no such statement; any other failure
// (concepts disagreeing on the period, a second currency) is logged and costs
// only that family, never the statement a lookup asked for.
function statementsOf(
  target: Omit<ExtractStatementInput, "family">,
  families: ReadonlyArray<StatementFamily>,
  logger: Pick<Console, "warn">,
): Extracted[] {
  return families.flatMap((family) => {
    try {
      return [extracted(extractStatementWithTokens({ ...target, family }))];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isMissingCoverage(message)) {
        logger.warn("sec_edgar statement extraction failed", {
          issuer_id: target.subject.id,
          family,
          fiscal_year: target.fiscal_year,
          fiscal_period: target.fiscal_period,
          error: message,
        });
      }
      return [];
    }
  });
}

const COMPANION_FAMILIES = ["cashflow", "balance"] as const;

// A companion whose metrics the registry lacks is logged and left out, like
// a failed extraction, so it cannot cost the income statement either.
function mapCompanions(
  registry: MetricRegistry,
  companions: ReadonlyArray<Extracted>,
  target: Omit<ExtractStatementInput, "family">,
  logger: Pick<Console, "warn">,
): Array<Extracted & { mapped: MappedStatement }> {
  return companions.flatMap((entry) => {
    try {
      return [{ ...entry, mapped: mapStatement(registry, entry.statement) }];
    } catch (error) {
      logger.warn("sec_edgar statement mapping failed", {
        issuer_id: target.subject.id,
        family: entry.statement.family,
        fiscal_year: target.fiscal_year,
        fiscal_period: target.fiscal_period,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });
}

function isMissingCoverage(message: string): boolean {
  return message.includes("no us-gaap values") ||
    message.includes('has no "us-gaap" taxonomy') ||
    message.includes("no monetary lines extracted");
}

async function upsertSecFilingSource(
  db: FundamentalsQueryExecutor,
  input: {
    cik: number;
    accessionNumber: string;
    retrievedAt: string;
  },
): Promise<UUID> {
  const source = buildSecSource({
    source_id: sourceIdForAccession(input.accessionNumber),
    cik: input.cik,
    accession_number: input.accessionNumber,
    retrieved_at: input.retrievedAt,
    content_hash: secAccessionVersionHash(input.accessionNumber),
  });
  // The accession is the source version: a re-ingest refreshes retrieved_at
  // but never rewrites the hash that publication proofs are bound to.
  const result = await db.query<{ source_id: string }>(
    `insert into sources
       (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at, content_hash)
     values ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz, $8)
     on conflict (source_id)
     do update set canonical_url = excluded.canonical_url,
                   retrieved_at = excluded.retrieved_at
             where sources.content_hash is not distinct from excluded.content_hash
     returning source_id::text as source_id`,
    [
      source.source_id,
      source.provider,
      source.kind,
      source.canonical_url,
      source.trust_tier,
      source.license_class,
      source.retrieved_at,
      source.content_hash,
    ],
  );
  const stored = result.rows[0]?.source_id;
  if (stored === undefined) {
    throw new Error(`sec_edgar source ${source.source_id} for accession ${input.accessionNumber} has another content_hash; a source version never changes`);
  }
  return stored as UUID;
}

function sourceIdForAccession(accessionNumber: string): UUID {
  const hash = createHash("sha256").update(accessionNumber).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const hex = hash.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}` as UUID;
}

function statementAccession(
  facts: SecCompanyFacts,
  fiscalYear: number,
  fiscalPeriod: FiscalPeriod,
): string | null {
  const counts = new Map<string, number>();
  const usGaap = facts.facts["us-gaap"];
  if (!usGaap) return null;
  const fiscalWindow = secFiscalYearWindow(facts, fiscalYear);
  for (const [conceptName, metricKey] of Object.entries(US_GAAP_TO_METRIC_KEY)) {
    if (!SEC_INCOME_METRIC_KEYS.includes(metricKey)) continue;
    const concept = usGaap[conceptName];
    if (!concept) continue;
    for (const [unitCode, values] of Object.entries(concept.units)) {
      const match = selectSecConceptValue(values, {
        fiscal_year: fiscalYear,
        fiscal_period: fiscalPeriod,
        fiscal_window: fiscalWindow,
      }, unitCode);
      if (!match) continue;
      counts.set(match.accn, (counts.get(match.accn) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export type SecBackedStatsRepositoryOptions = {
  statements: StatementRepository;
  // Snapshot cutoff for the latest-year lookup (pass the same to `statements`).
  cutoff?: string;
  // The fiscal year to load (a question that names one, #180); default the latest.
  fiscalYear?: number;
  fetcher?: SecEdgarFetcher | null;
  clock?: () => Date;
  logger?: Pick<Console, "warn">;
};

export function createSecBackedStatsRepository(
  db: FundamentalsQueryExecutor,
  options: SecBackedStatsRepositoryOptions,
): StatsRepository {
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? console;

  return {
    async find(issuer_id: UUID): Promise<KeyStatsEnvelope | null> {
      const year = (options.fiscalYear === undefined ? null : { fiscal_year: options.fiscalYear })
        ?? await loadLatestFiscalYear(db, issuer_id, options.cutoff)
        // A cutoff-scoped lookup never discovers live (see the statement repository).
        ?? (options.cutoff === undefined
          ? await discoverLatestFiscalYear(db, issuer_id, options.fetcher ?? null, logger)
          : null);
      if (!year) return null;

      const current = await options.statements.find({
        issuer_id,
        family: "income",
        basis: "as_reported",
        fiscal_year: year.fiscal_year,
        fiscal_period: "FY",
      });
      if (!current) return null;

      const prior = await options.statements.find({
        issuer_id,
        family: "income",
        basis: "as_reported",
        fiscal_year: year.fiscal_year - 1,
        fiscal_period: "FY",
      });
      const registry = await loadMetricRegistry(
        db,
        Array.from(new Set([
          ...current.lines.map((line) => line.metric_key),
          ...(prior?.lines.map((line) => line.metric_key) ?? []),
        ])),
      );

      return buildKeyStats({
        statement: mapStatement(registry, current),
        prior_statement: prior ? mapStatement(registry, prior) : undefined,
        freshness_policy: { as_of: clock().toISOString() },
      });
    },
  };
}

async function discoverLatestFiscalYear(
  db: FundamentalsQueryExecutor,
  issuerId: UUID,
  fetcher: SecEdgarFetcher | null,
  logger: Pick<Console, "warn">,
): Promise<{ fiscal_year: number } | null> {
  if (!fetcher) return null;
  const issuer = await loadIssuer(db, issuerId);
  if (!issuer?.cik) return null;
  const cikNumber = Number(issuer.cik);
  if (!Number.isInteger(cikNumber) || cikNumber <= 0) return null;

  try {
    const { facts } = await fetchCompanyFacts(fetcher, cikNumber);
    const fiscalYear = latestAnnualRevenueYear(facts);
    return fiscalYear === null ? null : { fiscal_year: fiscalYear };
  } catch (error) {
    const unavailable = classifySecIngestionError(error);
    logger.warn("sec_edgar latest fiscal year lookup failed", {
      issuer_id: issuerId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!unavailable) return null;
    throw unavailable;
  }
}

function latestAnnualRevenueYear(facts: SecCompanyFacts): number | null {
  const usGaap = facts.facts["us-gaap"];
  if (!usGaap) return null;
  let latest: number | null = null;
  for (const [conceptName, metricKey] of Object.entries(US_GAAP_TO_METRIC_KEY)) {
    if (metricKey !== "revenue") continue;
    const concept = usGaap[conceptName];
    if (!concept) continue;
    for (const values of Object.values(concept.units)) {
      for (const value of values) {
        if (value.fp !== "FY" || value.form !== "10-K") continue;
        latest = latest === null ? value.fy : Math.max(latest, value.fy);
      }
    }
  }
  return latest;
}

function classifySecIngestionError(error: unknown): FundamentalsDataUnavailableError | null {
  if (error instanceof FundamentalsDataUnavailableError) return error;

  if (error instanceof SecEdgarFetchError) {
    if (error.status === 404) return null;
    if (error.status === 429) {
      return new FundamentalsDataUnavailableError("rate_limited", error.message, true);
    }
    return new FundamentalsDataUnavailableError(
      "provider_error",
      error.message,
      error.status >= 500,
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  if (isMissingCoverage(message)) {
    return null;
  }

  return new FundamentalsDataUnavailableError("provider_error", message, false);
}

type IssuerRow = {
  issuer_id: string;
  cik: string | null;
};

async function loadIssuer(
  db: FundamentalsQueryExecutor,
  issuerId: UUID,
): Promise<IssuerRow | null> {
  const result = await db.query<IssuerRow>(
    `select issuer_id::text as issuer_id, cik
       from issuers
      where issuer_id = $1`,
    [issuerId],
  );
  return result.rows[0] ?? null;
}

async function loadMetricRegistry(
  db: FundamentalsQueryExecutor,
  metricKeys: ReadonlyArray<string>,
): Promise<MetricRegistry> {
  const uniqueKeys = Array.from(new Set(metricKeys));
  const result = await db.query<MetricDefinition>(
    `select metric_id::text as metric_id,
            metric_key,
            display_name,
            unit_class,
            aggregation,
            interpretation,
            canonical_source_class,
            definition_version,
            notes
       from metrics
      where metric_key = any($1::text[])`,
    [uniqueKeys],
  );
  return createMetricRegistry(result.rows);
}

type StatementFactRow = {
  fact_id: string;
  metric_key: string;
  metric_id: string;
  period_kind: PeriodKind;
  period_start: Date | string | null;
  period_end: Date | string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  value_num: string | number | null;
  value_text: string | null;
  unit: string;
  currency: string | null;
  scale: string | number;
  as_of: Date | string;
  reported_at: Date | string | null;
  source_id: string;
  coverage_level: CoverageLevel;
};

async function loadStatementFromFacts(
  db: FundamentalsQueryExecutor,
  lookup: StatementLookup,
  cutoff?: string,
): Promise<{ normalized: NormalizedStatement; mapped: MappedStatement } | null> {
  if (lookup.family !== "income" || lookup.basis !== "as_reported") {
    return null;
  }

  const periodKind = periodKindFor(lookup.fiscal_period);
  const result = await db.query<StatementFactRow>(
    `select distinct on (m.metric_key)
            f.fact_id::text as fact_id,
            m.metric_key,
            f.metric_id::text as metric_id,
            f.period_kind::text as period_kind,
            f.period_start,
            f.period_end,
            f.fiscal_year,
            f.fiscal_period,
            f.value_num,
            f.value_text,
            f.unit,
            f.currency,
            f.scale,
            f.as_of,
            f.reported_at,
            f.source_id::text as source_id,
            f.coverage_level
       from facts f
       join metrics m on m.metric_id = f.metric_id
      where f.subject_kind = 'issuer'
        and f.subject_id = $1
        and f.period_kind = $2
        and f.fiscal_year = $3
        and f.fiscal_period = $4
        and f.method = 'reported'
        and ${cutoff === undefined ? factActiveSql("f") : factKnownAtSql("f", "$6::timestamptz")}
        and m.metric_key = any($5::text[])
      order by m.metric_key, f.as_of desc, f.created_at desc`,
    [lookup.issuer_id, periodKind, lookup.fiscal_year, lookup.fiscal_period, SEC_INCOME_METRIC_KEYS, ...(cutoff === undefined ? [] : [cutoff])],
  );
  if (result.rows.length === 0) return null;

  const lines = result.rows.map(lineFromFactRow);
  const reportingCurrency = firstCurrency(lines);
  if (!reportingCurrency) return null;

  const base = result.rows[0];
  const normalized = normalizedStatement({
    subject: { kind: "issuer", id: lookup.issuer_id },
    family: "income",
    basis: "as_reported",
    period_kind: periodKind,
    period_start: dateString(base.period_start),
    period_end: dateString(base.period_end) ?? "",
    fiscal_year: lookup.fiscal_year,
    fiscal_period: lookup.fiscal_period,
    reporting_currency: reportingCurrency,
    as_of: isoString(base.as_of),
    reported_at: base.reported_at ? isoString(base.reported_at) : null,
    source_id: base.source_id,
    lines,
  });

  const registry = createMetricRegistry(result.rows.map((row) => ({
    metric_id: row.metric_id,
    metric_key: row.metric_key,
    display_name: row.metric_key,
    unit_class: unitClassFor(row.unit),
    aggregation: row.metric_key.includes("eps") ? "point_in_time" : "sum",
    interpretation: "neutral",
    canonical_source_class: "gaap",
    definition_version: 1,
    notes: null,
  })));
  return { normalized, mapped: mapStatement(registry, normalized) };
}

function lineFromFactRow(row: StatementFactRow): StatementLine {
  const out: StatementLine = {
    metric_key: row.metric_key,
    value_num: row.value_num === null ? null : Number(row.value_num),
    unit: row.unit,
    scale: Number(row.scale),
    coverage_level: row.coverage_level,
    // Lineage anchor: this line was loaded from a persisted fact, so carry its
    // id forward for derived-fact provenance (key-stat input refs).
    fact_id: row.fact_id,
  };
  if (row.value_text !== null) out.value_text = row.value_text;
  if (row.currency !== null) out.currency = row.currency;
  return out;
}

function firstCurrency(lines: ReadonlyArray<StatementLine>): string | null {
  for (const line of lines) {
    if (line.currency) return line.currency;
  }
  return null;
}

// Lines taken verbatim from a losslessly parsed response are written from
// their exact source token (Postgres numeric parses it without loss) and
// receive a source_token_preserved precision attestation in the same
// transaction, so a fact never lands without its proof. Lines without a token
// (legacy fixtures, derived fourth quarters) keep the legacy number and get no
// precision proof, so strict financial binding treats them as gaps. A line
// that conflicts with a stored fact whose value and dates equal its token,
// and whose precision is unproven, revalidates that fact. Each token's fact,
// inserted or already stored, gets its financial context when
// recordSecOriginalContext certifies it.
async function persistStatementFacts(
  db: FundamentalsQueryExecutor,
  statement: MappedStatement,
  clock: () => Date,
  provenance: {
    cik: number;
    tokens: ReadonlyMap<string, SecSourceToken>;
    derivations?: ReadonlyMap<string, SecDerivation>;
    retrievedAt?: string;
  },
): Promise<Map<string, string>> {
  // The facts this call inserted, by metric_key (a conflicting line inserts none).
  const insertedIds = new Map<string, string>();
  for (const line of statement.lines) {
    const token = provenance.tokens.get(line.metric_key);
    const derivation = provenance.derivations?.get(line.metric_key);
    const qualityFlags = derivation
      ? [await derivationLineage(db, derivation, provenance.cik, provenance.retrievedAt ?? clock().toISOString())]
      : [];
    const inserted = await db.query<{ fact_id: string }>(
      `insert into facts (
         subject_kind, subject_id, metric_id, period_kind, period_start,
         period_end, fiscal_year, fiscal_period, value_num, value_text,
         unit, currency, scale, as_of, reported_at, observed_at, source_id,
         method, definition_version, verification_status, freshness_class,
         coverage_level, confidence, quality_flags
       ) values (
         'issuer', $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15, $16,
         'reported', 1, 'authoritative', 'filing_time', $17, 1, $18::jsonb
       )
       on conflict do nothing
       returning fact_id::text as fact_id`,
      [
        statement.subject.id,
        line.metric_id,
        statement.period_kind,
        statement.period_start,
        statement.period_end,
        statement.fiscal_year,
        statement.fiscal_period,
        token?.token ?? line.value_num,
        line.value_text ?? null,
        line.unit,
        line.currency ?? null,
        line.scale,
        statement.as_of,
        statement.reported_at,
        clock().toISOString(),
        statement.source_id,
        line.coverage_level,
        JSON.stringify(qualityFlags),
      ],
    );
    const factId = inserted.rows[0]?.fact_id;
    if (factId) insertedIds.set(line.metric_key, factId);
    if (!token) continue;
    const storedId = factId ?? await lockStoredTokenFact(db, statement, line, token);
    if (!storedId) continue;
    const locator = `sec_edgar:companyfacts:CIK${String(provenance.cik).padStart(10, "0")}#${token.concept}|${token.unit}|${token.accn}|${token.start ?? ""}..${token.end}`;
    if (factId || !(await hasProvenPrecision(db, storedId))) {
      await recordFactPrecisionAttestation(db, {
        fact_id: storedId,
        precision_class: factId ? "source_token_preserved" : "revalidated_against_source",
        raw_token: token.token,
        token_proof_hash: secTokenProofHash(provenance.cik, token),
        source_locator: locator,
        validation_method: "sec_companyfacts_lossless_json.v1",
      });
    }
    await recordSecOriginalContext(db, storedId, line, token, locator);
  }
  return insertedIds;
}

// The caller reads the fact's proof in a later statement, which sees a proof
// a concurrent ingestion committed while this lock waited.
async function lockStoredTokenFact(
  db: FundamentalsQueryExecutor,
  statement: MappedStatement,
  line: MappedStatement["lines"][number],
  token: SecSourceToken,
): Promise<string | null> {
  const { rows } = await db.query<{ fact_id: string }>(
    `select f.fact_id::text as fact_id
       from facts f
      where f.subject_kind = 'issuer' and f.subject_id = $1 and f.metric_id = $2 and f.period_kind = $3
        and f.fiscal_year = $4 and f.fiscal_period = $5 and f.source_id = $6 and f.method = 'reported'
        and ${factActiveSql("f")}
        and f.period_start is not distinct from $7::date and f.period_end = $8::date and f.value_num = $9::numeric
      for update`,
    [
      statement.subject.id,
      line.metric_id,
      statement.period_kind,
      statement.fiscal_year,
      statement.fiscal_period,
      statement.source_id,
      statement.period_start,
      statement.period_end,
      token.token,
    ],
  );
  return rows[0]?.fact_id ?? null;
}

async function hasProvenPrecision(db: FundamentalsQueryExecutor, factId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from current_fact_precision_attestations where fact_id = $1 and precision_class <> 'legacy_unverified'`,
    [factId],
  );
  return rows.length > 0;
}

// A split before a filing is issued restates its per-share values and share
// counts, its own period's included, and companyfacts does not say whether
// one did: their adjustment basis is unknown, so they get no context.
const SEC_SHARE_METRIC_KEYS: ReadonlySet<string> = new Set([
  "eps_basic",
  "eps_diluted",
  "shares_outstanding_basic",
  "shares_outstanding_diluted",
]);

const SEC_CONTEXT_VERSION = "sec_companyfacts_context.v1";

// A metric mapped from several concepts is certified only from the reviewed
// one: capex v1 is cash paid for PP&E, and PaymentsToAcquireProductiveAssets
// (which some filers tag instead) adds purchased intangibles. OCF is the total,
// matching capex's scope; the continuing-operations line leaves out
// discontinued operations. Facts from the other concepts stay readable in
// statements but get no context.
const SEC_CERTIFIED_CONCEPTS: Readonly<Record<string, string>> = {
  capex: "PaymentsToAcquirePropertyPlantAndEquipment",
  operating_cash_flow: "NetCashProvidedByUsedInOperatingActivities",
};

// Selection takes every token from the filing whose own period it is, never
// from a later filing's comparative, so the stored fact is that filing's
// original disclosure. Companyfacts carries only undimensioned values, which
// are consolidated.
async function recordSecOriginalContext(
  db: FundamentalsQueryExecutor,
  tokenFactId: string,
  line: MappedStatement["lines"][number],
  token: SecSourceToken,
  locator: string,
): Promise<void> {
  if (SEC_SHARE_METRIC_KEYS.has(line.metric_key)) return;
  // The statement contract labels every balance FY of its fiscal year, so a
  // certified 10-Q balance would be read as the year's closing one.
  if (token.start === null && token.form !== "10-K") return;
  const certifiedConcept = SEC_CERTIFIED_CONCEPTS[line.metric_key];
  if (certifiedConcept !== undefined && token.concept !== certifiedConcept) return;
  const existing = await db.query(`select 1 from fact_financial_contexts where fact_id = $1`, [tokenFactId]);
  if (existing.rows.length > 0) return;
  await recordFactFinancialContext(db, {
    fact_id: tokenFactId,
    context_version: SEC_CONTEXT_VERSION,
    period_type: token.start === null ? "instant" : "duration",
    dimension_scope: "consolidated",
    dimension_members: [],
    reporting_basis: "as_reported",
    adjustment_basis: "unadjusted",
    share_basis: "not_applicable",
    fiscal_calendar_version: "sec_filer_fiscal_year.v1",
    disclosure_relation: "original",
    source_context_ref: locator,
  });
}

// A discrete quarter computed from filed values (a cash flow year to date less
// the previous one, a year less three quarters) usually spans filings: the
// fact's source is the statement's filing, and its lineage names every input
// with its own filing source, so a reader can cite each one.
export const SEC_DERIVATION_KIND = "sec_period_difference";

async function derivationLineage(
  db: FundamentalsQueryExecutor,
  derivation: SecDerivation,
  cik: number,
  retrievedAt: string,
): Promise<Record<string, unknown>> {
  const sources = new Map<string, UUID>();
  for (const accn of new Set(derivation.inputs.map((input) => input.accn))) {
    sources.set(accn, await upsertSecFilingSource(db, { cik, accessionNumber: accn, retrievedAt }));
  }
  return {
    kind: SEC_DERIVATION_KIND,
    concept: derivation.concept,
    unit: derivation.unit,
    input_source_ids: [...new Set(sources.values())],
    inputs: derivation.inputs.map((input) => ({ ...input, source_id: sources.get(input.accn)! })),
  };
}

// A 10-K repeats the two prior years beside its own (#321). Every stored
// original FY disclosure of the issuer is compared with each later 10-K in the
// download that gives the same concept, unit and dates, in filing order: a
// value that differs from the previous filing's is stored as that year's
// restatement, on the restating filing's source, naming the original. A
// companyfacts download lists every filing, so the stored history does not
// depend on which year was ingested first (#333), and repeating a restated
// value adds nothing. A filing giving two different values, or a value without
// its lossless token, is skipped; an original with no recorded concept is left
// as it is. A restated fact's method keeps it out of every as-reported reader.
async function recordSecRestatements(
  db: FundamentalsQueryExecutor,
  input: {
    facts: SecCompanyFacts;
    cik: number;
    issuerId: UUID;
    evidence: SecFetchEvidence;
    clock: () => Date;
  },
): Promise<void> {
  const { rows: originals } = await db.query<{
    fact_id: string;
    metric_id: string;
    period_kind: string;
    period_start: string | null;
    period_end: string;
    fiscal_year: number;
    value: string;
    unit: string;
    currency: string | null;
    scale: string;
    source_context_ref: string | null;
  }>(
    `select f.fact_id::text as fact_id, f.metric_id::text as metric_id, f.period_kind::text as period_kind,
            f.period_start::text as period_start, f.period_end::text as period_end, f.fiscal_year,
            f.value_num::text as value, f.unit, f.currency, f.scale::text as scale, c.source_context_ref
       from facts f
       join fact_financial_contexts c on c.fact_id = f.fact_id
      where f.subject_kind = 'issuer' and f.subject_id = $1 and f.method = 'reported' and f.fiscal_period = 'FY'
        and ${factActiveSql("f")}
        and c.context_version = $2 and c.disclosure_relation = 'original'`,
    [input.issuerId, SEC_CONTEXT_VERSION],
  );
  const usGaap = input.facts.facts["us-gaap"] ?? {};
  const sources = new Map<string, UUID>();
  const published = new Set<string>();
  for (const original of originals) {
    const located = /#([^|]+)\|([^|]+)\|([^|]+)\|/u.exec(original.source_context_ref ?? "");
    if (!located) continue;
    const [, concept, unit, originalAccession] = located;
    const byFiling = new Map<string, { filed: string; tokens: Set<string | null> }>();
    for (const value of usGaap[concept!]?.units?.[unit!] ?? []) {
      if (value.accn === originalAccession || value.form !== "10-K" || (value.start ?? null) !== original.period_start || value.end !== original.period_end) continue;
      const filing = byFiling.get(value.accn) ?? { filed: value.filed, tokens: new Set() };
      filing.tokens.add(value.val_token ?? null);
      byFiling.set(value.accn, filing);
    }
    const filings = [...byFiling].sort(([leftAccn, left], [rightAccn, right]) => left.filed.localeCompare(right.filed) || leftAccn.localeCompare(rightAccn));
    let previous = original.value;
    for (const [accessionNumber, { filed, tokens }] of filings) {
      const [presented, ...others] = tokens;
      if (others.length > 0 || presented === null || presented === undefined) continue;
      const unchanged = sameDecimal(presented, previous);
      previous = presented;
      if (unchanged !== false) continue;
      const asOf = input.evidence.completed_at;
      let sourceId = sources.get(accessionNumber);
      if (sourceId === undefined) {
        sourceId = await upsertSecFilingSource(db, { cik: input.cik, accessionNumber, retrievedAt: asOf });
        sources.set(accessionNumber, sourceId);
      }
      const token: SecSourceToken = { token: presented, concept: concept!, unit: unit!, accn: accessionNumber, form: "10-K", start: original.period_start, end: original.period_end };
      const inserted = await db.query<{ fact_id: string }>(
        `insert into facts (
           subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
           value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, definition_version,
           verification_status, freshness_class, coverage_level, confidence, supersedes
         ) values (
           'issuer', $1, $2, $3, $4, $5, $6, 'FY', $7, $8, $9, $10, $11, $15, $12, $13, 'restated', 1,
           'authoritative', 'filing_time', 'full', 1, $14
         )
         on conflict do nothing
         returning fact_id::text as fact_id`,
        [
          input.issuerId, original.metric_id, original.period_kind, original.period_start, original.period_end, original.fiscal_year,
          token.token, original.unit, original.currency, original.scale, asOf, input.clock().toISOString(), sourceId, original.fact_id,
          filed,
        ],
      );
      // The restating filing need not be the one this ingest is for; this
      // download listing it proves it was public by the download's completion,
      // and an earlier download may be the tighter proof of a row already stored.
      if (!published.has(accessionNumber)) {
        await recordSecFetchPublication(db, { sourceId, accessionNumber, evidence: input.evidence });
        published.add(accessionNumber);
      }
      const factId = inserted.rows[0]?.fact_id;
      if (!factId) continue;
      const locator = `sec_edgar:companyfacts:CIK${String(input.cik).padStart(10, "0")}#${token.concept}|${token.unit}|${token.accn}|${token.start ?? ""}..${token.end}`;
      await recordFactPrecisionAttestation(db, {
        fact_id: factId,
        precision_class: "source_token_preserved",
        raw_token: token.token,
        token_proof_hash: secTokenProofHash(input.cik, token),
        source_locator: locator,
        validation_method: "sec_companyfacts_lossless_json.v1",
      });
      await recordFactFinancialContext(db, {
        fact_id: factId,
        context_version: SEC_CONTEXT_VERSION,
        period_type: original.period_start === null ? "instant" : "duration",
        dimension_scope: "consolidated",
        dimension_members: [],
        reporting_basis: "as_restated",
        adjustment_basis: "unadjusted",
        share_basis: "not_applicable",
        fiscal_calendar_version: "sec_filer_fiscal_year.v1",
        disclosure_relation: "economic_restatement",
        source_context_ref: locator,
      });
    }
  }
}

/** Numeric equality of two decimal texts, or null when either is not one. */
function sameDecimal(left: string, right: string): boolean | null {
  const a = parseFinancialDecimal(left);
  const b = parseFinancialDecimal(right);
  return a.ok && b.ok ? compareExactDecimals(a.value, b.value) === 0 : null;
}

/** Binds the exact token to its location in the SEC response. */
function secTokenProofHash(cik: number, token: SecSourceToken): string {
  return createHash("sha256")
    .update(JSON.stringify(["sec_edgar_companyfacts.v1", cik, token.concept, token.unit, token.accn, token.start, token.end, token.token]))
    .digest("hex");
}

async function loadLatestFiscalYear(
  db: FundamentalsQueryExecutor,
  issuerId: UUID,
  cutoff?: string,
): Promise<{ fiscal_year: number } | null> {
  const result = await db.query<{ fiscal_year: number }>(
    `select max(f.fiscal_year)::int as fiscal_year
       from facts f
       join metrics m on m.metric_id = f.metric_id
      where f.subject_kind = 'issuer'
        and f.subject_id = $1
        and f.period_kind = 'fiscal_y'
        and f.fiscal_period = 'FY'
        and f.method = 'reported'
        and ${cutoff === undefined ? factActiveSql("f") : factKnownAtSql("f", "$2::timestamptz")}
        and m.metric_key = 'revenue'`,
    cutoff === undefined ? [issuerId] : [issuerId, cutoff],
  );
  const fiscalYear = result.rows[0]?.fiscal_year;
  return typeof fiscalYear === "number" ? { fiscal_year: fiscalYear } : null;
}

function periodKindFor(fiscalPeriod: FiscalPeriod): PeriodKind {
  return fiscalPeriod === "FY" ? "fiscal_y" : "fiscal_q";
}

// pg reads a date column as local midnight, so its calendar date is the local
// one: toISOString would shift it a day east of UTC.
function dateString(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return value.slice(0, 10);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function unitClassFor(unit: string): MetricDefinition["unit_class"] {
  if (unit === "shares" || unit === "count") return "count";
  return "currency";
}
