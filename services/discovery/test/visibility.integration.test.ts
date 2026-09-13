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
