// Net cash and total debt (ADR 0006, #602) from real companyfacts, as SEC
// ingestion stores them: each balance of one 10-K at its fiscal year-end, an
// unreported line left out, and a balance only a 10-Q reports never read.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { validateFinancialPlan } from "../../financial-core/src/index.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { aaplWithCash, callInputsCompanyFacts } from "../../fundamentals/test/sec-call-inputs-fixture.ts";
import { inspectCommittedResult } from "../src/inspection.ts";
import { completedRun, databaseUrl, engineDatabase, IDS, pinnedClients, revenuePlan } from "./db-fixtures.ts";

const FIXTURE = callInputsCompanyFacts();
const USD = { kind: "currency", currency: "USD" };
const RETRIEVED = "2026-11-09T15:00:00.000Z";
const CASH = ["cash_and_equivalents", "marketable_securities_current", "marketable_securities_noncurrent", "short_term_investments", "debt_securities_current"];
const DEBT = ["long_term_debt_current", "long_term_debt_noncurrent", "commercial_paper", "short_term_borrowings"];

// NVDA's fixture balances are all from its FY2027 Q1 and Q2 10-Qs.
const ISSUERS = {
  aapl: { issuerId: randomUUID(), cik: 320193, facts: () => aaplWithCash(FIXTURE), filing: [2026, "FY"] },
  cat: { issuerId: randomUUID(), cik: 18230, facts: () => FIXTURE.CAT, filing: [2025, "FY"] },
  cost: { issuerId: randomUUID(), cik: 909832, facts: () => FIXTURE.COST, filing: [2026, "FY"] },
  nvda: { issuerId: randomUUID(), cik: 1045810, facts: () => FIXTURE.NVDA, filing: [2027, "Q2"] },
} as const;
type Slot = keyof typeof ISSUERS;

function balancePlan() {
  const slots = Object.keys(ISSUERS) as Slot[];
  const wired = (slot: Slot, keys: string[]) => Object.fromEntries(keys.map((key) => [key, `${slot}_${key}`]));
  const validated = validateFinancialPlan({
    ...revenuePlan({ cutoff: "2026-11-09T23:59:59.999-05:00" }),
    subjects: {
      membership: "explicit",
      requested_count: slots.length,
      resolved_count: slots.length,
      omitted_count: 0,
      members: slots.map((slot, index) => ({ slot_id: slot, subject_ref: { kind: "issuer", id: ISSUERS[slot].issuerId }, display_order: index, role: index === 0 ? "primary" : "peer" })),
    },
    metric_definitions: [...CASH, ...DEBT].map((key) => ({ metric_key: key, definition_version: `${key}.v1` })),
    operations: slots.flatMap((slot) => [
      ...[...CASH, ...DEBT].map((key) => ({
        node_id: `${slot}_${key}`, operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: slot, metric_key: key,
        period: { kind: "latest", period_type: "annual", offset: 0 },
      })),
      { node_id: `${slot}_net_cash`, operation: "net_cash", operation_version: "net_cash.v1", ...wired(slot, [...CASH, ...DEBT]) },
      { node_id: `${slot}_total_debt`, operation: "total_debt", operation_version: "total_debt.v1", ...wired(slot, DEBT) },
    ]),
    outputs: slots.flatMap((slot) => ["net_cash", "total_debt"].map((figure) => ({ output_id: `${slot}_${figure}`, node_id: `${slot}_${figure}`, unit_id: slot }))),
    publication_units: slots.map((slot) => ({ unit_id: slot, kind: "chat_section" })),
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

test("net cash and total debt from each filer's latest 10-K balance sheet", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for engine coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-net-cash");
  const pool = await connectedPool(t, databaseUrl(db));
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  for (const [slot, { issuerId, cik, facts, filing: [fiscal_year, fiscal_period] }] of Object.entries(ISSUERS)) {
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuerId, slot.toUpperCase(), String(cik)]);
    const statements = createSecBackedStatementRepository(pool, {
      fetcher: secCompanyFetcher(facts, { completed_at: RETRIEVED }),
      sourceId: randomUUID(),
      logger: { warn: () => {} },
    });
    assert.ok(await statements.find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year, fiscal_period }), slot);
  }

  const [client] = await pinnedClients(t, db, 1);
  const { results } = await completedRun(db, client!, balancePlan());
  const outcome = async (outputId: string) => {
    const result = (await inspectCommittedResult(db, IDS.owner, results[outputId]!))!;
    assert.ok(result.availability === "available", outputId);
    const payload = result.payload as { kind: "value"; value: string } | { kind: "gap"; reason_code: string };
    return [result.disposition, payload.kind === "value" ? payload.value : payload.reason_code];
  };

  await t.test("AAPL FY2026: cash and securities 136.935B less debt 80.111B is net cash of 56.824B", async () => {
    const result = (await inspectCommittedResult(db, IDS.owner, results.aapl_net_cash!))!;
    assert.ok(result.availability === "available");
    assert.deepEqual([result.disposition, result.payload], ["verified", { kind: "value", unit: USD, exact: true, value: "56824000000", rounding: null }]);
    const bound = result.inputs.flatMap((input) => input.status === "bound" && "fact_id" in input ? [[input.input_slot, input.value, input.period.end, input.source.locator?.split("|")[2]]] : []);
    assert.deepEqual(bound, [
      ["aapl_cash_and_equivalents", "36305000000", "2026-09-26", "0000320193-26-000026"],
      ["aapl_commercial_paper", "1997000000", "2026-09-26", "0000320193-26-000026"],
      ["aapl_long_term_debt_current", "9906000000", "2026-09-26", "0000320193-26-000026"],
      ["aapl_long_term_debt_noncurrent", "68208000000", "2026-09-26", "0000320193-26-000026"],
      ["aapl_marketable_securities_current", "20417000000", "2026-09-26", "0000320193-26-000026"],
      ["aapl_marketable_securities_noncurrent", "80213000000", "2026-09-26", "0000320193-26-000026"],
    ]);
    assert.deepEqual(await outcome("aapl_total_debt"), ["verified", "80111000000"]);
  });

  await t.test("CAT and COST tag no cash and equivalents: net cash is a missing input, and total debt still forms", async () => {
    assert.deepEqual(await outcome("cat_net_cash"), ["missing", "missing_input"]);
    // Long-term debt 30.696B (noncurrent only) and short-term borrowings 5.514B at 2025-12-31.
    assert.deepEqual(await outcome("cat_total_debt"), ["verified", "36210000000"]);
    assert.deepEqual(await outcome("cost_net_cash"), ["missing", "missing_input"]);
    // Long-term debt 2.248B current and 3.914B noncurrent at 2026-08-30.
    assert.deepEqual(await outcome("cost_total_debt"), ["verified", "6162000000"]);
  });

  // A 10-Q balance is stored but never certified, so it is unusable, not absent:
  // leaving it out would understate its side, so it blocks the figure.
  await t.test("NVDA's debt balances are all from 10-Qs, so neither figure forms", async () => {
    assert.deepEqual([await outcome("nvda_net_cash"), await outcome("nvda_total_debt")], [["blocked_dependency", "blocked_by_dependency"], ["blocked_dependency", "blocked_by_dependency"]]);
    const result = (await inspectCommittedResult(db, IDS.owner, results.nvda_net_cash!))!;
    assert.ok(result.availability === "available");
    assert.deepEqual(result.inputs.map((input) => [input.input_slot, input.status === "gap" ? input.reason_code : input.status]), [
      ["nvda_cash_and_equivalents", "missing_input"],
      ["nvda_commercial_paper", "missing_input"],
      ["nvda_debt_securities_current", "context_unverified"],
      ["nvda_long_term_debt_current", "context_unverified"],
      ["nvda_long_term_debt_noncurrent", "context_unverified"],
      ["nvda_marketable_securities_current", "missing_input"],
      ["nvda_marketable_securities_noncurrent", "missing_input"],
      ["nvda_short_term_borrowings", "missing_input"],
      ["nvda_short_term_investments", "missing_input"],
    ]);
  });
});
