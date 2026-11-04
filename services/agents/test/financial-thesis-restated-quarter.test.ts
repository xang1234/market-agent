// A saved rule reads the latest disclosure public by its cutoff, and SEC ingest
// stores a quarter's later figures (#513), so a filing can move a quarterly or
// trailing rule. A quarter it leaves unverified resolves nothing.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import type { QueryExecutor } from "../src/agent-repo.ts";
import { saveThesis } from "../src/thesis-repo.ts";
import { assess, revenueCondition, thesisDatabase } from "./financial-thesis-fixtures.ts";

const AS_OF = "2025-03-15T00:00:00.000Z";

type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
const DATES: Record<Quarter | "FY", readonly [string, string]> = {
  Q1: ["2024-01-01", "2024-03-31"], Q2: ["2024-04-01", "2024-06-30"], Q3: ["2024-07-01", "2024-09-30"], Q4: ["2024-10-01", "2024-12-31"], FY: ["2024-01-01", "2024-12-31"],
};

/** Fiscal 2024's 10-Qs and 10-K as SEC lists them, with the quarters the 10-K also states. */
function companyFacts(cik: number, tenK: Partial<Record<Quarter, string>>) {
  const accn = (serial: number) => `${String(cik).padStart(10, "0")}-25-${String(serial).padStart(6, "0")}`;
  const value = (serial: number, form: string, filed: string, fp: string, period: Quarter | "FY", token: string) =>
    ({ start: DATES[period][0], end: DATES[period][1], val: Number(token), val_token: token, accn: accn(serial), fy: 2024, fp, form, filed });
  return {
    cik,
    entityName: `Filer ${cik}`,
    facts: { "us-gaap": { Revenues: { label: "", description: "", units: { USD: [
      value(1, "10-Q", "2024-04-23", "Q1", "Q1", "16053000000"),
      value(2, "10-Q", "2024-07-23", "Q2", "Q2", "9094000000"),
      value(3, "10-Q", "2024-10-22", "Q3", "Q3", "9842000000"),
      value(4, "10-K", "2025-02-03", "FY", "FY", "38702000000"),
      ...Object.entries(tenK).map(([period, token]) => value(4, "10-K", "2025-02-03", "FY", period as Quarter, token)),
    ] } } } },
  };
}

test("a saved quarterly or trailing rule over restated quarters", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for thesis financial coverage");
    return;
  }
  const { db, pool } = await thesisDatabase(t, "thesis-restated-quarter");
  const filer = async (cik: number, tenK: Partial<Record<Quarter, string>>) => {
    const issuerId = randomUUID();
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuerId, `Filer ${cik}`, String(cik)]);
    const statements = createSecBackedStatementRepository(pool, {
      fetcher: secCompanyFetcher(() => companyFacts(cik, tenK), { completed_at: "2025-03-01T15:00:00.000Z" }),
      sourceId: randomUUID(),
      logger: { warn: () => {} },
    });
    for (const fiscalPeriod of ["Q1", "Q2", "Q3", "Q4", "FY"] as const) {
      assert.ok(await statements.find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: fiscalPeriod }));
    }
    return issuerId;
  };
  /** A rule saved on an agent of its own, which watches only that issuer. */
  const assessed = async (issuerId: string, period_kind: "fiscal_q" | "ttm", operator: "gt" | "lt", threshold: string) => {
    const agentId = randomUUID();
    await db.query(
      `insert into agents (agent_id, user_id, name, thesis, universe, cadence) values ($1, $2, 'Filer monitor', 'Legacy thesis', $3::jsonb, 'daily')`,
      [agentId, IDS.owner, JSON.stringify({ mode: "static", subject_refs: [{ kind: "issuer", id: issuerId }] })],
    );
    const thesis = await saveThesis(pool as unknown as QueryExecutor, {
      agent_id: agentId,
      user_id: IDS.owner,
      expected_version: 0,
      thesis: "Revenue holds through the next cycle.",
      subject_ref: { kind: "issuer", id: issuerId },
      conditions: [revenueCondition(operator, threshold, { period_kind })],
    });
    const [result] = await assess(pool, thesis, AS_OF);
    return result!;
  };

  await t.test("the 10-K's own statements of the quarters move a quarterly rule and leave the trailing sum on the year", async () => {
    const issuerId = await filer(320401, { Q1: "8955000000", Q2: "9094000000", Q3: "9842000000", Q4: "10812000000" });
    const quarterly = await assessed(issuerId, "fiscal_q", "gt", "10000000000");
    assert.equal(quarterly.status, "supported", "Q4 is the 10-K's 10,812M, not the 3,713M its year less the 10-Qs left");
    const trailing = await assessed(issuerId, "ttm", "lt", "39000000000");
    assert.equal(trailing.status, "supported", "8,955M + 9,094M + 9,842M + 10,812M is 38,703M");
  });

  await t.test("a year the 10-K restated in part leaves the rule unresolved, never a 45,801M trailing sum", async () => {
    const issuerId = await filer(320402, { Q4: "10812000000" });
    const quarterly = await assessed(issuerId, "fiscal_q", "gt", "1");
    assert.deepEqual([quarterly.status, quarterly.reason], ["unresolved", "The saved rule could not be verified (restatement_unverified)."]);
    const trailing = await assessed(issuerId, "ttm", "gt", "1");
    assert.deepEqual([trailing.status, trailing.reason], ["unresolved", "No eligible value was public at the assessment cutoff."]);
  });
});
