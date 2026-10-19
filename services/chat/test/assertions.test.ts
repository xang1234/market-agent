import test from "node:test";
import assert from "node:assert/strict";

import { assertionList, checkAssertions } from "../src/assertions.ts";
import type { EvidencePacket } from "../src/evidence-packet.ts";
import { plainText, renderAssertion } from "../src/render-assertions.ts";

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

test("the assertion list is read wherever it is, and a broken one is malformed (#208)", () => {
  const list = '[{"kind":"observation","text":"x","evidence":["F1"]}]';
  assert.deepEqual(assertionList(`NVDA leads.\n\n\`\`\`assertions\n${list}\n\`\`\``), JSON.parse(list));
  assert.deepEqual(assertionList(`NVDA leads.\n\`\`\`assertions\n${list}\n\`\`\`\nAMD trails.`), JSON.parse(list));
  assert.equal(assertionList("NVDA leads.\n```assertions\n[{\"kind\":"), null);
  assert.equal(assertionList("NVDA leads.\n```assertions\n{\"kind\": \"observation\"}\n```"), null);
  assert.equal(assertionList("NVDA leads."), undefined);
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
  // An amount in words is no digit: the judge reads it (worded_amount, inference-judge.ts).
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0, 1, 2, 7, 8, 9, 10]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [3, "an inference rests on its supports; it writes no figure"],
    [4, "an inference rests on its supports; it writes no figure"],
    [5, "an inference binds the accepted observations it rests on"],
    [6, "an inference binds the accepted observations it rests on"],
    [11, "an inference rests on its supports; it writes no figure"],
  ]);
  const quarter = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] },
    { kind: "analyst_inference", text: "The Q4 momentum carries into next year.", evidence: [], supports: [0] },
  ]);
  assert.deepEqual(quarter.rejected.map((entry) => [entry.index, entry.reason]), [[1, "an inference rests on its supports; it writes no figure"]]);
});

test("at most twelve assertions are checked; the rest are rejected (#208)", () => {
  const one = { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: ["F1"] };
  const report = check(Array.from({ length: 14 }, () => one));
  assert.equal(report.accepted.length, 12);
  assert.deepEqual(report.rejected.map((entry) => entry.index), [12, 13]);
});

test("an attribution renders its claim's quote, never its text: a company or number there is not read (#208, #301)", () => {
  const report = check([
    { kind: "management_attribution", text: "AMD management expects [[C2]]", evidence: ["C2"] },
    { kind: "management_attribution", text: "NVDA management expects [[C2]]", evidence: ["C2"] },
    { kind: "management_attribution", text: "AMD management expects 12% revenue growth.", evidence: ["C2"] },
    { kind: "management_attribution", text: "AMD management expects [[C1]]", evidence: ["C2"] },
  ]);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0, 1, 2, 3]);
  assert.deepEqual(report.rejected, []);
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

test("with claims but no figures, an assertion about figures binds nothing and is rejected; a claim's is checked (#208, #302)", () => {
  const report = checkAssertions([
    { kind: "observation", text: "ACME trades at $12.", evidence: [] },
    { kind: "management_attribution", text: "AMD management expects [[C2]]", evidence: ["C2"] },
  ], { ...PACKET, figures: [] });
  assert.deepEqual(report, {
    status: "checked",
    accepted: [{ index: 1, kind: "management_attribution", text: "AMD management expects [[C2]]", evidence: ["C2"] }],
    rejected: [{ index: 0, text: "ACME trades at $12.", check: "kind", reason: "an observation cites figures, and only figures" }],
  });
});

test("with no figures, malformed or over-limit entries are rejected as on any packet (#208)", () => {
  const one = { kind: "observation", text: "ACME trades at $12.", evidence: [] };
  const report = checkAssertions([null, { kind: "guess", text: "x", evidence: [] }, ...Array.from({ length: 11 }, () => one)], { ...PACKET, figures: [] });
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [0, "not an assertion with text"],
    [1, 'unknown kind "guess"'],
    ...Array.from({ length: 10 }, (_, i) => [i + 2, "an observation cites figures, and only figures"]),
    [12, "more than 12 assertions"],
  ]);
});

test("with no figures, an unknown id, a claim cited as a figure, or no evidence is rejected (#208, #302)", () => {
  const report = checkAssertions([
    { kind: "observation", text: "ACME trades at $12.", evidence: ["F99"] },
    { kind: "observation", text: "ACME trades at $12.", evidence: ["C2"] },
    { kind: "observation", text: "ACME trades at $12.", evidence: [] },
  ], { ...PACKET, figures: [] });
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [0, 'unknown evidence id "F99"'],
    [1, "an observation cites figures, and only figures"],
    [2, "an observation cites figures, and only figures"],
  ]);
});

test("with no figures, an inference has no accepted observation to rest on (#208, #302)", () => {
  const report = checkAssertions([
    { kind: "observation", text: "ACME trades at $12.", evidence: [] },
    { kind: "analyst_inference", text: "ACME looks cheap.", evidence: [], supports: [0] },
    { kind: "analyst_inference", text: "ACME looks cheap.", evidence: [], supports: [99] },
    { kind: "analyst_inference", text: "ACME looks cheap.", evidence: [], supports: [1] },
  ], { ...PACKET, figures: [] });
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [0, "an observation cites figures, and only figures"],
    [1, "an inference binds the accepted observations it rests on"],
    [2, "an inference binds the accepted observations it rests on"],
    [3, "an inference binds the accepted observations it rests on"],
  ]);
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

test("the first assertion block is the one read (#208)", () => {
  assert.deepEqual(assertionList("NVDA leads.\n```assertions\n[]\n```\nAMD trails.\n```assertions\n[{\"kind\":\"observation\"}]\n```"), []);
});

test("a list cut off before its closing fence is read as far as it was written (#208)", () => {
  assert.deepEqual(assertionList("NVDA leads.\n```assertions\n[]"), []);
  assert.deepEqual(assertionList("NVDA leads.\n```assertions\n[]\n```   \nAMD trai"), []);
});

test("only an inference has supports (#208)", () => {
  const report = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]].", evidence: ["F1"], supports: [99] },
  ]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [0, "only an analyst inference lists supports"],
  ]);
});

test("a block with CRLF line endings is read too (#208)", () => {
  assert.deepEqual(assertionList("NVDA leads.\r\n```assertions\r\n[]\r\n```\r\n"), []);
});

test("an inference's words about a metric are not read by the checks, a named gap's included: the judge reads them (#302)", () => {
  const report = checkAssertions([
    { kind: "observation", text: "NVDA's free cash flow margin was [[F1]].", evidence: ["F1"] },
    { kind: "analyst_inference", text: "Its free cash flow margin funds buybacks.", supports: [0] },
    { kind: "analyst_inference", text: "Its EBITDA funds buybacks.", supports: [0] },
  ], { ...PACKET, unavailable_metrics: ["Free cash flow margin", "EBITDA"] });
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0, 1, 2]);
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

test("a support that failed its check is dropped; an inference with none left is rejected (#301)", () => {
  const report = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F99"] },
    { kind: "analyst_inference", text: "The margin shows pricing power.", supports: [0, 1] },
    { kind: "analyst_inference", text: "The margin shows pricing power.", supports: [1, 9] },
  ]);
  assert.deepEqual(report.accepted.map((entry) => [entry.index, entry.supports ?? null]), [[0, null], [2, [0]]]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [1, 'unknown evidence id "F99"'],
    [3, "an inference binds the accepted observations it rests on"],
  ]);
});

test("an inference may rest on a management attribution, so the claim it relies on is bound; never on an unknown cause (#302)", () => {
  const report = check([
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] },
    { kind: "management_attribution", text: "NVDA management said [[C1]]", evidence: ["C1"] },
    { kind: "analyst_inference", text: "Its margin rests on a mix that may not repeat.", supports: [0, 1], subject: "NVDA" },
    { kind: "analyst_inference", text: "A richer mix is the stated driver.", supports: [1], subject: "NVDA" },
    { kind: "analyst_inference", text: "A richer mix is the stated driver.", supports: [1], subject: "AMD" },
    { kind: "unknown_cause", text: "The figures do not show why NVDA's gross margin changed.", evidence: ["F1", "F2"] },
    { kind: "analyst_inference", text: "The cause is unclear.", supports: [5] },
  ]);
  assert.deepEqual(report.accepted.filter((entry) => entry.kind === "analyst_inference").map((entry) => [entry.index, entry.supports]), [[2, [0, 1]], [3, [1]]]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [4, "an inference's subject is a company its evidence covers"],
    [6, "an inference binds the accepted observations it rests on"],
  ]);
});

test("an evidence id listed twice is a duplicate reference (#221)", () => {
  assert.deepEqual(check([{ kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1", "F1"] }]).rejected.map((entry) => entry.reason),
    ['evidence lists "F1" twice']);
  assert.deepEqual(check([{ kind: "management_attribution", text: "Management credited a richer data-center mix.", evidence: ["C1", "C1"] }]).rejected.map((entry) => entry.reason),
    ['evidence lists "C1" twice']);
});

test("an observation's or comparison's template writes its evidence, never its text: a figure, year, peer, cause or missing metric there is not read (#302)", () => {
  const packet: EvidencePacket = {
    ...PACKET,
    companies: ["NVDA", "AMD", "AAPL"],
    figures: PACKET.figures.filter((figure) => figure.id !== "F2"),
    unavailable_metrics: ["Free cash flow"],
  };
  const highest = (text: string) => ({ kind: "comparison", op: "highest", result: "F1", text, evidence: ["F1", "F3"] });
  const report = checkAssertions([
    { kind: "observation", text: "NVDA's gross margin was 75.0% in FY2026.", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2024.", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]], ahead of AAPL.", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026, driven by a richer mix.", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's free cash flow was [[F1]].", evidence: ["F1"] },
    highest("NVDA's 75.0% gross margin was highest."),
    highest("NVDA's gross margin was higher than AAPL's."),
    highest("NVDA's gross margin was highest, thanks to pricing."),
    highest("NVDA's free cash flow was highest."),
  ], packet);
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("an inference's text is shown, so it types no figure; a company or a missing metric it names is the judge's to read (#302)", () => {
  const report = checkAssertions([
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] },
    { kind: "analyst_inference", text: "The 75.0% margin funds research.", supports: [0] },
    { kind: "analyst_inference", text: "The margin leaves AMD behind.", supports: [0] },
    { kind: "analyst_inference", text: "The margin funds free cash flow.", supports: [0] },
  ], { ...PACKET, unavailable_metrics: ["Free cash flow"] });
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0, 2, 3]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [[1, "an inference rests on its supports; it writes no figure"]]);
});
test("each rejection names the check that failed, so binding and comparative failures are told apart (#221)", () => {
  const report = checkAssertions([
    { kind: "observation" },
    { kind: "guess", text: "Margins will rise.", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1", "F1"] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F99"] },
    { kind: "analyst_inference", text: "The margin held near 75%.", supports: [8] },
    { kind: "analyst_inference", text: "AMD keeps more of each sale.", supports: [8], subject: "AMD" },
    { kind: "observation", text: "NVDA's gross margin was 75% in FY2026.", evidence: ["F1"] },
    { kind: "observation", text: "Management credited a richer mix.", evidence: ["C1"] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026, driven by a richer mix.", evidence: ["F1"] },
    { kind: "observation", text: "NVDA's free cash flow was [[F1]] in FY2026.", evidence: ["F1"] },
    { kind: "comparison", text: "AMD's gross margin of [[F3]] is above NVDA's [[F2]] in FY2025.", evidence: ["F2", "F3"], op: "highest", result: "F3" },
    { kind: "analyst_inference", text: "The leader keeps more of each sale.", supports: [] },
    { kind: "observation", text: "NVDA's gross margin was [[F1]] in FY2026.", evidence: ["F1"] },
  ], { ...PACKET, unavailable_metrics: ["Free cash flow"] });
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.check, entry.reason]), [
    [0, "format", "not an assertion with text"],
    [1, "format", 'unknown kind "guess"'],
    [2, "reference", 'evidence lists "F1" twice'],
    [3, "reference", 'unknown evidence id "F99"'],
    [4, "binding", "an inference rests on its supports; it writes no figure"],
    [5, "binding", "an inference's subject is a company its evidence covers"],
    [7, "kind", "an observation cites figures, and only figures"],
    [10, "comparative", "comparison: F2 (72.7%) is higher than F3 (49.4%)"],
    [11, "support", "an inference binds the accepted observations it rests on"],
    [12, "limit", "more than 12 assertions"],
  ]);
});

test("an observation's text is never shown, so a reference it writes is not checked: it renders from its evidence", () => {
  const report = check([{ kind: "observation", text: "NVDA's FY2026 gross margin was [[F9]].", evidence: ["F1"] }]);
  assert.deepEqual(report.rejected, []);
  assert.equal(plainText(renderAssertion(report.accepted[0]!, PACKET, []).segments), "NVDA's gross margin was 75.0% in FY2026.");
});

test("an inference that writes a reference is rejected: it writes no digit (#301)", () => {
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

test("an inference may name a company: who leads is its comparison's checked result, and whether the words agree is the judge's to read (#288)", () => {
  const oneYear = { ...PACKET, figures: PACKET.figures.filter((figure) => figure.id !== "F2") };
  const list = (text: string) => [
    { kind: "comparison", op: "highest", result: "F1", text: "NVDA's gross margin was highest.", evidence: ["F1", "F3"] },
    { kind: "analyst_inference", text, supports: [0] },
  ];
  for (const text of ["AMD leads NVDA on margin.", "NVDA keeps more of each sale.", "The margin lead funds research."]) {
    assert.deepEqual(checkAssertions(list(text), oneYear).accepted.map((entry) => entry.index), [0, 1], text);
  }
});
test("an inference names its subject, a company its own evidence or its supports cover (#308)", () => {
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
    { kind: "observation", subject: "NVDA", text: "NVDA's gross margin was [[F1]].", evidence: ["F1"] },
  ], oneYear);
  assert.deepEqual(report.accepted.map((entry) => [entry.index, entry.subject]), [[0, undefined], [1, undefined], [2, "AMD"], [3, "AMD"]]);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.reason]), [
    [4, "an inference's subject is a company its evidence covers"],
    [5, "an inference's subject is a company its evidence covers"],
    [6, "an inference's subject is a company its evidence covers"],
    [7, "only an analyst inference has a subject"],
  ]);
  assert.equal(report.rejected[0]?.check, "binding");
  // With one company, a figure with no company is its own.
  const single = checkAssertions([
    { kind: "observation", text: "Gross margin was [[F1]].", evidence: ["F1"] },
    { kind: "analyst_inference", subject: "NVDA", text: "NVDA keeps more of each sale.", supports: [0] },
  ], { ...PACKET, companies: ["NVDA"], figures: [{ ...PACKET.figures[0]!, company: undefined }] });
  assert.deepEqual(single.rejected, []);
  assert.deepEqual(single.accepted.map((entry) => [entry.index, entry.subject]), [[0, undefined], [1, "NVDA"]]);
});

test("an unknown cause's change is between periods of one kind, both fully covered (#302 review)", () => {
  const packet: EvidencePacket = {
    ...PACKET,
    companies: ["AAPL"],
    figures: [
      { id: "F1", metric: "Revenue", period: "FY2025", value: "$416.2B", source_ids: [], displayed: false },
      { id: "F2", metric: "Revenue", period: "Q12026", value: "$124.3B", source_ids: [], displayed: false },
      { id: "F3", metric: "Net income", period: "Q42025", value: "$20.0B", source_ids: [], displayed: false },
      { id: "F4", metric: "Net income", period: "Q12026", value: "$25.0B", source_ids: [], displayed: false, period_coverage: "partial" },
    ],
  };
  const reasons = (evidence: string[]) =>
    checkAssertions([{ kind: "unknown_cause", text: "The figures do not show why.", evidence }], packet).rejected.map((entry) => entry.reason);
  const reason = "an unknown cause cites a change: one company's metric, two periods, two values";
  assert.deepEqual([reasons(["F1"]), reasons(["F2"]), reasons(["F3"]), reasons(["F4"])], [[reason], [reason], [reason], [reason]]);
});
