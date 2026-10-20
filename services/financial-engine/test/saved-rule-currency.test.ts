import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { recordFactPrecisionAttestation, recordSourcePublicationAttestation } from "../../evidence/src/financial-attestations.ts";
import { recordFactFinancialContext } from "../../evidence/src/financial-context.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { translateSavedRule, type SavedMetricRule } from "../src/saved-rule.ts";
import { authorityFor, databaseUrl, engineDatabase, HASH, IDS } from "./db-fixtures.ts";

const CUTOFF = "2024-03-01T00:00:00.000Z";
const RULE: SavedMetricRule = { metric_key: "gross_profit", unit: "currency", period_kind: "fiscal_y", operator: "gt", threshold: "1", max_age_days: 730 };

test("a generic currency rule takes its currency only from evidence that binding could use at the cutoff", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for saved-rule coverage");
    return;
  }
  const db = await engineDatabase(t, "saved-rule-currency");
  const pool = await connectedPool(t, databaseUrl(db));
  const thresholdUnit = async () => {
    const translation = await translateSavedRule(
      { pool, evidence: createEvidenceFinancialPort },
      { authority: authorityFor(), subject: { kind: "issuer", id: IDS.issuerA }, rule: RULE, as_of: CUTOFF },
    );
    return translation.ok ? translation.draft.thresholds[0]!.unit : translation.reason;
  };
  const euroFact = async (fact: { source: string; year: number; proven?: boolean; invalidated?: boolean }) => {
    const factId = (await db.query<{ fact_id: string }>(
      `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                          value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                          freshness_class, coverage_level, confidence)
       values ('issuer', $1, $2, 'fiscal_y', make_date($3, 1, 1), make_date($3, 12, 31), $3, 'FY', 1, 'currency', 'EUR', 1,
               '2024-02-01T00:00:00Z', '2024-01-10T00:00:00Z', '2024-02-01T00:00:00Z', $4, 'reported', 'authoritative', 'filing_time', 'full', 1)
       returning fact_id::text`,
      [IDS.issuerA, IDS.grossProfit, fact.year, fact.source],
    )).rows[0]!.fact_id;
    if (fact.proven ?? true) {
      await recordFactPrecisionAttestation(db, {
        fact_id: factId, precision_class: "source_token_preserved", raw_token: "1", token_proof_hash: HASH.proof, source_locator: `locator:${factId}`, validation_method: "fixture",
      });
      await recordFactFinancialContext(db, {
        fact_id: factId, context_version: "context.v1", period_type: "duration", dimension_scope: "consolidated", dimension_members: [],
        reporting_basis: "as_reported", adjustment_basis: "unadjusted", share_basis: "not_applicable", fiscal_calendar_version: "fiscal-calendar.v1",
        disclosure_relation: "original", source_context_ref: null,
      });
    }
    if (fact.invalidated) await db.query(`update facts set invalidated_at = now() where fact_id = $1`, [factId]);
  };
  const publishedAfterCutoff = randomUUID();
  const laterHash = "4".repeat(64);
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash, user_id)
     values ($1, 'sec_edgar', 'filing', 'primary', 'public', '2024-06-01T00:00:00Z', $2, null)`,
    [publishedAfterCutoff, `sha256:${laterHash}`],
  );
  await recordSourcePublicationAttestation(db, {
    source_id: publishedAfterCutoff, document_id: null, source_version_hash: laterHash, available_not_before: null,
    available_no_later_than: "2024-06-01T23:59:59.999-05:00", timing_precision: "date", source_timezone: "America/New_York",
    proof_method: "accession_bound_archive", proof_ref: `proof:${publishedAfterCutoff}`, proof_hash: HASH.proof, mapping_version: "test-accession-archive.v1",
  });

  assert.deepEqual(await thresholdUnit(), { kind: "currency", currency: "USD" });
  await euroFact({ source: IDS.privateSource, year: 2023 });
  await euroFact({ source: IDS.sourceV1, year: 2020, invalidated: true });
  await euroFact({ source: IDS.sourceV2, year: 2023, proven: false });
  await euroFact({ source: publishedAfterCutoff, year: 2021 });
  assert.deepEqual(await thresholdUnit(), { kind: "currency", currency: "USD" }, "private, invalidated, unproven, and not-yet-public facts never bind");
  await euroFact({ source: IDS.sourceV2, year: 2022 });
  assert.equal(await thresholdUnit(), "unit_does_not_match_definition", "a second bindable currency is still ambiguous");
});
