import test from "node:test";
import assert from "node:assert/strict";

import { checkAssertions } from "../src/assertions.ts";
import { checkComparison } from "../src/comparisons.ts";
import type { EvidencePacket, PacketFigure } from "../src/evidence-packet.ts";

const packet = (companies: string[], figures: PacketFigure[]): EvidencePacket => ({
  route: "trend",
  cutoff: "2026-09-01T00:00:00.000Z",
  companies,
  figures,
  coverage: [],
  gaps: [],
  query_bounds: {},
  claims: [],
  disagreements: [],
  claims_status: "none",
  claims_truncated: false,
});
const fig = (id: string, metric: string, period: string, value: string, extra: Partial<PacketFigure> = {}): PacketFigure =>
  ({ id, metric, period, value, source_ids: [], ...extra });

// One company's quarters: AMD's operating margin dips into a loss in Q2 and
// recovers. T5 is the latest-quarter row showing T4's fact again.
const AMD = packet(["AMD"], [
  fig("T1", "Operating margin", "Q1 2025", "10.8%", { period_end: "2025-03-29", fact_id: "f1" }),
  fig("T2", "Operating margin", "Q2 2025", "-1.7%", { period_end: "2025-06-28", fact_id: "f2" }),
  fig("T3", "Operating margin", "Q3 2025", "13.7%", { period_end: "2025-09-27", fact_id: "f3" }),
  fig("T4", "Operating margin", "Q4 2025", "14.1%", { period_end: "2025-12-27", fact_id: "f4" }),
  fig("T5", "Operating margin", "Q42025", "14.1%", { period_end: "2025-12-27", fact_id: "f4" }),
  // 10 -> 12 -> 11: up overall, not throughout, pulled back from a high.
  fig("G1", "Gross margin", "Q1 2025", "10.0%", { period_end: "2025-03-29" }),
  fig("G2", "Gross margin", "Q2 2025", "12.0%", { period_end: "2025-06-28" }),
  fig("G3", "Gross margin", "Q3 2025", "11.0%", { period_end: "2025-09-27" }),
  // 10 -> 7 -> 9: down overall, rebounding from a low.
  fig("N1", "Net margin", "Q1 2025", "10.0%", { period_end: "2025-03-29" }),
  fig("N2", "Net margin", "Q2 2025", "7.0%", { period_end: "2025-06-28" }),
  fig("N3", "Net margin", "Q3 2025", "9.0%", { period_end: "2025-09-27" }),
  // Q2 is missing: up every step shown, but not shown to rise every quarter.
  fig("R1", "Revenue", "Q1 2025", "$7.4B", { period_end: "2025-03-29" }),
  fig("R3", "Revenue", "Q3 2025", "$9.2B", { period_end: "2025-09-27" }),
  fig("R4", "Revenue", "Q4 2025", "$10.3B", { period_end: "2025-12-27" }),
]);

const PEERS = packet(["NVDA", "AMD", "AAPL"], [
  fig("C1", "Gross margin", "FY2026", "74.4%", { company: "NVDA", period_end: "2026-01-25" }),
  fig("C2", "Gross margin", "FY2025", "49.9%", { company: "AMD", period_end: "2025-12-27" }),
  fig("C3", "Gross margin", "FY2025", "46.9%", { company: "AAPL", period_end: "2025-09-27" }),
  // AAPL has no operating margin shown.
  fig("O1", "Operating margin", "FY2026", "60.4%", { company: "NVDA" }),
  fig("O2", "Operating margin", "FY2025", "10.7%", { company: "AMD" }),
  // Equal as shown, and too close to separate at the precision shown.
  fig("M1", "Net margin", "FY2026", "13.2%", { company: "NVDA" }),
  fig("M2", "Net margin", "FY2025", "13.2%", { company: "AMD" }),
  fig("M3", "Net margin", "FY2025", "13.25%", { company: "AAPL" }),
  // Negative values: the highest is the least negative.
  fig("E1", "EPS growth", "FY2026", "-5.0%", { company: "NVDA" }),
  fig("E2", "EPS growth", "FY2025", "-12.0%", { company: "AMD" }),
  fig("E3", "EPS growth", "FY2025", "-8.0%", { company: "AAPL" }),
  // Different currencies cannot be ranked; different scales can.
  fig("V1", "Revenue", "FY2026", "$130.5B", { company: "NVDA" }),
  fig("V2", "Revenue", "FY2025", "€25.8B", { company: "AMD" }),
  fig("V3", "Revenue", "FY2025", "$950.0M", { company: "AAPL" }),
  fig("S1", "Cash", "FY2026", "$1.2B", { company: "NVDA" }),
  fig("S2", "Cash", "FY2025", "$950.0M", { company: "AMD" }),
]);

const compare = (p: EvidencePacket, op: string, evidence: string[], result: unknown) =>
  checkAssertions([{ kind: "comparison", op, result, text: "x", evidence }], p);
const reasons = (p: EvidencePacket, op: string, evidence: string[], result: unknown) =>
  compare(p, op, evidence, result).rejected.map((entry) => entry.reason);
const ok = (p: EvidencePacket, op: string, evidence: string[], result: unknown) =>
  assert.deepEqual(reasons(p, op, evidence, result), [], `${op} ${JSON.stringify(result)} should pass`);

const ALL_OPERATING = ["T1", "T2", "T3", "T4"];

test("an extremum over time covers every period shown, interior ones included (#208)", () => {
  ok(AMD, "lowest", ALL_OPERATING, "T2");
  ok(AMD, "highest", ALL_OPERATING, "T4");
  // The same fact shown twice counts once, whichever is cited.
  ok(AMD, "highest", ["T1", "T2", "T3", "T5"], "T5");
  ok(AMD, "highest", ["T1", "T2", "T3", "T4", "T5"], "T5");
  // Wrong extremum: the start is not the low, the interior loss is.
  assert.deepEqual(reasons(AMD, "lowest", ALL_OPERATING, "T1"), ["comparison: T2 (-1.7%) is lower than T1 (10.8%)"]);
  // A convenient subset: leaving out the loss quarter makes Q1 look like the low.
  assert.deepEqual(reasons(AMD, "lowest", ["T1", "T3", "T4"], "T1"), ["comparison: leaves out Q2 2025, which shows operating margin too"]);
});

test("a trend's net direction, every-step movement and rebound are distinct claims (#208)", () => {
  ok(AMD, "trend", ALL_OPERATING, "rose");
  ok(AMD, "trend", ALL_OPERATING, "rebounded");
  assert.deepEqual(reasons(AMD, "trend", ALL_OPERATING, "fell"), ["comparison: operating margin rose from 10.8% to 14.1%"]);
  assert.deepEqual(reasons(AMD, "trend", ALL_OPERATING, "rose_throughout"), ["comparison: operating margin did not rise in every period"]);
  // 10 -> 12 -> 11 rises overall but not throughout, and pulls back from a high.
  ok(AMD, "trend", ["G1", "G2", "G3"], "rose");
  ok(AMD, "trend", ["G1", "G2", "G3"], "pulled_back");
  assert.deepEqual(reasons(AMD, "trend", ["G1", "G2", "G3"], "rose_throughout"), ["comparison: gross margin did not rise in every period"]);
  assert.deepEqual(reasons(AMD, "trend", ["G1", "G2", "G3"], "rebounded"), ["comparison: gross margin has no low inside the window that it recovered from"]);
  // 10 -> 7 -> 9 rebounds while remaining down overall.
  ok(AMD, "trend", ["N1", "N2", "N3"], "fell");
  ok(AMD, "trend", ["N1", "N2", "N3"], "rebounded");
  assert.deepEqual(reasons(AMD, "trend", ["N1", "N2", "N3"], "rose"), ["comparison: net margin fell from 10.0% to 9.0%"]);
  // A missing quarter: up at each step shown, but not shown to rise in every period.
  ok(AMD, "trend", ["R1", "R3", "R4"], "rose");
  assert.deepEqual(reasons(AMD, "trend", ["R1", "R3", "R4"], "rose_throughout"), ["comparison: a period is missing between Q1 2025 and Q3 2025, so every-period movement is not shown"]);
  assert.deepEqual(reasons(AMD, "trend", ALL_OPERATING, "sideways"), ['comparison: unknown trend result "sideways"']);
});

test("a ranking covers every company with the metric shown, and picks the right winner (#208)", () => {
  ok(PEERS, "highest", ["C1", "C2", "C3"], "C1");
  ok(PEERS, "lowest", ["C1", "C2", "C3"], "C3");
  ok(PEERS, "order", ["C1", "C2", "C3"], ["C1", "C2", "C3"]);
  // Wrong winner, with every number and citation right.
  assert.deepEqual(reasons(PEERS, "highest", ["C1", "C2", "C3"], "C2"), ["comparison: C1 (74.4%) is higher than C2 (49.9%)"]);
  assert.deepEqual(reasons(PEERS, "order", ["C1", "C2", "C3"], ["C1", "C3", "C2"]), ["comparison: C2 (49.9%) is higher than C3 (46.9%)"]);
  assert.deepEqual(reasons(PEERS, "order", ["C1", "C2", "C3"], ["C1", "C2"]), ["comparison: the order lists each cited figure once"]);
  // An omitted peer makes a conclusion over a convenient subset.
  assert.deepEqual(reasons(PEERS, "lowest", ["C1", "C2"], "C2"), ["comparison: leaves out AAPL, which shows gross margin too"]);
  // A company with no figure for the metric is outside the cohort, and said so.
  ok(PEERS, "highest", ["O1", "O2"], "O1");
  const checked = checkComparison({ op: "highest", result: "O1" }, ["O1", "O2"], PEERS);
  assert.ok("comparison" in checked);
  assert.deepEqual(checked.comparison.not_shown, ["AAPL"]);
});

test("ties, rounding, negatives and incompatible units cannot make a false winner (#208)", () => {
  assert.deepEqual(reasons(PEERS, "highest", ["M1", "M2", "M3"], "M1"), [
    "comparison: M1 (13.2%) and M2 (13.2%) cannot be told apart at the precision shown",
  ]);
  // 13.2% and 13.25% overlap once rounding is allowed for.
  assert.deepEqual(reasons(PEERS, "order", ["M1", "M2", "M3"], ["M3", "M1", "M2"]), [
    "comparison: M3 (13.25%) and M1 (13.2%) cannot be told apart at the precision shown",
  ]);
  ok(PEERS, "highest", ["E1", "E2", "E3"], "E1");
  ok(PEERS, "lowest", ["E1", "E2", "E3"], "E2");
  assert.deepEqual(reasons(PEERS, "highest", ["V1", "V2", "V3"], "V1"), ["comparison: the values are in different units or currencies"]);
  ok(PEERS, "highest", ["S1", "S2"], "S1");
  assert.deepEqual(reasons(PEERS, "highest", ["S1", "S2"], "S2"), ["comparison: S1 ($1.2B) is higher than S2 ($950.0M)"]);
});

test("a comparison's shape: one metric, two or more figures, a trend over one company's periods (#208)", () => {
  assert.deepEqual(reasons(PEERS, "highest", ["C1", "O2"], "C1"), ["comparison: a comparison is of one metric"]);
  assert.deepEqual(reasons(PEERS, "highest", ["C1"], "C1"), ["a comparison cites two or more figures, and only figures"]);
  assert.deepEqual(reasons(PEERS, "trend", ["C1", "C2", "C3"], "rose"), ["comparison: a trend is one company's metric over time"]);
  assert.deepEqual(reasons(PEERS, "highest", ["C1", "C2", "C3"], "C9"), ["comparison: the result is not one of the cited figures"]);
  assert.deepEqual(reasons(PEERS, "rank", ["C1", "C2", "C3"], "C1"), ['comparison: unknown op "rank"']);
  // Only a comparison has an op.
  assert.deepEqual(
    checkAssertions([{ kind: "observation", op: "highest", text: "x", evidence: ["C1"] }], PEERS).rejected.map((entry) => entry.reason),
    ["only a comparison has an op and a result"],
  );
});

test("an inference may rest on a checked comparison (#208)", () => {
  const report = checkAssertions([
    { kind: "comparison", op: "highest", result: "C1", text: "NVDA has the highest gross margin.", evidence: ["C1", "C2", "C3"] },
    { kind: "analyst_inference", text: "The leader has more pricing power than its peers.", evidence: [], supports: [0] },
  ], PEERS);
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(report.accepted.map((entry) => entry.kind), ["comparison", "analyst_inference"]);
  assert.equal(report.accepted[0]!.op, "highest");
  // One resting on a rejected comparison is rejected with it.
  const wrong = checkAssertions([
    { kind: "comparison", op: "highest", result: "C2", text: "AMD has the highest gross margin.", evidence: ["C1", "C2", "C3"] },
    { kind: "analyst_inference", text: "The leader has more pricing power than its peers.", evidence: [], supports: [0] },
  ], PEERS);
  assert.deepEqual(wrong.accepted, []);
});

test("segments of one company rank as one metric, apart from the company's own revenue (#208)", () => {
  const segments = packet(["NVDA"], [
    fig("R1", "Revenue", "Q42026", "$62.1B", { period_end: "2026-01-25" }),
    fig("S1", "Revenue", "Q42026", "$55.2B", { segment: "Data Center", period_end: "2026-01-25" }),
    fig("S2", "Revenue", "Q42026", "$4.3B", { segment: "Gaming", period_end: "2026-01-25" }),
    fig("S3", "Revenue", "Q42026", "$650.0M", { segment: "Automotive", period_end: "2026-01-25" }),
  ]);
  ok(segments, "highest", ["S1", "S2", "S3"], "S1");
  ok(segments, "order", ["S1", "S2", "S3"], ["S1", "S2", "S3"]);
  assert.deepEqual(reasons(segments, "highest", ["S1", "S2"], "S1"), ["comparison: leaves out Automotive, which shows revenue too"]);
  assert.deepEqual(reasons(segments, "highest", ["R1", "S1"], "R1"), ["comparison: a comparison is of one metric"]);
});

test("a comparison needs two distinct facts, however its evidence repeats them (#286 review)", () => {
  const one = packet(["NVDA"], [
    fig("A1", "Revenue", "Q42026", "$62.1B", { fact_id: "f1" }),
    fig("A2", "Revenue", "Q4 2026", "$62.1B", { fact_id: "f1" }),
  ]);
  // A repeated id is a duplicate reference, caught before the comparison (#221).
  assert.deepEqual(reasons(one, "highest", ["A1", "A1"], "A1"), ['evidence lists "A1" twice']);
  assert.deepEqual(reasons(one, "lowest", ["A1", "A2"], "A1"), ["comparison: a comparison needs two or more distinct figures"]);
});

test("a comparison never sets an annual figure against a quarterly one (#302 review)", () => {
  const available = (id: string, metric: string, period: string, value: string, extra: Partial<PacketFigure> = {}) =>
    fig(id, metric, period, value, { fact_id: `f-${id}`, ...extra });
  const aapl = packet(["AAPL"], [
    available("F1", "Revenue", "FY2025", "$416.2B"),
    available("F2", "Revenue", "Q12026", "$124.3B"),
    available("F3", "Revenue", "Q42024", "$90.0B"),
  ]);
  assert.deepEqual(reasons(aapl, "trend", ["F1", "F2", "F3"], "fell"), ["comparison: a comparison does not set an annual figure against a quarterly one"]);
  ok(aapl, "trend", ["F3", "F2"], "rose");
  assert.deepEqual(reasons(aapl, "trend", ["F3", "F2"], "fell"), ["comparison: revenue rose from $90.0B to $124.3B"]);
});

