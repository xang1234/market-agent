import { isDeepStrictEqual } from "node:util";
import {
  createMetricRegistry,
  mapStatement,
  mapStatementLine,
  resolveMetric,
  type MappedStatement,
  type MetricDefinition,
  type MetricRegistry,
} from "./metric-mapper.ts";
import {
  buildSecSource,
  fetchCompanyFacts,
  extractStatementWithTokens,
  reportsNoncontrollingInterest,
  SecEdgarFetchError,
  SEC_COVER_COUNT_CONCEPT,
  SEC_INCOME_METRIC_KEYS,
  SEC_METRIC_KEYS_BY_FAMILY,
  US_GAAP_TO_METRIC_KEY,
  secCoverCountValues,
  secFiscalYearWindow,
  secTokenLocator,
  secTokenProofHash,
  selectSecConceptValue,
  sourceIdForAccession,
  type ExtractStatementInput,
  type SecCompanyFacts,
  type SecCompanyFactsFetch,
  type SecConcept,
  type SecConceptValue,
  type SecEdgarFetcher,
  type SecDerivation,
  type SecFetchEvidence,
  type SecSource,
  type SecSourceToken,
  type SecValueLocation,
} from "./sec-edgar.ts";
import type { ConceptScopeV1, DerivationProofV1, NoncontrollingInterestInferenceV1 } from "../../financial-core/src/contracts.ts";
import { resolveMetricDefinition, type MetricValueKind } from "../../financial-core/src/definitions.ts";
import { derivationValue } from "../../financial-core/src/derivation.ts";
import type { ShareBasis } from "../../financial-core/src/evidence-vocabulary.ts";
import { explainedBySplits, filingRounding, sameRoundedFigure, splitHistoryCovers, splitsRestate, sumWithinRounding, type RoundedFigure } from "../../financial-core/src/split-adjustment.ts";
import { loadSubjectSplitHistory, type SubjectSplitHistory } from "../../market/src/split-history.ts";
import { checkTokenAgainstStoredValue, recordFactPrecisionAttestation } from "../../evidence/src/financial-attestations.ts";
import { recordFactFinancialContext } from "../../evidence/src/financial-context.ts";
import { withPinnedTransaction, type TransactionalQueryExecutor } from "./pinned-transaction.ts";
import { recordSecFetchPublication, secAccessionVersionHash } from "./sec-publication-proof.ts";
import { secDerivedLine } from "./sec-derivation-proof.ts";
import { recordSecFilingAcceptances, type SecFilingRef } from "./sec-acceptance.ts";
import { factActiveSql, factKnownAtSql } from "../../evidence/src/fact-activity.ts";
import { FundamentalsDataUnavailableError } from "./availability.ts";
import { FROZEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { issuerHoldsCik } from "../../shared/src/identifiers.ts";
import {
  FISCAL_PERIODS,
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

// Null for a frozen golden issuer, whose illustrative figures live SEC data
// must not repair; null when the issuer has no usable CIK or SEC has no such
// statement (a 404, or no us-gaap values for it). A failure of SEC's download
// or data throws FundamentalsDataUnavailableError; a failure storing it throws
// as it is.
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
  const [statement] = await hydrateSecPeriods(db, input, () => [{ fiscal_year: input.fiscal_year, fiscal_period: input.fiscal_period }]);
  return statement ?? null;
}

// Stores the issuer's annual statements for the latest fiscal years its
// planned reads need (from the latest year with a 10-K revenue value) from one
// companyfacts download, unless every read is already stored with its proofs.
// `reads` is how many of the latest fiscal years each metric is read for. A
// year SEC has no statement for is skipped; the years that extract are stored
// before a failure is thrown as hydrateSecIssuer throws it.
export async function hydrateSecIssuerLatestYears(
  db: FundamentalsTransactionalQueryExecutor,
  input: {
    issuerId: UUID;
    reads: ReadonlyMap<string, number>;
    fetcher: SecEdgarFetcher;
    sourceId: UUID;
    clock?: () => Date;
    logger?: Pick<Console, "warn">;
  },
): Promise<void> {
  if (FROZEN_ISSUER_IDS.has(input.issuerId)) return;
  if (await storedProvenReads(db, input.issuerId, input.reads, (input.clock ?? (() => new Date()))())) return;
  const years = Math.max(0, ...input.reads.values());
  await hydrateSecPeriods(db, input, (facts) => {
    const latest = latestAnnualRevenueYear(facts);
    return latest === null ? [] : Array.from({ length: years }, (_, offset) => ({ fiscal_year: latest - offset, fiscal_period: "FY" as const }));
  });
}

// Whether every planned read is stored as SEC facts the engine would accept:
// a precision proof with its token, a financial context, and a publication
// proof, for the latest fiscal year on file and the years before it each
// metric needs. A latest year that ended more
// than a filing cycle ago (15 months) does not count: a newer 10-K is due, so
// the issuer is fetched again.
async function storedProvenReads(db: FundamentalsQueryExecutor, issuerId: UUID, reads: ReadonlyMap<string, number>, now: Date): Promise<boolean> {
  const { rows } = await db.query<{ metric_key: string; fiscal_year: number; period_end: string }>(
    `select distinct m.metric_key, f.fiscal_year, f.period_end::text as period_end
       from facts f
       join metrics m on m.metric_id = f.metric_id
       join sources s on s.source_id = f.source_id
      where f.subject_kind = 'issuer'
        and f.subject_id = $1
        and m.metric_key = any($2::text[])
        -- A year's flows are fiscal_y facts; its year-end balances are point facts.
        and f.period_kind in ('fiscal_y', 'point')
        and f.fiscal_period = 'FY'
        and s.provider = 'sec_edgar'
        and ${factActiveSql("f")}
        and exists (select 1 from current_fact_precision_attestations a
                     where a.fact_id = f.fact_id and a.precision_class <> 'legacy_unverified'
                       and a.raw_token is not null and a.token_proof_hash is not null)
        and exists (select 1 from fact_financial_contexts c where c.fact_id = f.fact_id)
        and exists (select 1 from current_source_publication_attestations p
                     where p.source_id = f.source_id and p.source_version_hash = normalized_content_hash(s.content_hash))`,
    [issuerId, [...reads.keys()]],
  );
  const latest = rows.reduce<(typeof rows)[number] | null>((best, row) => (best === null || Number(row.fiscal_year) > Number(best.fiscal_year) ? row : best), null);
  if (latest === null) return false;
  const filingCycle = new Date(`${latest.period_end}T00:00:00.000Z`);
  filingCycle.setUTCMonth(filingCycle.getUTCMonth() + 15);
  if (!(filingCycle > now)) return false;
  const proven = new Set(rows.map((row) => `${row.metric_key}:${Number(row.fiscal_year)}`));
  return [...reads].every(([metric, years]) =>
    Array.from({ length: years }, (_, offset) => proven.has(`${metric}:${Number(latest.fiscal_year) - offset}`)).every(Boolean));
}

async function hydrateSecPeriods(
  db: FundamentalsTransactionalQueryExecutor,
  input: { issuerId: UUID; fetcher: SecEdgarFetcher; sourceId: UUID; clock?: () => Date; logger?: Pick<Console, "warn"> },
  periodsOf: (facts: SecCompanyFacts) => ReadonlyArray<{ fiscal_year: number; fiscal_period: FiscalPeriod }>,
): Promise<Array<NormalizedStatement | null>> {
  if (FROZEN_ISSUER_IDS.has(input.issuerId)) return [];
  const logger = input.logger ?? console;
  const clock = input.clock ?? (() => new Date());
  const issuer = await loadIssuer(db, input.issuerId);
  const cik = Number(issuer?.cik);
  if (!Number.isInteger(cik) || cik <= 0) return [];

  // SEC's failures are held until what did extract is stored, so a bad
  // year never costs the years beside it.
  const filings: ExtractedFiling[] = [];
  let secFailure: { error: unknown; fiscal_year?: number; fiscal_period?: FiscalPeriod } | null = null;
  try {
    const fetched = await fetchCompanyFacts(input.fetcher, cik);
    for (const period of periodsOf(fetched.facts)) {
      try {
        filings.push(extractFiling({ fetched, cik, issuerId: input.issuerId, ...period, fallbackSourceId: input.sourceId, income: "require", logger }));
      } catch (error) {
        if (!isMissingCoverage(error instanceof Error ? error.message : String(error))) secFailure ??= { error, ...period };
      }
    }
  } catch (error) {
    secFailure = { error };
  }
  const stored: Array<Awaited<ReturnType<typeof storeFiling>>> = [];
  for (const filing of filings) {
    try {
      stored.push(await storeFiling(db, filing, clock));
    } catch (error) {
      if (!(error instanceof FundamentalsDataUnavailableError)) throw error;
      secFailure ??= { error, fiscal_year: filing.target.fiscal_year, fiscal_period: filing.target.fiscal_period };
    }
  }
  await recordSecFilingAcceptances(db, input.fetcher, { cik, filings: stored.flatMap((entry) => (entry.filing ? [entry.filing] : [])), logger });
  if (secFailure !== null) {
    const { error, ...period } = secFailure;
    logger.warn("sec_edgar fundamentals ingestion failed", {
      issuer_id: input.issuerId,
      ...period,
      error: error instanceof Error ? error.message : String(error),
    });
    const unavailable = classifySecIngestionError(error);
    if (unavailable) throw unavailable;
  }
  return stored.map((entry) => entry.statement);
}

// For every SEC income period already on file for an issuer, from one
// companyfacts download: stores the cash flow and balance sheet, and repairs
// the income statement. Those periods are otherwise read from facts and never
// fetched again, so this is how they gain the families ingested since, and how
// facts the old period selector got wrong (a 10-K's oldest comparative, a
// framed prior-year quarter) are replaced. With annualHistoryYears (dev only,
// #610), it also stores the download's newest that many 10-K fiscal years,
// whether or not any income is on file for them.
export async function backfillSecCompanionStatements(
  db: FundamentalsTransactionalQueryExecutor,
  input: {
    issuerId: UUID;
    fetcher: SecEdgarFetcher;
    sourceId: UUID;
    clock?: () => Date;
    logger?: Pick<Console, "warn">;
    annualHistoryYears?: number;
  },
): Promise<{ periods: number }> {
  if (FROZEN_ISSUER_IDS.has(input.issuerId)) return { periods: 0 };
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
        and (${factActiveSql("f")} and m.metric_key = any($2::text[])
          -- A net income from ProfitLoss that 0076 invalidated may have been its period's only income fact (#342).
          or m.metric_key = 'net_income' and f.invalidated_at is not null
             and (f.quality_flags @> '[{"concept": "ProfitLoss"}]'
               or exists (select 1 from fact_precision_attestations p where p.fact_id = f.fact_id and p.source_locator like '%#ProfitLoss|%')))
      order by f.fiscal_year, f.fiscal_period`,
    [input.issuerId, SEC_INCOME_METRIC_KEYS],
  );
  const history = input.annualHistoryYears ?? 0;
  if (rows.length === 0 && history === 0) return { periods: 0 };
  const fetched = await fetchCompanyFacts(input.fetcher, cik);
  const periods = new Map(rows.map((row) => [`${row.fiscal_year}|${row.fiscal_period}`, row]));
  for (const fiscal_year of tenKFiscalYears(fetched.facts, history)) periods.set(`${fiscal_year}|FY`, { fiscal_year, fiscal_period: "FY" });
  const filings: SecFilingRef[] = [];
  for (const period of periods.values()) {
    const extracted = extractFiling({
      fetched,
      cik,
      issuerId: input.issuerId,
      fiscal_year: period.fiscal_year,
      fiscal_period: period.fiscal_period,
      fallbackSourceId: input.sourceId,
      income: "repair",
      logger: input.logger ?? console,
    });
    const { filing } = await storeFiling(db, extracted, input.clock ?? (() => new Date()));
    if (filing) filings.push(filing);
  }
  await recordSecFilingAcceptances(db, input.fetcher, { cik, filings, logger: input.logger ?? console });
  return { periods: periods.size };
}

/** The newest `count` fiscal years an original 10-K in the download reports, by its fiscal-year label. */
function tenKFiscalYears(facts: SecCompanyFacts, count: number): number[] {
  const years = new Set<number>();
  for (const concept of Object.values(facts.facts["us-gaap"] ?? {})) {
    for (const values of Object.values(concept.units)) {
      for (const value of values) if (value.form === "10-K" && value.fp === "FY" && Number.isInteger(value.fy)) years.add(value.fy);
    }
  }
  return [...years].sort((left, right) => right - left).slice(0, count);
}

type Extracted = {
  statement: NormalizedStatement;
  tokens: ReadonlyMap<string, SecSourceToken>;
  derivations: ReadonlyMap<string, SecDerivation>;
  inferences: ReadonlyMap<string, NoncontrollingInterestInferenceV1>;
};

type IngestInput = {
  fetched: SecCompanyFactsFetch;
  cik: number;
  issuerId: UUID;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  fallbackSourceId: UUID;
  income: "require" | "repair";
  logger: Pick<Console, "warn">;
};

type ExtractedFiling = Readonly<{
  input: IngestInput;
  accessionNumber: string | null;
  source: SecSource | null;
  sourceId: UUID;
  target: Omit<ExtractStatementInput, "family">;
  income: Extracted | null;
  companions: ReadonlyArray<Extracted>;
  coverCount: CoverCount | null;
}>;

/**
 * A filing's cover-page count of its common shares (#444): a point at the
 * count's own date S, labeled with the filing's fiscal year and period and
 * filed on D. It is certified only when the filing lists one count. With
 * several, each covers part of the registrant's shares, so the newest is
 * stored with its token as partial coverage and no context: binding gaps on
 * its scope, never on an older filing's count. A count without its lossless
 * token is not stored.
 */
type CoverCount = Readonly<{ period: Omit<FactBatch, "lines">; line: StatementLine; token: SecSourceToken; certified: boolean }>;

const SEC_COVER_COUNT_METRIC_KEY = "shares_outstanding";

function secCoverCount(input: IngestInput, accessionNumber: string, sourceId: UUID): CoverCount | null {
  const [value, ...others] = secCoverCountValues(input.fetched.facts, accessionNumber).sort((left, right) => right.end.localeCompare(left.end));
  const fiscalPeriod = FISCAL_PERIODS.find((period) => period === value?.fp);
  if (value?.val_token === undefined || fiscalPeriod === undefined || !Number.isInteger(value.fy)) return null;
  return {
    period: {
      subject: { kind: "issuer", id: input.issuerId },
      period_kind: "point",
      period_start: null,
      period_end: value.end,
      fiscal_year: value.fy,
      fiscal_period: fiscalPeriod,
      as_of: input.fetched.evidence.completed_at,
      // Midnight UTC, so the stored instant's date is the filing date wherever it is read.
      reported_at: `${value.filed}T00:00:00.000Z`,
      source_id: sourceId,
    },
    line: { metric_key: SEC_COVER_COUNT_METRIC_KEY, value_num: value.val, unit: "shares", scale: 1, coverage_level: others.length === 0 ? "full" : "partial" },
    token: { token: value.val_token, concept: SEC_COVER_COUNT_CONCEPT, unit: "shares", accn: value.accn, form: value.form, filed: value.filed, start: null, end: value.end },
    certified: others.length === 0,
  };
}

// Reads the filing's statements out of the download, without the database.
// Throws when a required income statement cannot be extracted.
function extractFiling(input: IngestInput): ExtractedFiling {
  const accessionNumber = statementAccession(input.fetched.facts, input.fiscal_year, input.fiscal_period);
  const source = accessionNumber ? secFilingSource(input.cik, accessionNumber, input.fetched.evidence.completed_at) : null;
  const sourceId = source?.source_id ?? input.fallbackSourceId;
  const target = {
    subject: { kind: "issuer", id: input.issuerId },
    facts: input.fetched.facts,
    fiscal_year: input.fiscal_year,
    fiscal_period: input.fiscal_period,
    accession_number: accessionNumber ?? undefined,
    source_id: sourceId,
    as_of: input.fetched.evidence.completed_at,
  } as const;
  const income: Extracted | null = input.income === "require"
    ? extracted(extractStatementWithTokens({ ...target, family: "income" }))
    : statementsOf(target, ["income"], input.logger)[0] ?? null;
  return {
    input,
    accessionNumber,
    source,
    sourceId,
    target,
    income,
    companions: statementsOf(target, COMPANION_FAMILIES, input.logger),
    coverCount: accessionNumber ? secCoverCount(input, accessionNumber, sourceId) : null,
  };
}

// Stores one filing's statements for a fiscal period from a companyfacts
// download, in one transaction: the income statement, and the same filing's
// cash flow and balance sheet beside it. Income is "require" (a lookup: it must
// extract) or "repair" (a backfill: stored income facts that differ from the
// filing are replaced; a period it cannot extract is left as it is). Returns
// the income statement, or null without it, and the accession filing it stored
// facts on. Every period of one download is dated by that download's
// completion, never by when it was processed.
async function storeFiling(
  db: FundamentalsTransactionalQueryExecutor,
  { input, accessionNumber, source, sourceId, target, income, companions, coverCount }: ExtractedFiling,
  clock: () => Date,
): Promise<{ statement: NormalizedStatement | null; filing: SecFilingRef | null }> {
  const asOf = input.fetched.evidence.completed_at;
  const registry = await loadMetricRegistry(db, [
    ...[...(income ? [income] : []), ...companions].flatMap((entry) => entry.statement.lines.map((line) => line.metric_key)),
    ...(coverCount ? [coverCount.line.metric_key] : []),
  ]);
  const mapped = [
    ...(income ? [{ ...income, mapped: mapSecStatement(registry, income.statement) }] : []),
    ...mapCompanions(registry, companions, target, input.logger),
  ];
  const cover = coverCount && mapCoverCount(registry, coverCount, target, input.logger);
  if (mapped.length === 0 && !cover) {
    if (source) await upsertSecFilingSource(db, source);
    return { statement: income?.statement ?? null, filing: null };
  }
  const stored = await withPinnedTransaction(db, async (client) => {
    // Each ingest of an issuer checks its inferences against what it reads, so
    // two at once could each re-store a figure the other refutes (#342).
    await client.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [input.issuerId]);
    if (!(await issuerHoldsCik(client, input.issuerId, input.cik))) return false;
    if (source) await upsertSecFilingSource(client, source);
    // A download older than one already stored may lack the noncontrolling
    // interest the newer one reported, so it leaves every figure it would
    // infer as it is: none stored, none retired.
    const newest = await isNewestDownload(client, input.issuerId, input.fetched);
    if (!newest && (income?.inferences.size ?? 0) > 0) {
      input.logger?.warn(`sec: a download older than one stored for issuer ${input.issuerId} infers no net income`);
    }
    // The repair retires stored income facts the filing contradicts, then
    // stores the filing's in their place (the active identity is unique).
    const stale = input.income === "repair" && income
      ? await staleStatementFacts(client, input.issuerId, input.cik, income, input.fetched.facts)
      : new Map<string, string[]>();
    if (!newest) for (const metricKey of income?.inferences.keys() ?? []) stale.delete(metricKey);
    if (stale.size > 0) await invalidateWithDependents(client, input.issuerId, [...stale.values()].flat());
    for (const entry of mapped) {
      const statement = newest ? entry.mapped : { ...entry.mapped, lines: entry.mapped.lines.filter((line) => !entry.inferences.has(line.metric_key)) };
      const inserted = await persistStatementFacts(client, statement, clock, {
        cik: input.cik,
        tokens: entry.tokens,
        derivations: entry.derivations,
        inferences: entry.inferences,
        retrievedAt: asOf,
        logger: input.logger,
      });
      if (entry.statement !== income?.statement) continue;
      for (const [metricKey, oldIds] of stale) {
        const newId = inserted.get(metricKey);
        if (newId) {
          await client.query(`update facts set superseded_by = $2, updated_at = now() where fact_id = any($1::uuid[])`, [oldIds, newId]);
        }
      }
    }
    if (cover) {
      await persistStatementFacts(client, cover.facts, clock, {
        cik: input.cik,
        tokens: new Map([[SEC_COVER_COUNT_METRIC_KEY, cover.token]]),
        retrievedAt: asOf,
        certify: cover.certified,
        logger: input.logger,
      });
    }
    await retireRefutedInferences(client, input.issuerId, input.fetched.facts);
    await retireGoldenFacts(client, input.issuerId);
    await recordSecRestatements(client, {
      facts: input.fetched.facts,
      cik: input.cik,
      issuerId: input.issuerId,
      evidence: input.fetched.evidence,
      clock,
    });
    if (accessionNumber) {
      await recordSecFetchPublication(client, { sourceId, accessionNumber, evidence: input.fetched.evidence });
    }
    return true;
  });
  if (!stored) {
    input.logger.warn(`sec: issuer ${input.issuerId} no longer holds CIK ${input.cik}; its download is not stored`);
    return { statement: null, filing: null };
  }
  return { statement: income?.statement ?? null, filing: accessionNumber ? { sourceId, accessionNumber } : null };
}

// A metric our registry lacks is ours and throws as it is. A line SEC tagged
// with a unit its metric cannot take is SEC's data, so that failure is
// classified like an extraction failure.
function mapSecStatement(registry: MetricRegistry, statement: NormalizedStatement): MappedStatement {
  for (const line of statement.lines) resolveMetric(registry, line.metric_key);
  try {
    return mapStatement(registry, statement);
  } catch (error) {
    throw new FundamentalsDataUnavailableError("provider_error", error instanceof Error ? error.message : String(error), false);
  }
}

// The stored, active SEC facts for a statement's period that the filing
// contradicts, their ids by metric_key: a metric the statement has, with another value,
// dates or inference basis; or one of its family the statement lacks, dated for
// another period (the old selector's comparative, with nothing to replace it),
// inferred, or an unproven net income that is the download's ProfitLoss for
// its period (#342: ingestion once stored ProfitLoss as net income, with no
// proof, and no longer yields it where the filer reports a noncontrolling
// interest). A value is compared with its token as a precision
// proof compares them, since one stored from a JS number may round it.
async function staleStatementFacts(
  db: FundamentalsQueryExecutor,
  issuerId: UUID,
  cik: number,
  { statement, tokens, derivations, inferences }: Extracted,
  facts: SecCompanyFacts,
): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{
    fact_id: string;
    metric_key: string;
    stored_value: string | null;
    period_start: string | null;
    period_end: string;
    inference: NoncontrollingInterestInferenceV1 | null;
    proven: boolean;
  }>(
    // Dates as text: pg reads a date column as a local-time Date, which can
    // shift a day when written back as ISO.
    `select f.fact_id::text as fact_id, m.metric_key, f.value_num::text as stored_value,
            f.period_start::text as period_start, f.period_end::text as period_end, ${INFERENCE_SQL} as inference,
            exists (select 1 from current_fact_precision_attestations a
                     where a.fact_id = f.fact_id and a.precision_class <> 'legacy_unverified') as proven
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
  const profitLoss = Object.values(facts.facts["us-gaap"]?.ProfitLoss?.units ?? {}).flatMap((values) => (Array.isArray(values) ? values : []));
  const isProfitLoss = (row: (typeof rows)[number]) => profitLoss.some((value) =>
    (value.start ?? null) === row.period_start && value.end === row.period_end
    && checkTokenAgainstStoredValue(value.val_token ?? String(value.val), row.stored_value).status === "match");
  // A metric can have rows from several filings: every contradicted one goes.
  const stale = new Map<string, string[]>();
  for (const row of rows) {
    const line = statement.lines.find((candidate) => candidate.metric_key === row.metric_key);
    const otherDates = row.period_start !== statement.period_start || row.period_end !== statement.period_end;
    const derivation = derivations.get(row.metric_key);
    const exact = tokens.get(row.metric_key)?.token ?? (derivation && secDerivedLine(cik, statement, row.metric_key, derivation)?.sum);
    const otherValue = exact
      ? checkTokenAgainstStoredValue(exact, row.stored_value).status !== "match"
      : (row.stored_value === null ? null : Number(row.stored_value)) !== line?.value_num;
    const otherBasis = !isDeepStrictEqual(claimOf(row.inference), claimOf(inferences.get(row.metric_key)));
    const unreproduced = line === undefined && (row.inference !== null || (row.metric_key === "net_income" && !row.proven && isProfitLoss(row)));
    const contradicted = otherDates || (line !== undefined && (otherValue || otherBasis)) || unreproduced;
    if (contradicted) stale.set(row.metric_key, [...(stale.get(row.metric_key) ?? []), row.fact_id]);
  }
  return stale;
}

// An inference's claim, without the concept list it was checked against: a
// longer list in a later release does not make the stored figure another one.
function claimOf(inference: NoncontrollingInterestInferenceV1 | null | undefined) {
  return inference ? { kind: inference.kind, concept: inference.concept } : null;
}

function extracted(result: ReturnType<typeof extractStatementWithTokens>): Extracted {
  return { statement: normalizedStatement(result.statement), tokens: result.tokens, derivations: result.derivations, inferences: result.inferences };
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

// Like a companion, a cover count whose metric the registry lacks is logged
// and left out, so it cannot cost the statements.
function mapCoverCount(
  registry: MetricRegistry,
  coverCount: CoverCount,
  target: Omit<ExtractStatementInput, "family">,
  logger: Pick<Console, "warn">,
): (CoverCount & { facts: FactBatch }) | null {
  try {
    return { ...coverCount, facts: { ...coverCount.period, lines: [mapStatementLine(registry, coverCount.line)] } };
  } catch (error) {
    logger.warn("sec_edgar cover count mapping failed", {
      issuer_id: target.subject.id,
      accession_number: coverCount.token.accn,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function isMissingCoverage(message: string): boolean {
  return message.includes("no us-gaap values") ||
    message.includes('has no "us-gaap" taxonomy') ||
    message.includes("no monetary lines extracted");
}

// The accession's source row, built from SEC's data: a malformed accession
// throws here, before anything is stored.
function secFilingSource(cik: number, accessionNumber: string, retrievedAt: string): SecSource {
  return buildSecSource({
    source_id: sourceIdForAccession(accessionNumber),
    cik,
    accession_number: accessionNumber,
    retrieved_at: retrievedAt,
    content_hash: secAccessionVersionHash(accessionNumber),
  });
}

async function upsertSecFilingSource(db: FundamentalsQueryExecutor, source: SecSource): Promise<UUID> {
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
    throw new Error(`sec_edgar source ${source.source_id} (${source.canonical_url}) has another content_hash; a source version never changes`);
  }
  return stored as UUID;
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
// transaction, so a fact never lands without its proof. A derived flow line is
// written from its inputs' exact sum and proven by its derivation (#481). A
// line with neither keeps the legacy number and gets no precision proof, so
// strict financial binding treats it as a gap. A line that conflicts with
// a stored fact whose value and dates equal its token or sum, and whose
// precision is unproven, revalidates that fact. Each such fact, inserted or
// already stored, gets its financial context when recordSecOriginalContext
// certifies it, unless `certify` is false.
async function persistStatementFacts(
  db: FundamentalsQueryExecutor,
  statement: FactBatch,
  clock: () => Date,
  provenance: {
    cik: number;
    tokens: ReadonlyMap<string, SecSourceToken>;
    derivations?: ReadonlyMap<string, SecDerivation>;
    inferences?: ReadonlyMap<string, NoncontrollingInterestInferenceV1>;
    retrievedAt?: string;
    certify?: boolean;
    logger: Pick<Console, "warn">;
  },
): Promise<Map<string, string>> {
  // The facts this call inserted, by metric_key (a conflicting line inserts none).
  const insertedIds = new Map<string, string>();
  for (const line of statement.lines) {
    const token = provenance.tokens.get(line.metric_key);
    const derivation = provenance.derivations?.get(line.metric_key);
    const derived = derivation ? secDerivedLine(provenance.cik, statement, line.metric_key, derivation) : null;
    if (derivation && derived?.status === "unproven") {
      provenance.logger.warn("sec_edgar derived value left unproven", {
        reason: derived.issue,
        issuer_id: statement.subject.id,
        metric_key: line.metric_key,
        accession: derivation.minuend.accn,
        period_start: statement.period_start,
        period_end: statement.period_end,
      });
    }
    const proven = derived?.status === "proven" ? derived : null;
    const attestation = token
      ? {
          precision_class: "source_token_preserved" as const,
          raw_token: token.token,
          token_proof_hash: secTokenProofHash(provenance.cik, token),
          source_locator: secTokenLocator(provenance.cik, token),
          validation_method: "sec_companyfacts_lossless_json.v1",
        }
      : proven && {
          precision_class: "derived_from_source_tokens" as const,
          derivation: proven.proof,
          source_locator: proven.locator,
          validation_method: "sec_companyfacts_period_difference.v1",
        };
    const inference = provenance.inferences?.get(line.metric_key) ?? null;
    const qualityFlags = [
      ...(derivation ? [await derivationLineage(db, derivation, provenance.cik, provenance.retrievedAt ?? clock().toISOString())] : []),
      ...(inference ? [inference] : []),
    ];
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
        token?.token ?? derived?.sum ?? line.value_num,
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
    const exact = token ? { value: token.token, at: token } : proven && { value: proven.sum, at: proven.at };
    if (!attestation || !exact) continue;
    const storedId = factId ?? await lockStoredExactFact(db, statement, line, exact.value, inference);
    if (!storedId) continue;
    if (factId || !(await hasProvenPrecision(db, storedId))) {
      await recordFactPrecisionAttestation(db, attestation.precision_class === "source_token_preserved" && !factId
        ? { ...attestation, fact_id: storedId, precision_class: "revalidated_against_source" }
        : { ...attestation, fact_id: storedId });
    }
    if (provenance.certify !== false && !(derivation && derivedAcrossPerimeters(line.metric_key, derivation))) {
      await recordSecOriginalContext(db, storedId, line, exact.at, attestation.source_locator);
    }
  }
  return insertedIds;
}

/** What facts are stored from: a statement's period, or a cover count's, and its lines. */
type FactBatch = Pick<
  MappedStatement,
  "subject" | "period_kind" | "period_start" | "period_end" | "fiscal_year" | "fiscal_period" | "as_of" | "reported_at" | "source_id" | "lines"
>;

// The caller reads the fact's proof in a later statement, which sees a proof
// a concurrent ingestion committed while this lock waited. A stored fact with
// another inference claim (`claimOf`) is another figure, never proven by this line.
async function lockStoredExactFact(
  db: FundamentalsQueryExecutor,
  statement: FactBatch,
  line: MappedStatement["lines"][number],
  value: string,
  inference: NoncontrollingInterestInferenceV1 | null,
): Promise<string | null> {
  const { rows } = await db.query<{ fact_id: string }>(
    `select f.fact_id::text as fact_id
       from facts f
      where f.subject_kind = 'issuer' and f.subject_id = $1 and f.metric_id = $2 and f.period_kind = $3
        and f.fiscal_year = $4 and f.fiscal_period = $5 and f.source_id = $6 and f.method = 'reported'
        and ${factActiveSql("f")}
        and f.period_start is not distinct from $7::date and f.period_end = $8::date and f.value_num = $9::numeric
        and (${INFERENCE_SQL} - 'checked') is not distinct from ($10::jsonb - 'checked')
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
      value,
      inference === null ? null : JSON.stringify(inference),
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

// A split restates per-share values and share counts. A filing states its own
// period's EPS and weighted-average counts on the split basis of its filing
// date, every split before it included. Its cover-page count is a count as of
// the count's own date (#444): a split after that date is not in it, though the
// filing's statements reflect it. Each is as filed on that date, and binding
// restates it to an analysis's reference date. The share basis is the engine
// definition's.
function secSplitBasis(metricKey: string, token: SecValueLocation) {
  const definition = resolveMetricDefinition(metricKey);
  if (definition === null || !splitsRestate(definition.value_kind)) return { adjustment_basis: "unadjusted", share_basis: "not_applicable" } as const;
  return {
    adjustment_basis: "as_filed",
    as_filed_on: definition.value_kind === "share_count" ? token.end : token.filed,
    share_basis: definition.share_basis,
  } as const;
}

// A fact's no_noncontrolling_interest inference (#342), or null.
const INFERENCE_SQL = `jsonb_path_query_first(f.quality_flags, '$[*] ? (@.kind == "no_noncontrolling_interest")')`;

// Records the download's newest filing date for the issuer, and says whether
// no download stored before it had a newer one. Compared by filing date, so
// two downloads either side of a filing the same day compare equal.
async function isNewestDownload(db: FundamentalsQueryExecutor, issuerId: UUID, fetched: { facts: SecCompanyFacts; evidence: { completed_at: string } }): Promise<boolean> {
  // A date that is malformed or later than the fetch itself would raise the
  // stored date past every honest download, so it dates nothing.
  const fetchedOn = fetched.evidence.completed_at.slice(0, 10);
  const filed = Object.values(fetched.facts.facts).flatMap((concepts) => Object.values(concepts ?? {}))
    .flatMap((concept) => Object.values(concept?.units ?? {}))
    .flatMap((values) => (Array.isArray(values) ? values.map((value) => value.filed) : []))
    .filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= fetchedOn);
  const newest = filed.reduce((max, date) => (date > max ? date : max), "0001-01-01");
  const { rows } = await db.query<{ newest: boolean }>(
    `insert into sec_issuer_downloads (issuer_id, newest_filed) values ($1, $2::date)
     on conflict (issuer_id) do update set newest_filed = greatest(sec_issuer_downloads.newest_filed, excluded.newest_filed)
     returning newest_filed = $2::date as newest`,
    [issuerId, newest],
  );
  return rows[0]?.newest === true;
}

// An inferred figure holds only while no filing shows a noncontrolling
// interest for its period (#342). Any download can be the first to show one,
// for any period on file, so every filing's transaction checks them all.
async function retireRefutedInferences(db: FundamentalsQueryExecutor, issuerId: UUID, facts: SecCompanyFacts): Promise<void> {
  const usGaap = facts.facts["us-gaap"];
  if (!usGaap) return;
  const { rows } = await db.query<{ fact_id: string; period_start: string | null; period_end: string }>(
    `select f.fact_id::text as fact_id, f.period_start::text as period_start, f.period_end::text as period_end
       from facts f
       join sources s on s.source_id = f.source_id
      where f.subject_kind = 'issuer' and f.subject_id = $1 and s.provider = 'sec_edgar'
        and ${factActiveSql("f")}
        and ${INFERENCE_SQL} is not null`,
    [issuerId],
  );
  const refuted = rows.filter((row) => reportsNoncontrollingInterest(usGaap, row.period_start, row.period_end)).map((row) => row.fact_id);
  if (refuted.length > 0) await invalidateWithDependents(db, issuerId, refuted);
}

// repair:issuer-splits keeps the live issuer of a golden ticker and moves the
// golden dataset's illustrative figures onto it (issuer-splits.ts). Each one a
// filing reports for its metric and period is retired as a stale fact is. The
// filing's figure supersedes it. A statement read at an earlier cutoff still
// returns it, but the financial engine skips a retired fact whatever the cutoff,
// so a Call at the golden cutoff shows a gap for that period.
export async function retireGoldenFacts(db: FundamentalsQueryExecutor, issuerId: UUID): Promise<void> {
  if (FROZEN_ISSUER_IDS.has(issuerId)) return;
  const { rows } = await db.query<{ fact_id: string; superseded_by: string }>(
    `select distinct on (g.fact_id) g.fact_id::text as fact_id, r.fact_id::text as superseded_by
       from facts g
       join sources gs on gs.source_id = g.source_id and gs.provider = 'golden_fixture'
       join facts r on r.subject_kind = 'issuer' and r.subject_id = g.subject_id and r.metric_id = g.metric_id and r.period_kind = g.period_kind
                   and r.fiscal_year = g.fiscal_year and r.fiscal_period = g.fiscal_period and r.method = 'reported' and ${factActiveSql("r")}
       join sources rs on rs.source_id = r.source_id and rs.provider = 'sec_edgar'
      where g.subject_kind = 'issuer' and g.subject_id = $1 and ${factActiveSql("g")}
      order by g.fact_id, r.as_of desc, r.created_at desc`,
    [issuerId],
  );
  if (rows.length === 0) return;
  await invalidateWithDependents(db, issuerId, rows.map((row) => row.fact_id));
  await db.query(
    `update facts f set superseded_by = r.superseded_by, updated_at = now()
       from unnest($1::uuid[], $2::uuid[]) as r(fact_id, superseded_by) where f.fact_id = r.fact_id`,
    [rows.map((row) => row.fact_id), rows.map((row) => row.superseded_by)],
  );
}

// Invalidates the facts and every active fact of the issuer derived from one
// (analyze's quality_flags input_fact_ids), at any depth.
async function invalidateWithDependents(db: FundamentalsQueryExecutor, issuerId: UUID, factIds: ReadonlyArray<string>): Promise<void> {
  await db.query(
    `with recursive refuted(fact_id) as (
       select unnest($2::uuid[])
       union
       select d.fact_id
         from refuted r
         join facts d on d.subject_kind = 'issuer' and d.subject_id = $1 and d.invalidated_at is null
                     and d.quality_flags @> jsonb_build_array(jsonb_build_object('input_fact_ids', jsonb_build_array(r.fact_id::text)))
     )
     update facts f set invalidated_at = now(), updated_at = now()
       from refuted r
      where f.fact_id = r.fact_id and f.invalidated_at is null`,
    [issuerId, factIds],
  );
}

const SEC_CONTEXT_VERSION = "sec_companyfacts_context.v1";

// A metric mapped from several concepts is certified only from the reviewed
// one, or a scoped one (secConceptScope). OCF is the total, matching capex's
// scope. Facts from the other concepts stay readable in statements but get no
// context. A Call's inputs (#594) are each one reviewed concept, so an alias
// mapped beside one later is never certified unreviewed.
const SEC_CERTIFIED_CONCEPTS: Readonly<Record<string, string>> = {
  capex: "PaymentsToAcquirePropertyPlantAndEquipment",
  operating_cash_flow: "NetCashProvidedByUsedInOperatingActivities",
  pretax_income: "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  pretax_income_before_equity_method: "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  income_tax_expense: "IncomeTaxExpenseBenefit",
  stock_based_compensation_expense: "AllocatedShareBasedCompensationExpense",
  stock_based_compensation: "ShareBasedCompensation",
  long_term_debt_current: "LongTermDebtCurrent",
  long_term_debt_noncurrent: "LongTermDebtNoncurrent",
  commercial_paper: "CommercialPaper",
  short_term_borrowings: "ShortTermBorrowings",
  marketable_securities_current: "MarketableSecuritiesCurrent",
  marketable_securities_noncurrent: "MarketableSecuritiesNoncurrent",
  debt_securities_current: "DebtSecuritiesCurrent",
  short_term_investments: "ShortTermInvestments",
  remaining_performance_obligations: "RevenueRemainingPerformanceObligation",
};

// Capex a filer tags as PaymentsToAcquireProductiveAssets instead of PP&E
// (#731), and OCF a filer tags only for continuing operations (#743), certify
// too (operator, 2026-11-21), with the concept recorded in quality_flags:
// productive assets may include purchased intangibles, and the
// continuing-operations line excludes discontinued operations. Extraction reads
// a filing that tags both as its reviewed concept (US_GAAP_TO_METRIC_KEY's order).
function secConceptScope(metricKey: string, concept: string): ConceptScopeV1 | null {
  if (metricKey === "capex" && concept === "PaymentsToAcquireProductiveAssets") return { kind: "productive_assets_capex", concept };
  if (metricKey === "operating_cash_flow" && concept === "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations") return { kind: "continuing_operations_ocf", concept };
  return null;
}

// A continuing-operations line covers the businesses its own filing reports as
// continuing, and a discontinuation changes that set under the same concept. A
// quarter derived from another filing's year to date may subtract a figure
// covering other businesses, and no filing states which, so it does not certify.
function derivedAcrossPerimeters(metricKey: string, derivation: SecDerivation): boolean {
  return secConceptScope(metricKey, derivation.concept)?.kind === "continuing_operations_ocf"
    && derivation.subtrahends.some((input) => input.accn !== derivation.minuend.accn);
}

// Selection takes every token from the filing whose own period it is, never
// from a later filing's comparative, so the stored fact is that filing's
// original disclosure. Companyfacts carries only undimensioned values, which
// are consolidated.
async function recordSecOriginalContext(
  db: FundamentalsQueryExecutor,
  tokenFactId: string,
  line: MappedStatement["lines"][number],
  token: SecValueLocation,
  locator: string,
): Promise<void> {
  // The statement contract labels every balance FY of its fiscal year, so a
  // certified 10-Q balance would be read as the year's closing one. A cover
  // count keeps its filing's own fiscal period.
  if (token.start === null && token.form !== "10-K" && token.concept !== SEC_COVER_COUNT_CONCEPT) return;
  const certifiedConcept = SEC_CERTIFIED_CONCEPTS[line.metric_key];
  const scope = secConceptScope(line.metric_key, token.concept);
  if (certifiedConcept !== undefined && token.concept !== certifiedConcept && scope === null) return;
  // A fact stored before its concept certified gains the scope with its context.
  if (scope !== null) {
    await db.query(
      `update facts set quality_flags = quality_flags || $2::jsonb, updated_at = now() where fact_id = $1 and not quality_flags @> $2::jsonb`,
      [tokenFactId, JSON.stringify([scope])],
    );
  }
  const existing = await db.query(`select 1 from fact_financial_contexts where fact_id = $1`, [tokenFactId]);
  if (existing.rows.length > 0) return;
  await recordFactFinancialContext(db, {
    fact_id: tokenFactId,
    context_version: SEC_CONTEXT_VERSION,
    period_type: token.start === null ? "instant" : "duration",
    dimension_scope: "consolidated",
    dimension_members: [],
    reporting_basis: "as_reported",
    ...secSplitBasis(line.metric_key, token),
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
  const inputs = [derivation.minuend, ...derivation.subtrahends];
  const sources = new Map<string, UUID>();
  for (const accn of new Set(inputs.map((input) => input.accn))) {
    sources.set(accn, await upsertSecFilingSource(db, secFilingSource(cik, accn, retrievedAt)));
  }
  return {
    kind: SEC_DERIVATION_KIND,
    concept: derivation.concept,
    unit: derivation.unit,
    input_source_ids: [...new Set(sources.values())],
    inputs: inputs.map((input) => ({
      accn: input.accn,
      start: input.start ?? null,
      end: input.end,
      value: input.val_token ?? String(input.val),
      source_id: sources.get(input.accn)!,
    })),
  };
}

// A filing repeats earlier periods beside its own (#321). Every stored original
// disclosure of the issuer is walked through the later filings in the download
// that give the same concept, unit and dates, in filing order: a 10-K or its
// amendment for a year, and a 10-Q or its amendment too for a quarter (#513). Each
// is judged against the figure that stands, the original or the last restatement.
// A value that differs, past the coarser of the two filings' roundings, is stored
// as that period's restatement, on the restating filing's source, naming the
// original, and then stands, so a filing that reverses a restatement is one too. A
// companyfacts download lists every filing, so the stored history does not depend
// on which period was ingested first (#333), and repeating a restated value adds
// nothing. A filing giving two different values, or a value without its lossless
// token, is skipped; an original with no recorded concept is left as it is. A
// filing filed no later than the original is never later, whatever its fiscal tags
// say (secFiscalYearWindow). A restated fact's method keeps it out of every
// as-reported reader.
//
// A filing too short to show its rounding is read exactly, unless its own zeros
// could hide the difference. That may be no restatement at all, so it is
// unverified: a gap, never a false restatement or a stale figure.
//
// A derived quarter was never stated, so its own filing's line for it counts as a
// later statement, and the walk carries its inputs as they then stand. Every line
// is checked against them, one repeating the figure included, and taken only when
// they give it within rounding: a 10-K that re-presents one quarter alone would
// otherwise leave a year whose quarters overstate it. Failing that it is
// unverified, as it is from the first filing that moves an input and does not state
// the quarter: the number is not re-derived, so as_restated answers a gap rather
// than a stale figure. Nothing later clears an unverified statement: the period's
// later filings wait for it.
//
// Only us-gaap concepts are compared: a cover count (dei) is a count as of its
// own date, and a later filing states a later date's count, never that one's.
//
// An as-filed EPS or share count is on the split basis of its filing date
// (#387), so a later filing states it on its own. When the listing's splits
// between the two filing dates explain the figure, equal or not, it is the same
// one; otherwise it is a restatement, as filed on the later filing's date. Without
// those splits on file an equal figure stays the same one, as most never change,
// and a different one is stored as an unverified restatement. A later filing's
// stored statement converges to the verdict under the splits on file, so a rerun
// after `npm run sync:splits` decides an unverified one and a second rerun changes
// nothing.
async function recordSecRestatements(db: FundamentalsQueryExecutor, input: RestatementInput): Promise<void> {
  const { rows: originals } = await db.query<SecOriginal>(
    `select f.fact_id::text as fact_id, f.metric_id::text as metric_id, m.metric_key, f.period_kind::text as period_kind,
            f.period_start::text as period_start, f.period_end::text as period_end, f.fiscal_year, f.fiscal_period,
            f.value_num::text as value, f.unit, f.currency, f.scale::text as scale, c.source_context_ref,
            c.as_filed_on::text as as_filed_on, c.share_basis, ${INFERENCE_SQL} as inference, a.derivation, a.token_proof_hash, a.source_locator
       from facts f
       join metrics m on m.metric_id = f.metric_id
       join fact_financial_contexts c on c.fact_id = f.fact_id
       left join current_fact_precision_attestations a on a.fact_id = f.fact_id
      where f.subject_kind = 'issuer' and f.subject_id = $1 and f.method = 'reported'
        and ${factActiveSql("f")}
        and c.context_version = $2 and c.disclosure_relation = 'original'`,
    [input.issuerId, SEC_CONTEXT_VERSION],
  );
  if (originals.length === 0) return;
  const { rows: stated } = await db.query<{ fact_id: string; supersedes: string; source_id: string; disclosure_relation: string | null }>(
    `select f.fact_id::text as fact_id, f.supersedes::text as supersedes, f.source_id::text as source_id, c.disclosure_relation
       from facts f
       left join fact_financial_contexts c on c.fact_id = f.fact_id
      where f.subject_kind = 'issuer' and f.subject_id = $1 and f.method = 'restated' and ${factActiveSql("f")}`,
    [input.issuerId],
  );
  const storedLater = new Map(stated.map((row) => [`${row.supersedes}|${row.source_id}`, row]));
  const splitHistories = new Map<string, SubjectSplitHistory>();
  // The listing active on the later filing's date: noon UTC falls on that
  // date in every market from UTC-11 to UTC+11.
  const splitsOn = async (date: string) => {
    const known = splitHistories.get(date);
    if (known) return known;
    const history = await loadSubjectSplitHistory(db, { kind: "issuer", id: input.issuerId }, `${date}T12:00:00.000Z`);
    splitHistories.set(date, history);
    return history;
  };
  const usGaap = input.facts.facts["us-gaap"] ?? {};
  const memo = { sources: new Map<string, UUID>(), published: new Set<string>() };
  const roundingsByValues = new Map<ReadonlyArray<SecConceptValue>, FilingRoundings>();
  for (const original of originals) {
    const located = /#([^|]+)\|([^|]+)\|([^|]+)\|/u.exec(original.source_context_ref ?? "");
    if (!located) continue;
    const [, concept, unit, originalAccession] = located;
    const values = usGaap[concept!]?.units?.[unit!] ?? [];
    const originalFiled = values.find((value) => value.accn === originalAccession)?.filed;
    if (originalFiled === undefined) continue;
    const roundingsFor = (list: ReadonlyArray<SecConceptValue>) => {
      const known = roundingsByValues.get(list) ?? filingRoundings(list, resolveMetricDefinition(original.metric_key)?.value_kind ?? "per_share");
      roundingsByValues.set(list, known);
      return known;
    };
    const roundings = roundingsFor(values);
    const { derivation } = original;
    const record = async (later: LaterStatement, relation: LaterRelation | null) => {
      const current = storedLater.get(`${original.fact_id}|${sourceIdForAccession(later.accession)}`);
      if (current !== undefined && current.disclosure_relation !== relation) {
        await db.query(`update facts set invalidated_at = now(), updated_at = now() where fact_id = $1`, [current.fact_id]);
      }
      if (relation !== null) await storeLaterStatement(db, input, memo, original, later, relation);
    };
    const statements = periodStatements(values, original.period_start, original.period_end, original.fiscal_period === "FY");
    const isLater = ({ accession, filed }: PeriodStatement) => filed >= originalFiled && (derivation !== null || accession !== originalAccession);
    const rescoped = reviewedLines(usGaap, original, concept!, unit!, roundingsFor).filter((line) => line.input !== undefined || isLater(line));
    // A figure in a scoped concept changes scope at an equal figure: a filing
    // that states it only in the reviewed concept restates it there, and a
    // later one stating it in the scoped concept alone restates it back, for
    // continuing-operations OCF (operator 2026-11-22, #752) and productive-assets
    // capex (operator 2026-11-23, #758). Equal is within rounding, so the
    // restatement keeps the figure that stands, from the filing it stands on.
    const unordered = unorderedDates([statements, ...(derivation?.terms ?? []).map((term) => termStatements(values, term))], roundings);
    const sameDay = scopedFiguresByDate(statements, rescoped, roundings, originalFiled);
    let standing: StatedFigure = { value: original.value, as_filed_on: original.as_filed_on, rounding: roundings.get(originalAccession!) ?? null };
    const inputs: RoundedFigure[] = derivation?.terms.map((term) => ({ value: term.raw_token, rounding: roundings.get(term.source.accession) ?? null })) ?? [];
    // A derived figure stands on its unmoved inputs, whose rounding a line may fall within.
    let asDerived = derivation !== null;
    let asReviewed = false;
    let standsOn: LaterStatement | null = null;
    // A restated row sits on the later filing's source, and a derivation proves
    // only a fact on its first input's own source (#758), so a derived figure
    // that a line repeats only within rounding is unverified there.
    const rescope = (later: LaterStatement): [LaterStatement, LaterRelation] =>
      later.token === standing.value || (standsOn === null && original.token_proof_hash === null) ? [later, "economic_restatement"]
      : standsOn === null && derivation !== null ? [later, "unverified_restatement"]
      : [{ ...later, stands: standsOn ?? "original" }, "economic_restatement"];
    for (const filing of filingsInOrder(statements, derivation, values, rescoped)) {
      // Decided once a date, from where the year stands before that day's first filing.
      const day = sameDay.get(filing.filed);
      sameDay.delete(filing.filed);
      if (day !== undefined && opposed(day, { figure: standing, reviewed: asReviewed })) unordered.add(filing.filed);
      // A line in another scope only ever repeats the figure that stands, or leaves it unverified (#731).
      const changed = unordered.has(filing.filed) && filing.rescoped.length > 0
        ? filing.rescoped[0]
        : filing.rescoped.find((line) => sameRoundedFigure(line.term === null ? standing : inputs[line.term]!, { value: line.token, rounding: line.rounding }) !== true);
      if (changed !== undefined) {
        await record(changed, "unverified_restatement");
        break;
      }
      let moved: FiledInput | null = null;
      for (const input of filing.inputs) {
        const figure: RoundedFigure = { value: input.statement.token, rounding: roundings.get(input.statement.accession) ?? null };
        if (sameRoundedFigure(inputs[input.term]!, figure) === true) continue;
        inputs[input.term] = figure;
        moved ??= input;
      }
      if (moved !== null) asDerived = false;
      // A filing that states the reviewed concept reads as it (#731, #743), so once the year stands there it keeps it there.
      // Inputs it repeats unmoved leave the quarter its reviewed line.
      const reviewed = filing.rescoped.find((line) => line.term === null);
      if (moved === null && (filing.statement === null || (asReviewed && reviewed !== undefined)) && (filing.inputs.length === 0 || reviewed !== undefined)) {
        const switched = asReviewed ? undefined : reviewed;
        const [stored, relation] = switched ? rescope(switched) : [filing.rescoped[0]!, null];
        await record(stored, relation);
        if (relation === "unverified_restatement") break;
        if (switched) asReviewed = true;
        continue;
      }
      const statement = filing.statement !== null && isLater(filing.statement) ? filing.statement : null;
      if (statement === null) {
        if (moved !== null) {
          await record({ ...moved.statement, concept: concept!, unit: unit!, input: derivation!.terms[moved.term]! }, "unverified_restatement");
          break;
        }
        await record({ ...(filing.statement ?? filing.inputs[0]!.statement), concept: concept!, unit: unit! }, null);
        continue;
      }
      const figure: StatedFigure = { value: statement.token, as_filed_on: original.as_filed_on === null ? null : statement.filed, rounding: roundings.get(statement.accession) ?? null };
      const relation = unordered.has(statement.filed) || (derivation !== null && !inputsGive(derivation, inputs, figure))
        ? "unverified_restatement"
        : asDerived ? null : await laterRelation(original.metric_key, standing, figure, splitsOn);
      const later: LaterStatement = { ...statement, concept: concept!, unit: unit! };
      // Once the year stands in the reviewed concept, a line in the scoped one
      // alone changes scope back, so only an equal one tells what it states.
      const back = asReviewed && relation === null;
      const [stored, storedRelation] = back ? rescope(later) : [later, asReviewed ? "unverified_restatement" : relation];
      await record(stored, storedRelation);
      if (storedRelation === "unverified_restatement") break;
      asReviewed = false;
      if (relation !== null) {
        standing = figure;
        standsOn = later;
        asDerived = false;
      }
    }
  }
}

const FORMS_STATING_A_YEAR = ["10-K", "10-K/A"];
const FORMS_STATING_A_QUARTER = [...FORMS_STATING_A_YEAR, "10-Q", "10-Q/A"];

/** One filing's statement of a period. */
type PeriodStatement = Readonly<{ accession: string; filed: string; form: string; token: string }>;

// Each filing's one statement of a period, in filing order. A 10-Q states a
// year-end balance as a comparative, so a year reads 10-Ks only.
function periodStatements(values: ReadonlyArray<SecConceptValue>, start: string | null, end: string, annual: boolean): PeriodStatement[] {
  const forms = annual ? FORMS_STATING_A_YEAR : FORMS_STATING_A_QUARTER;
  const byFiling = new Map<string, { filed: string; form: string; tokens: Set<string | null> }>();
  for (const value of values) {
    if (!forms.includes(value.form) || (value.start ?? null) !== start || value.end !== end) continue;
    const filing = byFiling.get(value.accn) ?? { filed: value.filed, form: value.form, tokens: new Set() };
    filing.tokens.add(value.val_token ?? null);
    byFiling.set(value.accn, filing);
  }
  return [...byFiling].flatMap(([accession, { filed, form, tokens }]) => {
    const [token, ...others] = tokens;
    return others.length > 0 || token === null || token === undefined ? [] : [{ accession, filed, form, token }];
  }).sort((left, right) => left.filed.localeCompare(right.filed) || left.accession.localeCompare(right.accession));
}

/** A filing's line in the metric's reviewed concept, at that filing's rounding, for the period (term null) or one of a derived quarter's inputs. */
type RescopedLine = LaterStatement & Readonly<{ rounding: number | null; term: number | null }>;

/**
 * A filing's capex is its PP&E line when it states one, as extraction reads it
 * (US_GAAP_TO_METRIC_KEY's order). So for an original in a scoped concept
 * (secConceptScope), each filing's line in the metric's reviewed concept states
 * the period, or a derived quarter's input, in another scope. An input's own
 * filing is left out: its derivation already read that filing in this concept.
 */
function reviewedLines(
  usGaap: Readonly<Record<string, SecConcept>>,
  original: SecOriginal,
  concept: string,
  unit: string,
  roundingsOf: (values: ReadonlyArray<SecConceptValue>) => FilingRoundings,
): RescopedLine[] {
  const reviewed = SEC_CERTIFIED_CONCEPTS[original.metric_key];
  if (reviewed === undefined || secConceptScope(original.metric_key, concept) === null) return [];
  const values = usGaap[reviewed]?.units?.[unit] ?? [];
  const roundings = roundingsOf(values);
  const line = (term: number | null, input?: DerivationTerm) => (statement: PeriodStatement): RescopedLine =>
    ({ ...statement, concept: reviewed, unit, rounding: roundings.get(statement.accession) ?? null, term, ...(input ? { input } : {}) });
  return [
    ...periodStatements(values, original.period_start, original.period_end, original.fiscal_period === "FY").map(line(null)),
    ...(original.derivation?.terms ?? []).flatMap((input, term) =>
      termStatements(values, input).filter(({ accession }) => accession !== input.source.accession).map(line(term, input))),
  ];
}

type DerivationTerm = DerivationProofV1["terms"][number];

function termStatements(values: ReadonlyArray<SecConceptValue>, term: DerivationTerm): PeriodStatement[] {
  return periodStatements(values, term.start, term.end, term.span === "fiscal_year").filter(({ filed }) => filed >= term.source.filed);
}

/** The dates two filings state one figure differently, beyond rounding. Accession order is not filing order, so nothing tells which stands. */
function unorderedDates(statementLists: ReadonlyArray<ReadonlyArray<PeriodStatement>>, roundings: FilingRoundings): Set<string> {
  const figure = ({ accession, token }: PeriodStatement): RoundedFigure => ({ value: token, rounding: roundings.get(accession) ?? null });
  return new Set(statementLists.flatMap((statements) => statements
    .filter((one, index) => statements.slice(index + 1).some((other) => other.filed === one.filed && sameRoundedFigure(figure(one), figure(other)) !== true))
    .map(({ filed }) => filed)));
}

/** One filing's statement of a scoped figure's period, in the scoped and the reviewed concept (#752, #758). */
type ScopedFigures = { filed: string; scoped?: RoundedFigure; reviewed?: RoundedFigure };

/** The figure a period stands at, and whether in the reviewed concept, or null once unverified. */
type Standing = Readonly<{ figure: RoundedFigure; reviewed: boolean }> | null;

/** Each date's filings of a period from the original's date on, the original included, by scope. One filing's two scopes are its own to reconcile (#731, #743). */
function scopedFiguresByDate(
  statements: ReadonlyArray<PeriodStatement>,
  lines: ReadonlyArray<RescopedLine>,
  roundings: FilingRoundings,
  originalFiled: string,
): Map<string, ScopedFigures[]> {
  const byFiling = new Map<string, ScopedFigures>();
  const of = ({ accession, filed }: PeriodStatement) => byFiling.get(accession) ?? byFiling.set(accession, { filed }).get(accession)!;
  for (const statement of statements) {
    if (statement.filed >= originalFiled) of(statement).scoped = { value: statement.token, rounding: roundings.get(statement.accession) ?? null };
  }
  for (const line of lines) if (line.term === null) of(line).reviewed = { value: line.token, rounding: line.rounding };
  return Map.groupBy(byFiling.values(), ({ filed }) => filed);
}

/** How recordSecRestatements' walk reads one filing of a stated period from where it stands. */
function read(stands: Standing, { scoped, reviewed }: ScopedFigures): Standing {
  if (stands === null || (reviewed !== undefined && sameRoundedFigure(stands.figure, reviewed) !== true)) return null;
  if (scoped === undefined || (stands.reviewed && reviewed !== undefined)) return { figure: stands.figure, reviewed: true };
  const same = sameRoundedFigure(stands.figure, scoped);
  return same === true ? { figure: stands.figure, reviewed: false } : same === false && !stands.reviewed ? { figure: scoped, reviewed: false } : null;
}

/**
 * Whether one date's filings fail to leave a period standing at one figure in
 * one scope in every order. Accession order is not filing order, so nothing
 * tells which stands (#752, #756). An order that leaves it unverified stands
 * nowhere, and the walk would store that day's filings before it as if read first.
 */
function opposed(filings: ReadonlyArray<ScopedFigures>, stands: Standing): boolean {
  if (filings.length < 2) return false;
  const [first, ...others] = orders(filings).map((order) => order.reduce(read, stands));
  return first === null || others.some((other) => other === null || other.reviewed !== first!.reviewed || sameRoundedFigure(other.figure, first!.figure) !== true);
}

// ponytail: every order, n! of a day's filings of one period, which are two or three.
function orders<T>(items: ReadonlyArray<T>): T[][] {
  return items.length <= 1 ? [[...items]] : items.flatMap((item, index) => orders(items.toSpliced(index, 1)).map((rest) => [item, ...rest]));
}

/** A later filing's statement of one of a derived quarter's inputs, by its place among the terms. */
type FiledInput = Readonly<{ term: number; statement: PeriodStatement }>;

type WalkedFiling = { filed: string; accession: string; statement: PeriodStatement | null; inputs: FiledInput[]; rescoped: RescopedLine[] };

/** What each filing states of a period and of a derived quarter's inputs, in either scope, in filing order. */
function filingsInOrder(
  statements: ReadonlyArray<PeriodStatement>,
  derivation: DerivationProofV1 | null,
  values: ReadonlyArray<SecConceptValue>,
  rescoped: ReadonlyArray<RescopedLine>,
): WalkedFiling[] {
  const filings = new Map<string, WalkedFiling>();
  const filingOf = ({ accession, filed }: PeriodStatement) => {
    const filing = filings.get(accession) ?? { filed, accession, statement: null, inputs: [], rescoped: [] };
    filings.set(accession, filing);
    return filing;
  };
  for (const statement of statements) filingOf(statement).statement = statement;
  for (const [term, derived] of (derivation?.terms ?? []).entries()) {
    for (const statement of termStatements(values, derived)) filingOf(statement).inputs.push({ term, statement });
  }
  for (const line of rescoped) filingOf(line).rescoped.push(line);
  return [...filings.values()].sort((left, right) => left.filed.localeCompare(right.filed) || left.accession.localeCompare(right.accession));
}

/** Whether a derived quarter's inputs, as they stand, sum to a line for it within their rounding. */
function inputsGive(derivation: DerivationProofV1, inputs: ReadonlyArray<RoundedFigure>, line: RoundedFigure): boolean {
  const sum = derivationValue({ ...derivation, terms: derivation.terms.map((term, index) => ({ ...term, raw_token: inputs[index]!.value })) });
  return sum !== null && sumWithinRounding(line, sum, inputs.map((input) => input.rounding));
}

/** Each filing's rounding of one concept and unit (filingRounding). */
type FilingRoundings = ReadonlyMap<string, number | null>;

function filingRoundings(values: ReadonlyArray<SecConceptValue>, valueKind: MetricValueKind): FilingRoundings {
  const tokens = new Map<string, string[]>();
  for (const { accn, val_token } of values) {
    if (val_token !== undefined) tokens.set(accn, [...(tokens.get(accn) ?? []), val_token]);
  }
  return new Map([...tokens].map(([accn, stated]) => [accn, filingRounding(stated, valueKind)]));
}

type RestatementInput = Readonly<{
  facts: SecCompanyFacts;
  cik: number;
  issuerId: UUID;
  evidence: SecFetchEvidence;
  clock: () => Date;
}>;

type SecOriginal = {
  fact_id: string;
  metric_id: string;
  metric_key: string;
  period_kind: string;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  value: string;
  unit: string;
  currency: string | null;
  scale: string;
  source_context_ref: string | null;
  as_filed_on: string | null;
  share_basis: ShareBasis;
  // A later filing's figure stands in on the same basis as the original's.
  inference: NoncontrollingInterestInferenceV1 | null;
  /** A derived quarter's proof over its inputs; null for a stated figure. */
  derivation: DerivationProofV1 | null;
  token_proof_hash: string | null;
  source_locator: string | null;
};

/** A figure as a filing states it, that filing's rounding, and the filing date whose split basis it is on: null for a value splits do not move. */
type StatedFigure = RoundedFigure & Readonly<{ as_filed_on: string | null }>;

type LaterRelation = "economic_restatement" | "unverified_restatement";

/**
 * How a later filing's figure for a period relates to the one that stands, null
 * when it is the same figure at the coarser of their filings' roundings. A
 * difference only a filing too short to show its rounding could hide is unverified.
 * An as-filed figure is compared on the listing's splits between the two filing
 * dates, so an equal one across a split has changed. Without those splits on file
 * an equal figure is the same one and any other is unverified.
 */
async function laterRelation(
  metricKey: string,
  standing: StatedFigure,
  later: StatedFigure,
  splitsOn: (date: string) => Promise<SubjectSplitHistory>,
): Promise<LaterRelation | null> {
  const same = sameRoundedFigure(standing, later);
  if (standing.as_filed_on === null || later.as_filed_on === null) return same === true ? null : same === false ? "economic_restatement" : "unverified_restatement";
  const history = await splitsOn(later.as_filed_on);
  if (history.status !== "ok" || !splitHistoryCovers(history.checked_at, later.as_filed_on, history.timezone)) return same === true ? null : "unverified_restatement";
  const definition = resolveMetricDefinition(metricKey);
  const explained = definition === null ? null : explainedBySplits({
    earlier: { ...standing, as_filed_on: standing.as_filed_on },
    later: { ...later, as_filed_on: later.as_filed_on },
    value_kind: definition.value_kind,
    splits: history.splits,
  });
  return explained === true ? null : explained === false ? "economic_restatement" : "unverified_restatement";
}

/**
 * A later filing's statement of an original's period, or, for a derived quarter
 * whose `input` it changes, of that input alone.
 */
type LaterStatement = PeriodStatement & Readonly<{
  concept: string;
  unit: string;
  input?: DerivationTerm;
  /** For a change of scope only: the statement whose figure it repeats within rounding and stores, or the original (#752, #758). */
  stands?: LaterStatement | "original";
}>;

/**
 * Stores a later filing's statement of an original's period on the restating
 * filing's source, unless that filing's statement is already stored. A changed
 * input says nothing of the quarter's own figure, so its row keeps the standing
 * figure and that figure's proof, and locates the input. Selection never binds
 * it: it only makes as_restated a gap from that filing on.
 */
async function storeLaterStatement(
  db: FundamentalsQueryExecutor,
  input: RestatementInput,
  memo: { sources: Map<string, UUID>; published: Set<string> },
  original: SecOriginal,
  later: LaterStatement,
  relation: LaterRelation,
): Promise<void> {
  const asOf = input.evidence.completed_at;
  let sourceId = memo.sources.get(later.accession);
  if (sourceId === undefined) {
    sourceId = await upsertSecFilingSource(db, secFilingSource(input.cik, later.accession, asOf));
    memo.sources.set(later.accession, sourceId);
  }
  const sourceToken = (statement: LaterStatement): SecSourceToken => ({
    token: statement.token,
    concept: statement.concept,
    unit: statement.unit,
    accn: statement.accession,
    form: statement.form,
    filed: statement.filed,
    start: statement.input ? statement.input.start : original.period_start,
    end: statement.input ? statement.input.end : original.period_end,
  });
  const proven = (token: SecSourceToken) => ({ value: token.token, proof: secTokenProofHash(input.cik, token), locator: secTokenLocator(input.cik, token) });
  // A changed input stores the figure that stands with its proof, and locates
  // the input. A change of scope stores the figure that stands, proved and
  // located in the filing that states it.
  const stored = later.stands === "original"
    ? { value: original.value, proof: original.token_proof_hash!, locator: original.source_locator! }
    : later.stands ? proven(sourceToken(later.stands))
    : later.input ? { ...proven(sourceToken(later)), value: original.value, proof: original.token_proof_hash! }
    : proven(sourceToken(later));
  const inserted = await db.query<{ fact_id: string }>(
    `insert into facts (
       subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
       value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, definition_version,
       verification_status, freshness_class, coverage_level, confidence, supersedes, quality_flags
     ) values (
       'issuer', $1, $2, $3, $4, $5, $6, $17, $7, $8, $9, $10, $11, $15, $12, $13, 'restated', 1,
       'authoritative', 'filing_time', 'full', 1, $14, $16::jsonb
     )
     on conflict do nothing
     returning fact_id::text as fact_id`,
    [
      input.issuerId, original.metric_id, original.period_kind, original.period_start, original.period_end, original.fiscal_year,
      stored.value, original.unit, original.currency, original.scale, asOf, input.clock().toISOString(), sourceId, original.fact_id,
      later.filed,
      JSON.stringify([original.inference, secConceptScope(original.metric_key, later.concept)].filter((flag) => flag !== null)),
      original.fiscal_period,
    ],
  );
  // The restating filing need not be the one this ingest is for; this
  // download listing it proves it was public by the download's completion,
  // and an earlier download may be the tighter proof of a row already stored.
  if (!memo.published.has(later.accession)) {
    await recordSecFetchPublication(db, { sourceId, accessionNumber: later.accession, evidence: input.evidence });
    memo.published.add(later.accession);
  }
  const factId = inserted.rows[0]?.fact_id;
  if (!factId) return;
  await recordFactPrecisionAttestation(db, {
    fact_id: factId,
    precision_class: "source_token_preserved",
    raw_token: stored.value,
    token_proof_hash: stored.proof,
    source_locator: stored.locator,
    validation_method: later.input ? "sec_companyfacts_changed_input.v1" : later.stands ? "sec_companyfacts_rescoped_figure.v1" : "sec_companyfacts_lossless_json.v1",
  });
  await recordFactFinancialContext(db, {
    fact_id: factId,
    context_version: SEC_CONTEXT_VERSION,
    period_type: original.period_start === null ? "instant" : "duration",
    dimension_scope: "consolidated",
    dimension_members: [],
    reporting_basis: "as_restated",
    ...(original.as_filed_on === null ? { adjustment_basis: "unadjusted" } : { adjustment_basis: "as_filed", as_filed_on: later.filed }),
    share_basis: original.share_basis,
    fiscal_calendar_version: "sec_filer_fiscal_year.v1",
    disclosure_relation: relation,
    source_context_ref: stored.locator,
  });
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
