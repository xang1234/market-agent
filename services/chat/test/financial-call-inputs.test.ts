// A question for a Call input (ADR 0005) is answered from the certified SEC
// fact, with no planning model: each family's reported figures for the latest
// fiscal year, from companyfacts trimmed to the Call-input tags (#594), and a
// figure the fixture does not hold is a named gap, never another figure in its
// place.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { parseFinancialJson } from "../../fundamentals/src/lossless-financial-json.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { proposedMetric, resolveResearchScope, type ScopeProposal } from "../src/research-scope.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, NO_ASKS } from "./financial-fixtures.ts";

const FIXTURE = parseFinancialJson(
  readFileSync(new URL("../../fundamentals/test/sec-call-inputs.companyfacts.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const RETRIEVED = "2026-11-09T15:00:00.000Z";
const AS_OF = "2026-11-10T12:00:00.000Z";
const ISSUERS = {
  AAPL: { issuerId: randomUUID(), cik: 320193, filings: [[2026, "FY"]] },
  CAT: { issuerId: randomUUID(), cik: 18230, filings: [[2025, "FY"], [2026, "Q3"]] },
} as const;
type Ticker = keyof typeof ISSUERS;

const resolveMention = async (mention: string): Promise<ChatSubjectPreResolution> => {
  const issuer = ISSUERS[mention as Ticker];
  if (!issuer) return { status: "not_found", input_text: mention, normalized_input: mention, message: "not found" } as ChatSubjectPreResolution;
  return { status: "resolved", subject_ref: { kind: "issuer", id: issuer.issuerId }, display_label: mention, handoff: { display_labels: { ticker: mention } } } as unknown as ChatSubjectPreResolution;
};

test("a Call input question answers from the certified filing figure", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-call-inputs");
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  for (const [ticker, { issuerId, cik, filings }] of Object.entries(ISSUERS)) {
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuerId, ticker, String(cik)]);
    for (const [fiscal_year, fiscal_period] of filings) {
      const statements = createSecBackedStatementRepository(pool, {
        fetcher: secCompanyFetcher(() => FIXTURE[ticker], { completed_at: RETRIEVED }),
        sourceId: randomUUID(),
        logger: { warn: () => {} },
      });
      assert.ok(await statements.find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year, fiscal_period }));
    }
  }

  // As the scope model reads "<ticker>'s <metric>": the catalog metric, no period.
  const ask = async (ticker: Ticker, metric: string) => {
    const reading = { ...NO_ASKS, metrics: [proposedMetric(metric, null, null)!], companies: { kind: "as_named" as const, names: [ticker] } };
    assert.ok(reading.metrics[0], `${metric} is a catalog metric`);
    return answer(reading, `${ticker}'s ${metric.replaceAll("_", " ")}`);
  };
  const answer = async (reading: ScopeProposal, userIntent: string, extra: Partial<Parameters<typeof chatHarness>[1]> = {}) => {
    const harness = chatHarness(pool, { model: null, resolveMention, readQuestion: async () => reading, clock: () => new Date(AS_OF), ...extra });
    const done = completed((await harness.run({ threadId, userId: IDS.owner, userIntent })).events);
    const read = await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner });
    const message = read!.messages.find((candidate) => candidate.message_id === done.message_id)!;
    const block = (message.blocks as Array<{ kind: string; financial: any }>)[0]!;
    assert.equal(block.kind, "financial_answer", JSON.stringify(message.blocks));
    const { results, labels } = block.financial;
    return results.map((result: any) => [labels[result.measure_label_id].text, result.disposition, result.presented?.full_text ?? null]);
  };

  await t.test("pretax income: CAT tags only the figure before equity-method income, so pretax income is a gap", async () => {
    assert.deepEqual(await ask("CAT", "pretax_income"), [
      ["Pretax income (including equity-method income)", "missing", null],
      ["Pretax income before equity-method income", "verified", "USD 11541000000"],
    ]);
  });

  await t.test("income tax expense", async () => {
    assert.deepEqual(await ask("AAPL", "income_tax_expense"), [["Income tax expense (benefit)", "verified", "USD 27062000000"]]);
  });

  await t.test("stock-based compensation: the expense and the cash flow add-back, each as filed", async () => {
    assert.deepEqual(await ask("AAPL", "stock_based_compensation"), [
      ["Stock-based compensation expense", "verified", "USD 13789000000"],
      ["Stock-based compensation (cash flow add-back)", "verified", "USD 13789000000"],
    ]);
  });

  await t.test("long-term debt: its current portion and the rest, never summed", async () => {
    assert.deepEqual(await ask("AAPL", "long_term_debt"), [
      ["Long-term debt (current portion)", "verified", "USD 9906000000"],
      ["Long-term debt (noncurrent)", "verified", "USD 68208000000"],
    ]);
  });

  await t.test("short-term debt: commercial paper and short-term borrowings, each a gap where untagged", async () => {
    assert.deepEqual(await ask("CAT", "short_term_debt"), [
      ["Commercial paper", "missing", null],
      ["Short-term borrowings", "verified", "USD 5514000000"],
    ]);
  });

  await t.test("marketable securities and short-term investments, each concept its own figure", async () => {
    assert.deepEqual(await ask("AAPL", "marketable_securities"), [
      ["Marketable securities (current)", "verified", "USD 20417000000"],
      ["Marketable securities (noncurrent)", "verified", "USD 80213000000"],
      ["Debt securities (current)", "missing", null],
      ["Short-term investments", "missing", null],
    ]);
  });

  await t.test("remaining performance obligations, from the 10-K", async () => {
    assert.deepEqual(await ask("CAT", "remaining_performance_obligations"), [["Remaining performance obligations", "verified", "USD 30100000000"]]);
  });

  // A balance is certified only from a 10-K (sec-facts-repository.ts), so a
  // quarter has none: neither the FY2026 Q3 10-Q's USD 49,400M nor the
  // FY2025 10-K's USD 30,100M stands in for it.
  await t.test("a balance asked for a quarter is a gap, never the 10-Q figure", async () => {
    const cat = await resolveMention("CAT");
    const companies = [{ issuer_id: ISSUERS.CAT.issuerId, label: "CAT" }];
    const first = { ...NO_ASKS, metrics: [proposedMetric("remaining_performance_obligations", null, null)!], companies: { kind: "as_named" as const, names: ["CAT"] } };
    const prior = resolveResearchScope({ companies, prior: null, asOf: AS_OF, proposal: first });
    const quarter = { ...NO_ASKS, period: { kind: "fiscal_quarter" as const, fiscal_year: 2026, fiscal_period: "Q3" as const }, companies: { kind: "as_named" as const, names: [] } };
    const followUp = {
      priorSubjects: async () => [cat],
      researchScope: async (_context: unknown, read: Promise<ScopeProposal | null>) => resolveResearchScope({ companies, prior, asOf: AS_OF, proposal: await read }),
    } as never;
    assert.deepEqual(await answer(quarter, "And for Q3 2026?", followUp), [["Remaining performance obligations", "missing", null]]);
  });
});
