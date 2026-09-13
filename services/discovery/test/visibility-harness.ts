import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";

import { createDiscoveryReadModel } from "../src/read-model.ts";
import { createDiscoveryService } from "../src/service.ts";
import { createRunnerHarness } from "./runner-harness.ts";

/** A sealed Task 6 candidate with direct source-state mutation seams for read authorization. */
export async function createVisibleCandidateHarness(t: TestContext) {
  const worker = await createRunnerHarness(t);
  await worker.executeOnce();
  const service = createDiscoveryService({ repo: worker.repo, reads: createDiscoveryReadModel(worker.db) });
  const initial = await service.getRun(worker.userId, worker.runId);
  const candidate = initial.shortlist[0];
  assert.ok(candidate, "Task 6 fixture must finalize a shortlisted candidate");
  const candidateId = candidate.candidate_id;
  const { rows } = await worker.db.query<{ source_id: string; document_id: string; claim_id: string }>(
    `select q.source_id::text as source_id,q.document_id::text as document_id,q.claim_id::text as claim_id
       from discovery_quote_claims q
      where q.operation_key like $1::text || '/research/' || $2::text || '/%'
      order by q.operation_key,q.quote_key
      limit 1`,
    [worker.runId, candidateId],
  );
  const primary = rows[0];
  assert.ok(primary, "candidate must retain a durable research packet");
  const privateQuote = `private discovery quote ${randomUUID()}`;
  await worker.db.query(
    "update discovery_events set summary=$2 where run_id=$1::uuid and candidate_id=$3::uuid",
    [worker.runId, privateQuote, candidateId],
  );

  return Object.freeze({
    service,
    userId: worker.userId,
    otherUserId: worker.otherUserId,
    runId: worker.runId,
    candidateId,
    privateQuote,
    async assertReadableByOwner() {
      const view = await service.getRun(worker.userId, worker.runId);
      assert.equal(view.shortlist.find((item) => item.candidate_id === candidateId)?.evidence_available, true);
    },
    async assertHiddenFromOtherUser() {
      await assert.rejects(service.getRun(worker.otherUserId, worker.runId), { code: "not_found" });
    },
    async revokePrimarySource() {
      await worker.db.query("update sources set user_id=$2::uuid where source_id=$1::uuid", [primary.source_id, worker.otherUserId]);
    },
    async deletePrimaryDocument() {
      await worker.db.query("update documents set deleted_at=now() where document_id=$1::uuid", [primary.document_id]);
    },
    async revokePrimaryClaim() {
      await worker.db.query("update claims set superseded_at=now() where claim_id=$1::uuid", [primary.claim_id]);
    },
    async revokePrimaryFactEntitlement() {
      const issuerId = candidate.identity?.issuer_id;
      assert.ok(issuerId, "shortlisted candidate must be resolved");
      const metric = await worker.db.query<{ metric_id: string }>(
        "insert into metrics (metric_key,display_name,unit_class,aggregation,interpretation,canonical_source_class) values ($1,$2,'currency','point_in_time','neutral','fixture') returning metric_id::text as metric_id",
        [`visibility-entitlement-${candidateId}`, "Visibility entitlement"],
      );
      const factId = randomUUID();
      await worker.db.query(
        `insert into facts (fact_id,subject_kind,subject_id,metric_id,period_kind,unit,scale,as_of,observed_at,source_id,method,verification_status,freshness_class,coverage_level,entitlement_channels,confidence)
         values ($1::uuid,'issuer',$2::uuid,$3::uuid,'point','USD',1,now(),now(),$4::uuid,'reported','authoritative','filing_time','full','["app"]'::jsonb,1)`,
        [factId, issuerId, metric.rows[0]!.metric_id, primary.source_id],
      );
      await worker.db.query(
        `update discovery_candidates
            set assessment=jsonb_set(
              assessment,
              '{criteria,0,citations}',
              coalesce(assessment #> '{criteria,0,citations}','[]'::jsonb)
                || jsonb_build_array(jsonb_build_object('kind','fact','id',$2::text))
            )
          where candidate_id=$1::uuid`,
        [candidateId, factId],
      );
      await worker.db.query("update facts set entitlement_channels='[\"export\"]'::jsonb where fact_id=$1::uuid", [factId]);
    },
  });
}
