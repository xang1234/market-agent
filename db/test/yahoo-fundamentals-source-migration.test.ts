import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { dbRoot, dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, createDatabase, startServer } from "./financial-migration-helpers.ts";

const OLD = "00000000-0000-4000-a000-00000000000d";
const YAHOO = "00000000-0000-4000-a000-000000000014";
const OTHER = "00000000-0000-4000-a000-000000000009";
const ISSUER = "0f000000-0000-4000-8000-0000000000a9";
const METRIC = "0f000000-0000-4000-8000-0000000000bb";
const USER = "0f000000-0000-4000-8000-0000000000c1";
const TEMPLATE = "0f000000-0000-4000-8000-0000000000c2";
const SNAPSHOT = "0f000000-0000-4000-8000-0000000000c3";
const YAHOO_FACT = "0f000000-0000-4000-8000-0000000000e1";
const OTHER_FACT = "0f000000-0000-4000-8000-0000000000e2";

test("0078 moves what the Yahoo source wrote off GDELT's id, and a rerun changes nothing", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "yahoo-source-0078");
  const db = await createDatabase(t, server, "yahoo_source_0078");
  await applyCanonicalSchema(db);
  const fact = (id: string, source: string) =>
    `('${id}', 'issuer', '${ISSUER}', '${METRIC}', 'point', '2026-10-01', 20, 'count',
      '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', '${source}', 'vendor', 'authoritative', 'filing_time', 'full', 1)`;
  const block = (...sources: string[]) => JSON.stringify([{ id: "b1", kind: "analyst_consensus", source_refs: sources }]);
  await db.query(`
    insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class) values
      ('${METRIC}', 'analyst_count', 'Analyst count', 'count', 'point', 'neutral', 'vendor');
    insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values
      ('${OLD}', 'gdelt_article_discovery', 'article', 'https://api.gdeltproject.org/api/v2/doc/doc', 'tertiary', 'ephemeral', '2000-01-01T00:00:00Z'),
      ('${OTHER}', 'polygon_market', 'market_data', 'https://api.polygon.io', 'primary', 'licensed', '2000-01-01T00:00:00Z');
    insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, period_end, value_num, unit, as_of, observed_at,
                       source_id, method, verification_status, freshness_class, coverage_level, confidence) values
      ${fact(YAHOO_FACT, OLD)}, ${fact(OTHER_FACT, OTHER)};
    insert into snapshots (snapshot_id, subject_refs, source_ids, as_of, basis, normalization, allowed_transforms) values
      ('${SNAPSHOT}', '[]', '["${OLD}", "${OTHER}"]', '2026-10-01T00:00:00Z', 'reported', 'none', '{}');
    insert into users (user_id, email) values ('${USER}', 'yahoo-0078@example.com');
    insert into analyze_templates (template_id, user_id, name, prompt_template, source_categories, version) values
      ('${TEMPLATE}', '${USER}', 'Earnings', 'Assess', '[]', 1);
    insert into analyze_template_runs (template_id, template_version, snapshot_id, blocks) values
      ('${TEMPLATE}', 1, '${SNAPSHOT}', '${block(OLD, OTHER)}');
    insert into citation_logs (snapshot_id, block_id, ref_kind, ref_id, source_id) values
      ('${SNAPSHOT}', 'b1', 'fact', '${YAHOO_FACT}', '${OLD}');
  `);

  const repaired = async () => ({
    sources: (await db.query(`select provider, kind::text, license_class from sources where source_id = '${YAHOO}'`)).rows,
    gdelt: (await db.query(`select provider from sources where source_id = '${OLD}'`)).rows,
    facts: (await db.query(`select fact_id::text, source_id::text from facts order by fact_id`)).rows,
    manifest: (await db.query(`select source_ids from snapshots`)).rows,
    blocks: (await db.query(`select blocks from analyze_template_runs`)).rows,
    citations: (await db.query(`select source_id::text from citation_logs`)).rows,
  });
  const expected = {
    sources: [{ provider: "yahoo_finance_dev_fundamentals", kind: "reference_data", license_class: "free_dev" }],
    gdelt: [{ provider: "gdelt_article_discovery" }],
    facts: [{ fact_id: YAHOO_FACT, source_id: YAHOO }, { fact_id: OTHER_FACT, source_id: OTHER }],
    manifest: [{ source_ids: [YAHOO, OTHER] }],
    blocks: [{ blocks: [{ id: "b1", kind: "analyst_consensus", source_refs: [YAHOO, OTHER] }] }],
    citations: [{ source_id: YAHOO }],
  };

  await applyMigration(db, "0078", "up");
  assert.deepEqual(await repaired(), expected);

  await db.query(await readFile(join(dbRoot, "migrations", "0078_yahoo_fundamentals_source.up.sql"), "utf8"));
  assert.deepEqual(await repaired(), expected, "rerunning the repair changes nothing");

  await db.query(await readFile(join(dbRoot, "seed", "sources.sql"), "utf8"));
  assert.deepEqual(await repaired(), expected, "the seed agrees with the row the migration wrote");
});
