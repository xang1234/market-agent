import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

import { persistCampaignQuotes } from "../../evidence/src/campaign-claims.ts";
import { hashJsonValue } from "../../observability/src/tool-call.ts";
import { createAssessmentCommitter } from "../src/assessment-repo.ts";
import { ProviderRequestError } from "../src/providers/errors.ts";
import { canonicalCampaignQuotes } from "../src/quote-claims.ts";
import { executeDiscoveryRun } from "../src/runner.ts";
import { requestHash } from "../src/scout-support.ts";
import { executeStages } from "../src/stages.ts";
import type { CampaignModel, Providers, WorkerDeps } from "../src/ports.ts";
import type { AnalystOutput, ExistingCandidate, RawCitation, SkepticOutput } from "../src/types.ts";
import { DiscoveryError } from "../src/types.ts";
import { analystFixture, briefFixture, identityFixture, packetFixture, skepticFixture } from "./fixtures.ts";
import { withCampaignDb } from "./db-fixture.ts";

export const IDS = Object.freeze({ issuer: identityFixture().issuer_id });
type TestContext = Parameters<typeof withCampaignDb>[0];
type CrashAfter = "candidate_commit" | "analyst_checkpoint" | "candidate_failure" | "cohort_commit";
type FailurePoint = "reservation" | "response_persistence" | "finalization";
type ExistingCandidateInput = ExistingCandidate;
type Options = {
  crashAfter?: CrashAfter;
  cancelDuring?: "research";
  failOnceAt?: FailurePoint;
  failEveryReservation?: boolean;
  providerFailure?: ConstructorParameters<typeof ProviderRequestError>[0];
  withoutExisting?: boolean;
};
type ModelCall = { role: Parameters<CampaignModel["complete"]>[0]["role"]; candidate_id: string | undefined; operation_key: string; request_hash: string };

export async function createRunnerHarness(t: TestContext, options: Options = {}) {
  const fixture = await withCampaignDb(t);
  const { db, repo: baseRepo, userId, clock } = fixture;
  const { run, brief } = await fixture.createApprovedRun(briefFixture());
  const packets = [makePacket(0), makePacket(1)];
  for (const packet of packets) await seedCompany(db, packet);
  const existing = packets.map((packet, index) => candidateFromPacket(packet, brief.brief.mechanisms[index % brief.brief.mechanisms.length]!.mechanism_id));
  const calls: ModelCall[] = [];
  const candidateIssuers = new Map<string, string>();
  const providerUsers: string[] = [];
  let crashed = false;
  let failureInjected = false;
  let cohortAtFirstCompanyModel: string[] | null = null;

  const repo: WorkerDeps["repo"] = {
    ...baseRepo,
    async reserveAttempt(scope, input) {
      if ((options.failEveryReservation || (!failureInjected && options.failOnceAt === "reservation")) && "run_id" in scope && input.candidate_id !== undefined) {
        failureInjected = true;
        throw new DiscoveryError("unavailable", "injected reservation failure");
      }
      return baseRepo.reserveAttempt(scope, input);
    },
    async finishAttempt(scope, input) {
      if (!failureInjected && options.failOnceAt === "response_persistence" && "run_id" in scope && input.outcome === "success") {
        failureInjected = true;
        throw new DiscoveryError("unavailable", "injected response persistence failure");
      }
      await baseRepo.finishAttempt(scope, input);
    },
    async saveValidatedRole(lease, candidateId, checkpoint) {
      await baseRepo.saveValidatedRole(lease, candidateId, checkpoint);
      if (!crashed && options.crashAfter === "analyst_checkpoint" && checkpoint.role === "analyst") {
        crashed = true;
        throw new DiscoveryError("lease_lost", "injected crash after analyst checkpoint");
      }
    },
    async commitCohort(lease, candidateIds, coverage) {
      await baseRepo.commitCohort(lease, candidateIds, coverage);
      if (!crashed && options.crashAfter === "cohort_commit") {
        crashed = true;
        throw new DiscoveryError("lease_lost", "injected crash after cohort commit");
      }
    },
    async failCandidate(lease, candidateId, code) {
      await baseRepo.failCandidate(lease, candidateId, code);
      if (!crashed && options.crashAfter === "candidate_failure") {
        crashed = true;
        throw new DiscoveryError("lease_lost", "injected crash after candidate failure");
      }
    },
    async finalize(lease, input) {
      if (!failureInjected && options.failOnceAt === "finalization") {
        failureInjected = true;
        throw new Error("injected finalization failure");
      }
      await baseRepo.finalize(lease, input);
    },
  };
  const realCommit = createAssessmentCommitter({ db, clock: clock.now });
  const deps: WorkerDeps = {
    repo,
    clock: clock.now,
    providers: (lease) => {
      providerUsers.push(lease.user_id);
      return fakeProviders();
    },
    loadExisting: async () => options.withoutExisting ? [] : existing.map((candidate) => structuredClone(candidate)),
    model: (lease, operations) => ({
      async complete(input) {
        const index = input.attempt_number === 2 ? 1 : 0;
        const result = await operations.providerAttempt({
          key: input.operation_key,
          request_hash: input.request_hash,
          index,
          resource: "model",
          phase: input.phase,
          candidate_id: input.candidate_id,
          model_initial: input.model_initial === true && index === 0,
          model_role: input.model_initial === true && index === 0 && (input.role === "analyst" || input.role === "skeptic") ? input.role : undefined,
          execute: async () => {
            calls.push({ role: input.role, candidate_id: input.candidate_id, operation_key: input.operation_key, request_hash: input.request_hash });
            if (input.candidate_id !== undefined && cohortAtFirstCompanyModel === null) {
              cohortAtFirstCompanyModel = await selectedIds(baseRepo, userId, run.run_id);
            }
            if (options.cancelDuring === "research" && input.candidate_id !== undefined && input.role === "analyst") {
              await baseRepo.requestCancel(userId, run.run_id);
            }
            const tool_call_id = randomUUID();
            const result = {
              text: JSON.stringify(input.role === "scout" ? { hit_ids: [], seeds: [] } : rawRole(input.role, packetForCandidate(input.candidate_id))),
              deployment: { channel: "fixture", model: "fixture-model" },
              tool_call_id,
            };
            await db.query(
              "insert into tool_call_logs (tool_call_id,tool_name,args,result_hash,status) values ($1::uuid,'fixture_model','{}'::jsonb,$2,'ok')",
              [tool_call_id, hashJsonValue(result as never)],
            );
            return result;
          },
        });
        return result;
      },
    }),
    persistQuotes: async (_lease, packet, raw, request) => persistCampaignQuotes(db, {
      operation_key: request.operation_key,
      request_hash: request.request_hash,
      quotes: canonicalCampaignQuotes(raw, packet),
    }),
    commitAssessment: async (lease, packet, decision) => {
      const committed = await realCommit(lease, packet, decision);
      if (!crashed && options.crashAfter === "candidate_commit") {
        crashed = true;
        throw new DiscoveryError("lease_lost", "injected crash after candidate commit");
      }
      return committed;
    },
  };
  let oldLease: Awaited<ReturnType<typeof baseRepo.claimNextRun>> = null;
  async function executeLease(lease: NonNullable<Awaited<ReturnType<typeof baseRepo.claimNextRun>>>) {
    if (options.crashAfter !== undefined) {
      await executeStages(deps, lease, new AbortController().signal);
      return;
    }
    await executeDiscoveryRun(deps, lease, new AbortController().signal);
  }

  return Object.freeze({
    repo: baseRepo,
    userId,
    runId: run.run_id,
    advanceClock: clock.advance,
    callsForCompany: (issuerId: string) => calls.filter((call) => call.candidate_id !== undefined && candidateIssuers.get(call.candidate_id) === issuerId).length,
    callsForCompanyRole: (issuerId: string, role: "analyst" | "skeptic") => calls.filter((call) => call.role === role && call.candidate_id !== undefined && candidateIssuers.get(call.candidate_id) === issuerId).length,
    callsForRole: (role: "analyst" | "skeptic") => calls.filter((call) => call.role === role).length,
    requestFor: (role: "analyst" | "skeptic") => {
      const call = calls.find((entry) => entry.role === role);
      assert.ok(call, `expected ${role} request`);
      return { operation_key: call.operation_key, request_hash: call.request_hash };
    },
    selectedCandidateIds: () => selectedIds(baseRepo, userId, run.run_id),
    cohortAtFirstModelCall: () => cohortAtFirstCompanyModel ?? [],
    callsForUnselectedCompanies: async () => {
      const selected = new Set(await selectedIds(baseRepo, userId, run.run_id));
      return calls.filter((call) => call.candidate_id !== undefined && !selected.has(call.candidate_id)).length;
    },
    candidates: () => baseRepo.candidates(userId, run.run_id),
    events: async () => (await baseRepo.events(userId, run.run_id, 0, 100)).items,
    async makeFirstExistingDocumentUnavailableWithUnrelatedVisibleEvidence() {
      const packet = packets[0]!;
      await db.query("update documents set deleted_at=$1::timestamptz where document_id=$2::uuid", [clock.now().toISOString(), packet.excerpts[0]!.document_id]);
      await addUnrelatedVisibleDocument(db, packet.identity.issuer_id, clock.now().toISOString());
    },
    async useUnentitledFactAsFirstExistingProvenance() {
      const packet = packets[0]!;
      const metric = await db.query<{ metric_id: string }>(
        "insert into metrics (metric_key,display_name,unit_class,aggregation,interpretation,canonical_source_class) values ($1,$2,'currency','point_in_time','neutral','fixture') returning metric_id::text as metric_id",
        [`existing-provenance-${run.run_id}`, "Existing provenance"],
      );
      const fact_id = randomUUID();
      await db.query(
        `insert into facts (fact_id,subject_kind,subject_id,metric_id,period_kind,unit,scale,as_of,observed_at,source_id,method,verification_status,freshness_class,coverage_level,entitlement_channels,confidence)
         values ($1::uuid,'issuer',$2::uuid,$3::uuid,'point','USD',1,$4::timestamptz,$4::timestamptz,$5::uuid,'reported','authoritative','filing_time','full','["export"]'::jsonb,1)`,
        [fact_id, packet.identity.issuer_id, metric.rows[0]!.metric_id, clock.now().toISOString(), packet.excerpts[0]!.source_id],
      );
      existing[0]!.evidence_refs = [{ kind: "fact", fact_id, source_id: packet.excerpts[0]!.source_id }];
      await addUnrelatedVisibleDocument(db, packet.identity.issuer_id, clock.now().toISOString());
    },
    async revokeExistingEvidence() {
      await db.query(
        "update documents set deleted_at=$1::timestamptz where document_id=any($2::uuid[])",
        [clock.now().toISOString(), packets.flatMap((packet) => packet.excerpts.map((excerpt) => excerpt.document_id))],
      );
    },
    async assertCountersReconcile() {
      const current = await baseRepo.readRun(userId, run.run_id);
      const candidates = await baseRepo.candidates(userId, run.run_id);
      const selected = candidates.filter((candidate) => candidate.ordinal !== null);
      assert.equal(current.coverage.selected, selected.length);
      assert.equal(current.coverage.assessed, candidates.filter((candidate) => candidate.assessment !== null).length);
      assert.equal(current.coverage.not_selected, candidates.filter((candidate) => candidate.state === "not_selected").length);
      for (const mechanism of current.coverage.mechanisms) {
        assert.equal(mechanism.selected, selected.filter((candidate) => candidate.mechanism_ids.includes(mechanism.mechanism_id)).length);
        assert.equal(mechanism.assessed, candidates.filter((candidate) => candidate.assessment !== null && candidate.mechanism_ids.includes(mechanism.mechanism_id)).length);
      }
    },
    async snapshotCountForIssuer(issuerId: string) {
      return (await baseRepo.candidates(userId, run.run_id)).filter((candidate) => candidate.identity?.issuer_id === issuerId && candidate.snapshot_id !== null).length;
    },
    async claimWorker(workerId: string) {
      const lease = await baseRepo.claimNextRun(workerId);
      if (oldLease === null && lease !== null) oldLease = lease;
      return lease;
    },
    claimWorkersConcurrently: () => Promise.all([baseRepo.claimNextRun("concurrent-a"), baseRepo.claimNextRun("concurrent-b")]),
    async reserveLiveDiscoverySearch(lease: NonNullable<Awaited<ReturnType<typeof baseRepo.claimNextRun>>>) {
      const query = brief.brief.queries[0]!;
      await baseRepo.reserveAttempt(lease, {
        operation_key: `${run.run_id}/discovery/pool/search/0`,
        request_hash: requestHash({ kind: "discovery-search-v1", run_id: run.run_id, query: { ...query, query_index: 0 } }),
        resource: "search", phase: "discovery", attempt_number: 1,
      });
    },
    executeLease,
    providerUsers: () => [...providerUsers],
    async executeOnce() {
      oldLease = await baseRepo.claimNextRun("original");
      assert.ok(oldLease);
      await executeLease(oldLease);
    },
    cancelQueued: () => baseRepo.requestCancel(userId, run.run_id),
    cancelTerminal: () => baseRepo.requestCancel(userId, run.run_id),
    async resumeWithWorker(workerId: string) {
      const lease = await baseRepo.claimNextRun(workerId);
      assert.ok(lease);
      await executeDiscoveryRun(deps, lease, new AbortController().signal);
    },
    async commitUsingOldLease() {
      assert.ok(oldLease);
      await baseRepo.heartbeat(oldLease);
    },
  });

  function fakeProviders(): Providers {
    return {
      search: {
        async search(input, operations) {
          return operations.run({ key: input.operation_key, request_hash: input.request_hash, resource: "search", phase: input.phase, candidate_id: input.candidate_id, execute: async () => ({ hits: [], hits_truncated: 0 }) });
        },
      },
      identity: { async resolve() { throw new Error("attested existing fixture must not resolve identity"); } },
      evidence: {
        async acquire(input) {
          const original = packets.find((packet) => packet.identity.issuer_id === input.candidate.identity?.issuer_id);
          assert.ok(original, "evidence operation must name a fixture issuer");
          candidateIssuers.set(input.candidate.candidate_id, original.identity.issuer_id);
          return structuredClone({ ...original, candidate_id: input.candidate.candidate_id, identity: input.candidate.identity! });
        },
      },
      financials: {
        async read() {
          if (options.providerFailure !== undefined) throw new ProviderRequestError(options.providerFailure, `fixture ${options.providerFailure}`);
          return { facts: [], missing_fields: [], coverage_gaps: [] };
        },
      },
    };
  }

  function packetForCandidate(candidateId: string | undefined) {
    const issuerId = candidateId === undefined ? undefined : candidateIssuers.get(candidateId);
    const original = packets.find((packet) => packet.candidate_id === candidateId || packet.identity.issuer_id === issuerId);
    assert.ok(original, "model operation must name an acquired fixture candidate");
    return candidateId === undefined ? original : { ...original, candidate_id: candidateId };
  }
}

function makePacket(index: number) {
  const original = packetFixture();
  const identity = identityFixture(index);
  const candidate_id = `90000000-0000-4000-8000-00000000000${index + 1}`;
  const ids = [index * 10 + 1, index * 10 + 2];
  const excerpts = original.excerpts.map((excerpt, excerptIndex) => ({
    ...excerpt,
    excerpt_id: uuid("a0", ids[excerptIndex]!),
    document_id: uuid("a1", ids[excerptIndex]!),
    source_id: uuid("a2", ids[excerptIndex]!),
    document_hash: `sha256:${(index * 2 + excerptIndex + 1).toString(16).repeat(64)}`,
    published_at: "2026-09-01T00:00:00.000Z",
  }));
  return {
    ...original,
    candidate_id,
    identity,
    excerpts,
    claims: original.claims.map((claim, claimIndex) => ({ ...claim, claim_id: uuid("b0", ids[claimIndex]!), document_id: excerpts[claimIndex]!.document_id, source_id: excerpts[claimIndex]!.source_id })),
  };
}

function uuid(prefix: string, n: number): string { return `${prefix}000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`; }

function candidateFromPacket(packet: ReturnType<typeof makePacket>, mechanism_id: string): ExistingCandidateInput {
  return {
    candidate_id: packet.candidate_id, lead_key: `existing:${packet.identity.issuer_id}`, name: packet.identity.legal_name,
    identity: packet.identity, origins: ["existing"], mechanism_ids: [mechanism_id], seed: false,
    primary_domain_lead: false, first_seen: [0, 0], lead_hit_ids: [], reason_codes: ["fixture"],
    evidence_refs: [{
      kind: "document", source_id: packet.excerpts[0]!.source_id, document_id: packet.excerpts[0]!.document_id,
      claim_id: packet.claims[0]!.claim_id,
    }],
  };
}

async function addUnrelatedVisibleDocument(db: { query: Function }, issuerId: string, retrievedAt: string): Promise<void> {
  const sourceId = randomUUID();
  const documentId = randomUUID();
  const hash = `sha256:${randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
  await db.query(
    "insert into sources (source_id,provider,kind,canonical_url,trust_tier,license_class,retrieved_at) values ($1::uuid,'fixture-unrelated','press_release',$2,'primary','test',$3::timestamptz)",
    [sourceId, `https://example.test/unrelated/${documentId}`, retrievedAt],
  );
  await db.query(
    "insert into documents (document_id,source_id,kind,title,published_at,content_hash,raw_blob_id,parse_status) values ($1::uuid,$2::uuid,'press_release','Unrelated visible evidence',$3::timestamptz,$4,$4,'parsed')",
    [documentId, sourceId, retrievedAt, hash],
  );
  await db.query("insert into mentions (document_id,subject_kind,subject_id,prominence,confidence) values ($1::uuid,'issuer',$2::uuid,'body',1)", [documentId, issuerId]);
}

function rawRole(role: Parameters<CampaignModel["complete"]>[0]["role"], packet: ReturnType<typeof makePacket>): AnalystOutput<RawCitation> | SkepticOutput<RawCitation> {
  const quote = packet.excerpts[0]!.text;
  const analyst = structuredClone(analystFixture()) as AnalystOutput<RawCitation>;
  analyst.exposure.citations = [{ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote }];
  analyst.criteria[0]!.citations = [{ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote }];
  if (role === "analyst") return analyst;
  const skeptic = structuredClone(skepticFixture()) as SkepticOutput<RawCitation>;
  skeptic.exposure.citations = [{ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote }];
  skeptic.criteria[0]!.citations = [{ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote }];
  skeptic.counterarguments[0]!.citations = [{ kind: "excerpt", id: packet.excerpts[1]!.excerpt_id, quote: packet.excerpts[1]!.text }];
  return skeptic;
}

async function selectedIds(repo: WorkerDeps["repo"], userId: string, runId: string): Promise<string[]> {
  return (await repo.candidates(userId, runId)).filter((candidate) => candidate.ordinal !== null).sort((left, right) => left.ordinal! - right.ordinal!).map((candidate) => candidate.candidate_id);
}

async function seedCompany(db: { query: Function }, packet: ReturnType<typeof makePacket>): Promise<void> {
  const instrumentId = randomUUID();
  await db.query("insert into issuers (issuer_id,legal_name,former_names) values ($1::uuid,$2,'[]'::jsonb)", [packet.identity.issuer_id, packet.identity.legal_name]);
  await db.query("insert into instruments (instrument_id,issuer_id,asset_type) values ($1::uuid,$2::uuid,'common_stock')", [instrumentId, packet.identity.issuer_id]);
  await db.query("insert into listings (listing_id,instrument_id,mic,ticker,trading_currency,timezone) values ($1::uuid,$2::uuid,$3,$4,$5,'America/New_York')", [packet.identity.listing_id, instrumentId, packet.identity.mic, packet.identity.ticker, packet.identity.currency]);
  for (const excerpt of packet.excerpts) {
    await db.query("insert into sources (source_id,provider,kind,canonical_url,trust_tier,license_class,retrieved_at) values ($1::uuid,'fixture','press_release',$2,'primary','test',$3::timestamptz)", [excerpt.source_id, excerpt.url, excerpt.retrieved_at]);
    await db.query("insert into documents (document_id,source_id,kind,title,published_at,content_hash,raw_blob_id,parse_status) values ($1::uuid,$2::uuid,'press_release',$3,$4::timestamptz,$5,$6,'parsed')", [excerpt.document_id, excerpt.source_id, excerpt.title, excerpt.published_at, excerpt.document_hash, excerpt.document_hash]);
    await db.query("insert into mentions (document_id,subject_kind,subject_id,prominence,confidence) values ($1::uuid,'issuer',$2::uuid,'body',1)", [excerpt.document_id, packet.identity.issuer_id]);
  }
  for (const claim of packet.claims) {
    await db.query("insert into claims (claim_id,document_id,predicate,text_canonical,polarity,modality,reported_by_source_id,confidence,status) values ($1::uuid,$2::uuid,'fixture',$3,'neutral','quoted',$4::uuid,1,'extracted')", [claim.claim_id, claim.document_id, claim.text_canonical, claim.source_id]);
  }
}
