import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { listFinancialInputCandidates } from "../../evidence/src/financial-input-repo.ts";
import { createSecCompanyFactsHttpFetcher } from "../src/sec-edgar-http.ts";
import { createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";

const ISSUER_ID = "31000000-0000-4000-8000-000000000001";
const USER_ID = "31000000-0000-4000-8000-000000000002";
const FALLBACK_SOURCE_ID = "31000000-0000-4000-8000-000000000003";

const TOKENS = {
  revenue: "383285000000.123456789012345678",
  net_income: "0.1000000000000000000001",
  eps_diluted: "1.234567890123456789e+6",
};

function companyFactsText(): string {
  const value = (token: string) =>
    `{"start":"2023-01-01","end":"2023-12-31","val":${token},"accn":"0000320193-24-000006","fy":2023,"fp":"FY","form":"10-K","filed":"2024-01-10"}`;
  return `{"cik":320193,"entityName":"Example Corp","facts":{"us-gaap":{
    "Revenues":{"label":"Revenues","description":"","units":{"USD":[${value(TOKENS.revenue)}]}},
    "NetIncomeLoss":{"label":"Net income","description":"","units":{"USD":[${value(TOKENS.net_income)}]}},
    "EarningsPerShareDiluted":{"label":"EPS","description":"","units":{"USD/shares":[${value(TOKENS.eps_diluted)}]}}
  }}}`;
}

test("SEC company facts reach storage and strict reads without losing digits", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for lossless ingestion coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-lossless");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Example Corp', '320193')`, [ISSUER_ID]);
  await db.query(`insert into users (user_id, email) values ($1, 'reader@example.test')`, [USER_ID]);

  let fetches = 0;
  const statements = createSecBackedStatementRepository(db, {
    fetcher: createSecCompanyFactsHttpFetcher({
      userAgent: "market-agent-test test@example.invalid",
      fetchImpl: async () => {
        fetches += 1;
        return new Response(companyFactsText(), { status: 200 });
      },
    }),
    sourceId: FALLBACK_SOURCE_ID,
    clock: () => new Date("2024-02-01T00:00:00.000Z"),
    logger: { warn: () => {} },
  });
  const lookup = { issuer_id: ISSUER_ID, family: "income" as const, basis: "as_reported" as const, fiscal_year: 2023, fiscal_period: "FY" as const };
  const first = await statements.find(lookup);
  assert.ok(first);

  const stored = (await db.query<{ metric_key: string; value_text: string; raw_token: string | null; value_proof: string | null; precision_class: string | null }>(
    `select m.metric_key, f.value_num::text as value_text, a.raw_token, a.value_text as value_proof, a.precision_class
       from facts f
       join metrics m on m.metric_id = f.metric_id
       left join fact_precision_attestations a on a.fact_id = f.fact_id
      where f.subject_id = $1 order by m.metric_key`,
    [ISSUER_ID],
  )).rows;
  assert.deepEqual(
    Object.fromEntries(stored.map((row) => [row.metric_key, [row.value_text, row.raw_token, row.value_proof, row.precision_class]])),
    {
      eps_diluted: ["1234567.890123456789", TOKENS.eps_diluted, "1234567.890123456789", "source_token_preserved"],
      net_income: [TOKENS.net_income, TOKENS.net_income, TOKENS.net_income, "source_token_preserved"],
      revenue: [TOKENS.revenue, TOKENS.revenue, TOKENS.revenue, "source_token_preserved"],
    },
  );

  const strict = await listFinancialInputCandidates(db, {
    user_id: USER_ID,
    channel: "app",
    scope: "public_information",
    subject: { kind: "issuer", id: ISSUER_ID },
    metric_key: "revenue",
    fiscal_year: 2023,
    fiscal_period: "FY",
    limit: 10,
  });
  assert.equal(strict.candidates.length, 1);
  assert.equal(strict.candidates[0]!.value_text, TOKENS.revenue);
  assert.equal(strict.candidates[0]!.precision?.precision_class, "source_token_preserved");
  assert.match(strict.candidates[0]!.precision?.source_locator ?? "", /^sec_edgar:companyfacts:CIK0000320193#Revenues\|USD\|0000320193-24-000006\|2023-01-01\.\.2023-12-31$/u);

  // The legacy reader keeps its number-typed contract and repeat reads do not refetch or re-attest.
  const second = await statements.find(lookup);
  assert.equal(typeof second?.lines.find((line) => line.metric_key === "revenue")?.value_num, "number");
  assert.equal(fetches, 1);
  assert.equal((await db.query(`select count(*)::int as n from fact_precision_attestations`)).rows[0].n, 3);

  // A proof that cannot be written takes its facts with it: no fact lands unproven.
  const otherIssuer = "31000000-0000-4000-8000-000000000004";
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Other Corp', '320194')`, [otherIssuer]);
  await db.query(`create function refuse_proof() returns trigger language plpgsql as $$ begin raise exception 'proof store unavailable'; end $$`);
  await db.query(`create trigger refuse_proof before insert on fact_precision_attestations for each row execute function refuse_proof()`);
  const otherLookup = { ...lookup, issuer_id: otherIssuer };
  assert.equal(await statements.find(otherLookup).catch(() => null), null);
  const factsFor = async (issuerId: string) =>
    (await db.query(`select count(*)::int as n from facts where subject_id = $1`, [issuerId])).rows[0].n;
  assert.equal(await factsFor(otherIssuer), 0);

  await db.query(`drop trigger refuse_proof on fact_precision_attestations`);
  assert.ok(await statements.find(otherLookup));
  assert.equal(await factsFor(otherIssuer), 3);
  const proven = (await db.query(
    `select count(*)::int as n from current_fact_precision_attestations a join facts f on f.fact_id = a.fact_id where f.subject_id = $1`,
    [otherIssuer],
  )).rows[0].n;
  assert.equal(proven, 3);
});
