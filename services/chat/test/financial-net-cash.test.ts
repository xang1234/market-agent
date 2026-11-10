// A net debt or total debt question is answered with the certified figure
// (ADR 0006, #602), every balance it reads shown beside it, from real
// companyfacts and with no planning model. A line the 10-K does not report
// is its own gap and is left out of the sum.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { aaplWithCash, callInputsCompanyFacts } from "../../fundamentals/test/sec-call-inputs-fixture.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { proposedMetric } from "../src/research-scope.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, NO_ASKS } from "./financial-fixtures.ts";

const FIXTURE = callInputsCompanyFacts();
const RETRIEVED = "2026-11-09T15:00:00.000Z";
const AS_OF = "2026-11-10T12:00:00.000Z";
const ISSUERS = {
  AAPL: { issuerId: randomUUID(), cik: 320193, facts: () => aaplWithCash(FIXTURE), filing: [2026, "FY"] },
  CAT: { issuerId: randomUUID(), cik: 18230, facts: () => FIXTURE.CAT, filing: [2025, "FY"] },
} as const;
type Ticker = keyof typeof ISSUERS;

const resolveMention = async (mention: string): Promise<ChatSubjectPreResolution> => {
  const issuer = ISSUERS[mention as Ticker];
  if (!issuer) return { status: "not_found", input_text: mention, normalized_input: mention, message: "not found" } as ChatSubjectPreResolution;
  return { status: "resolved", subject_ref: { kind: "issuer", id: issuer.issuerId }, display_label: mention, handoff: { display_labels: { ticker: mention } } } as unknown as ChatSubjectPreResolution;
};

const AAPL_DEBT = [
  ["Long-term debt (current portion)", "verified", "USD 9906000000"],
  ["Long-term debt (noncurrent)", "verified", "USD 68208000000"],
  ["Commercial paper", "verified", "USD 1997000000"],
  ["Short-term borrowings", "missing", null],
];

test("net debt and total debt questions answer with the certified figure and its balances", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-net-cash");
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  for (const [ticker, { issuerId, cik, facts, filing: [fiscal_year, fiscal_period] }] of Object.entries(ISSUERS)) {
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuerId, ticker, String(cik)]);
    const statements = createSecBackedStatementRepository(pool, {
      fetcher: secCompanyFetcher(facts, { completed_at: RETRIEVED }),
      sourceId: randomUUID(),
      logger: { warn: () => {} },
    });
    assert.ok(await statements.find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year, fiscal_period }));
  }

  // As the scope model reads the question: the catalog metric, no period.
  const ask = async (ticker: Ticker, metric: string, userIntent: string) => {
    const reading = { ...NO_ASKS, metrics: [proposedMetric(metric, null, null)!], companies: { kind: "as_named" as const, names: [ticker] } };
    const harness = chatHarness(pool, { model: null, resolveMention, readQuestion: async () => reading, clock: () => new Date(AS_OF) });
    const done = completed((await harness.run({ threadId, userId: IDS.owner, userIntent })).events);
    const read = await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner });
    const message = read!.messages.find((candidate) => candidate.message_id === done.message_id)!;
    const block = (message.blocks as Array<{ id: string; kind: string; financial: any }>)[0]!;
    assert.equal(block.kind, "financial_answer", JSON.stringify(message.blocks));
    const { results, labels } = block.financial;
    return {
      proof: message.block_proofs[block.id],
      rows: results.map((result: any) => [labels[result.measure_label_id].text, result.disposition, result.presented?.full_text ?? null]),
    };
  };

  await t.test("AAPL's net debt is its net cash of USD 56,824M, sealed beside the nine balances", async () => {
    assert.deepEqual(await ask("AAPL", "net_cash", "What is AAPL's net debt?"), {
      proof: { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" },
      rows: [
        ["Cash and equivalents (excluding restricted cash)", "verified", "USD 36305000000"],
        ["Marketable securities (current)", "verified", "USD 20417000000"],
        ["Marketable securities (noncurrent)", "verified", "USD 80213000000"],
        ["Short-term investments", "missing", null],
        ["Debt securities (current)", "missing", null],
        ...AAPL_DEBT,
        ["Net cash (cash and securities less debt)", "verified", "USD 56824000000"],
      ],
    });
  });

  await t.test("AAPL's total debt is USD 80,111M, sealed beside its four debt lines", async () => {
    assert.deepEqual((await ask("AAPL", "total_debt", "What is AAPL's total debt?")).rows, [
      ...AAPL_DEBT,
      ["Total debt (long-term debt, commercial paper and short-term borrowings)", "verified", "USD 80111000000"],
    ]);
  });

  await t.test("CAT tags no cash and equivalents, so its net cash is a named gap, and its total debt still answers", async () => {
    const netCash = (await ask("CAT", "net_cash", "What is CAT's net debt?")).rows;
    assert.deepEqual([netCash[0], netCash.at(-1)], [["Cash and equivalents (excluding restricted cash)", "missing", null], ["Net cash (cash and securities less debt)", "missing", null]]);
    assert.deepEqual((await ask("CAT", "total_debt", "What is CAT's total debt?")).rows, [
      ["Long-term debt (current portion)", "missing", null],
      ["Long-term debt (noncurrent)", "verified", "USD 30696000000"],
      ["Commercial paper", "missing", null],
      ["Short-term borrowings", "verified", "USD 5514000000"],
      ["Total debt (long-term debt, commercial paper and short-term borrowings)", "verified", "USD 36210000000"],
    ]);
  });
});
