import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "pg";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createFact, type FactInput } from "../../evidence/src/fact-repo.ts";
import { loadVerifierFactsForRefs } from "../../evidence/src/local-runtime-evidence.ts";
import { createSecBackedStatementRepository, createSecBackedStatsRepository } from "../src/sec-facts-repository.ts";

// The comparison path's reads honour the snapshot cutoff (#161).
const ISSUER_ID = "11111111-1111-4111-8111-111111111111";
const CUTOFF = "2026-06-01T00:00:00.000Z";
const BEFORE = "2026-05-01T00:00:00.000Z";
const AFTER = "2026-07-01T00:00:00.000Z";

async function seed(client: Client): Promise<{ sourceA: string; sourceB: string; revenue: string }> {
  const source = async (provider: string) =>
    (await client.query<{ source_id: string }>(
      `insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
       values ($1, 'filing', 'primary', 'test', now()) returning source_id::text as source_id`,
      [provider],
    )).rows[0].source_id;
  const { rows } = await client.query<{ metric_id: string }>(
    `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ('revenue', 'Revenue', 'currency', 'sum', 'higher_is_better', 'gaap')
     returning metric_id::text as metric_id`,
  );
  await client.query(`insert into issuers (issuer_id, legal_name) values ($1::uuid, 'Test Co')`, [ISSUER_ID]);
  return { sourceA: await source("a"), sourceB: await source("b"), revenue: rows[0].metric_id };
}

test("the SEC statement and stats repositories read as of the cutoff", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "sec-facts-cutoff");
  const client = await connectedClient(t, databaseUrl);
  const { sourceA, sourceB, revenue } = await seed(client);
  const fact = (fiscal_year: number, overrides: Partial<FactInput> = {}) =>
    createFact(client, {
      subject_kind: "issuer",
      subject_id: ISSUER_ID,
      metric_id: revenue,
      period_kind: "fiscal_y",
      period_start: `${fiscal_year}-01-01`,
      period_end: `${fiscal_year}-12-31`,
      fiscal_year,
      fiscal_period: "FY",
      value_num: 100,
      unit: "currency",
      currency: "USD",
      as_of: BEFORE,
      observed_at: BEFORE,
      source_id: sourceA,
      method: "reported",
      verification_status: "authoritative",
      freshness_class: "filing_time",
      coverage_level: "full",
      entitlement_channels: ["app"],
      confidence: 1,
      ...overrides,
    } as FactInput);

  await fact(2024, { value_num: 100 });
  // A restatement of FY2024, and a new FY2025, both published after the cutoff.
  await fact(2024, { value_num: 120, source_id: sourceB, as_of: AFTER, observed_at: AFTER });
  const late = await fact(2025, { value_num: 130, as_of: AFTER, observed_at: AFTER });

  const statementsAt = (cutoff?: string) =>
    createSecBackedStatementRepository(client as never, { fetcher: null, sourceId: sourceA, ...(cutoff ? { cutoff } : {}) });
  const lookup = { issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: "FY" } as const;

  await t.test("a statement shows the line known at the cutoff, not a later restatement", async () => {
    const atCutoff = await statementsAt(CUTOFF).find(lookup);
    assert.equal(atCutoff?.lines.find((line) => line.metric_key === "revenue")?.value_num, 100);
    const now = await statementsAt().find(lookup);
    assert.equal(now?.lines.find((line) => line.metric_key === "revenue")?.value_num, 120);
  });

  await t.test("the latest fiscal year is the latest known at the cutoff", async () => {
    const stats = (cutoff?: string) =>
      createSecBackedStatsRepository(client, { statements: statementsAt(cutoff), fetcher: null, ...(cutoff ? { cutoff } : {}) });
    assert.equal((await stats(CUTOFF).find(ISSUER_ID))?.fiscal_year, 2024);
    assert.equal((await stats().find(ISSUER_ID))?.fiscal_year, 2025);
  });

  await t.test("the cited-fact loader can require facts known by the cutoff", async () => {
    assert.deepEqual(await loadVerifierFactsForRefs(client, { fact_refs: [late.fact_id], cutoff: CUTOFF, requireKnownByCutoff: true }), []);
    // Activity only (as the seal uses it): the fact is active, so it loads.
    assert.equal((await loadVerifierFactsForRefs(client, { fact_refs: [late.fact_id], cutoff: CUTOFF })).length, 1);
  });
});
