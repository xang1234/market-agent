// Cash resilience from facts SEC ingestion wrote (#344): an FY2024 10-K and a
// Q1 FY2025 10-Q. The 10-Q's balance is stored as FY2025 at the quarter's end;
// it is never certified, so the latest fiscal year is FY2024 for every input.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { chatDatabase, chatHarness, completed, SEC_ISSUER_D } from "./financial-fixtures.ts";

const CIK = 320197;

function companyFacts() {
  const k24 = { accn: "0000320197-25-000010", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" };
  const q1 = { accn: "0000320197-25-000020", fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01" };
  const value = (filing: typeof k24, start: string | null, end: string, token: string) =>
    ({ ...(start === null ? {} : { start }), end, val: Number(token), val_token: token, ...filing });
  const concept = (values: ReadonlyArray<ReturnType<typeof value>>) => ({ label: "", description: "", units: { USD: values } });
  const flow = (annual: string, quarter: string) =>
    concept([value(k24, "2024-01-01", "2024-12-31", annual), value(q1, "2025-01-01", "2025-03-31", quarter)]);
  const balance = (yearEnd: string, quarterEnd: string) =>
    concept([value(k24, null, "2024-12-31", yearEnd), value(q1, null, "2024-12-31", yearEnd), value(q1, null, "2025-03-31", quarterEnd)]);
  return {
    cik: CIK,
    entityName: "Quarterly Filer Corp",
    facts: {
      "us-gaap": {
        Revenues: flow("500", "130"),
        NetIncomeLoss: flow("100", "25"),
        NetCashProvidedByUsedInOperatingActivities: flow("120", "30"),
        Assets: balance("600", "650"),
        Liabilities: balance("300", "310"),
        StockholdersEquity: balance("200", "220"),
      },
    },
  };
}

test("cash resilience from an SEC 10-K and a later 10-Q", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-cash-res-sec");
  for (const [metricKey, name, aggregation] of [
    ["net_income", "Net income", "sum"],
    ["operating_cash_flow", "Operating cash flow", "sum"],
    ["total_assets", "Total assets", "point_in_time"],
    ["total_liabilities", "Total liabilities", "point_in_time"],
    ["total_equity", "Stockholders' equity", "point_in_time"],
  ]) {
    await db.query(
      `insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
       values ($1, $2, $3, 'currency', $4, 'neutral', 'gaap') on conflict (metric_key) do nothing`,
      [randomUUID(), metricKey, name, aggregation],
    );
  }
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Quarterly Filer Corp', $2)`, [SEC_ISSUER_D, String(CIK)]);
  const statements = createSecBackedStatementRepository(pool, {
    fetcher: secCompanyFetcher(companyFacts, { completed_at: "2025-06-01T15:05:00.000Z" }),
    sourceId: randomUUID(),
    logger: { warn: () => {} },
  });
  for (const [fiscalYear, fiscalPeriod] of [[2024, "FY"], [2025, "Q1"]] as const) {
    assert.ok(await statements.find({ issuer_id: SEC_ISSUER_D, family: "income", basis: "as_reported", fiscal_year: fiscalYear, fiscal_period: fiscalPeriod }));
  }

  const done = completed((await chatHarness(pool, { model: null })
    .run({ threadId, userId: IDS.owner, userIntent: "Show QTR's cash resilience" })).events);
  const read = await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner });
  const message = read!.messages.find((candidate) => candidate.message_id === done.message_id)!;
  const block = (message.blocks as Array<{ id: string; financial: any }>)[0]!;
  const { results, labels } = block.financial;
  const rows = results.map((result: any) => [labels[result.measure_label_id].text, labels[result.period_label_id].text, result.presented.kind === "value" ? result.presented.value : result.disposition]);
  assert.deepEqual(rows, [
    ["Operating cash flow", "FY2024 (ended 2024-12-31)", "120"],
    ["Net income", "FY2024 (ended 2024-12-31)", "100"],
    ["Total liabilities", "end of FY2024 (2024-12-31)", "300"],
    ["Total assets", "end of FY2024 (2024-12-31)", "600"],
    ["Stockholders' equity", "end of FY2024 (2024-12-31)", "200"],
    ["Cash conversion: operating cash flow / net income (reported period)", "FY2024 (ended 2024-12-31)", "1.2"],
    ["Total liabilities / total assets (period-end balance sheet)", "end of FY2024 (2024-12-31)", "0.5"],
    ["Total liabilities / stockholders' equity (period-end balance sheet)", "end of FY2024 (2024-12-31)", "1.5"],
  ]);
  const bound = (await db.query(
    `select i.input_slot, f.fiscal_year, f.period_end::text as period_end
       from financial_run_inputs i join facts f on f.fact_id = i.fact_id
      where i.run_id = (select run_id from financial_runs where parent_id = $1 order by created_at desc limit 1)
      order by i.input_slot`,
    [threadId],
  )).rows.map((row) => [row.fiscal_year, row.period_end]);
  assert.deepEqual(bound, Array(5).fill([2024, "2024-12-31"]), "every input binds the FY2024 10-K");
});
