import test from "node:test";
import assert from "node:assert/strict";

import { auditClaimPeriods } from "../src/claim-period-audit-cli.ts";
import { createClaimArgument } from "../src/claim-argument-repo.ts";
import { createClaim, type ClaimPeriod } from "../src/claim-repo.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

test("the census flags a bound period its issuer's facts do not hold, in a fiscal year they cover", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "claim-period-audit");
  const client = await connectedClient(t, databaseUrl);
  const issuerId = (await client.query<{ id: string }>(
    `insert into issuers (legal_name, cik) values ('Advanced Micro Devices Inc', '0000002488') returning issuer_id::text as id`,
  )).rows[0]!.id;
  const sourceId = (await client.query<{ id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
     values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text as id`,
  )).rows[0]!.id;
  const metricId = (await client.query<{ id: string }>(
    `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ('gross_profit', 'Gross Profit', 'currency', 'sum', 'higher_is_better', 'filing') returning metric_id::text as id`,
  )).rows[0]!.id;
  // AMD's fiscal 2025 quarters through Q3.
  for (const [period, start, end] of [["Q1", "2024-12-29", "2025-03-29"], ["Q2", "2025-03-30", "2025-06-28"], ["Q3", "2025-06-29", "2025-09-27"]]) {
    await client.query(
      `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                          value_num, unit, currency, as_of, observed_at, source_id, method, verification_status,
                          freshness_class, coverage_level, confidence)
       values ('issuer', $1, $2, 'fiscal_q', $3, $4, 2025, $5, 1, 'currency', 'USD', now(), now(), $6, 'reported',
               'authoritative', 'filing_time', 'full', 1)`,
      [issuerId, metricId, start, end, period, sourceId],
    );
  }
  const bind = async (period: ClaimPeriod) => {
    const documentId = (await client.query<{ id: string }>(
      `insert into documents (source_id, kind, content_hash, raw_blob_id)
       values ($1, 'filing', $2, $2) returning document_id::text as id`,
      [sourceId, `sha256:${period.kind}-${period.end}`],
    )).rows[0]!.id;
    const claim = await createClaim(client, {
      document_id: documentId,
      predicate: "management.explanation.gross_margin",
      text_canonical: `Gross margin moved in the period ended ${period.end}.`,
      polarity: "neutral",
      modality: "quoted",
      reported_by_source_id: sourceId,
      attributed_to_type: "issuer",
      attributed_to_id: issuerId,
      confidence: 0.8,
      status: "extracted",
      period,
    });
    await createClaimArgument(client, { claim_id: claim.claim_id, subject_kind: "issuer", subject_id: issuerId, role: "subject" });
  };
  const statuses = async () => (await auditClaimPeriods(client)).map((row) => [row.period.kind, row.period.end, row.status]);

  // The quarter the facts hold, and one past them (its facts are not in yet).
  await bind({ kind: "fiscal_q", end: "2025-06-28" });
  await bind({ kind: "fiscal_q", end: "2025-12-27" });
  assert.deepEqual(await statuses(), [
    ["fiscal_q", "2025-06-28", "matched"],
    ["fiscal_q", "2025-12-27", "uncovered"],
  ]);

  // A calendar quarter's end, and the quarter's end read as a year's: fiscal
  // 2025 has facts, and none ends there in that kind.
  await bind({ kind: "fiscal_q", end: "2025-06-30" });
  await bind({ kind: "fiscal_y", end: "2025-06-28" });
  assert.deepEqual(await statuses(), [
    ["fiscal_q", "2025-06-28", "matched"],
    ["fiscal_y", "2025-06-28", "mismatched"],
    ["fiscal_q", "2025-06-30", "mismatched"],
    ["fiscal_q", "2025-12-27", "uncovered"],
  ]);

  // Corrected: the misread claims superseded, so no reader cites them.
  await client.query(`update claims set superseded_at = now() where period_end = '2025-06-30' or period_kind = 'fiscal_y'`);
  assert.deepEqual(await statuses(), [
    ["fiscal_q", "2025-06-28", "matched"],
    ["fiscal_q", "2025-12-27", "uncovered"],
  ]);
});
