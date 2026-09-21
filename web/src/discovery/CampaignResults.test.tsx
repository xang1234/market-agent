import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import type { CandidateView, RunView } from "../../../services/discovery/src/types.ts";
import { CandidateCard } from "./CandidateCard.tsx";
import { CampaignResults } from "./CampaignResults.tsx";

test("shows actual shortlist, unknown valuation, unavailable evidence, and a different-brief comparison warning", async () => {
  // This would catch padded shortlist copy, favorable unknown valuation, or a comparison that implies rank movement across briefs.
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restore = installDomGlobals(dom.window as unknown as Window);
  const root = createRoot(dom.window.document.getElementById("root")!);
  const candidate = candidateView();
  try {
    await act(async () => {
      root.render(<CampaignResults run={runView([candidate])} candidates={[candidate]} events={[]} comparison={{ run: { ...runView([]), run_id: "older", brief_id: "different-brief" }, candidates: [] }} />);
    });
    const body = dom.window.document.body;
    assert.match(body.textContent ?? "", /1 shortlisted/);
    assert.match(body.textContent ?? "", /Valuation context[\s\S]*Unknown/);
    assert.match(body.textContent ?? "", /Different research question/);
    const sources = [...body.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "View sources for Grid Systems");
    assert.ok(sources, "source drawer control is labelled for keyboard and assistive users");
    await act(async () => sources.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    assert.match(body.textContent ?? "", /Evidence is no longer available/);
    assert.doesNotMatch(body.textContent ?? "", /lease|epoch|JSON|operation key/i);
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test("compares same-brief shortlists without treating an older non-shortlisted candidate as removed", () => {
  // This would catch a comparison built from the entire older candidate page.
  const shortlisted = candidateView();
  const olderNonShortlisted: CandidateView = {
    ...candidateView(),
    candidate_id: "candidate-older",
    name: "Never shortlisted",
    state: "not_selected",
    rank: null,
    identity: { ...candidateView().identity!, issuer_id: "issuer-older", listing_id: "listing-older", ticker: "OLD" },
  };
  const html = renderToStaticMarkup(
    <CampaignResults
      run={runView([shortlisted])}
      candidates={[shortlisted]}
      events={[]}
      comparison={{ run: { ...runView([shortlisted]), run_id: "older" }, candidates: [olderNonShortlisted] }}
    />,
  );
  assert.match(html, /Same brief comparison/);
  assert.match(html, /No longer shortlisted: None/);
  assert.doesNotMatch(html, /Never shortlisted/);
});

test("never exposes a non-web source URL as a link", async () => {
  // This would catch a malformed API payload becoming an executable href.
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restore = installDomGlobals(dom.window as unknown as Window);
  const root = createRoot(dom.window.document.getElementById("root")!);
  const candidate: CandidateView = {
    ...candidateView(),
    evidence_available: true,
    sources: [{ ...candidateView().sources[0]!, url: "javascript:alert('unsafe')" }],
  };
  try {
    await act(async () => { root.render(<CandidateCard candidate={candidate} />); });
    const sources = [...dom.window.document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "View sources for Grid Systems");
    assert.ok(sources);
    await act(async () => sources.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    assert.equal([...dom.window.document.querySelectorAll("a")].some((anchor) => anchor.href.startsWith("javascript:")), false);
    assert.match(dom.window.document.body.textContent ?? "", /Source links are unavailable/);
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test("uses ordinary pressed buttons for result groups", () => {
  const html = renderToStaticMarkup(<CampaignResults run={runView([])} candidates={[]} events={[]} />);
  assert.doesNotMatch(html, /role="tab(?:list|panel)?"/);
  assert.match(html, /<button[^>]*aria-pressed="true"[^>]*>Shortlist \(0\)<\/button>/);
});

function candidateView(): CandidateView {
  return {
    candidate_id: "candidate-1", identity: { issuer_id: "issuer-1", listing_id: "listing-1", legal_name: "Grid Systems Inc.", ticker: "GRID", mic: "XNAS", currency: "USD", asset_type: "common_stock", identity_source_ids: [] }, name: "Grid Systems", state: "shortlisted", rank: 1, snapshot_id: "snapshot-1", evidence_available: false, can_promote: false,
    assessment: { candidate_id: "candidate-1", identity: { issuer_id: "issuer-1", listing_id: "listing-1", legal_name: "Grid Systems Inc.", ticker: "GRID", mic: "XNAS", currency: "USD", asset_type: "common_stock", identity_source_ids: [] }, state: "eligible_not_shortlisted", dimensions: {
      theme_exposure: { level: "strong", explanation: "Direct equipment demand.", citations: [] }, evidence_strength: { level: "mixed", explanation: "Some source coverage.", citations: [] }, business_quality: { level: "mixed", explanation: "Operating history is mixed.", citations: [] }, valuation_context: { level: "unknown", explanation: "No current valuation evidence.", citations: [] },
    }, criteria: [], counterarguments: [{ text: "Orders could slow.", citations: [] }], unresolved_questions: ["Can margin improve?"], next_action: "Review the next filing.", reason_codes: [] },
    sources: [{ citation: { kind: "claim", id: "claim-1" }, title: "Company filing", url: "https://example.com/filing", published_at: null, retrieved_at: "2026-09-10T00:00:00.000Z" }], origins: ["web"], mechanism_ids: ["mechanism-1"], reason_codes: [],
  };
}

function runView(shortlist: CandidateView[]): RunView {
  return {
    run_id: "run-1", campaign_id: "campaign-1", brief_id: "brief-1", user_id: "user-1", status: "completed", stage: "finalization", policy_version: "v1", request_key: "key-1", model_config: [], limits: { candidates: 100, research: 25, shortlist: 10, attempts: { search: 80, document: 150, identity: 120, financial: 50, model: 64 }, input_chars: 64000, output_tokens: 10000, request_timeout_ms: 30000, run_timeout_ms: 2700000 }, usage: { search: 5, document: 10, identity: 3, financial: 1, model: 3 }, coverage: { searches_planned: 5, searches_completed: 5, hits_truncated: 0, leads_overflow: 0, extraction_batches_skipped: 0, unresolved: 1, discovered: 6, selected: 3, assessed: 3, not_selected: 2, mechanisms: [{ mechanism_id: "mechanism-1", discovered: 6, selected: 3, assessed: 3 }], gaps: [] }, started_at: "2026-09-10T00:00:00.000Z", finished_at: "2026-09-10T01:00:00.000Z", cancel_requested_at: null, shortlist, cost: { status: "unavailable" }, worker_waiting: false,
  };
}

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window };
  const previous = { act: globals.IS_REACT_ACT_ENVIRONMENT, document: globals.document, window: globals.window };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.document = domWindow.document;
  globals.window = domWindow;
  return () => { globals.IS_REACT_ACT_ENVIRONMENT = previous.act; globals.document = previous.document; globals.window = previous.window; };
}
