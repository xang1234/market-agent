import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import type { ThesisVersion } from "../../agents/src/thesis-types.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { databaseUrl, engineDatabase, IDS, seedReportedFact } from "../../financial-engine/test/db-fixtures.ts";
import { loadThesisPacket } from "../src/thesis-evidence.ts";

const ISSUER = "20000000-0000-4000-8000-000000000001";
const HIGH_PRECISION_FACT = "30000000-0000-4000-8000-000000000001";
const UNSAFE_INTEGER_FACT = "30000000-0000-4000-8000-000000000002";

test("loadThesisPacket preserves PostgreSQL numeric text for the sealed packet", async () => {
  const statements: string[] = [];
  const db: QueryExecutor = {
    async query(text) {
      statements.push(text);
      if (!text.includes("jsonb_to_recordset($2::jsonb) requested")) return { rows: [] } as never;

      const exactTextProjection = text.includes("f.value_num::text as value_num")
        && text.includes("f.scale::text as scale");
      return {
        rows: [
          fact({
            fact_id: HIGH_PRECISION_FACT,
            metric_key: "margin_ratio",
            value_num: exactTextProjection ? "0.1000000000000000000001" : 0.1,
            scale: exactTextProjection ? "3" : 3,
            unit: "ratio",
          }),
          fact({
            fact_id: UNSAFE_INTEGER_FACT,
            metric_key: "enterprise_value",
            value_num: exactTextProjection ? "9007199254740993" : Number("9007199254740993"),
            scale: exactTextProjection ? "1" : 1,
            unit: "USD",
          }),
        ],
      } as never;
    },
  };

  const packet = await loadThesisPacket(db, {
    thesis: thesisVersion(),
    userId: "10000000-0000-4000-8000-000000000001",
    asOf: "2026-09-22T00:00:00.000Z",
    runId: "80000000-0000-4000-8000-000000000001",
    financial: {} as never,
  });
  assert.deepEqual(packet.facts.map((row) => [row.value_num, row.scale]), [
    ["0.1000000000000000000001", "3"],
    ["9007199254740993", "1"],
  ]);
  const factQuery = statements.find((statement) => statement.includes("jsonb_to_recordset($2::jsonb) requested")) ?? "";
  assert.match(factQuery, /f\.value_num::text as value_num/);
  assert.match(factQuery, /f\.scale::text as scale/);
  assert.doesNotMatch(factQuery, /(?:value_num|scale)::float8/);
  assert.match(factQuery, /f\.value_num is not null/);
  assert.match(factQuery, /f\.value_num not in \('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric\)/);
});

function thesisVersion(): ThesisVersion {
  return {
    thesis_version_id: "40000000-0000-4000-8000-000000000001",
    agent_id: "50000000-0000-4000-8000-000000000001",
    version: 1,
    thesis: "Exact numeric facts determine the monitored thesis result.",
    subject_ref: { kind: "issuer", id: ISSUER },
    created_at: "2026-09-01T00:00:00.000Z",
    conditions: [
      {
        condition_id: "60000000-0000-4000-8000-000000000001",
        statement: "Margin remains at or below the exact limit.",
        falsifier: "Margin exceeds the exact limit.",
        horizon: "Next quarter",
        metric: { metric_key: "margin_ratio", unit: "ratio", period_kind: "point", operator: "lte", threshold: "0.3", max_age_days: 30 },
      },
      {
        condition_id: "60000000-0000-4000-8000-000000000002",
        statement: "Enterprise value remains at the precise threshold.",
        falsifier: "Enterprise value differs from the precise threshold.",
        horizon: "Next quarter",
        metric: { metric_key: "enterprise_value", unit: "USD", period_kind: "point", operator: "eq", threshold: "9007199254740993", max_age_days: 30 },
      },
    ],
  };
}

function fact(input: { fact_id: string; metric_key: string; value_num: number | string; scale: number | string; unit: string }) {
  return {
    ...input,
    period_kind: "point",
    period_end: null,
    period_start: null,
    fiscal_year: null,
    fiscal_period: null,
    as_of: "2026-09-21T00:00:00.000Z",
    source_id: "70000000-0000-4000-8000-000000000001",
    confidence: 1,
    trust_tier: "primary",
  };
}

test("a run's evidence holds certified F ids and 10-K claim C ids, each standing for its stored rows", { skip: !dockerAvailable(), timeout: 120000 }, async (t) => {
  const db = await engineDatabase(t, "thesis-analyst-evidence");
  const pool = await connectedPool(t, databaseUrl(db));
  const year = new Date().getUTCFullYear() - 1;
  const revenue = await seedReportedFact(db, { metric_key: "revenue", value: "130497000000", fiscal_year: year });
  const grossProfit = await seedReportedFact(db, { metric_key: "gross_profit", value: "97858000000", fiscal_year: year });
  const source = randomUUID();
  const tenK = randomUUID();
  await db.query(`insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values ($1, 'sec_edgar', 'filing', 'https://www.sec.gov/aa8', 'primary', 'public', now() - interval '2 days')`, [source]);
  await db.query(
    `insert into documents (document_id, source_id, kind, title, provider_doc_id, published_at, content_hash, raw_blob_id, parse_status, created_at, read_state)
     values ($1, $2, 'filing', '10-K', 'acc-aa8', now() - interval '2 days', 'h-aa8', 'h-aa8', 'parsed', now() - interval '2 days', '{"1":{"state":"read"},"1A":{"state":"read"}}'::jsonb)`,
    [tenK, source],
  );
  await db.query(`insert into mentions (document_id, subject_kind, subject_id, prominence, confidence) values ($1, 'issuer', $2, 'headline', 1)`, [tenK, IDS.issuerA]);
  const { rows: [claim] } = await db.query<{ claim_id: string }>(
    `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, attributed_to_type, attributed_to_id, confidence, status, created_at, effective_time)
     values ($1, 'business.products', 'Our products include data center accelerators.', 'neutral', 'quoted', $2, 'issuer', $3, 0.9, 'extracted', now() - interval '2 days', now() - interval '2 days')
     returning claim_id::text`,
    [tenK, source, IDS.issuerA],
  );
  await db.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [claim!.claim_id, IDS.issuerA]);
  await db.query(`insert into claim_evidence (claim_id, document_id, locator, confidence) values ($1, $2, $3, 1)`, [claim!.claim_id, tenK, JSON.stringify({ item: "1", start: 1, end: 5 })]);

  const packet = await loadThesisPacket(pool, {
    thesis: {
      ...thesisVersion(),
      subject_ref: { kind: "issuer", id: IDS.issuerA },
      conditions: [{ condition_id: "60000000-0000-4000-8000-000000000003", statement: "Data center accelerators stay the core product.", falsifier: "The 10-K stops naming accelerators.", horizon: "Next 10-K" }],
    },
    userId: IDS.owner,
    asOf: new Date().toISOString(),
    runId: randomUUID(),
    financial: { pool, evidence: createEvidenceFinancialPort },
  });

  const { packet: shown, refs } = packet.evidence;
  const figures = shown.figures as ReadonlyArray<{ id: string; metric: string; value: string }>;
  const claims = shown.claims as ReadonlyArray<{ id: string; predicate: string; text: string }>;
  const facts = (metric: string) => refs[figures.find((figure) => figure.metric.startsWith(metric))!.id];
  assert.deepEqual(facts("Revenue"), { claim_refs: [], fact_refs: [revenue] }, "a reported figure stands for its fact");
  assert.deepEqual(facts("Gross margin"), { claim_refs: [], fact_refs: [grossProfit, revenue].sort() }, "a computed figure stands for the facts it read");
  assert.ok(figures.every((figure) => /^F\d+$/.test(figure.id) && refs[figure.id]!.fact_refs.length > 0), "only figures with stored facts are shown");
  const products = claims.find((entry) => entry.predicate === "business.products")!;
  assert.match(products.id, /^C\d+$/);
  assert.deepEqual(refs[products.id], { claim_refs: [claim!.claim_id], fact_refs: [] });
  assert.equal(products.text, "Our products include data center accelerators.");
  assert.ok(packet.claims.some((entry) => entry.claim_id === claim!.claim_id), "the 10-K claim is sealed with the packet");
  const modelView = JSON.stringify(shown);
  for (const stored of [revenue, grossProfit, claim!.claim_id]) assert.equal(modelView.includes(stored), false, "the model reads F and C ids, never stored ids");
  assert.equal("cutoff" in shown, false, "the packet is the same from run to run");
});
