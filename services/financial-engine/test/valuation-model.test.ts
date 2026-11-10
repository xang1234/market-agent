// ADR 0006's AAPL probe on the model's reported inputs as the engine certifies
// them: free cash flow and net cash from one FY2026 10-K. The trimmed
// companyfacts fixture holds neither AAPL's operating cash flow nor its capex,
// so both come from the hand audit's read of that 10-K (accession
// 0000320193-26-000026), injected as its cash is (aaplCallInputs). S0 is the
// hand audit's 14,532,182,000 at 2026-10-23. P, d and r are the ADR's literals.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import {
  parseFinancialDecimal,
  rationalFromDecimal,
  requiredGrowth,
  todaysMultiple,
  validateFinancialPlan,
  type ExactRational,
} from "../../financial-core/src/index.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { aaplCallInputs } from "../../fundamentals/test/sec-call-inputs-fixture.ts";
import { inspectCommittedResult } from "../src/inspection.ts";
import { completedRun, databaseUrl, engineDatabase, IDS, pinnedClients, revenuePlan } from "./db-fixtures.ts";

const RETRIEVED = "2026-11-09T15:00:00.000Z";
const CASH = ["cash_and_equivalents", "marketable_securities_current", "marketable_securities_noncurrent", "short_term_investments", "debt_securities_current"];
const DEBT = ["long_term_debt_current", "long_term_debt_noncurrent", "commercial_paper", "short_term_borrowings"];
const YEAR = { kind: "fiscal_period", fiscal_year: 2026, fiscal_period: "FY" };

function modelInputsPlan(issuerId: string) {
  const read = (metric: string, period: object) => ({ node_id: metric, operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "aapl", metric_key: metric, period });
  const validated = validateFinancialPlan({
    ...revenuePlan({ cutoff: "2026-11-09T23:59:59.999-05:00" }),
    subjects: { membership: "explicit", requested_count: 1, resolved_count: 1, omitted_count: 0, members: [{ slot_id: "aapl", subject_ref: { kind: "issuer", id: issuerId }, display_order: 0, role: "primary" }] },
    metric_definitions: ["operating_cash_flow", "capex", ...CASH, ...DEBT].map((key) => ({ metric_key: key, definition_version: `${key}.v1` })),
    operations: [
      read("operating_cash_flow", YEAR),
      read("capex", YEAR),
      { node_id: "free_cash_flow", operation: "free_cash_flow", operation_version: "free_cash_flow.v1", operating_cash_flow: "operating_cash_flow", capex: "capex" },
      ...[...CASH, ...DEBT].map((key) => read(key, { kind: "latest", period_type: "annual", offset: 0 })),
      { node_id: "net_cash", operation: "net_cash", operation_version: "net_cash.v1", ...Object.fromEntries([...CASH, ...DEBT].map((key) => [key, key])) },
    ],
    outputs: ["free_cash_flow", "net_cash"].map((node) => ({ output_id: node, node_id: node, unit_id: "call" })),
    publication_units: [{ unit_id: "call", kind: "chat_section" }],
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

function q(text: string): ExactRational {
  const parsed = parseFinancialDecimal(text);
  assert.ok(parsed.ok, text);
  return rationalFromDecimal(parsed.value)!;
}

test("AAPL FY2026: today's multiple is 36.15x and the price requires 7.3% a year", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for engine coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-valuation-model");
  const pool = await connectedPool(t, databaseUrl(db));
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  const issuerId = randomUUID();
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'AAPL', '320193')`, [issuerId]);
  const statements = createSecBackedStatementRepository(pool, {
    fetcher: secCompanyFetcher(() => aaplCallInputs(), { completed_at: RETRIEVED }),
    sourceId: randomUUID(),
    logger: { warn: () => {} },
  });
  assert.ok(await statements.find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: 2026, fiscal_period: "FY" }));

  const [client] = await pinnedClients(t, db, 1);
  const { results } = await completedRun(db, client!, modelInputsPlan(issuerId));
  const certified = async (outputId: string) => {
    const result = (await inspectCommittedResult(db, IDS.owner, results[outputId]!))!;
    assert.ok(result.availability === "available", outputId);
    const payload = result.payload as { kind: "value"; value: string } | { kind: "gap"; reason_code: string };
    assert.ok(result.disposition === "verified" && payload.kind === "value", `${outputId}: ${JSON.stringify(result)}`);
    return payload.value;
  };
  const [freeCashFlow, netCash] = [await certified("free_cash_flow"), await certified("net_cash")];
  assert.deepEqual([freeCashFlow, netCash], ["136056000000", "56824000000"]);

  const inputs = {
    call_date: "2026-11-09",
    free_cash_flow: q(freeCashFlow),
    period_end: "2026-09-26",
    shares: q("14532182000"),
    net_cash: q(netCash),
    price: q("342.37"),
    price_date: "2026-11-06",
    currency: { reporting: "USD", price: "USD" },
    required_return: q("0.10"),
  };
  const multiple = todaysMultiple(inputs);
  assert.ok(multiple.kind === "value");
  const growth = requiredGrowth(inputs, { share_change: q("0.00277"), exit_multiple: multiple.value });
  assert.ok(growth.kind === "value");
  assert.deepEqual([multiple.text, growth.text, growth.steps], ["36.15x", "7.3%", 14]);
});
