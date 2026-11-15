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
