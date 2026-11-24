// Standout findings (standout-findings.ts) run on the engine over seeded
// annual series: each detector gives a finding, or declines by name.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client, Pool } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { IDS, seedReportedFact } from "../../financial-engine/test/db-fixtures.ts";
import type { ControlledRouter, LlmToolCall } from "../../llm/src/router.ts";
import { analystSectionRunner } from "../src/analyst-agent.ts";
import type { AnswerTraceInput } from "../src/answer-trace.ts";
import type { ChatTurnRunContext } from "../src/coordinator.ts";
import { certifiedFinancials, chatAuthority } from "../src/financial-runtime.ts";
import { DETECTORS, isFinding, runDetectors, type DetectorOutcome } from "../src/standout-findings.ts";
import { chatDatabase } from "./financial-fixtures.ts";

const YEARS = Array.from({ length: 10 }, (_, k) => 2014 + k);
type Series = Readonly<Record<string, (year: number, k: number) => string | null>>;

async function seedIssuer(db: Client, series: Series): Promise<string> {
  const issuer = randomUUID();
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [issuer, `Issuer ${issuer.slice(0, 8)}`]);
  for (const [metric, value] of Object.entries(series)) {
    for (const [k, year] of YEARS.entries()) {
      const amount = value(year, k);
      if (amount !== null) await seedReportedFact(db, { metric_key: metric, value: amount, fiscal_year: year, subject: issuer });
    }
  }
  return issuer;
}

async function findings(pool: Pool, threadId: string, issuer: string) {
  const turnId = randomUUID();
  const context: ChatTurnRunContext = { threadId, runId: turnId, turnId, userId: IDS.owner, userIntent: "What stands out?", emit: () => undefined } as unknown as ChatTurnRunContext;
  const outcome = await certifiedFinancials({ pool, planningModel: null, evidence: createEvidenceFinancialPort }, {
    context,
    subjects: [{ mention: "AAA", resolution: { status: "resolved", subject_ref: { kind: "issuer", id: issuer }, label: "AAA" } }],
    choice: { kind: "findings" },
    labels: new Map([[issuer, "AAA"]]),
    authority: chatAuthority(IDS.owner, threadId, turnId),
    requestKey: `findings:${issuer}`,
    persistParent: async () => {},
  });
  assert.equal(outcome.status, "published", JSON.stringify(outcome));
  if (outcome.status !== "published") throw new Error("unpublished");
  const byDetector = new Map(runDetectors(outcome.content, "AAA").map((entry) => [entry.detector_id, entry] as const));
  return { byDetector, packet: await outcome.packet() };
}

const shown = (outcome: DetectorOutcome | undefined) => (outcome && isFinding(outcome) ? outcome.statement : outcome && { reason: outcome.reason, detail: outcome.detail });

test("standout findings", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for standout findings");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-findings");

  await t.test("each detector finds its latest year at the extreme, in a sentence of the certified figures, which the packet cites", async () => {
    // Margin rises 10% to 19%; cash conversion falls 1.5x to 1.05x; SBC rises against a falling FCF.
    const issuer = await seedIssuer(db, {
      revenue: () => "1000",
      operating_income: (_y, k) => String(100 + 10 * k),
      net_income_consolidated: () => "100",
      operating_cash_flow: (_y, k) => String(150 - 5 * k),
      capex: () => "10",
      stock_based_compensation: (_y, k) => String(20 + 5 * k),
    });
    const { byDetector, packet } = await findings(pool, threadId, issuer);
    assert.deepEqual(DETECTORS.map((detector) => shown(byDetector.get(detector.id))), [
      "AAA's operating margin was 19.00% in FY2023 (ended 2023-12-31), the highest of its last 10 fiscal years.",
      "AAA's stock-based compensation as a multiple of free cash flow was 0.68x in FY2023 (ended 2023-12-31), the highest of its last 5 fiscal years.",
      "AAA's cash conversion (operating cash flow / net income) was 1.05x in FY2023 (ended 2023-12-31), the lowest of its last 10 fiscal years.",
    ]);
    for (const outcome of byDetector.values()) {
      assert.ok(isFinding(outcome));
      const [value, ranking] = outcome.result_ids.map((id) => packet.figures.find((figure) => figure.result_id === id));
      assert.ok(value && value.ranking === undefined && value.gap === undefined, "the latest year's value is a packet figure");
      assert.ok(ranking?.ranking, "its ranking is a packet figure");
    }
  });

  await t.test("get_findings puts each finding in the answer's packet over the F ids of its certified figures, and tells the answer how to cite them", async () => {
    const issuer = await seedIssuer(db, {
      revenue: () => "1000",
      operating_income: (_y, k) => String(100 + 10 * k),
      net_income_consolidated: () => "100",
      operating_cash_flow: () => "150",
      capex: () => "10",
      stock_based_compensation: () => "20",
    });
    const steps: Array<{ text?: string; toolCalls?: LlmToolCall[] }> = [{ toolCalls: [{ id: "c1", name: "get_findings", arguments: { subject_ref: { kind: "issuer", id: issuer } } }] }, { text: "DONE" }];
    let sent = 0;
    const router: ControlledRouter = { complete: async () => ({ text: "", ...steps[sent++], deployment: { channel: "openai", model: "o3" } }) };
    let composed: AnswerTraceInput | undefined;
    const runId = randomUUID();
    const section = await analystSectionRunner({
      financial: { pool, evidence: createEvidenceFinancialPort },
      router: async () => router,
      read: async () => assert.fail("no stored read"),
      compose: async (input) => {
        composed = input;
        return { assertions: null, blocks: [], without: () => ({ blocks: [] }) } as unknown as Awaited<ReturnType<Parameters<typeof analystSectionRunner>[0]["compose"]>>;
      },
    })({ subject: { issuer_id: issuer, label: "AAA" }, goal: "What stands out in AAA's history?", sectionId: "findings", userId: IDS.owner, runId, authority: chatAuthority(IDS.owner, threadId, runId), snapshotId: randomUUID(), asOf: new Date().toISOString() });
    const findings = section.packet?.findings ?? [];
    assert.deepEqual(findings.map((finding) => finding.statement), ["AAA's operating margin was 19.00% in FY2023 (ended 2023-12-31), the highest of its last 10 fiscal years."]);
    const [value, ranking] = findings[0]!.figures.map((id) => section.packet!.figures.find((figure) => figure.id === id));
    assert.equal(value?.value, "19.00%");
    assert.ok(ranking?.ranking);
    assert.ok(composed?.instructions?.some((rule) => rule.startsWith("evidence_packet.findings")), "the answer is told how to cite a finding");
  });

  await t.test("a get_findings run with no finding adds no figures to the answer, only a note naming each detector's decline", async () => {
    const issuer = await seedIssuer(db, { revenue: (year) => (year >= 2022 ? "1000" : null), operating_income: (year) => (year >= 2022 ? "100" : null) });
    const router: ControlledRouter = (() => {
      let sent = 0;
      const steps = [{ toolCalls: [{ id: "c1", name: "get_findings", arguments: { subject_ref: { kind: "issuer", id: issuer } } }] }, { text: "DONE" }];
      return { complete: async () => ({ text: "", ...steps[sent++], deployment: { channel: "openai", model: "o3" } }) };
    })();
    const runId = randomUUID();
    const section = await analystSectionRunner({
      financial: { pool, evidence: createEvidenceFinancialPort },
      router: async () => router,
      read: async () => assert.fail("no stored read"),
      compose: async () => assert.fail("nothing to write from"),
    })({ subject: { issuer_id: issuer, label: "AAA" }, goal: "What stands out in AAA's history?", sectionId: "findings", userId: IDS.owner, runId, authority: chatAuthority(IDS.owner, threadId, runId), snapshotId: randomUUID(), asOf: new Date().toISOString() });
    assert.deepEqual(section.packet?.figures, []);
    assert.equal(section.packet?.findings, undefined);
    assert.deepEqual(section.packet?.gaps, [
      "AAA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: a year in its window has no value; cash conversion (operating cash flow / net income): a year in its window has no value).",
    ]);
  });

  await t.test("a missing year, a non-positive base and a year inside the range each decline by name", async () => {
    const issuer = await seedIssuer(db, {
      revenue: (year) => (year === 2017 ? null : "1000"),
      operating_income: (_y, k) => String(100 + 10 * k),
      net_income_consolidated: (year) => (year === 2023 ? "-50" : "100"),
      operating_cash_flow: () => "150",
      capex: () => "10",
      stock_based_compensation: (_y, k) => String(80 - 5 * k),
    });
    const { byDetector } = await findings(pool, threadId, issuer);
    assert.deepEqual(byDetector.get("operating_margin_extreme"), { detector_id: "operating_margin_extreme", reason: "incomplete_history", detail: "9 of 10 fiscal years have a value" });
    assert.equal((byDetector.get("cash_conversion_low") as { reason: string }).reason, "non_positive_base");
    assert.deepEqual(byDetector.get("sbc_share_of_free_cash_flow"), { detector_id: "sbc_share_of_free_cash_flow", reason: "within_range", detail: "FY2023 (ended 2023-12-31) ranks 5 of 5 by highest" });
  });

  await t.test("a lowest margin is a finding; a negative free cash flow year leaves the history incomplete; a flat series ties and is no standout", async () => {
    const issuer = await seedIssuer(db, {
      revenue: () => "1000",
      operating_income: (_y, k) => String(200 - 10 * k),
      net_income_consolidated: () => "100",
      operating_cash_flow: () => "150",
      capex: (year) => (year === 2021 ? "500" : "10"),
      stock_based_compensation: () => "20",
    });
    const { byDetector } = await findings(pool, threadId, issuer);
    assert.equal(shown(byDetector.get("operating_margin_extreme")), "AAA's operating margin was 11.00% in FY2023 (ended 2023-12-31), the lowest of its last 10 fiscal years.");
    assert.deepEqual(byDetector.get("sbc_share_of_free_cash_flow"), { detector_id: "sbc_share_of_free_cash_flow", reason: "incomplete_history", detail: "4 of 5 fiscal years have a value" });
    assert.deepEqual(byDetector.get("cash_conversion_low"), { detector_id: "cash_conversion_low", reason: "within_range", detail: "FY2023 (ended 2023-12-31) ranks 1 of 10 by lowest, tied with 9 other years" });
  });
});
