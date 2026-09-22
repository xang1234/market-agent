import assert from "node:assert/strict";
import test from "node:test";

import { dbOptions } from "./db-fixture.ts";
import { createVisibleCandidateHarness } from "./visibility-harness.ts";

test("authorized run reads redact cached evidence after primary-source ownership is revoked", dbOptions, async (t) => {
  const h = await createVisibleCandidateHarness(t);
  await h.assertReadableByOwner();
  await h.assertHiddenFromOtherUser();
  await h.revokePrimarySource();
  const view = await h.service.getRun(h.userId, h.runId);
  const candidate = view.shortlist.find((item) => item.candidate_id === h.candidateId);
  assert.equal(candidate?.evidence_available, false);
  assert.equal(candidate?.assessment, null);
  assert.equal(candidate?.can_promote, false);
  assert.ok((await h.service.getEvents(h.userId, h.runId, 0)).items.every((event) => !event.summary.includes(h.privateQuote)));
});

test("authorized run reads redact cached evidence after its cited document is deleted", dbOptions, async (t) => {
  const h = await createVisibleCandidateHarness(t);
  await h.deletePrimaryDocument();
  const candidate = (await h.service.getRun(h.userId, h.runId)).shortlist.find((item) => item.candidate_id === h.candidateId);
  assert.equal(candidate?.evidence_available, false);
  assert.equal(candidate?.assessment, null);
});

test("authorized run reads redact cached evidence after its cited claim is no longer current", dbOptions, async (t) => {
  const h = await createVisibleCandidateHarness(t);
  await h.revokePrimaryClaim();
  const candidate = (await h.service.getRun(h.userId, h.runId)).shortlist.find((item) => item.candidate_id === h.candidateId);
  assert.equal(candidate?.evidence_available, false);
  assert.equal(candidate?.can_promote, false);
});

test("authorized run reads redact cached evidence after a cited fact loses app entitlement", dbOptions, async (t) => {
  const h = await createVisibleCandidateHarness(t);
  await h.revokePrimaryFactEntitlement();
  const candidate = (await h.service.getRun(h.userId, h.runId)).shortlist.find((item) => item.candidate_id === h.candidateId);
  assert.equal(candidate?.evidence_available, false);
  assert.equal(candidate?.assessment, null);
  assert.equal(candidate?.can_promote, false);
});

test("run and candidate reads omit cited sources without browser-safe HTTPS URLs while preserving visible evidence", dbOptions, async (t) => {
  const h = await createVisibleCandidateHarness(t);
  const before = (await h.service.getRun(h.userId, h.runId)).shortlist.find((item) => item.candidate_id === h.candidateId);
  assert.ok(before, "fixture must provide the candidate in the run shortlist");
  assert.ok(before.assessment, "fixture must provide a cited assessment");
  assert.ok(before.sources.length > 1, "fixture must retain another valid cited source");
  assert.ok(before.sources.some((source) => source.citation.id === h.primaryClaimId), "fixture must include the source whose URL changes");

  for (const canonicalUrl of [null, "", "not a URL", "http://fixture.example.test/unsafe"] as const) {
    await h.setPrimarySourceCanonicalUrl(canonicalUrl);
    const runCandidate = (await h.service.getRun(h.userId, h.runId)).shortlist.find((item) => item.candidate_id === h.candidateId);
    const pageCandidate = (await h.service.getCandidates(h.userId, h.runId, { cursor: null, limit: 100 })).items.find((item) => item.candidate_id === h.candidateId);

    for (const candidate of [runCandidate, pageCandidate]) {
      assert.ok(candidate, "candidate remains readable");
      assert.equal(candidate.evidence_available, true);
      assert.equal(candidate.can_promote, before.can_promote);
      assert.deepEqual(candidate.assessment, before.assessment, "assessment and citation identifiers remain available");
      assert.ok(candidate.sources.length < before.sources.length, "source row without a usable link is omitted");
      assert.ok(candidate.sources.every((source) => new URL(source.url).protocol === "https:"), "remaining source links stay browser-safe");
      assert.ok(!candidate.sources.some((source) => source.citation.id === h.primaryClaimId), "URL-less source row is omitted");
      assert.ok(candidate.sources.some((source) => source.citation.id !== h.primaryClaimId), "other valid cited sources remain");
    }
  }
});
