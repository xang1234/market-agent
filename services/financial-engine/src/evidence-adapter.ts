// Evidence-backed FinancialEvidencePort. Authorization happens in the
// Evidence repository's SQL; this adapter only maps its rows into the engine's
// candidate shape and classifies database failures as execution errors. Split
// histories are public market data, read from the market service's tables.

import type { FinancialUnit, FiscalPeriod } from "../../financial-core/src/index.ts";
import { FISCAL_PERIODS } from "../../financial-core/src/index.ts";
import { listFinancialInputCandidates, type FinancialInputCandidate } from "../../evidence/src/financial-input-repo.ts";
import { loadListingSplits } from "../../market/src/split-repository.ts";
import type { CandidatePage, CandidateRequest, FinancialEvidencePort, InputCandidate, SplitHistory, SplitHistoryRequest, SqlExecutor } from "./ports.ts";

export function createEvidenceFinancialPort(db: SqlExecutor): FinancialEvidencePort {
  return {
    async listInputCandidates(request: CandidateRequest): Promise<CandidatePage> {
      let page;
      try {
        page = await listFinancialInputCandidates(db, {
          user_id: request.authority.owner_user_id,
          channel: "app",
          scope: "public_information",
          subject: request.subject,
          metric_key: request.metric_key,
          fiscal_year: request.fiscal_year,
          fiscal_period: request.fiscal_period,
          limit: request.limit,
        });
      } catch (error) {
        if (isDatabaseError(error)) return { status: "error", reason_code: "database_error" };
        throw error;
      }
      return { status: "ok", candidates: page.candidates.flatMap(toInputCandidate), truncated: page.truncated };
    },

    // A second share class or venue may have split differently, so more than
    // one listing is as unresolved as none.
    async readSplitHistory({ subject, as_of }: SplitHistoryRequest): Promise<SplitHistory> {
      try {
        const { rows } = await db.query<{ listing_id: string }>(
          `select l.listing_id::text as listing_id
             from listings l join instruments i on i.instrument_id = l.instrument_id
            where i.asset_type = 'common_stock'
              and (case when $1 = 'issuer' then i.issuer_id else l.listing_id end) = $2::uuid
              and (l.active_from is null or l.active_from <= $3::timestamptz)
              and (l.active_to is null or l.active_to > $3::timestamptz)`,
          [subject.kind, subject.id, as_of],
        );
        if (rows.length !== 1) return { status: "gap", reason_code: "split_listing_unresolved" };
        const listingId = rows[0]!.listing_id;
        const history = await loadListingSplits(db, listingId);
        if (history.checked_at === null) return { status: "gap", reason_code: "split_history_missing" };
        return {
          status: "ok",
          listing_id: listingId,
          checked_at: history.checked_at,
          splits: history.splits.map(({ execution_date, split_from, split_to }) => ({ execution_date, split_from, split_to })),
        };
      } catch (error) {
        if (isDatabaseError(error)) return { status: "gap", reason_code: "database_error" };
        throw error;
      }
    },
  };
}

/** Rows without a fiscal period the contract can express cannot be candidates. */
function toInputCandidate(row: FinancialInputCandidate): InputCandidate[] {
  if (row.fiscal_year === null || row.period_end === null || !isFiscalPeriod(row.fiscal_period)) return [];
  return [
    {
      fact_id: row.fact_id,
      source_id: row.source_id,
      source_version_hash: row.source_version_hash,
      metric_key: row.metric_key,
      period: { start: row.period_start, end: row.period_end, fiscal_year: row.fiscal_year, fiscal_period: row.fiscal_period },
      value_text: row.value_text,
      scale_text: row.scale_text,
      unit: financialUnit(row.unit, row.currency),
      method: row.method,
      verification_status: row.verification_status,
      reported_at: row.reported_at,
      observed_at: row.observed_at,
      supersedes: row.supersedes,
      superseded_by: row.superseded_by,
      context: row.context,
      precision: row.precision,
      publication: row.publication.map((proof) => ({
        attestation_id: proof.attestation_id,
        timing: {
          available_not_before: proof.available_not_before,
          available_no_later_than: proof.available_no_later_than,
          timing_precision: proof.timing_precision,
          source_timezone: proof.source_timezone,
        },
      })),
    },
  ];
}

function financialUnit(unit: string, currency: string | null): FinancialUnit | null {
  if ((unit === "currency" || unit === "currency_per_share") && currency !== null && /^[A-Z]{3}$/u.test(currency)) {
    return { kind: unit, currency };
  }
  if (unit === "shares" || unit === "count") return { kind: unit };
  return null;
}

function isFiscalPeriod(value: string | null): value is FiscalPeriod {
  return value !== null && (FISCAL_PERIODS as ReadonlyArray<string>).includes(value);
}

/** Postgres/driver failures carry a SQLSTATE code or a connection error code. */
function isDatabaseError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return /^[0-9A-Z]{5}$/u.test(code) || code.startsWith("ECONN") || code === "ETIMEDOUT";
}
