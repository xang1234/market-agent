// Real-PostgreSQL fixtures for engine tests. Evidence is written through the
// production Evidence writers so proofs obey the same rules as ingestion.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Client } from "pg";
import { bootstrapDatabase, connectedClient, connectedPool, registerLifoCleanup } from "../../../db/test/docker-pg.ts";
import { recordFactPrecisionAttestation, recordSourcePublicationAttestation } from "../../evidence/src/financial-attestations.ts";
import { recordFactFinancialContext } from "../../evidence/src/financial-context.ts";
import {
  createRuntimeAuthority,
  validateFinancialPlan,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
} from "../../financial-core/src/index.ts";
import { snapshotTransactionClient, type SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { executeRun } from "../src/execute.ts";
import { acquireLease, type RunLease } from "../src/lease.ts";
import { reserveRun } from "../src/run-repo.ts";

export const IDS = {
  owner: "4f000000-0000-4000-8000-000000000001",
  other: "4f000000-0000-4000-8000-000000000002",
  issuerA: "4f000000-0000-4000-8000-0000000000a1",
  issuerB: "4f000000-0000-4000-8000-0000000000a2",
  revenue: "4f000000-0000-4000-8000-0000000000b1",
  grossProfit: "4f000000-0000-4000-8000-0000000000b2",
  sourceV1: "4f000000-0000-4000-8000-0000000000c1",
  sourceV2: "4f000000-0000-4000-8000-0000000000c2",
  privateSource: "4f000000-0000-4000-8000-0000000000c3",
  original: "4f000000-0000-4000-8000-0000000000d1",
  restated: "4f000000-0000-4000-8000-0000000000d2",
  fy2022: "4f000000-0000-4000-8000-0000000000d3",
  grossProfit2023: "4f000000-0000-4000-8000-0000000000d4",
  privateB: "4f000000-0000-4000-8000-0000000000d5",
  parent: "4f000000-0000-4000-8000-0000000000f1",
} as const;

export const HASH = { v1: "1".repeat(64), v2: "2".repeat(64), private: "3".repeat(64), proof: "9".repeat(64) } as const;
export const ORIGINAL_REVENUE = "383285000000.123456789012345678";

export async function engineDatabase(t: TestContext, prefix: string): Promise<Client> {
  const { databaseUrl } = await bootstrapDatabase(t, prefix);
  const db = await connectedClient(t, databaseUrl);
  await seedEvidence(db);
  return db;
}

/** The URL of the database `db` is connected to. */
export function databaseUrl(db: Client): string {
  const { user, password, host, port, database } = (db as unknown as { connectionParameters: Record<string, string> }).connectionParameters;
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

export async function connectExtraClient(t: TestContext, db: Client): Promise<Client> {
  return connectedClient(t, databaseUrl(db));
}

/**
 * Waits until `count` other backends are blocked on a lock — an explicit
 * barrier, not a timed sleep. Fails after `deadlineMs`, which means an expected
 * lock conflict never happened.
 */
export async function waitForLockWaiters(observer: Client, count: number, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const waiting = Number((await observer.query(`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`)).rows[0].n);
    if (waiting >= count) return;
    if (Date.now() > deadline) throw new Error(`expected ${count} backend(s) blocked on a lock; none blocked within ${deadlineMs}ms`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function seedEvidence(db: Client): Promise<void> {
  const fact = (id: string, metric: string, source: string, value: string, year: number, links: { supersedes?: string; superseded_by?: string } = {}) =>
    `('${id}', 'issuer', '${source === IDS.privateSource ? IDS.issuerB : IDS.issuerA}', '${metric}', 'fiscal_y', '${year}-01-01', '${year}-12-31', ${year}, 'FY',
      ${value}, 'currency', 'USD', 1, '${year + 1}-02-01T00:00:00Z', '${year + 1}-01-10T00:00:00Z', '${year + 1}-02-01T00:00:00Z', '${source}',
      '${source === IDS.privateSource ? "extracted" : "reported"}', 'authoritative', 'filing_time', 'full', 1,
      ${links.supersedes ? `'${links.supersedes}'` : "null"}, ${links.superseded_by ? `'${links.superseded_by}'` : "null"})`;
  await db.query(`
    insert into users (user_id, email) values ('${IDS.owner}', 'owner@example.test'), ('${IDS.other}', 'other@example.test');
    insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class) values
      ('${IDS.revenue}', 'revenue', 'Revenue', 'currency', 'sum', 'higher_is_better', 'gaap'),
      ('${IDS.grossProfit}', 'gross_profit', 'Gross profit', 'currency', 'sum', 'higher_is_better', 'gaap');
    insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash, user_id) values
      ('${IDS.sourceV1}', 'sec_edgar', 'filing', 'primary', 'public', '2024-02-01T00:00:00Z', 'sha256:${HASH.v1}', null),
      ('${IDS.sourceV2}', 'sec_edgar', 'filing', 'primary', 'public', '2024-02-02T00:00:00Z', '${HASH.v2}', null),
      ('${IDS.privateSource}', 'user_upload', 'upload', 'user', 'user_private', '2024-02-01T00:00:00Z', '${HASH.private}', '${IDS.owner}');
    insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                       value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                       freshness_class, coverage_level, confidence, supersedes, superseded_by) values
      ${fact(IDS.original, IDS.revenue, IDS.sourceV1, ORIGINAL_REVENUE, 2023, { superseded_by: IDS.restated })},
      ${fact(IDS.restated, IDS.revenue, IDS.sourceV2, "383000000000", 2023, { supersedes: IDS.original })},
      ${fact(IDS.fy2022, IDS.revenue, IDS.sourceV1, "365817000000", 2022)},
      ${fact(IDS.grossProfit2023, IDS.grossProfit, IDS.sourceV1, "169148000000", 2023)},
      ${fact(IDS.privateB, IDS.revenue, IDS.privateSource, "5", 2023)};
  `);
  const published = (source: string, version: string, localDate: string) =>
    recordSourcePublicationAttestation(db, {
      source_id: source,
      document_id: null,
      source_version_hash: version,
      available_not_before: null,
      available_no_later_than: `${localDate}T23:59:59.999-05:00`,
      timing_precision: "date",
      source_timezone: "America/New_York",
      proof_method: "accession_bound_archive",
      proof_ref: `proof:${source}`,
      proof_hash: HASH.proof,
      mapping_version: "sec-acceptance-mapping.v1",
    });
  await published(IDS.sourceV1, HASH.v1, "2024-01-10");
  await published(IDS.sourceV2, HASH.v2, "2024-01-20");
  await published(IDS.privateSource, HASH.private, "2024-01-05");
  for (const [factId, token, relation] of [
    [IDS.original, ORIGINAL_REVENUE, "original"],
    [IDS.restated, "383000000000", "economic_restatement"],
    [IDS.fy2022, "365817000000", "original"],
    [IDS.grossProfit2023, "169148000000", "original"],
    [IDS.privateB, "5", "original"],
  ] as const) {
    await recordFactPrecisionAttestation(db, {
      fact_id: factId,
      precision_class: "source_token_preserved",
      raw_token: token,
      token_proof_hash: HASH.proof,
      source_locator: `locator:${factId}`,
      validation_method: "fixture",
    });
    await recordFactFinancialContext(db, {
      fact_id: factId,
      context_version: "context.v1",
      period_type: "duration",
      dimension_scope: "consolidated",
      dimension_members: [],
      reporting_basis: relation === "economic_restatement" ? "as_restated" : "as_reported",
      adjustment_basis: "unadjusted",
      share_basis: "not_applicable",
      fiscal_calendar_version: "fiscal-calendar.v1",
      disclosure_relation: relation,
      source_context_ref: null,
    });
  }
}

export type PlanOptions = {
  cutoff?: string;
  basis?: "as_reported" | "as_restated";
  subjects?: Array<"a" | "b">;
  maxCandidates?: number;
  maxAgeDays?: number | null;
};

/** Revenue FY2023 and FY2022 per subject, plus A's gross margin with a threshold. */
export function revenuePlan(options: PlanOptions = {}): FinancialPlanV1 {
  const subjects = options.subjects ?? ["a"];
  const issuer = { a: IDS.issuerA, b: IDS.issuerB };
  const reported = (slot: string, nodeId: string, metric: string, year: number) => ({
    node_id: nodeId,
    operation: "reported_metric" as const,
    operation_version: "reported_metric.v1",
    subject_slot: slot,
    metric_key: metric,
    period: { kind: "fiscal_period" as const, fiscal_year: year, fiscal_period: "FY" as const },
  });
  const operations = subjects.flatMap((slot) => [reported(slot, `${slot}_rev`, "revenue", 2023), reported(slot, `${slot}_prev`, "revenue", 2022)]);
  const outputs = subjects.flatMap((slot) => [
    { output_id: `${slot}_out_rev`, node_id: `${slot}_rev`, unit_id: `${slot}_unit` },
    { output_id: `${slot}_out_prev`, node_id: `${slot}_prev`, unit_id: `${slot}_unit` },
  ]);
  const plan = {
    schema_version: "financial_plan.v1" as const,
    plan_id: randomUUID(),
    origin: { kind: "chat_request" as const, ref: "chat:turn:1" },
    planner: { kind: "deterministic" as const, adapter_version: "test.v1", model: null, prompt_version: null },
    catalog_version: "catalog.v1",
    interpretation: null,
    subjects: {
      membership: "explicit" as const,
      requested_count: subjects.length,
      resolved_count: subjects.length,
      omitted_count: 0,
      members: subjects.map((slot, index) => ({ slot_id: slot, subject_ref: { kind: "issuer" as const, id: issuer[slot] }, display_order: index, role: index === 0 ? ("primary" as const) : ("peer" as const) })),
    },
    time: { knowledge_cutoff: options.cutoff ?? "2024-01-15T23:59:59.999-05:00", cutoff_timezone: "America/New_York", time_mode: "public_information" as const },
    policies: {
      reporting_basis: options.basis ?? ("as_reported" as const),
      period_policy: "exact_fiscal" as const,
      freshness: { max_age_days: options.maxAgeDays ?? null },
      source_policy_version: "sources.v1",
    },
    metric_definitions: [{ metric_key: "revenue", definition_version: "revenue.v1" }],
    operations,
    outputs,
    publication_units: subjects.map((slot) => ({ unit_id: `${slot}_unit`, kind: "chat_section" as const })),
    thresholds: [],
    limits: { max_subjects: 25, max_periods_per_subject: 20, max_operations: 512, max_outputs: 2000, max_input_candidates: options.maxCandidates ?? 10000, max_concurrent_evidence_tasks: 4 },
    presentation_template_version: "financial-answer.v1",
  };
  const validated = validateFinancialPlan(plan);
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

/**
 * Issuer A across three units: revenue (FY2023, FY2022), gross margin for both
 * years (FY2022 has no gross profit), and a margin screen whose threshold no
 * value meets — a complete, empty screen.
 */
export function marginPlan(options: Pick<PlanOptions, "cutoff"> = {}): FinancialPlanV1 {
  const base = revenuePlan(options);
  const reported = (nodeId: string, metric: string, year: number) => ({
    node_id: nodeId,
    operation: "reported_metric" as const,
    operation_version: "reported_metric.v1",
    subject_slot: "a",
    metric_key: metric,
    period: { kind: "fiscal_period" as const, fiscal_year: year, fiscal_period: "FY" as const },
  });
  const margin = (nodeId: string, numerator: string, revenue: string) =>
    ({ node_id: nodeId, operation: "gross_margin" as const, operation_version: "gross_margin.v1", numerator, revenue });
  const validated = validateFinancialPlan({
    ...base,
    plan_id: randomUUID(),
    metric_definitions: [
      { metric_key: "revenue", definition_version: "revenue.v1" },
      { metric_key: "gross_profit", definition_version: "gross_profit.v1" },
    ],
    operations: [
      reported("a_rev", "revenue", 2023),
      reported("a_gp", "gross_profit", 2023),
      reported("a_rev22", "revenue", 2022),
      reported("a_gp22", "gross_profit", 2022),
      margin("a_gm", "a_gp", "a_rev"),
      margin("a_gm22", "a_gp22", "a_rev22"),
      { node_id: "a_gm_check", operation: "threshold" as const, operation_version: "threshold.v1", subject: "a_gm", threshold_id: "min_gm", comparison: "gte" as const },
    ],
    outputs: [
      { output_id: "out_rev", node_id: "a_rev", unit_id: "rev_unit" },
      { output_id: "out_rev22", node_id: "a_rev22", unit_id: "rev_unit" },
      { output_id: "out_gm", node_id: "a_gm", unit_id: "margin_unit" },
      { output_id: "out_gm22", node_id: "a_gm22", unit_id: "margin_unit" },
      { output_id: "out_check", node_id: "a_gm_check", unit_id: "screen_unit" },
    ],
    publication_units: [
      { unit_id: "rev_unit", kind: "chat_section" as const },
      { unit_id: "margin_unit", kind: "chat_section" as const },
      { unit_id: "screen_unit", kind: "chat_section" as const },
    ],
    thresholds: [{ threshold_id: "min_gm", value: "0.99", unit: { kind: "ratio" as const }, attribution: { kind: "user_request" as const, ref: "chat:turn:1" } }],
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

export function authorityFor(owner: string = IDS.owner, overrides: { mode?: "off" | "shadow" | "enforce"; lease?: { epoch: number; fence_token: string } | null } = {}): FinancialRuntimeAuthority {
  return createRuntimeAuthority({
    owner_user_id: owner,
    egress_channel: "chat",
    parent: { kind: "chat_thread", id: IDS.parent, version: "1" },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "chat", capability: "financial-answer", mode: overrides.mode ?? "shadow" },
    approval_state: "not_required",
    lease: overrides.lease ?? null,
  });
}

/** A new pending run for the plan, leased to `workerId`. */
export async function leasedRun(
  db: Client,
  plan: FinancialPlanV1,
  authority: FinancialRuntimeAuthority = authorityFor(),
  workerId = "worker-1",
): Promise<{ runId: string; lease: RunLease }> {
  const reserved = await reserveRun(db, { authority, request_key: randomUUID(), plan });
  assert.equal(reserved.status, "created");
  const runId = (reserved as { run: { run_id: string } }).run.run_id;
  const acquired = await acquireLease(db, { authority, run_id: runId, worker_id: workerId, ttl_ms: 60_000 });
  assert.equal(acquired.status, "acquired");
  return { runId, lease: (acquired as { lease: RunLease }).lease };
}

/** A run of `plan` executed to ready_to_seal, still leased to `workerId`. */
export async function readyRun(
  db: Client,
  plan: FinancialPlanV1,
  authority: FinancialRuntimeAuthority = authorityFor(),
  workerId = "worker-1",
): Promise<{ runId: string; lease: RunLease }> {
  const leased = await leasedRun(db, plan, authority, workerId);
  const report = await executeRun({ client: db, lease: leased.lease, plan, authority, evidence: createEvidenceFinancialPort, parent_limits: {} });
  assert.equal(report.outcome, "ready_to_seal");
  return leased;
}

/** Pinned pool clients on the same database, released when the test ends. */
export async function pinnedClients(t: TestContext, db: Client, count: number): Promise<SnapshotTransactionClient[]> {
  const pool = await connectedPool(t, databaseUrl(db), { max: count + 1 });
  const clients: SnapshotTransactionClient[] = [];
  for (let index = 0; index < count; index += 1) {
    const client = await pool.connect();
    registerLifoCleanup(t, () => client.release());
    clients.push(snapshotTransactionClient(client));
  }
  return clients;
}
