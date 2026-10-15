import test from "node:test";
import assert from "node:assert/strict";

import { checkAssertions, rejectionCheck, splitAssertions } from "../src/assertions.ts";
import type { EvidencePacket } from "../src/evidence-packet.ts";

const PACKET: EvidencePacket = {
  route: "comparison",
  cutoff: "2026-09-01T00:00:00.000Z",
  companies: ["NVDA", "AMD"],
  figures: [
    { id: "F1", company: "NVDA", metric: "Gross margin", period: "FY2026", value: "75.0%", source_ids: [] },
    { id: "F2", company: "NVDA", metric: "Gross margin", period: "FY2025", value: "72.7%", source_ids: [] },
    { id: "F3", company: "AMD", metric: "Gross margin", period: "FY2025", value: "49.4%", source_ids: [] },
    { id: "F4", company: "AMD", metric: "Revenue", period: "FY2025", value: "$75.0B", source_ids: [] },
  ],
  coverage: [],
  gaps: [],
  query_bounds: {},
  claims: [
    { id: "C2", text: "AMD management expects 10% revenue growth next year.", predicate: "guidance.change", stance: "supporting", company: "AMD", claim_id: "c2", source_id: "s2" },
    { id: "C1", text: "Management said a richer data-center mix lifted margins.", predicate: "kpi.commentary", stance: "supporting", company: "NVDA", effective_time: "2026-02-25T00:00:00.000Z", claim_id: "c1", source_id: "s1" },
  ],
  disagreements: [],
  claims_status: "available",
  claims_truncated: false,
};

const check = (list: unknown[]) => checkAssertions(list, PACKET);

test("the assertion list is cut from the prose wherever it is, and a broken one is malformed (#208)", () => {
  const list = '[{"kind":"observation","text":"x","evidence":["F1"]}]';
  assert.deepEqual(splitAssertions(`NVDA leads.\n\n\`\`\`assertions\n${list}\n\`\`\``), { prose: "NVDA leads.", list: JSON.parse(list), open: false });
  assert.deepEqual(splitAssertions(`NVDA leads.\n\`\`\`assertions\n${list}\n\`\`\`\nAMD trails.`).prose, "NVDA leads.\n\nAMD trails.");
  assert.deepEqual(splitAssertions("NVDA leads.\n```assertions\n[{\"kind\":"), { prose: "NVDA leads.", list: null, open: true });
  assert.deepEqual(splitAssertions("NVDA leads."), { prose: "NVDA leads.", list: undefined, open: false });
  assert.equal(checkAssertions(undefined, PACKET).status, "missing");
  assert.equal(checkAssertions(null, PACKET).status, "malformed");
});

test("a margin change with no causal claim is an observation plus an unknown cause (#208)", () => {
  const report = check([
    { kind: "observation", text: "NVDA's gross margin rose from [[F2]] in FY2025 to [[F1]] in FY2026.", evidence: ["F2", "F1"] },
    { kind: "unknown_cause", text: "The figures do not show why NVDA's margin rose.", evidence: ["F1", "F2"] },
  ]);
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(report.accepted.map((entry) => entry.kind), ["observation", "unknown_cause"]);
});

test("each kind cites what it must (#208)", () => {
  const report = check([
    { kind: "management_attribution", text: "Management credited a richer mix.", evidence: ["F1"] },
    { kind: "observation", text: "Management credited a richer mix.", evidence: ["C1"] },
    { kind: "unknown_cause", text: "The cause is not shown.", evidence: ["C1", "F1"] },
    { kind: "management_attribution", text: "NVDA management credited a richer data-center mix.", evidence: ["C1"] },
    { kind: "guess", text: "Margins will rise.", evidence: ["F1"] },
  ]);
  assert.deepEqual(report.rejected.map((entry) => entry.reason), [
    "a management attribution cites the claim that makes it, and only claims",
    "an observation cites figures, and only figures",
    "an unknown cause cites the figures that changed, and no claim",
    'unknown kind "guess"',
  ]);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [3]);
});

test("an inference rests on accepted observations and writes no figure, typed or referenced (#208, #301)", () => {
  const report = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] },
    { kind: "observation", text: "AMD's gross margin was [[F3]] in FY2025.", evidence: ["F3"] },
    { kind: "analyst_inference", text: "The leader prices with more power.", evidence: [], supports: [0, 1] },
    { kind: "analyst_inference", text: "The leader's [[F1]] margin outruns the other's [[F3]].", evidence: [], supports: [0, 1] },
    { kind: "analyst_inference", text: "The leader's 80% margin leads.", evidence: [], supports: [0] },
    { kind: "analyst_inference", text: "The leader prices with more power.", evidence: [] },
    { kind: "analyst_inference", text: "Its margin is higher.", evidence: [], supports: [2] },
    { kind: "analyst_inference", text: "Its gross margin rose to seventy percent.", evidence: [], supports: [0] },
    { kind: "analyst_inference", text: "It earns a few billion dollars more.", evidence: [], supports: [0] },
    { kind: "analyst_inference", text: "The leader is ahead of all three companies shown.", evidence: [], supports: [0] },
    { kind: "analyst_inference", text: "It earns more profit per dollar of revenue.", evidence: [], supports: [0] },
    { kind: "analyst_inference", text: "The FY2026 performance looks stronger.", evidence: [], supports: [0, 1] },
  ]);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0, 1, 2, 9, 10]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [3, "an inference rests on its supports; it writes no figure"],
    [4, "an inference rests on its supports; it writes no figure"],
    [5, "an inference binds the accepted observations it rests on"],
    [6, "an inference binds the accepted observations it rests on"],
    [7, "an inference rests on its supports; it writes no figure"],
    [8, "an inference rests on its supports; it writes no figure"],
    [11, "an inference rests on its supports; it writes no figure"],
  ]);
  const quarter = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] },
    { kind: "analyst_inference", text: "The Q4 momentum carries into next year.", evidence: [], supports: [0] },
  ]);
  assert.deepEqual(quarter.rejected.map((entry) => [entry.index, entry.reason]), [[1, "an inference rests on its supports; it writes no figure"]]);
});

test("a figure is written only as its own evidence's reference: the wrong figure, company or id, or a typed value, is rejected (#208)", () => {
  const report = check([
    // F3 is a real figure, but AMD's: NVDA's evidence does not hold it.
    { kind: "observation", text: "NVDA's gross margin was [[F3]].", evidence: ["F1"] },
    // Its own figure, credited to another company.
    { kind: "observation", text: "AMD's gross margin was [[F1]].", evidence: ["F1"] },
    // The right value, typed rather than referenced.
    { kind: "observation", text: "NVDA's gross margin was 75.0%.", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: ["F9"] },
  ]);
  assert.deepEqual(report.rejected.map((entry) => entry.reason), [
    "[[F3]] is not in its evidence",
    "names AMD, which its evidence does not",
    "types 75.0%; write its reference",
    'unknown evidence id "F9"',
  ]);
  assert.equal(report.accepted.length, 0);
});

test("at most twelve assertions are checked; the rest are rejected (#208)", () => {
  const one = { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: ["F1"] };
  const report = check(Array.from({ length: 14 }, () => one));
  assert.equal(report.accepted.length, 12);
  assert.deepEqual(report.rejected.map((entry) => entry.index), [12, 13]);
});

test("a company the text names must be its evidence's (#208)", () => {
  assert.deepEqual(check([{ kind: "observation", text: "NVDA's gross margin was [[F1]], ahead of AMD.", evidence: ["F1"] }]).rejected.map((entry) => entry.reason), [
    "names AMD, which its evidence does not",
  ]);
});

test("an attribution is its claim's, for its company: the claim's own number may stand in its text, another may not (#208, #301)", () => {
  const report = check([
    { kind: "management_attribution", text: "AMD management expects [[C2]]", evidence: ["C2"] },
    { kind: "management_attribution", text: "NVDA management expects [[C2]]", evidence: ["C2"] },
    // The page shows C2's quote, never this text; 10% is what C2 writes.
    { kind: "management_attribution", text: "AMD management expects 10% revenue growth.", evidence: ["C2"] },
    { kind: "management_attribution", text: "AMD management expects 12% revenue growth.", evidence: ["C2"] },
  ]);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0, 2]);
  assert.deepEqual(report.rejected.map((entry) => entry.reason), ["names NVDA, which its evidence does not", "types 12%; write its reference"]);
});

test("a year the text writes is a period of its own evidence, not just of the turn (#221)", () => {
  const report = check([
    // FY2026 is F1's period, and the turn's, but not F3's.
    { kind: "observation", text: "AMD's margin was [[F3]] in FY2026.", evidence: ["F3"] },
    { kind: "observation", text: "AMD's margin was [[F3]] in fiscal 2025.", evidence: ["F3"] },
    { kind: "observation", text: "NVDA's margin was [[F1]] in FY2026, and AMD's [[F3]] in FY2025.", evidence: ["F1", "F3"] },
    // A claim's year is its effective or published date's.
    { kind: "management_attribution", text: "In February 2026, NVDA management said [[C1]]", evidence: ["C1"] },
    // Q1-Q4 and H1-H2 are period labels whatever the evidence.
    { kind: "observation", text: "AMD's margin was [[F3]] in Q4 2025.", evidence: ["F3"] },
  ]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [[0, "FY2026 is not a period of its evidence"]]);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [1, 2, 3, 4]);
});

test("a packet with claims but no figures is still checked; one with neither is skipped (#208)", () => {
  const claimsOnly = { ...PACKET, figures: [] };
  const report = checkAssertions([{ kind: "management_attribution", text: "AMD management expects [[C2]]", evidence: ["C2"] }], claimsOnly);
  assert.equal(report.status, "checked");
  assert.equal(report.accepted.length, 1);
  assert.equal(checkAssertions([], { ...claimsOnly, claims: [] }).status, "skipped");
});

test("a claim with no company is no company's: it neither credits the first nor bars the right one (#208)", () => {
  const unowned = {
    ...PACKET,
    claims: [{ id: "C1", text: "Management reiterated 10% growth guidance.", predicate: "guidance.change", stance: "neutral" as const, claim_id: "c", source_id: "s" }],
  };
  const report = checkAssertions([
    { kind: "management_attribution", text: "AMD management reiterated [[C1]]", evidence: ["C1"] },
    { kind: "management_attribution", text: "Management reiterated [[C1]]", evidence: ["C1"] },
  ], unowned);
  assert.deepEqual(report.rejected, []);
});

test("malformed evidence or supports is rejected, not cleaned up (#208)", () => {
  const report = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: ["F1", null] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: "F1" },
    { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: ["F1"] },
    { kind: "analyst_inference", text: "NVDA's margin is high.", evidence: [], supports: [2, "0"] },
  ]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [0, "evidence is not a list of packet ids"],
    [1, "evidence is not a list of packet ids"],
    [3, "supports is not a list of assertion indexes"],
  ]);
});

test("with claims but no figures, only claim-bound assertions are checked; the rest are counted unchecked (#208)", () => {
  const report = checkAssertions([
    { kind: "observation", text: "ACME trades at $12.", evidence: [] },
    { kind: "management_attribution", text: "AMD management expects [[C2]]", evidence: ["C2"] },
  ], { ...PACKET, figures: [] });
  assert.equal(report.status, "checked");
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [1]);
  assert.equal(report.unchecked, 1);
});

test("on the no-figures path, malformed or over-limit entries are still rejected, not unchecked (#208)", () => {
  const one = { kind: "observation", text: "ACME trades at $12.", evidence: [] };
  const report = checkAssertions([null, { kind: "guess", text: "x", evidence: [] }, ...Array.from({ length: 11 }, () => one)], { ...PACKET, figures: [] });
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [0, "not an assertion with text"],
    [1, 'unknown kind "guess"'],
    [12, "more than 12 assertions"],
  ]);
  assert.equal(report.unchecked, 10);
});

test("digits in a company's name are not typed; a number or a worded amount is (#208)", () => {
  const named = { ...PACKET, companies: ["3M Company", "AMD"], figures: [
    { id: "F1", company: "3M Company", metric: "Gross margin", value: "49.2%", source_ids: [] },
    { id: "F4", company: "AMD", metric: "Revenue", value: "$75.0B", source_ids: [] },
  ] };
  const report = checkAssertions([
    { kind: "observation", text: "3M Company's gross margin was [[F1]].", evidence: ["F1"] },
    { kind: "observation", text: "3M Company's gross margin was 49.2 percent.", evidence: ["F1"] },
    { kind: "observation", text: "AMD's revenue was 75 billion dollars.", evidence: ["F4"] },
    { kind: "observation", text: "AMD's revenue was ($75.0B).", evidence: ["F4"] },
  ], named);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [1, "types 49.2; write its reference"],
    [2, "types 75; write its reference"],
    [3, "types $75.0B; write its reference"],
  ]);
});

test("on the no-figures path, an unknown id or a claim cited as a figure is rejected, not unchecked (#208)", () => {
  const report = checkAssertions([
    { kind: "observation", text: "ACME trades at $12.", evidence: ["F99"] },
    { kind: "observation", text: "ACME trades at $12.", evidence: ["C2"] },
    { kind: "observation", text: "ACME trades at $12.", evidence: [] },
  ], { ...PACKET, figures: [] });
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [0, 'unknown evidence id "F99"'],
    [1, "an observation cites figures, and only figures"],
  ]);
  assert.equal(report.unchecked, 1);
});

test("on the no-figures path, an inference must still rest on listed observations (#208)", () => {
  const report = checkAssertions([
    { kind: "observation", text: "ACME trades at $12.", evidence: [] },
    { kind: "analyst_inference", text: "ACME looks cheap.", evidence: [], supports: [0] },
    { kind: "analyst_inference", text: "ACME looks cheap.", evidence: [], supports: [99] },
    { kind: "analyst_inference", text: "ACME looks cheap.", evidence: [], supports: [1] },
  ], { ...PACKET, figures: [] });
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [2, "an inference binds the accepted observations it rests on"],
    [3, "an inference binds the accepted observations it rests on"],
  ]);
  assert.equal(report.unchecked, 2);
});

test("a stored quarter (\"Q42026\") gives its year as prose writes it (#208)", () => {
  const quarterly = { ...PACKET, figures: [{ id: "F1", company: "NVDA", metric: "Revenue", period: "Q42026", value: "$10.0B", source_ids: [] }] };
  assert.deepEqual(checkAssertions([{ kind: "observation", text: "NVDA's revenue was [[F1]] in Q4 2026.", evidence: ["F1"] }], quarterly).rejected, []);
});

test("a management attribution cites claims only, so a figure cannot lend it a number (#208)", () => {
  const report = check([{ kind: "management_attribution", text: "NVDA management said its margin was [[F1]].", evidence: ["C1", "F1"] }]);
  assert.deepEqual(report.rejected.map((entry) => entry.reason), ["a management attribution cites the claim that makes it, and only claims"]);
});

test("on the no-figures path, an inference resting on a rejected observation is rejected (#208)", () => {
  const report = checkAssertions([
    { kind: "observation", text: "ACME trades at $12.", evidence: ["F99"] },
    { kind: "analyst_inference", text: "ACME looks cheap.", evidence: [], supports: [0] },
  ], { ...PACKET, figures: [] });
  assert.deepEqual(report.rejected.map((entry) => entry.index), [0, 1]);
});

test("every assertion block is cut from the prose (#208)", () => {
  const block = '```assertions\n[]\n```';
  assert.equal(splitAssertions(`NVDA leads.\n${block}\nAMD trails.\n${block}`).prose, "NVDA leads.\n\nAMD trails.");
});

test("a closing fence with trailing spaces is closed (#208)", () => {
  assert.equal(splitAssertions("NVDA leads.\n```assertions\n[]\n```   \nAMD trai").open, false);
  assert.equal(splitAssertions("NVDA leads.\n```assertions\n[{").open, true);
});

test("only an inference has supports (#208)", () => {
  const report = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: ["F1"], supports: [99] },
  ]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [0, "only an analyst inference lists supports"],
  ]);
});

test("a block with CRLF line endings is cut from the prose too (#208)", () => {
  assert.deepEqual(splitAssertions("NVDA leads.\r\n```assertions\r\n[]\r\n```\r\n"), { prose: "NVDA leads.", list: [], open: false });
});

test("a requested metric no reader serves is a named gap: no other figure stands in for it (#208)", () => {
  const report = checkAssertions([
    { kind: "observation", text: "NVDA's free cash flow margin was [[F1]].", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's FCF margin was [[F1]].", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's EBITDA was [[F1]].", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: ["F1"] },
  ], { ...PACKET, unavailable_metrics: ["Free cash flow margin", "EBITDA"] });
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [0, "Free cash flow margin is not in the evidence: it is a named gap"],
    [1, "Free cash flow margin is not in the evidence: it is a named gap"],
    [2, "EBITDA is not in the evidence: it is a named gap"],
  ]);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [3]);
});

test("an unknown cause needs a change: one company's metric in two periods (#208)", () => {
  const report = check([
    // The figure that moved alone: the packet shows its other period (F2).
    { kind: "unknown_cause", text: "The figures do not show why.", evidence: ["F1"] },
    // Two companies' figures, and AMD's revenue has no other period.
    { kind: "unknown_cause", text: "The figures do not show why.", evidence: ["F2", "F3", "F4"] },
    { kind: "unknown_cause", text: "The figures do not show why.", evidence: ["F1", "F2"] },
  ]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [1, "an unknown cause cites a change: one company's metric, two periods, two values"],
  ]);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0, 2]);
});

test("an unchanged value is no change; a claim about a missing metric may be attributed (#208)", () => {
  const flat = { ...PACKET, figures: [
    { id: "F1", company: "NVDA", metric: "Gross margin", period: "FY2026", value: "75.0%", source_ids: [] },
    { id: "F2", company: "NVDA", metric: "Gross margin", period: "FY2025", value: "75.0%", source_ids: [] },
  ], claims: [{ id: "C1", text: "NVDA management expects free cash flow to grow.", predicate: "guidance.change", stance: "supporting" as const, company: "NVDA", claim_id: "c", source_id: "s" }],
  unavailable_metrics: ["Free cash flow"] };
  const report = checkAssertions([
    { kind: "unknown_cause", text: "The figures do not show why.", evidence: ["F1", "F2"] },
    { kind: "management_attribution", text: "NVDA management expects free cash flow to grow.", evidence: ["C1"] },
  ], flat);
  assert.deepEqual(report.rejected.map((entry) => entry.index), [0]);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [1]);
});

test("every figure an unknown cause cites is part of a change (#208)", () => {
  const report = check([
    // NVDA's margin changed; AMD's single value did not.
    { kind: "unknown_cause", text: "The figures do not show why.", evidence: ["F1", "F2", "F3"] },
  ]);
  assert.deepEqual(report.rejected.map((entry) => entry.index), [0]);
});

test("an inference may omit evidence; a malformed one is still rejected (#208)", () => {
  const report = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] },
    { kind: "analyst_inference", text: "The margin shows pricing power.", supports: [0] },
    { kind: "analyst_inference", text: "The margin shows pricing power.", evidence: "F1", supports: [0] },
  ]);
  assert.deepEqual(report.accepted.map((entry) => [entry.index, entry.kind, entry.evidence]), [[0, "observation", ["F1"]], [1, "analyst_inference", []]]);
  assert.deepEqual(report.rejected.map((entry) => entry.reason), ["evidence is not a list of packet ids"]);
});

test("an unknown cause may cite only the figure that moved when the packet shows the change (#208)", () => {
  // F1 (FY2026) differs from F2 (FY2025) in the packet, though only F1 is cited.
  assert.deepEqual(check([{ kind: "unknown_cause", text: "The data does not show why NVDA's gross margin moved.", evidence: ["F1"] }]).rejected, []);
  // AMD's revenue has no other period in the packet: no change to explain.
  assert.deepEqual(check([{ kind: "unknown_cause", text: "The data does not show why.", evidence: ["F4"] }]).rejected.map((entry) => entry.reason),
    ["an unknown cause cites a change: one company's metric, two periods, two values"]);
});

test("a year inside a figure's window is a period of its evidence (#208)", () => {
  const packet = { ...PACKET, figures: [{ id: "F1", company: "NVDA", metric: "Price return", period: "YTD 2026: 2025-12-31 close to 2026-08-31 close", value: "5.81%", source_ids: [] }] };
  assert.deepEqual(checkAssertions([{ kind: "observation", text: "NVDA's YTD price return (Dec 2025 close to Aug 2026 close) was [[F1]].", evidence: ["F1"] }], packet).rejected, []);
});

test("an inference stands on every support it lists: one that failed or does not exist rejects it (#310)", () => {
  const report = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's gross margin was 99% in FY2026.", evidence: ["F1"] },
    { kind: "analyst_inference", text: "The margin shows pricing power.", supports: [0, 1] },
    { kind: "analyst_inference", text: "The margin shows pricing power.", supports: [1, 9] },
  ]);
  assert.deepEqual(report.accepted.map((entry) => [entry.index, entry.supports ?? null]), [[0, null]]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [1, "types 99%; write its reference"],
    [2, "an inference rests on every support it lists; 1 is not accepted"],
    [3, "an inference rests on every support it lists; 1 is not accepted"],
  ]);
  assert.deepEqual(check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] },
    { kind: "analyst_inference", text: "The margin shows pricing power.", supports: [0, 9] },
  ]).rejected.map((entry) => entry.reason), ["an inference rests on every support it lists; 9 is not accepted"]);
});

test("an evidence id listed twice is a duplicate reference (#221)", () => {
  assert.deepEqual(check([{ kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1", "F1"] }]).rejected.map((entry) => entry.reason),
    ['evidence lists "F1" twice']);
  assert.deepEqual(check([{ kind: "management_attribution", text: "Management credited a richer data-center mix.", evidence: ["C1", "C1"] }]).rejected.map((entry) => entry.reason),
    ['evidence lists "C1" twice']);
});

test("an observation or comparison states no cause: a cause is attributed or unknown (#221)", () => {
  assert.deepEqual(check([{ kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026, driven by a richer mix.", evidence: ["F1"] }]).rejected.map((entry) => entry.reason),
    ["an observation states no cause: give it as a management attribution or an unknown cause"]);
  assert.deepEqual(check([{ kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] }]).rejected, []);
});

test("each rejection names the check that failed, so binding and comparative failures are told apart (#221)", () => {
  const cases: Array<[string, string]> = [
    ["types 99%; write its reference", "binding"],
    ["FY2026 is not a period of its evidence", "binding"],
    ["[[F4]] is not in its evidence", "binding"],
    ["names AMD, which its evidence does not", "binding"],
    ["unknown reference [[F9]]", "reference"],
    ["comparison: F2 (74.6%) is higher than F4 (49.2%)", "comparative"],
    ["comparison: leaves out AAPL, which shows gross margin too", "comparative"],
    ['unknown evidence id "F99"', "reference"],
    ['evidence lists "C1" twice', "reference"],
    ["an observation cites figures, and only figures", "kind"],
    ["an unknown cause cites a change: one company's metric, two periods, two values", "kind"],
    ["an observation states no cause: give it as a management attribution or an unknown cause", "cause"],
    ["an inference binds the accepted observations it rests on", "support"],
    ["Free cash flow is not in the evidence: it is a named gap", "gap"],
    ["more than 12 assertions", "limit"],
    ['unknown kind "guess"', "format"],
    ["removed by the narrative guard", "rendering"],
    ["rests on an observation the narrative guard removed", "rendering"],
    ["an inference rests on its supports; it writes no figure", "binding"],
  ];
  for (const [reason, check] of cases) assert.equal(rejectionCheck(reason), check, reason);
});

test("descriptive wording is not a cause; causal connectives are (#294 review)", () => {
  for (const text of ["The table reflects NVDA's gross margin of [[F1]] in FY2026.", "The results from FY2026 include NVDA's gross margin of [[F1]]."]) {
    assert.deepEqual(check([{ kind: "observation", text, evidence: ["F1"] }]).rejected, [], text);
  }
  for (const text of ["NVDA's gross margin was [[F1]] in FY2026 because of a richer mix.", "NVDA's gross margin of [[F1]] in FY2026 resulted from a richer mix."]) {
    assert.equal(rejectionCheck(check([{ kind: "observation", text, evidence: ["F1"] }]).rejected[0]?.reason ?? ""), "cause", text);
  }
});

test("a cause is caught on an answer with no figures too, not left unchecked (#294 review)", () => {
  const report = checkAssertions([{ kind: "observation", text: "AMD's margin fell, driven by inventory charges.", evidence: [] }], { ...PACKET, figures: [] });
  assert.equal(rejectionCheck(report.rejected[0]?.reason ?? ""), "cause");
  assert.equal(report.unchecked, undefined);
});

test("active causal verbs are causes too; descriptive wording still isn't (#294 review)", () => {
  for (const text of [
    "Inventory charges caused NVDA's gross margin to fall to [[F1]] in FY2026.",
    "A richer mix led to NVDA's gross margin of [[F1]] in FY2026.",
    "Data center demand drove NVDA's gross margin to [[F1]] in FY2026.",
    "Pricing resulted in NVDA's gross margin of [[F1]] in FY2026.",
  ]) {
    assert.equal(rejectionCheck(check([{ kind: "observation", text, evidence: ["F1"] }]).rejected[0]?.reason ?? ""), "cause", text);
  }
  for (const text of ["The table reflects NVDA's gross margin of [[F1]] in FY2026.", "The results from FY2026 include NVDA's gross margin of [[F1]]."]) {
    assert.deepEqual(check([{ kind: "observation", text, evidence: ["F1"] }]).rejected, [], text);
  }
});

test("contributed to and stemmed from are causes (#294 review)", () => {
  for (const text of ["Charges contributed to NVDA's gross margin of [[F1]] in FY2026.", "NVDA's gross margin of [[F1]] in FY2026 stemmed from a richer mix."]) {
    assert.equal(rejectionCheck(check([{ kind: "observation", text, evidence: ["F1"] }]).rejected[0]?.reason ?? ""), "cause", text);
  }
});

test("common financial causatives (lifted, boosted, pressured, weighed on) are causes (#294 review)", () => {
  for (const text of [
    "AI demand lifted NVDA's gross margin to [[F1]] in FY2026.",
    "Pricing boosted NVDA's gross margin to [[F1]] in FY2026.",
    "Costs pressured NVDA's gross margin of [[F1]] in FY2026.",
    "Charges weighed on NVDA's gross margin of [[F1]] in FY2026.",
  ]) {
    assert.equal(rejectionCheck(check([{ kind: "observation", text, evidence: ["F1"] }]).rejected[0]?.reason ?? ""), "cause", text);
  }
});

test("the noun \"results in\" is not a cause (#294 review)", () => {
  assert.deepEqual(check([{ kind: "observation", text: "The results in FY2026 include NVDA's gross margin of [[F1]].", evidence: ["F1"] }]).rejected, []);
});

test("a base-form causative after a modal or \"to\" is a cause; the noun \"pressure\" is not (#294 review)", () => {
  for (const text of ["AI demand could lift NVDA's gross margin of [[F1]] in FY2026.", "Demand may drive NVDA's gross margin of [[F1]] in FY2026."]) {
    assert.equal(rejectionCheck(check([{ kind: "observation", text, evidence: ["F1"] }]).rejected[0]?.reason ?? ""), "cause", text);
  }
  assert.deepEqual(check([{ kind: "observation", text: "NVDA's gross margin of [[F1]] in FY2026 shows no pressure.", evidence: ["F1"] }]).rejected, []);
});

test("the noun \"cause\" is not a stated cause (#294 review)", () => {
  assert.deepEqual(check([{ kind: "observation", text: "The cause is not shown; NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] }]).rejected, []);
  assert.equal(rejectionCheck(check([{ kind: "observation", text: "Charges caused NVDA's gross margin of [[F1]] in FY2026.", evidence: ["F1"] }]).rejected[0]?.reason ?? ""), "cause");
});

test("noun forms (drives, pressures, boosts, lifts) are not causes (#294 review)", () => {
  const packet = { ...PACKET, figures: [{ id: "F1", company: "NVDA", metric: "Revenue", period: "FY2026", value: "$3.1B", source_ids: [] }] };
  for (const text of ["NVDA's hard drives generated [[F1]] in revenue in FY2026.", "NVDA's revenue of [[F1]] in FY2026 came with cost pressures and price boosts."]) {
    assert.deepEqual(checkAssertions([{ kind: "observation", text, evidence: ["F1"] }], packet).rejected, [], text);
  }
});

test("a packet reference in the text is checked by membership, never read as a number (prose-refs)", () => {
  const reasons = (text: string, evidence: string[]) => check([{ kind: "observation", text, evidence }]).rejected.map((entry) => entry.reason);
  assert.deepEqual(reasons("AMD's fiscal 2025 revenue is [[F4]].", ["F4"]), []);
  assert.deepEqual(reasons("AMD's fiscal 2025 revenue is [[F4]].", ["F3"]), ["[[F4]] is not in its evidence"]);
  assert.deepEqual(reasons("AMD's fiscal 2025 revenue is [[F9]].", ["F4"]), ["unknown reference [[F9]]"]);
  // A value typed beside its reference is typed (#302 item 2).
  assert.deepEqual(reasons("AMD's fiscal 2025 revenue is $7.7B [[F4]].", ["F4"]), ["types $7.7B; write its reference"]);
  // An inference references no figure, not even its supports' (#301).
  const report = check([
    { kind: "observation", text: "NVDA's FY2026 gross margin was [[F1]].", evidence: ["F1"] },
    { kind: "analyst_inference", text: "The margin leaves room to invest.", supports: [0] },
    { kind: "analyst_inference", text: "The [[F1]] margin leaves room to invest.", supports: [0] },
    { kind: "management_attribution", text: "NVDA said [[C1]]", evidence: ["C1"] },
    { kind: "analyst_inference", text: "The outlook [[C1]] is credible.", evidence: ["C1"], supports: [0] },
  ]);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0, 1, 3]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [2, "an inference rests on its supports; it writes no figure"],
    [4, "an inference rests on its supports; it writes no figure"],
  ]);
});

test("an inference names no period: a period it names could be another company's, so its supports' periods render beside it (#301 review)", () => {
  const report = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026 and [[F2]] in FY2025.", evidence: ["F1", "F2"] },
    { kind: "analyst_inference", text: "FY2026 extended a margin edge already held in FY2025.", supports: [0] },
    { kind: "analyst_inference", text: "The margin edge was already held a year earlier.", supports: [0] },
    { kind: "analyst_inference", text: "The margin has held near 75% for two years.", supports: [0] },
  ]);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0, 2]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [1, "an inference rests on its supports; it writes no figure"],
    [3, "an inference rests on its supports; it writes no figure"],
  ]);
});

test("an attribution may write what its cited claim writes, a product or an amount; no other assertion may (#301)", () => {
  const packet: EvidencePacket = { ...PACKET, claims: [
    ...PACKET.claims,
    { id: "C3", text: "Export controls on our MI308 GPUs led to approximately $800 million in inventory charges.", predicate: "management.explanation.revenue", stance: "challenging", company: "AMD", claim_id: "c3", source_id: "s3" },
  ] };
  const report = checkAssertions([
    { kind: "management_attribution", text: "AMD said MI308 export controls cost about $800 million: [[C3]]", evidence: ["C3"] },
    // C2 does not name it.
    { kind: "management_attribution", text: "AMD expects MI308 to recover: [[C2]]", evidence: ["C2"] },
    { kind: "observation", text: "AMD's MI308 revenue was [[F4]].", evidence: ["F4"] },
    // An amount its claim does not write.
    { kind: "management_attribution", text: "AMD said the controls cost $900 million: [[C3]]", evidence: ["C3"] },
    // Part of the claim's token is not the token.
    { kind: "management_attribution", text: "AMD said the controls cost $80 million: [[C3]]", evidence: ["C3"] },
  ], packet);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [1, "types MI308; write its reference"],
    [2, "types MI308; write its reference"],
    [3, "types $900; write its reference"],
    [4, "types $80; write its reference"],
  ]);
});

test("across companies an inference names no company, whichever it would credit; with one company it may (#288)", () => {
  const oneYear = { ...PACKET, figures: PACKET.figures.filter((figure) => figure.id !== "F2") };
  const check = (list: unknown[]) => checkAssertions(list, oneYear);
  const list = (text: string) => [
    { kind: "comparison", op: "highest", result: "F1", text: "NVDA's gross margin was highest.", evidence: ["F1", "F3"] },
    { kind: "analyst_inference", text, supports: [0] },
  ];
  assert.deepEqual(check(list("AMD leads NVDA on margin.")).rejected.map((entry) => [entry.index, entry.reason]), [
    [1, "an inference names no company; its subject does"],
  ]);
  assert.deepEqual(check(list("NVDA keeps more of each sale.")).rejected.map((entry) => entry.reason), ["an inference names no company; its subject does"]);
  assert.deepEqual(check(list("The margin lead funds research.")).rejected, []);
  // A one-letter ticker cannot be told from the article, as in the guard.
  const agilent = checkAssertions(list("A wider margin leaves room to invest."), { ...oneYear, companies: ["NVDA", "A"] });
  assert.deepEqual(agilent.rejected, []);
  const single = checkAssertions([
    { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: ["F1"] },
    { kind: "analyst_inference", text: "NVDA keeps more of each sale.", supports: [0] },
  ], { ...PACKET, companies: ["NVDA"] });
  assert.deepEqual(single.rejected, []);
});

test("an inference names its subject, a company its own evidence or its supports cover; its text still names none (#308)", () => {
  const oneYear = { ...PACKET, figures: PACKET.figures.filter((figure) => figure.id !== "F2") };
  const report = checkAssertions([
    { kind: "comparison", op: "highest", result: "F1", text: "NVDA's gross margin was highest.", evidence: ["F1", "F3"] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: ["F1"] },
    { kind: "analyst_inference", subject: "AMD", text: "Its thinner margin leaves less room to invest.", supports: [0] },
    // Its own claim covers AMD, though its support is NVDA's alone.
    { kind: "analyst_inference", subject: "AMD", text: "Its outlook rests on guidance, not results.", evidence: ["C2"], supports: [1] },
    { kind: "analyst_inference", subject: "INTC", text: "Its margin trails.", supports: [0] },
    { kind: "analyst_inference", subject: 7, text: "Its margin trails.", supports: [0] },
    { kind: "analyst_inference", subject: "AMD", text: "Its margin trails.", supports: [1] },
    { kind: "analyst_inference", subject: "AMD", text: "AMD's margin trails.", supports: [0] },
    { kind: "observation", subject: "NVDA", text: "NVDA's gross margin was [[F1]].", evidence: ["F1"] },
  ], oneYear);
  assert.deepEqual(report.accepted.map((entry) => [entry.index, entry.subject]), [[0, undefined], [1, undefined], [2, "AMD"], [3, "AMD"]]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [4, "an inference's subject is a company its evidence covers"],
    [5, "an inference's subject is a company its evidence covers"],
    [6, "an inference's subject is a company its evidence covers"],
    [7, "an inference names no company; its subject does"],
    [8, "only an analyst inference has a subject"],
  ]);
  assert.equal(rejectionCheck("an inference's subject is a company its evidence covers"), "binding");
  // With one company, a figure with no company is its own.
  const single = checkAssertions([
    { kind: "observation", text: "Gross margin was [[F1]].", evidence: ["F1"] },
    { kind: "analyst_inference", subject: "NVDA", text: "NVDA keeps more of each sale.", supports: [0] },
  ], { ...PACKET, companies: ["NVDA"], figures: [{ ...PACKET.figures[0]!, company: undefined }] });
  assert.deepEqual(single.rejected, []);
  assert.deepEqual(single.accepted.map((entry) => [entry.index, entry.subject]), [[0, undefined], [1, "NVDA"]]);
});

test("what the data cannot show is a data gap: words only, citing nothing; across companies it names none, as an inference (#301)", () => {
  const report = checkAssertions([
    { kind: "data_gap", text: "No prior-year margins are shown, so the trend cannot be judged." },
    // A metric no reader serves is what a gap names.
    { kind: "data_gap", text: "Free cash flow is not shown for either company.", evidence: [] },
    { kind: "data_gap", text: "No FY2024 revenue is shown." },
    { kind: "data_gap", text: "Revenue before [[F4]] is not shown." },
    { kind: "data_gap", text: "No margin under fifty percent is shown." },
    { kind: "data_gap", text: "Revenue is not split by segment.", evidence: ["F4"] },
    { kind: "data_gap", text: "No segment split is shown.", supports: [0] },
    // Across companies a gap could rank them ("AMD's margin is higher than NVDA's"), so it names none.
    { kind: "data_gap", text: "AMD's gross margin is higher than NVDA's, which the data cannot explain." },
    // "a billion dollars" is an amount too.
    { kind: "data_gap", text: "Cash of a billion dollars is not shown." },
  ], { ...PACKET, unavailable_metrics: ["Free cash flow"] });
  assert.deepEqual(report.accepted.map((entry) => [entry.index, entry.kind, entry.evidence]), [[0, "data_gap", []], [1, "data_gap", []]]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [2, "a data gap writes no figure; it says in words what is not shown"],
    [3, "a data gap writes no figure; it says in words what is not shown"],
    [4, "a data gap writes no figure; it says in words what is not shown"],
    [5, "a data gap cites nothing; it names what is not shown"],
    [6, "only an analyst inference lists supports"],
    [7, "a data gap names no company; the gap notes do"],
    [8, "a data gap writes no figure; it says in words what is not shown"],
  ]);
  assert.deepEqual(report.rejected.map((entry) => rejectionCheck(entry.reason)), ["binding", "binding", "binding", "kind", "format", "binding", "binding"]);
  // An article is a number only before a scale: "a point" or "a dollar of revenue" is no amount.
  const idioms = checkAssertions([{ kind: "data_gap", text: "At a point like this, margin per a dollar of revenue is not shown." }], { ...PACKET, companies: ["NVDA"] });
  assert.deepEqual(idioms.rejected, []);
  // With one company, naming it ranks no one.
  const single = checkAssertions([{ kind: "data_gap", text: "No segment revenue is shown for NVDA." }], { ...PACKET, companies: ["NVDA"] });
  assert.deepEqual(single.rejected, []);
  // With no figures shown, a gap is still checked, never left unchecked.
  const claimsOnly = checkAssertions([{ kind: "data_gap", text: "No segment revenue is shown." }], { ...PACKET, figures: [] });
  assert.deepEqual([claimsOnly.accepted.map((entry) => entry.index), claimsOnly.rejected, claimsOnly.unchecked], [[0], [], undefined]);
});
