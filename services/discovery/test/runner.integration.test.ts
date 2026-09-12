import assert from "node:assert/strict";
import test from "node:test";

import { dbOptions } from "./db-fixture.ts";
import { createRunnerHarness } from "./runner-harness.ts";

test("worker commits its immutable cohort before any company model call", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  await h.executeOnce();
  assert.deepEqual(h.cohortAtFirstModelCall(), await h.selectedCandidateIds());
  assert.equal(await h.callsForUnselectedCompanies(), 0);
  await h.assertCountersReconcile();
});

test("only one worker can hold the live run lease", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  const [first, second] = await h.claimWorkersConcurrently();
  assert.ok(first);
  assert.equal(second, null);
  await h.executeLease(first);
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "completed");
  await h.assertCountersReconcile();
});

test("deadline elapsed during worker downtime finalizes a replacement lease as partial", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  assert.ok(await h.claimWorker("original"));
  h.advanceClock(2_700_001);
  const replacement = await h.claimWorker("replacement");
  assert.ok(replacement);
  await h.executeLease(replacement);
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "partial");
  await h.assertCountersReconcile();
});

test("a discovery plan with no candidates completes an empty bounded shortlist", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { withoutExisting: true });
  await h.executeOnce();
  const run = await h.repo.readRun(h.userId, h.runId);
  assert.equal(run.status, "completed");
  assert.equal(run.coverage.selected, 0);
  assert.equal(run.coverage.assessed, 0);
  await h.assertCountersReconcile();
});

test("revoked source evidence cannot authorize an existing candidate identity", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  await h.revokeExistingEvidence();
  await h.executeOnce();
  const run = await h.repo.readRun(h.userId, h.runId);
  assert.equal(run.status, "partial");
  assert.equal(run.coverage.selected, 0);
  assert.ok(run.coverage.gaps.some((gap) => gap.code === "existing_evidence_unavailable"));
  await h.assertCountersReconcile();
});

test("an unavailable exact document provenance cannot be replaced by an unrelated visible issuer document", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  await h.makeFirstExistingDocumentUnavailableWithUnrelatedVisibleEvidence();
  await h.executeOnce();
  assert.equal(h.callsForCompany("80000000-0000-4000-8000-000000000001"), 0);
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "partial");
});

test("an unentitled exact fact provenance cannot be replaced by an unrelated visible issuer document", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  await h.useUnentitledFactAsFirstExistingProvenance();
  await h.executeOnce();
  assert.equal(h.callsForCompany("80000000-0000-4000-8000-000000000001"), 0);
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "partial");
});

test("a reservation failure leaves only that company incomplete and reconciles terminal coverage", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { failOnceAt: "reservation" });
  await h.executeOnce();
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "partial");
  assert.ok((await h.candidates()).some((candidate) => candidate.state === "research_error"));
  await h.assertCountersReconcile();
});

test("a systemic provider failure preventing every assessment finalizes failed", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { failEveryReservation: true });
  await h.executeOnce();
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "failed");
  assert.ok((await h.candidates()).every((candidate) => candidate.assessment === null));
  await h.assertCountersReconcile();
});

test("a replacement lease classifies every persisted configuration failure as failed", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { providerFailure: "missing_configuration", crashAfter: "candidate_failure" });
  await assert.rejects(h.executeOnce(), /injected crash/);
  h.advanceClock(91_000);
  await h.resumeWithWorker("replacement");
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "failed");
});

test("response persistence retry completes through the operation ledger", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { failOnceAt: "response_persistence" });
  await h.executeOnce();
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "completed");
  await h.assertCountersReconcile();
});

test("a transient finalization failure retries the completed stage outcome", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { failOnceAt: "finalization" });
  await h.executeOnce();
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "completed");
  const events = await h.events();
  assert.equal(events.filter((event) => event.kind === "run_finalized").length, 1);
  assert.ok(events.every((event, index) => index === 0 || event.sequence > events[index - 1]!.sequence));
  await h.assertCountersReconcile();
});

test("a cancellation request wins over normal completion", dbOptions, async (t) => {
  const h = await createRunnerHarness(t, { cancelDuring: "research" });
  await h.executeOnce();
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "cancelled");
  await h.assertCountersReconcile();
});

test("a live operation reservation leaves the runner nonterminal until a replacement lease resumes it", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  const original = await h.claimWorker("original");
  assert.ok(original);
  await h.reserveLiveDiscoverySearch(original);
  await h.executeLease(original);
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "running");
  h.advanceClock(91_000);
  await h.resumeWithWorker("replacement");
  assert.equal((await h.repo.readRun(h.userId, h.runId)).status, "completed");
});

test("queued cancellation becomes terminal without a worker lease", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  assert.equal((await h.cancelQueued()).status, "cancelled");
  assert.equal(await h.repo.claimNextRun("should-not-claim"), null);
  assert.equal((await h.events()).filter((event) => event.kind === "run_finalized").length, 1);
});

test("a cancellation request cannot rewrite a completed run", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  await h.executeOnce();
  assert.equal((await h.cancelTerminal()).status, "completed");
});
