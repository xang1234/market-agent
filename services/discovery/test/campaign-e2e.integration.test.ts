import assert from "node:assert/strict";
import test from "node:test";

import { createCampaignE2eHarness, recordedFixtureAssessments } from "./e2e-harness.ts";
import { dbOptions } from "./db-fixture.ts";

test("the pending human-review corpus has ten stable recorded assessment and source references", async () => {
  const assessments = await recordedFixtureAssessments();
  assert.equal(assessments.length, 10);
  assert.equal(new Set(assessments.map((assessment) => assessment.assessment_id)).size, 10);
  assert.equal(new Set(assessments.map((assessment) => assessment.candidate_id)).size, 10);
  assert.ok(assessments.every((assessment) => assessment.primary_source_id !== assessment.counter_source_id));
});

test("recorded fixture operation contracts reject another candidate and a duplicate operation", dbOptions, async (t) => {
  const h = await createCampaignE2eHarness(t, "power-infrastructure");
  await h.approveAndStart();
  await h.assertOperationContractRejectsWrongCandidateAndDuplicate();
});

test("approved theme research reaches an inspectable shortlist without live providers", dbOptions, async (t) => {
  const h = await createCampaignE2eHarness(t, "power-infrastructure");
  const started = await h.approveAndStart();
  await h.workerUntilTerminal();
  const result = await h.getRun(started.run_id);

  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.ok(result.shortlist.length > 0 && result.shortlist.length <= 10);
  for (const candidate of result.shortlist) {
    assert.equal(candidate.evidence_available, true);
    assert.ok(candidate.snapshot_id);
    await h.assertSnapshotVerifies(candidate.snapshot_id);
  }
  await h.assertFixtureOutcome();
  await h.assertAllLimitsRespected();
  await h.assertForeignUserDenied();
});

test("recorded fixtures exclude misleading and counterevidenced companies and complete an empty theme", dbOptions, async (t) => {
  for (const [fixture, state] of [
    ["industrial-automation", "excluded"],
    ["supply-disruption", "excluded"],
    ["unsupported-theme", null],
  ] as const) {
    const h = await createCampaignE2eHarness(t, fixture);
    const started = await h.approveAndStart();
    await h.workerUntilTerminal();
    const result = await h.getRun(started.run_id);
    assert.equal(result.status, "completed", fixture);
    const candidates = await h.getCandidates();
    assert.equal(candidates.items.length, state === null ? 0 : 1, fixture);
    if (state !== null) assert.equal(candidates.items[0]!.state, state, fixture);
    assert.equal(result.shortlist.length, 0, fixture);
    await h.assertFixtureOutcome();
    await h.assertAllLimitsRespected();
  }
});
