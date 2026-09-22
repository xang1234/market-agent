import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";

import { persistCampaignQuotes } from "../../evidence/src/campaign-claims.ts";
import { hashJsonValue } from "../../observability/src/tool-call.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import { createDiscoveryDevApiAdapter } from "../../dev-api/src/discovery-adapter.ts";
import { createDevApiServer, createFixtureDevApiAdapters } from "../../dev-api/src/http.ts";
import { createAssessmentCommitter } from "../src/assessment-repo.ts";
import { createDiscoveryReadModel } from "../src/read-model.ts";
import { createDiscoveryRepository } from "../src/repository.ts";
import { createDiscoveryService } from "../src/service.ts";
import { canonicalCampaignQuotes } from "../src/quote-claims.ts";
import { runDiscoveryWorker } from "../src/worker.ts";
import type { AnalystOutput, Brief, CandidateView, CompanyIdentity, RawCitation, SkepticOutput } from "../src/types.ts";
import type { CampaignModel, EvidencePacket, Providers, WorkerDeps } from "../src/ports.ts";
import { withCampaignDb } from "./db-fixture.ts";

type TestContext = Parameters<typeof withCampaignDb>[0];
type FixtureName = "power-infrastructure" | "industrial-automation" | "supply-disruption" | "unsupported-theme";
type Fixture = {
  fixture: FixtureName;
  question: string;
  brief: Brief;
  candidate: null | { candidate_id: string; lead_key: string; name: string; identity: CompanyIdentity; excerpts: EvidencePacket["excerpts"] };
  search_hits: unknown[];
  identities: CompanyIdentity[];
  financial_facts: EvidencePacket["facts"];
  financial_missing_fields: string[];
  role_responses: Partial<Record<"analyst" | "skeptic", { exposure: "weak" | "moderate" | "strong"; criterion_outcome: "pass" | "fail" | "unknown"; criterion_source: "primary" | "counter" }>>;
  operation_outcomes: Record<"search" | "document" | "financial" | "model", string[]>;
  expected: { status: "completed"; states: Record<string, string>; ranks: Record<string, number>; unknown_valuation?: boolean; quote_cache_before_run?: boolean; famous_company_excluded?: boolean; counterevidence_excludes?: boolean; zero_qualified?: boolean };
};

const USER = "10000000-0000-4000-8000-000000000001";
const FOREIGN_USER = "10000000-0000-4000-8000-000000000002";

/**
 * Full-path harness: the service and worker are real, while only provider/model
 * transports use strict named fixture responses. A new fixture must declare
 * every operation it consumes; unexpected calls fail at the provider boundary.
 */
export async function createCampaignE2eHarness(t: TestContext, name: FixtureName) {
  const fixture = await loadFixture(name);
  const database = await withCampaignDb(t);
  const { db, clock } = database;
  const repo = createDiscoveryRepository(db, { clock: clock.now });
  const service = createDiscoveryService({ repo, reads: createDiscoveryReadModel(db, clock.now), readiness: () => ({ ready: true, missing: [] }) });
  const calls = new Set<string>();
  let runId: string | null = null;
  let quoteCountBeforeRun: number | null = null;

  if (fixture.candidate !== null) await seedCandidateEvidence(db, fixture.candidate);
  const server = createDevApiServer({}, {
    adapters: { ...createFixtureDevApiAdapters(), discovery: createDiscoveryDevApiAdapter(service) },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const deps: WorkerDeps = {
    repo,
    clock: clock.now,
    providers: () => strictProviders(),
    loadExisting: async (_lease, brief) => fixture.candidate === null ? [] : [{
      candidate_id: fixture.candidate.candidate_id,
      lead_key: fixture.candidate.lead_key,
      name: fixture.candidate.name,
      identity: fixture.candidate.identity,
      origins: ["existing"], mechanism_ids: [brief.mechanisms[0]!.mechanism_id], seed: false,
      primary_domain_lead: true, first_seen: [0, 0], lead_hit_ids: [], reason_codes: ["fixture_existing"],
      evidence_refs: [{ kind: "document", document_id: fixture.candidate.excerpts[0]!.document_id, source_id: fixture.candidate.excerpts[0]!.source_id }],
    }],
    model: (lease, operations) => strictModel(lease, operations),
    persistQuotes: async (_lease, packet, raw, request) => persistCampaignQuotes(db, {
      operation_key: request.operation_key,
      request_hash: request.request_hash,
      quotes: canonicalCampaignQuotes(raw, packet),
    }),
    commitAssessment: createAssessmentCommitter({ db, clock: clock.now }),
  };

  async function api(path: string, init: RequestInit = {}, user = USER): Promise<Response> {
    return fetch(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-user-id": user, ...init.headers },
    });
  }

  async function candidateViews(): Promise<CandidateView[]> {
    assert.ok(runId !== null);
    const response = await api(`/v1/discovery/runs/${runId}/candidates?limit=25`);
    assert.equal(response.status, 200);
    return (await response.json() as { items: CandidateView[] }).items;
  }

  function expectedOperation(operationKey: string): void {
    assert.ok(runId !== null, "a provider operation requires a started run");
    const suffix = operationKey.slice(`${runId}/`.length);
    const allowed = Object.values(fixture.operation_outcomes).flat().map((value) => value.replace("{candidate_id}", suffix.startsWith("research/") ? suffix.split("/")[1]! : "{candidate_id}"));
    assert.ok(allowed.includes(suffix), `unexpected fixture operation ${suffix}`);
    calls.add(suffix);
  }

  function strictProviders(): Providers {
    return {
      search: {
        async search(input, operations) {
          expectedOperation(input.operation_key);
          return operations.run({
            key: input.operation_key, request_hash: input.request_hash, resource: "search", phase: input.phase, candidate_id: input.candidate_id,
            execute: async () => ({ hits: structuredClone(fixture.search_hits) as never, hits_truncated: 0 }),
          });
        },
      },
      identity: { async resolve(input) { expectedOperation(input.operation_key); throw new Error("fixture contains only source-attested existing companies"); } },
      evidence: {
        async acquire(input, operations) {
          expectedOperation(input.operation_key);
          assert.ok(fixture.candidate !== null, "unsupported-theme must not request evidence");
          return operations.run({
            key: input.operation_key, request_hash: input.request_hash, resource: "document", phase: input.phase, candidate_id: input.candidate_id,
            execute: async () => ({
              candidate_id: input.candidate_id,
              identity: input.candidate.identity!,
              excerpts: structuredClone(fixture.candidate!.excerpts), claims: [], facts: [], counter_search_completed: false, coverage_gaps: [],
            }),
          });
        },
      },
      financials: {
        async read(input) {
          expectedOperation(input.operation_key);
          return { facts: structuredClone(fixture.financial_facts), missing_fields: [...fixture.financial_missing_fields], coverage_gaps: fixture.financial_missing_fields.length === 0 ? [] : ["valuation_unknown"] };
        },
      },
    };
  }

  function strictModel(_lease: Parameters<WorkerDeps["model"]>[0], operations: Parameters<WorkerDeps["model"]>[1]): CampaignModel {
    return {
      async complete(input) {
        expectedOperation(input.operation_key);
        const response = responseFor(input.role, fixture);
        return operations.providerAttempt({
          key: input.operation_key, request_hash: input.request_hash, index: input.attempt_number === 2 ? 1 : 0,
          resource: "model", phase: input.phase, candidate_id: input.candidate_id,
          model_initial: input.model_initial === true && input.attempt_number !== 2,
          model_role: input.model_initial === true && input.attempt_number !== 2 && (input.role === "analyst" || input.role === "skeptic") ? input.role : undefined,
          execute: async () => {
            const tool_call_id = randomUUID();
            const result = { text: JSON.stringify(response), deployment: { channel: "fixture", model: `fixture-${fixture.fixture}` }, tool_call_id };
            await db.query(
              "insert into tool_call_logs (tool_call_id,tool_name,args,result_hash,status) values ($1::uuid,'discovery-fixture','{}'::jsonb,$2,'ok')",
              [tool_call_id, hashJsonValue(result as never)],
            );
            return result;
          },
        });
      },
    };
  }

  return Object.freeze({
    async approveAndStart() {
      const created = await api("/v1/discovery/campaigns", { method: "POST", body: JSON.stringify({ name: fixture.fixture, question: fixture.question }) });
      assert.equal(created.status, 201);
      const campaign = await created.json() as { campaign_id: string };
      const saved = await api(`/v1/discovery/campaigns/${campaign.campaign_id}/brief`, { method: "PUT", body: JSON.stringify({ expected_version: 0, brief: fixture.brief }) });
      assert.equal(saved.status, 200);
      const savedBrief = await saved.json() as { version: number; hash: string };
      if (fixture.expected.quote_cache_before_run === false) {
        const quotes = await db.query<{ count: string }>("select count(*)::text as count from discovery_quote_claims");
        quoteCountBeforeRun = Number(quotes.rows[0]!.count);
      }
      const started = await api(`/v1/discovery/campaigns/${campaign.campaign_id}/runs`, { method: "POST", body: JSON.stringify({ brief_version: savedBrief.version, brief_hash: savedBrief.hash, request_key: randomUUID() }) });
      assert.equal(started.status, 201);
      const run = await started.json() as { run_id: string };
      runId = run.run_id;
      return run;
    },
    async workerUntilTerminal() {
      const controller = new AbortController();
      const worker = runDiscoveryWorker(deps, { signal: controller.signal, pollMs: 1 });
      try {
        for (let i = 0; i < 2_000; i += 1) {
          assert.ok(runId !== null);
          const response = await api(`/v1/discovery/runs/${runId}`);
          const run = await response.json() as { status: string };
          if (["completed", "partial", "failed", "cancelled"].includes(run.status)) return;
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
        assert.fail("fixture worker did not reach a terminal state");
      } finally {
        controller.abort();
        await worker;
      }
    },
    async getRun(id: string) {
      const response = await api(`/v1/discovery/runs/${id}`);
      assert.equal(response.status, 200);
      return await response.json() as { status: string; shortlist: CandidateView[]; usage: Record<string, number>; limits: { attempts: Record<string, number> } };
    },
    async getCandidates() {
      return { items: await candidateViews() };
    },
    async assertFixtureOutcome() {
      assert.ok(runId !== null);
      const run = await repo.readRun(USER, runId);
      assert.equal(run.status, fixture.expected.status);
      const candidates = await candidateViews();
      if (fixture.candidate === null) {
        assert.equal(candidates.length, 0, "the unsupported fixture completes with zero qualified candidates");
        assert.equal(fixture.expected.zero_qualified, true);
        return;
      }
      const candidate = candidates.find((item) => item.identity?.issuer_id === fixture.candidate!.identity.issuer_id);
      assert.ok(candidate, "fixture candidate is identifiable by canonical issuer identity");
      const expectedState = fixture.expected.states[fixture.candidate.candidate_id];
      assert.equal(candidate.state, expectedState, "fixture candidate state");
      const expectedRank = fixture.expected.ranks[fixture.candidate.candidate_id] ?? null;
      assert.equal(candidate.rank, expectedRank, "fixture candidate rank");
      if (fixture.expected.unknown_valuation === true) assert.equal(candidate.assessment?.dimensions.valuation_context.level, "unknown");
      if (fixture.expected.quote_cache_before_run === false) assert.equal(quoteCountBeforeRun, 0, "fixture starts without quote cache");
    },
    async assertSnapshotVerifies(snapshotId: string) {
      const snapshot = await db.query<Record<string, unknown>>(
        `select snapshot_id::text,subject_refs,fact_refs,claim_refs,event_refs,document_refs,series_specs,source_ids,tool_call_ids,tool_call_result_hashes,as_of::text,basis,normalization,coverage_start::text,allowed_transforms,model_version
           from snapshots where snapshot_id=$1::uuid`, [snapshotId],
      );
      assert.equal(snapshot.rowCount, 1, "candidate snapshot is durable");
      const row = snapshot.rows[0]!;
      const claims = await db.query<{ claim_id: string; document_id: string; source_id: string }>(
        "select claim_id::text,document_id::text,reported_by_source_id::text as source_id from claims where claim_id=any($1::uuid[])", [row.claim_refs],
      );
      const documents = await db.query<{ document_id: string; source_id: string }>(
        "select document_id::text,source_id::text from documents where document_id=any($1::uuid[])", [row.document_refs],
      );
      const verified = await verifySnapshotSeal({
        snapshot_id: snapshotId,
        manifest: {
          subject_refs: row.subject_refs as never, fact_refs: row.fact_refs as never, claim_refs: row.claim_refs as never,
          event_refs: row.event_refs as never, document_refs: row.document_refs as never, series_specs: row.series_specs as never,
          source_ids: row.source_ids as never, as_of: isoTimestamp(row.as_of), basis: row.basis as never,
          normalization: row.normalization as never, coverage_start: row.coverage_start === null ? null : isoTimestamp(row.coverage_start),
          allowed_transforms: row.allowed_transforms as never, model_version: row.model_version as string | null,
          tool_call_ids: row.tool_call_ids as never, tool_call_result_hashes: row.tool_call_result_hashes as never,
        },
        blocks: [{ id: `campaign-assessment-${snapshotId}`, kind: "rich_text", snapshot_id: snapshotId, data_ref: { kind: "rich_text", id: snapshotId }, source_refs: row.source_ids as string[], as_of: isoTimestamp(row.as_of), claim_refs: row.claim_refs as string[], document_refs: row.document_refs as string[], subject_refs: row.subject_refs as never, segments: [] }],
        claims: claims.rows as never, documents: documents.rows as never, sources: (row.source_ids as string[]).map((source_id) => ({ source_id })),
      });
      assert.equal(verified.ok, true, JSON.stringify(verified.failures));
    },
    async assertAllLimitsRespected() {
      assert.ok(runId !== null);
      const result = await repo.readRun(USER, runId);
      for (const [resource, used] of Object.entries(result.usage)) assert.ok(used <= result.limits.attempts[resource as keyof typeof result.limits.attempts], `${resource} usage exceeds its cap`);
      const expected = Object.values(fixture.operation_outcomes).flat().map((value) => value.replace("{candidate_id}", fixture.candidate === null ? "" : findCandidateId(calls, value)));
      assert.deepEqual([...calls].sort(), expected.sort(), "fixture declares every used external operation exactly once");
    },
    async assertForeignUserDenied() {
      assert.ok(runId !== null);
      const response = await api(`/v1/discovery/runs/${runId}`, {}, FOREIGN_USER);
      assert.equal(response.status, 404);
    },
  });
}

function findCandidateId(calls: ReadonlySet<string>, template: string): string {
  if (!template.includes("{candidate_id}")) return "";
  const ending = template.slice(template.indexOf("}/") + 2);
  const call = [...calls].find((value) => value.startsWith("research/") && value.endsWith(ending));
  assert.ok(call, `expected fixture operation ${template}`);
  return call.split("/")[1]!;
}

function isoTimestamp(value: unknown): string {
  const date = new Date(String(value));
  assert.ok(Number.isFinite(date.getTime()), `expected timestamp, received ${String(value)}`);
  return date.toISOString();
}

function responseFor(role: "planner" | "scout" | "analyst" | "skeptic" | "summary", fixture: Fixture): unknown {
  if (role === "scout") return { hit_ids: [], seeds: [] };
  assert.ok(fixture.candidate !== null, `unsupported fixture cannot call ${role}`);
  const [primary, counter] = fixture.candidate.excerpts;
  assert.ok(primary && counter);
  const criterion_id = fixture.brief.criteria[0]!.criterion_id;
  const citation = { kind: "excerpt" as const, id: primary.excerpt_id, quote: primary.text };
  const riskCitation = { kind: "excerpt" as const, id: counter.excerpt_id, quote: counter.text };
  const analystResponse = fixture.role_responses.analyst;
  const skepticResponse = fixture.role_responses.skeptic;
  assert.ok(analystResponse && skepticResponse, `fixture must provide analyst and skeptic responses`);
  const analystCitation = analystResponse.criterion_source === "counter" ? riskCitation : citation;
  const skepticCitation = skepticResponse.criterion_source === "counter" ? riskCitation : citation;
  const analyst: AnalystOutput<RawCitation> = {
    exposure: { level: analystResponse.exposure, explanation: analystResponse.criterion_outcome === "fail" ? "The recorded source does not support the required exposure." : "The recorded primary source supports the company exposure.", citations: [analystCitation] },
    business_quality: { level: "unknown", explanation: "Business quality evidence is unavailable.", citations: [] },
    valuation_context: { level: "unknown", explanation: "Valuation evidence is unavailable.", citations: [] },
    criteria: [{ criterion_id, outcome: analystResponse.criterion_outcome, explanation: analystResponse.criterion_outcome === "fail" ? "The cited document falsifies the required product exposure." : "The cited document supports the criterion.", citations: [analystCitation] }],
    unresolved_questions: [], next_action: "Review the next primary disclosure.",
  };
  if (role === "analyst") return analyst;
  const skeptic: SkepticOutput<RawCitation> = {
    ...analyst,
    criteria: [{ criterion_id, outcome: skepticResponse.criterion_outcome, explanation: skepticResponse.criterion_outcome === "fail" ? "The cited counterevidence materially challenges the required criterion." : "The cited document supports the criterion.", citations: [skepticCitation] }],
    counterarguments: [{ text: "The cited counterevidence can materially limit the expected benefit.", citations: [riskCitation] }],
  };
  return skeptic;
}

async function loadFixture(name: FixtureName): Promise<Fixture> {
  const value = JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Fixture;
  assert.equal(value.fixture, name);
  return value;
}

async function seedCandidateEvidence(db: { query: Function }, candidate: NonNullable<Fixture["candidate"]>): Promise<void> {
  const instrumentId = randomUUID();
  await db.query("insert into issuers (issuer_id,legal_name,former_names) values ($1::uuid,$2,'[]'::jsonb)", [candidate.identity.issuer_id, candidate.identity.legal_name]);
  await db.query("insert into instruments (instrument_id,issuer_id,asset_type) values ($1::uuid,$2::uuid,'common_stock')", [instrumentId, candidate.identity.issuer_id]);
  await db.query("insert into listings (listing_id,instrument_id,mic,ticker,trading_currency,timezone) values ($1::uuid,$2::uuid,$3,$4,$5,'America/New_York')", [candidate.identity.listing_id, instrumentId, candidate.identity.mic, candidate.identity.ticker, candidate.identity.currency]);
  for (const excerpt of candidate.excerpts) {
    await db.query("insert into sources (source_id,provider,kind,canonical_url,trust_tier,license_class,retrieved_at) values ($1::uuid,'sec_edgar','press_release',$2,'primary','test',$3::timestamptz)", [excerpt.source_id, excerpt.url, excerpt.retrieved_at]);
    await db.query("insert into documents (document_id,source_id,kind,title,published_at,content_hash,raw_blob_id,parse_status) values ($1::uuid,$2::uuid,'press_release',$3,$4::timestamptz,$5,$5,'parsed')", [excerpt.document_id, excerpt.source_id, excerpt.title, excerpt.published_at, excerpt.document_hash]);
    await db.query("insert into mentions (document_id,subject_kind,subject_id,prominence,confidence) values ($1::uuid,'issuer',$2::uuid,'body',1)", [excerpt.document_id, candidate.identity.issuer_id]);
  }
}
