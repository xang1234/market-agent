import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "pg";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createFact, type FactInput } from "../../evidence/src/fact-repo.ts";
import { loadUsableFacts } from "../src/usable-facts.ts";

// One rule per subtest (#159). Each fact gets its own fiscal year, so a rule's
// effect shows as that year being present or absent.
const ISSUER_ID = "11111111-1111-4111-8111-111111111111";
const CUTOFF = "2026-06-01T00:00:00.000Z";
const BEFORE = "2026-05-01T00:00:00.000Z";
const AFTER = "2026-07-01T00:00:00.000Z";

async function seedSource(client: Client, provider: string): Promise<string> {
  const { rows } = await client.query<{ source_id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
     values ($1, 'filing', 'primary', 'test', now())
     returning source_id::text as source_id`,
    [provider],
  );
  return rows[0].source_id;
}

async function seedRevenueMetric(client: Client): Promise<string> {
  const { rows } = await client.query<{ metric_id: string }>(
    `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ('revenue', 'Revenue', 'currency', 'sum', 'higher_is_better', 'gaap')
     returning metric_id::text as metric_id`,
  );
  return rows[0].metric_id;
}

test("loadUsableFacts applies every rule for facts that ground a sealed answer", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "usable-facts");
  const client = await connectedClient(t, databaseUrl);
  const sourceA = await seedSource(client, "a");
  const sourceB = await seedSource(client, "b");
  const metricId = await seedRevenueMetric(client);
  const fact = (fiscal_year: number, overrides: Partial<FactInput> = {}) =>
    createFact(client, {
      subject_kind: "issuer",
      subject_id: ISSUER_ID,
      metric_id: metricId,
      period_kind: "fiscal_y",
      fiscal_year,
      fiscal_period: "FY",
      value_num: fiscal_year,
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
  const years = async (options: Partial<Parameters<typeof loadUsableFacts>[1]> = {}) =>
    (await loadUsableFacts(client, { subjectKind: "issuer", subjectIds: [ISSUER_ID], ...options }))
      .map((row) => row.fiscal_year);

  await fact(2000); // the control: usable under every rule

  await t.test("eligibility: reported, active, app-entitled, display-verified", async () => {
    await fact(2001, { verification_status: "candidate" });
    await fact(2002, { method: "estimated" });
    await fact(2003, { entitlement_channels: ["export"] });
    const invalidated = await fact(2004);
    await client.query(`update facts set invalidated_at = now() where fact_id = $1::uuid`, [invalidated.fact_id]);
    const usable = await years();
    assert.ok(usable.includes(2000));
    for (const year of [2001, 2002, 2003, 2004]) assert.ok(!usable.includes(year), `FY${year} should be excluded`);
  });

  await t.test("numeric: text-only facts are excluded when numbers are required", async () => {
    await fact(2005, { value_num: null, value_text: "not disclosed" } as Partial<FactInput>);
    assert.ok(!(await years({ numericOnly: true })).includes(2005));
    assert.ok((await years({ numericOnly: false })).includes(2005));
  });

  await t.test("dated: a fiscal period needs its year and period; a point fact does not", async () => {
    await fact(2006, { fiscal_period: null } as Partial<FactInput>);
    await fact(2007, { period_kind: "point", fiscal_period: null, period_end: "2007-12-31" } as Partial<FactInput>);
    const usable = await years();
    assert.ok(!usable.includes(2006));
    assert.ok(usable.includes(2007));
  });

  await t.test("currency: a currency fact must state its currency", async () => {
    await fact(2008, { currency: null } as Partial<FactInput>);
    assert.ok(!(await years()).includes(2008));
  });

  await t.test("canonical: one fact per period, the latest as_of winning", async () => {
    await fact(2009, { value_num: 1, as_of: "2026-04-01T00:00:00.000Z", observed_at: "2026-04-01T00:00:00.000Z" });
    await fact(2009, { value_num: 2, source_id: sourceB });
    const rows = (await loadUsableFacts(client, { subjectKind: "issuer", subjectIds: [ISSUER_ID] }))
      .filter((row) => row.fiscal_year === 2009);
    assert.deepEqual(rows.map((row) => row.value_num), [2]);
  });

  await t.test("cutoff: as_of, observed_at and reported_at must all be known by it", async () => {
    await fact(2010, { as_of: AFTER, observed_at: AFTER });
    await fact(2011, { observed_at: AFTER });
    await fact(2012, { reported_at: AFTER } as Partial<FactInput>);
    const atCutoff = await years({ cutoff: CUTOFF });
    assert.ok(atCutoff.includes(2000));
    for (const year of [2010, 2011, 2012]) assert.ok(!atCutoff.includes(year), `FY${year} was not known at the cutoff`);
    // Without a cutoff ("now"), all three are usable.
    const now = await years();
    for (const year of [2010, 2011, 2012]) assert.ok(now.includes(year));
  });
});
