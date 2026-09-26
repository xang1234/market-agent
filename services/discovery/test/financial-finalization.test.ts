// Numerical criteria finalize only under the campaign's live fence, and the
// assessment commit accepts a certified outcome only from this campaign run
// with every input still visible.

import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { decideCandidate } from "../src/assessment.ts";
import { createAssessmentCommitter } from "../src/assessment-repo.ts";
import { outcomesWithHiddenInputs, requireCertifiedResults } from "../src/financial-outcomes.ts";
import type { EvidencePacket } from "../src/ports.ts";
import type { AnalystOutput, SkepticOutput } from "../src/types.ts";
import { ALPHA, CUTOFF, financialCampaign, MARGIN_ID, REVENUE_ID } from "./financial-fixtures.ts";

test("discovery numerical criteria finalization", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for discovery finalization coverage");
    return;
  }
  const { db, pool, repo, lease, brief, candidateId, evaluate, certificates } = await financialCampaign(t, "discovery-fin-final");
  const nothingCertified = async (label: string, run: () => Promise<Map<string, { outcome: string }> | ReadonlyMap<string, { outcome: string }>>) => {
    const outcomes = await run();
    assert.deepEqual([...outcomes.values()].map((outcome) => outcome.outcome), ["unknown", "unknown"], label);
    assert.equal(await certificates(), 0, label);
  };

  await t.test("a stale fence, an expired lease, a cancellation, or a finished candidate finalizes nothing", async () => {
    await nothingCertified("a superseded epoch", () => evaluate({ ...lease, epoch: lease.epoch - 1 }));
    await nothingCertified("another worker", () => evaluate({ ...lease, worker_id: "worker-2" }));

    const { rows: [saved] } = await db.query(`select lease_expires_at from discovery_runs where run_id = $1`, [lease.run_id]);
    await db.query(`update discovery_runs set lease_expires_at = now() - interval '1 second' where run_id = $1`, [lease.run_id]);
    await nothingCertified("an expired lease", () => evaluate());
    await db.query(`update discovery_runs set lease_expires_at = $2 where run_id = $1`, [lease.run_id, saved.lease_expires_at]);

    await db.query(`update discovery_runs set cancel_requested_at = now() where run_id = $1`, [lease.run_id]);
    await nothingCertified("a cancellation", () => evaluate());
    await db.query(`update discovery_runs set cancel_requested_at = null where run_id = $1`, [lease.run_id]);

    await db.query(`update discovery_candidates set state = 'research_error' where candidate_id = $1`, [candidateId]);
    await nothingCertified("a finished candidate", () => evaluate());
    await db.query(`update discovery_candidates set state = 'researching' where candidate_id = $1`, [candidateId]);
  });

  let outcomes!: Awaited<ReturnType<typeof evaluate>>;
  await t.test("under the live fence the same calculations finalize, once", async () => {
    const executions = Number((await db.query(`select count(*)::int as n from computations c join financial_runs r on r.run_id = c.financial_run_id where r.parent_id = $1`, [lease.run_id])).rows[0].n);
    outcomes = await evaluate();
    assert.deepEqual([...outcomes.values()].map((outcome) => outcome.outcome), ["pass", "fail"]);
    assert.equal(await certificates(), 2);
    const after = Number((await db.query(`select count(*)::int as n from computations c join financial_runs r on r.run_id = c.financial_run_id where r.parent_id = $1`, [lease.run_id])).rows[0].n);
    assert.equal(after, executions, "the refused attempts' calculations were reused, not repeated");
  });

  await t.test("the committed assessment carries the certified outcomes as its numerical verdicts", async () => {
    const packet: EvidencePacket = {
      candidate_id: candidateId, identity: ALPHA, claims: [], facts: [], counter_search_completed: true, coverage_gaps: [],
      excerpts: [{
        excerpt_id: crypto.randomUUID(), document_id: crypto.randomUUID(), source_id: IDS.sourceV1, family_key: "alpha", title: "Alpha filing",
        url: "https://example.test/alpha", published_at: null, retrieved_at: "2024-02-01T00:00:00.000Z", document_hash: `sha256:${"c".repeat(64)}`,
        normalized_start: 0, text: "Alpha files annual reports.", primary: true, primary_eligible: true,
      }],
    };
    const unknown = { level: "unknown" as const, explanation: "Not established.", citations: [] };
    const criteria = brief.brief.criteria.map((criterion) => ({ criterion_id: criterion.criterion_id, outcome: "pass" as const, explanation: "Asserted by the role.", citations: [] }));
    const analyst: AnalystOutput = { exposure: unknown, business_quality: unknown, valuation_context: unknown, criteria, unresolved_questions: [], next_action: "Review filings." };
    const skeptic: SkepticOutput = { ...analyst, counterarguments: [] };
    const decision = decideCandidate(brief.brief, packet, analyst, skeptic, CUTOFF, outcomes);
    assert.deepEqual(decision.criteria.filter((criterion) => criterion.certified).map((criterion) => [criterion.criterion_id, criterion.outcome]), [[REVENUE_ID, "pass"], [MARGIN_ID, "fail"]]);

    // The assessment model's provenance, as the worker records it.
    const attempt = await repo.reserveAttempt(lease, { operation_key: `${lease.run_id}/research/${candidateId}/analyst`, request_hash: `sha256:${"a".repeat(64)}`, resource: "model", phase: "research", candidate_id: candidateId, attempt_number: 1, model_initial: true, model_role: "analyst" });
    await repo.finishAttempt(lease, { attempt_id: attempt.attempt_id, outcome: "success", result: { text: "{}" }, tool_call_id: null });

    const forged = { ...decision, criteria: decision.criteria.map((criterion) => criterion.certified ? { ...criterion, certified: { ...criterion.certified, run_id: crypto.randomUUID() } } : criterion) };
    await assert.rejects(() => requireCertifiedResults(pool, lease, forged), /outside this campaign run/u);
    await assert.rejects(() => requireCertifiedResults(pool, { ...lease, run_id: crypto.randomUUID() }, decision), /outside this campaign run/u);

    const committed = await createAssessmentCommitter({ db: pool, clock: () => new Date() })(lease, packet, decision);
    const stored = (await db.query(`select assessment from discovery_candidates where candidate_id = $1`, [candidateId])).rows[0].assessment;
    assert.deepEqual(stored.criteria.find((criterion: { criterion_id: string }) => criterion.criterion_id === REVENUE_ID).certified, outcomes.get(REVENUE_ID)!.certified);
    assert.ok(committed.snapshot_id);
  });

  await t.test("a calculation whose input becomes invisible no longer counts", async () => {
    // Gross profit binds the original filing; revenue binds its restatement, filed separately.
    await db.query(`update sources set user_id = $2 where source_id = $1`, [IDS.sourceV1, IDS.other]);
    try {
      assert.deepEqual([...await outcomesWithHiddenInputs(pool, IDS.owner, [...outcomes.values()])], [MARGIN_ID]);
      await db.query(`update sources set user_id = $2 where source_id = $1`, [IDS.sourceV2, IDS.other]);
      assert.deepEqual([...await outcomesWithHiddenInputs(pool, IDS.owner, [...outcomes.values()])].sort(), [MARGIN_ID, REVENUE_ID].sort());
    } finally {
      await db.query(`update sources set user_id = null where source_id = any($1::uuid[])`, [[IDS.sourceV1, IDS.sourceV2]]);
    }
  });

  await t.test("deleting the campaign run erases its calculations", async () => {
    assert.ok(await certificates() > 0);
    await db.query(`delete from discovery_runs where run_id = $1`, [lease.run_id]);
    assert.equal(await certificates(), 0);
    assert.equal((await db.query(`select count(*)::int as n from financial_runs where parent_id = $1`, [lease.run_id])).rows[0].n, 0);
  });
});
