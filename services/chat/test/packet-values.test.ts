// Each packet figure's exact value, and the pointers a figure check reads it by (#800):
// F3 for a figure, C2.1 for the first figure a claim's text states.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { FinancialAnswerContent, FinancialPlan, PresentedResult } from "../../financial-core/src/index.ts";
import { enginePacket, packetForModel, packetValue, parsePacketRef, type EvidencePacket, type PacketClaim, type PacketRef } from "../src/evidence-packet.ts";
import { priceFigures } from "../src/perf-block.ts";
import { AMD_Q2_2025_RELEASE } from "./golden/dataset.ts";

// NVIDIA's latest-quarter answer on the golden data: the first financial answer block in the
// golden conversation, recorded from a real stack with DEV_CAPTURE_FILE (services/app/src/dev.ts).
type Exchange = { body: string };
type Message = { blocks?: Array<{ kind: string; financial?: FinancialAnswerContent }> };
const REPLAY = JSON.parse(readFileSync(new URL("../../app/fixtures/golden-conversation.replay.json", import.meta.url), "utf8")) as { exchanges: Exchange[] };
const ANSWER = REPLAY.exchanges
  .flatMap(({ body }) => (body.startsWith("{") ? ((JSON.parse(body) as { messages?: Message[] }).messages ?? []) : []))
  .flatMap((message) => message.blocks ?? [])
  .find((block) => block.kind === "financial_answer")!.financial!;
const NO_TICKERS = new Map<string, string>();
// enginePacket shows a ranking only with a plan; one with no operations names no lead.
const PLAN = { operations: [], outputs: [] } as unknown as FinancialPlan;

const figureOf = (packet: EvidencePacket, metric: string, period: string) =>
  packet.figures.find((figure) => figure.metric === metric && figure.period?.startsWith(period))!;
const resultOf = (metric: string, period: string) =>
  ANSWER.results.find((result) => ANSWER.labels[result.measure_label_id]!.text === metric && ANSWER.labels[result.period_label_id]!.text.startsWith(period))!;
// The answer with one result's presented value replaced.
const withPresented = (target: PresentedResult, presented: PresentedResult["presented"]): FinancialAnswerContent =>
  ({ ...ANSWER, results: ANSWER.results.map((result) => (result === target ? { ...result, presented } : result)) });

test("an engine figure carries the exact value its result holds: an amount as is, a ratio as a fraction or a multiple, a percent over 100", () => {
  const packet = enginePacket(ANSWER, NO_TICKERS, null);
  const revenue = figureOf(packet, "Revenue", "Q4 FY2026");
  assert.equal(revenue.value, "$62.1B");
  assert.deepEqual(revenue.quantity, { kind: "amount", value: 62_100_000_000 });
  const margin = resultOf("Gross margin (gross profit / revenue)", "Q4 FY2026");
  assert.equal(margin.presented.kind === "value" && margin.presented.unit.kind, "ratio");
  assert.deepEqual(figureOf(packet, "Gross margin (gross profit / revenue)", "Q4 FY2026").quantity, { kind: "fraction", value: 46_200 / 62_100 });
  const value = (presented: { value: string; unit: unknown; full_text: string }) => {
    const answer = withPresented(margin, { kind: "value", text: "", exact: true, ...presented } as PresentedResult["presented"]);
    return figureOf(enginePacket(answer, NO_TICKERS, null), "Gross margin (gross profit / revenue)", "Q4 FY2026").quantity;
  };
  assert.deepEqual(value({ value: "74.4", unit: { kind: "percent" }, full_text: "74.4%" }), { kind: "fraction", value: 0.744 });
  assert.deepEqual(value({ value: "3.5", unit: { kind: "ratio" }, full_text: "3.5x" }), { kind: "ratio", value: 3.5 }, "a ratio the engine reads as a multiple");
  assert.deepEqual(value({ value: "120", unit: { kind: "basis_points" }, full_text: "120 bp" }), { kind: "fraction", value: 0.012 });
  assert.deepEqual(value({ value: "1.25", unit: { kind: "currency_per_share", currency: "USD" }, full_text: "USD 1.25 per share" }), { kind: "amount", value: 1.25 });
});

test("a gap or a ranking figure has no value", () => {
  const revenue = resultOf("Revenue", "Q4 FY2026");
  const gapped = withPresented(revenue, { kind: "gap", text: "No reported fact matched the requested metric, subject, and period.", reason_code: "missing_input" });
  const packet = enginePacket(gapped, NO_TICKERS, PLAN);
  const gap = figureOf(packet, "Revenue", "Q4 FY2026");
  assert.equal(gap.gap !== undefined && gap.quantity, undefined);
  const rankings = packet.figures.filter((figure) => figure.ranking);
  assert.equal(rankings.length, 2);
  assert.deepEqual(rankings.map((figure) => figure.quantity), [undefined, undefined]);
});

test("the model never sees a figure's exact value", () => {
  const { figures } = packetForModel(enginePacket(ANSWER, NO_TICKERS, null)) as { figures: Array<Record<string, unknown>> };
  assert.equal(figures.some((figure) => "quantity" in figure), false);
});

test("a price chart's return reads as a fraction and its close as an amount", () => {
  const chart = {
    series: [{ name: "NVDA", points: [{ y: 0 }, { y: 21.37 }] }],
    provenance_series_specs: [{ series_ref: "series-1", end_close: 178.4, currency: "USD", window: { baseline_date: "2026-01-02", end_date: "2026-08-31" } }],
    source_refs: ["source-1"],
  };
  const [ret, close] = priceFigures(chart, "ytd");
  assert.deepEqual([ret!.value, ret!.quantity], ["21.37%", { kind: "fraction", value: 0.2137 }]);
  assert.deepEqual([close!.value, close!.quantity], ["$178.40", { kind: "amount", value: 178.4 }]);
});

const claim = (id: string, text: string): PacketClaim =>
  ({ id, text, predicate: "results.explanation", stance: "neutral", claim_id: `claim-${id}`, source_id: "source-1" });
const WITH_CLAIMS: EvidencePacket = {
  ...enginePacket(ANSWER, NO_TICKERS, null),
  claims: [claim("C1", "Management expects growth."), claim("C2", AMD_Q2_2025_RELEASE.text)],
};

test("F3 reads the third figure's value, and C2.1 the first figure claim C2's text states; a name's digits are no figure", () => {
  const f8 = parsePacketRef("F8", WITH_CLAIMS);
  assert.deepEqual(f8, { figure: "F8" });
  assert.deepEqual(packetValue(WITH_CLAIMS, f8!), { kind: "amount", value: 62_100_000_000 }, "F8 is Q4 FY2026 revenue");
  // "…our AMD Instinct MI308 data center GPU products. … approximately $800 million in inventory and related charges."
  const c21 = parsePacketRef("C2.1", WITH_CLAIMS);
  assert.deepEqual(c21, { claim: "C2", numeral: 1 });
  assert.deepEqual(packetValue(WITH_CLAIMS, c21!), { kind: "amount", value: 800_000_000 });
  assert.equal(parsePacketRef("C2.2", WITH_CLAIMS), null, "MI308's digits are part of a name");
});

test("an id the packet doesn't hold reads nothing", () => {
  for (const text of ["F99", "C9.1", "C1.1", "C2.0", "C2", "F", "f8", "F8.1", " F8 x"]) assert.equal(parsePacketRef(text, WITH_CLAIMS), null, text);
  assert.deepEqual(parsePacketRef(" F8 ", WITH_CLAIMS), { figure: "F8" }, "surrounding space is no part of an id");
  assert.equal(packetValue(WITH_CLAIMS, { figure: "F99" } as PacketRef), undefined);
  assert.equal(packetValue(WITH_CLAIMS, { claim: "C2", numeral: 2 } as PacketRef), undefined);
});
