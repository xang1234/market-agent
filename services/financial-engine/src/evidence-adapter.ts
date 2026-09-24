// Evidence-backed FinancialEvidencePort. Authorization happens in the
// Evidence repository's SQL; this adapter only maps its rows into the engine's
// candidate shape and classifies database failures as execution errors.

import type { FinancialUnit, FiscalPeriod } from "../../financial-core/src/index.ts";
import { FISCAL_PERIODS } from "../../financial-core/src/index.ts";
import { listFinancialInputCandidates, type FinancialInputCandidate } from "../../evidence/src/financial-input-repo.ts";
import type { CandidatePage, CandidateRequest, FinancialEvidencePort, InputCandidate, SqlExecutor } from "./ports.ts";

export function createEvidenceFinancialPort(db: SqlExecutor): FinancialEvidencePort {
  return {
    async listInputCandidates(request: CandidateRequest): Promise<CandidatePage> {
      let page;
      try {
        page = await listFinancialInputCandidates(db as Parameters<typeof listFinancialInputCandidates>[0], {
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
