import assert from "node:assert/strict";
import test from "node:test";

import { memoVerdict, SECTIONS } from "../../../.claude/skills/verify-market-agent/scripts/memo-verdict.ts";

const LISTING = "4f000000-0000-4000-8000-0000000000e1";
const TITLES = ["Investment thesis", "Growth drivers", "Competitive position", "Downside risks"];

function seen(note: string, canvasExtra = "", figure = false) {
  const run = {
    blocks: SECTIONS.map((id, i) => ({
      kind: "section",
      title: TITLES[i],
      data_ref: { params: { playbook_section_id: id } },
      claim_refs: [],
      source_refs: [],
      children: [{ kind: "rich_text", segments: [...(figure ? [{ type: "ref", ref_kind: "result" }] : []), { type: "text", text: note }] }],
    })),
  };
  return {
    run,
    unquotedArticle: [...TITLES, note, canvasExtra].join("\n"),
    page: `Memo generated\n${TITLES.join("\n")}`,
    url: `http://127.0.0.1:5173/analyze?subject=listing:${LISTING}`,
    listingId: LISTING,
    predicates: new Map<string, string>(),
    failure: null,
    memoMs: 40,
    llmCalls: 0,
    log: "",
    evidence: "/tmp/memo",
  };
}

test("the memo flow fails a memo no model wrote, and passes one whose every section says no stored source covers it", () => {
  assert.equal(memoVerdict(seen("This section was not written, as nothing could be read for it just now.")).passed, false);
  const empty = "No stored source covers this section. AAA had no 10-K on file as of 2026-11-16, so no business or risk factor claims from one.";
  assert.equal(memoVerdict(seen(empty)).passed, true);
  assert.equal(memoVerdict(seen(empty, "AAA is a Buy.")).passed, false, "a stance word in the agent's words fails it");
  assert.equal(memoVerdict(seen(empty, "This is a buy.")).passed, false, "buy as a rating fails it");
  assert.equal(memoVerdict(seen(empty, "Customers buy in bulk.")).passed, true, "buy as a verb does not");
  assert.equal(memoVerdict(seen("Commentary is unavailable for this answer.", "", true)).passed, false, "a figure with no answer written beside it is not a written section");
});

test("a stance word inside a quoted 10-K claim is reported from the page but passes; the report states the verdict (#798)", () => {
  const empty = "No stored source covers this section.";
  // NVDA's 10-K, quoted on the 2026-11-25 memo: on the page, stripped from the canvas with the other claim quotes.
  const quote = "Source 8: All major cloud service providers, or CSPs, AI model makers, and enterprises use our data center-scale infrastructure and computing platforms to accelerate the services and offerings they deliver to billions of end users and customers, including AI solutions and assistants, AI foundation models, advertising, search, recommendation systems, social 4 Table of Contents networking, data processing, online shopping, live video, and translation.";
  const quoted = seen(empty);
  const { report, passed } = memoVerdict({ ...quoted, page: `${quoted.page}\n${quote}` });
  assert.equal(passed, true);
  assert.equal(report.passed, true, "report.json says whether the run passed, so a run without its exit code is not misread");
  assert.deepEqual(report.stance_words, []);
  assert.deepEqual(report.page_stance_words, ["recommendation"]);
  const stance = memoVerdict(seen(empty, "We recommend buying NVDA."));
  assert.equal(stance.passed, false, "a recommendation in the agent's own words still fails it");
  assert.equal(stance.report.passed, false);
});

test("the memo flow reports each section's themes shown and what the judge did with them, from this run's log lines alone", () => {
  const RUN = "4f000000-0000-4000-8000-0000000000f1";
  const base = seen("A note.");
  const run = {
    run_id: RUN,
    blocks: base.run.blocks.map((block, i) => (i === 3 ? { ...block, children: [{ kind: "rich_text", commentary: [{ kind: "inference" }, { kind: "figures", segments: [] }, { kind: "inference" }] }] } : block)),
  };
  const log = [
    `[chat] judge thread=${RUN} run=${RUN} turn=downside_risks on anthropic/claude-haiku-5-5: 2 shown, 0 unverified, of 4 inferences (judge call failed: the turn has made its model calls)`,
    `[chat] judge thread=${RUN} run=${RUN} turn=competitive_position on anthropic/claude-haiku-5-5: 1 shown, 0 unverified, of 3 inferences`,
    "[chat] judge thread=4f000000-0000-4000-8000-0000000000f2 run=4f000000-0000-4000-8000-0000000000f2 turn=growth_drivers: 0 shown, 0 unverified, of 2 inferences",
    `[chat] judge thread=${RUN} run=${RUN} turn=investment_thesis on bedrock/anthropic.claude-haiku-5-5-v1:0: 1 shown, 0 unverified, of 2 inferences`,
    `[chat] judge thread=${RUN} run=${RUN} turn=investment_thesis on opencode/claude-haiku:free: 2 shown, 0 unverified, of 2 inferences (judge call failed: timeout)`,
  ].join("\n");
  const { report } = memoVerdict({ ...base, run, log });
  assert.deepEqual(report.sections.map((section) => [section.id, "themes_shown" in section ? section.themes_shown : null, "judge" in section ? section.judge : null]), [
    ["investment_thesis", 0, { shown: 3, of: 4, reasons: ["judge call failed: timeout"] }],
    ["growth_drivers", 0, null],
    ["competitive_position", 0, { shown: 1, of: 3, reasons: [] }],
    ["downside_risks", 2, { shown: 2, of: 4, reasons: ["judge call failed: the turn has made its model calls"] }],
  ]);
});
