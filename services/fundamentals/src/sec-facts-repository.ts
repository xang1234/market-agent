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
  extractStatement,
  SecEdgarFetchError,
  SEC_INCOME_METRIC_KEYS,
  US_GAAP_TO_METRIC_KEY,
  type SecCompanyFacts,
  type SecEdgarFetcher,
} from "./sec-edgar.ts";
import { createHash } from "node:crypto";
import { FundamentalsDataUnavailableError } from "./availability.ts";
import {
  normalizedStatement,
  type CoverageLevel,
  type FiscalPeriod,
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

export type SecBackedStatementRepositoryOptions = {
  fetcher?: SecEdgarFetcher | null;
  sourceId: UUID;
  clock?: () => Date;
  logger?: Pick<Console, "warn">;
};

export function createSecBackedStatementRepository(
  db: FundamentalsQueryExecutor,
  options: SecBackedStatementRepositoryOptions,
): StatementRepository {
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? console;

  return {
    async find(lookup: StatementLookup): Promise<NormalizedStatement | null> {
      const existing = await loadStatementFromFacts(db, lookup);
      if (existing) return existing.normalized;

      if (lookup.family !== "income" || lookup.basis !== "as_reported") {
        return null;
      }
      if (!options.fetcher) {
        return null;
      }

      const issuer = await loadIssuer(db, lookup.issuer_id);
      if (!issuer?.cik) {
        return null;
      }

      const cikNumber = Number(issuer.cik);
      if (!Number.isInteger(cikNumber) || cikNumber <= 0) {
        return null;
      }

      const asOf = clock().toISOString();
      try {
        const companyFacts = await fetchCompanyFacts(options.fetcher, cikNumber);
        const accessionNumber = statementAccession(companyFacts, lookup.fiscal_year, lookup.fiscal_period);
        const sourceId = accessionNumber
          ? await upsertSecFilingSource(db, {
              baseSourceId: options.sourceId,
              cik: cikNumber,
              accessionNumber,
              retrievedAt: asOf,
            })
          : options.sourceId;
        const statement = normalizedStatement(extractStatement({
          subject: { kind: "issuer", id: lookup.issuer_id },
          facts: companyFacts,
          family: lookup.family,
          fiscal_year: lookup.fiscal_year,
          fiscal_period: lookup.fiscal_period,
          source_id: sourceId,
          as_of: asOf,
        }));

        const registry = await loadMetricRegistry(db, statement.lines.map((line) => line.metric_key));
        await persistStatementFacts(db, mapStatement(registry, statement), clock);
        return statement;
      } catch (error) {
        const unavailable = classifySecIngestionError(error);
        logger.warn("sec_edgar fundamentals ingestion failed", {
          issuer_id: lookup.issuer_id,
          fiscal_year: lookup.fiscal_year,
          fiscal_period: lookup.fiscal_period,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!unavailable) return null;
        throw unavailable;
      }
    },
  };
}

async function upsertSecFilingSource(
  db: FundamentalsQueryExecutor,
  input: {
    baseSourceId: UUID;
    cik: number;
    accessionNumber: string;
    retrievedAt: string;
  },
): Promise<UUID> {
  const source = buildSecSource({
    source_id: sourceIdForAccession(input.baseSourceId, input.accessionNumber),
    cik: input.cik,
    accession_number: input.accessionNumber,
    retrieved_at: input.retrievedAt,
    content_hash: createHash("sha256").update(input.accessionNumber).digest("hex"),
  });
  const result = await db.query<{ source_id: string }>(
    `insert into sources
       (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at, content_hash)
     values ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz, $8)
     on conflict (source_id)
     do update set canonical_url = excluded.canonical_url,
                   retrieved_at = excluded.retrieved_at,
                   content_hash = excluded.content_hash
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
  return (result.rows[0]?.source_id ?? source.source_id) as UUID;
}

function sourceIdForAccession(baseSourceId: UUID, accessionNumber: string): UUID {
  const digits = accessionNumber.replaceAll("-", "");
  return `${baseSourceId.slice(0, 24)}${digits.slice(0, 12)}` as UUID;
}

function statementAccession(
  facts: SecCompanyFacts,
  fiscalYear: number,
  fiscalPeriod: FiscalPeriod,
): string | null {
  const expectedForm = fiscalPeriod === "FY" ? "10-K" : "10-Q";
  const counts = new Map<string, number>();
  const usGaap = facts.facts["us-gaap"];
  if (!usGaap) return null;
  for (const [conceptName, metricKey] of Object.entries(US_GAAP_TO_METRIC_KEY)) {
    if (!SEC_INCOME_METRIC_KEYS.includes(metricKey)) continue;
    const concept = usGaap[conceptName];
    if (!concept) continue;
    for (const values of Object.values(concept.units)) {
      for (const value of values) {
        if (value.fy !== fiscalYear || value.fp !== fiscalPeriod || value.form !== expectedForm) continue;
        counts.set(value.accn, (counts.get(value.accn) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export type SecBackedStatsRepositoryOptions = {
  statements: StatementRepository;
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
      const latest = await loadLatestFiscalYear(db, issuer_id)
        ?? await discoverLatestFiscalYear(db, issuer_id, options.fetcher ?? null, logger);
      if (!latest) return null;

      const current = await options.statements.find({
        issuer_id,
        family: "income",
        basis: "as_reported",
        fiscal_year: latest.fiscal_year,
        fiscal_period: "FY",
      });
      if (!current) return null;

      const prior = await options.statements.find({
        issuer_id,
        family: "income",
        basis: "as_reported",
        fiscal_year: latest.fiscal_year - 1,
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
    const facts = await fetchCompanyFacts(fetcher, cikNumber);
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
  if (
    message.includes("no us-gaap values") ||
    message.includes('has no "us-gaap" taxonomy') ||
    message.includes("no monetary lines extracted")
  ) {
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
        and f.invalidated_at is null
        and f.superseded_by is null
        and m.metric_key = any($5::text[])
      order by m.metric_key, f.as_of desc, f.created_at desc`,
    [lookup.issuer_id, periodKind, lookup.fiscal_year, lookup.fiscal_period, SEC_INCOME_METRIC_KEYS],
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

async function persistStatementFacts(
  db: FundamentalsQueryExecutor,
  statement: MappedStatement,
  clock: () => Date,
): Promise<void> {
  for (const line of statement.lines) {
    await db.query(
      `insert into facts (
         subject_kind, subject_id, metric_id, period_kind, period_start,
         period_end, fiscal_year, fiscal_period, value_num, value_text,
         unit, currency, scale, as_of, reported_at, observed_at, source_id,
         method, definition_version, verification_status, freshness_class,
         coverage_level, confidence
       ) values (
         'issuer', $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15, $16,
         'reported', 1, 'authoritative', 'filing_time', $17, 1
       )
       on conflict do nothing`,
      [
        statement.subject.id,
        line.metric_id,
        statement.period_kind,
        statement.period_start,
        statement.period_end,
        statement.fiscal_year,
        statement.fiscal_period,
        line.value_num,
        line.value_text ?? null,
        line.unit,
        line.currency ?? null,
        line.scale,
        statement.as_of,
        statement.reported_at,
        clock().toISOString(),
        statement.source_id,
        line.coverage_level,
      ],
    );
  }
}

async function loadLatestFiscalYear(
  db: FundamentalsQueryExecutor,
  issuerId: UUID,
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
        and f.invalidated_at is null
        and f.superseded_by is null
        and m.metric_key = 'revenue'`,
    [issuerId],
  );
  const fiscalYear = result.rows[0]?.fiscal_year;
  return typeof fiscalYear === "number" ? { fiscal_year: fiscalYear } : null;
}

function periodKindFor(fiscalPeriod: FiscalPeriod): PeriodKind {
  return fiscalPeriod === "FY" ? "fiscal_y" : "fiscal_q";
}

function dateString(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function unitClassFor(unit: string): MetricDefinition["unit_class"] {
  if (unit === "shares" || unit === "count") return "count";
  return "currency";
}
