import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";

import { persistCampaignQuotes } from "../../evidence/src/campaign-claims.ts";
import type { CampaignDocument } from "../../evidence/src/campaign-documents.ts";
import { hashJsonValue } from "../../observability/src/tool-call.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import { createDiscoveryDevApiAdapter } from "../../dev-api/src/discovery-adapter.ts";
import { createDevApiServer, createFixtureDevApiAdapters } from "../../dev-api/src/http.ts";
import { createAssessmentCommitter } from "../src/assessment-repo.ts";
import { createDiscoveryReadModel } from "../src/read-model.ts";
import { createDiscoveryRepository } from "../src/repository.ts";
import { createDiscoveryService } from "../src/service.ts";
import { canonicalCampaignQuotes } from "../src/quote-claims.ts";
import { createBraveSearchProvider } from "../src/providers/search.ts";
import { createCanonicalIdentityProvider } from "../src/providers/identity.ts";
import { createEvidenceProvider } from "../src/providers/evidence.ts";
import { createFinancialProvider } from "../src/providers/financials.ts";
import { stableUuid } from "../src/scout-support.ts";
import { parseBrief } from "../src/validation.ts";
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
  candidate: null | { candidate_id: string; lead_key: string; name: string; search_url: string; identity: CompanyIdentity; excerpts: EvidencePacket["excerpts"] };
  search_hits: Array<{ query_index: number; title: string; url: string; description: string }>;
  identities: CompanyIdentity[];
  financial_facts: EvidencePacket["facts"];
  financial_missing_fields: string[];
  role_responses: Partial<Record<"analyst" | "skeptic", { exposure: "weak" | "moderate" | "strong"; criterion_outcome: "pass" | "fail" | "unknown"; criterion_source: "primary" | "counter" }>>;
  operation_outcomes: Record<"search" | "identity" | "document" | "financial" | "model", string[]>;
  operation_order: string[];
  expected: { status: "completed"; states: Record<string, string>; ranks: Record<string, number>; unknown_valuation?: boolean; quote_cache_before_run?: boolean; famous_company_excluded?: boolean; counterevidence_excludes?: boolean; zero_qualified?: boolean };
  recorded_assessments?: Array<{ assessment_id: string; candidate_id: string; primary_source_id: string; counter_source_id: string }>;
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
  const packets = new Map<string, EvidencePacket>();
  const providerFailures: string[] = [];
  let runId: string | null = null;
  let quoteCountBeforeRun: number | null = null;
  let operationContract: FixtureOperationContract | null = null;
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
    // Full-path fixtures must enter through Scout's recorded web lead. Existing
    // evidence reuse is a distinct production path and is intentionally empty.
    loadExisting: async () => [],
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
    assert.ok(operationContract !== null, "a provider operation requires a started run");
    operationContract.consume(operationKey);
  }

  function strictProviders(): Providers {
    let activeSearch: { operation_key: string; candidate_id?: string } | null = null;
    const search = createBraveSearchProvider({
      apiKey: "recorded-fixture-key",
      now: clock.now,
      fetch: async () => {
        assert.ok(activeSearch !== null, "recorded search fetch must have an operation");
        const operation = activeSearch;
        expectedOperation(operation.operation_key);
        return new Response(JSON.stringify({
          web: { results: recordedSearchResults(fixture, operation.operation_key, runId) },
        }));
      },
    });
    const canonicalIdentity = createCanonicalIdentityProvider({
      lookup: {
        async findCached() { return []; },
        async discover(input) {
          try {
            expectedOperation(input.operation_key);
            const resolved = fixture.identities.filter((item) => item.ticker === input.query);
            assert.equal(resolved.length, 1, `fixture identity lookup must resolve ${input.query}`);
            await seedIdentityPrerequisite(db, resolved[0]!);
            return resolved.map((item) => ({ ...item, active: true }));
          } catch (error) {
            providerFailures.push(`identity ${input.query}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
          }
        },
      },
    });
    const evidence = createEvidenceProvider({
      documents: {
        async load() { return { documents: [], coverage_gaps: [] }; },
        async fetchAndStore(input, operations) {
          expectedOperation(input.operation_key);
          const candidate = fixtureCandidateForRuntimeId(fixture, runId, input.candidate_id);
          assert.ok(candidate !== null, `fixture has no recorded document for ${input.candidate_id ?? "unknown candidate"}`);
          const excerpt = candidate.excerpts.find((item) => item.url === input.url);
          assert.ok(excerpt, `unexpected recorded document ${input.url}`);
          return operations.run({
            key: input.operation_key, request_hash: input.request_hash, resource: "document", phase: input.phase, candidate_id: input.candidate_id,
            execute: async () => {
              await seedRecordedDocument(db, candidate.identity.issuer_id, excerpt);
              return campaignDocument(excerpt);
            },
          });
        },
      },
      candidates: {
        async find(input) {
          const candidate = fixtureCandidateForRuntimeId(fixture, runId, input.candidate.candidate_id);
          assert.ok(candidate !== null, `fixture candidate ${input.candidate.candidate_id} was not selected from a recorded lead`);
          return candidate.excerpts.map((excerpt) => ({
            url: excerpt.url, title: excerpt.title, published_at: excerpt.published_at,
            provider: "sec_edgar" as const, kind: "filing" as const,
          }));
        },
      },
    });
    const financials = createFinancialProvider({
      reader: {
        async readCached(input) {
          assert.ok(runId !== null);
          expectedOperation(`${runId}/research/${input.identity.issuer_id === fixture.candidate?.identity.issuer_id ? runtimeCandidateId(fixture, runId) : "unknown"}/financial`);
          return { facts: structuredClone(fixture.financial_facts), missing_fields: [...fixture.financial_missing_fields], coverage_gaps: fixture.financial_missing_fields.length === 0 ? [] : ["valuation_unknown"] };
        },
      },
    });
    return {
      search: {
        async search(input, operations) {
          activeSearch = { operation_key: input.operation_key, candidate_id: input.candidate_id };
          try { return await search.search(input, operations); }
          finally { activeSearch = null; }
        },
      },
      identity: canonicalIdentity,
      evidence: {
        async acquire(input, operations) {
          const packet = await evidence.acquire(input, operations);
          packets.set(packet.candidate_id, packet);
          return packet;
        },
      },
      financials,
    };
  }

  function strictModel(_lease: Parameters<WorkerDeps["model"]>[0], operations: Parameters<WorkerDeps["model"]>[1]): CampaignModel {
    return {
      async complete(input) {
        expectedOperation(input.operation_key);
        const response = input.role === "scout"
          ? scoutResponse(fixture)
          : responseFor(input.role, fixture, packets.get(input.candidate_id ?? ""));
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
      operationContract = createFixtureOperationContract(fixture, runId);
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
          if (["completed", "partial", "failed", "cancelled"].includes(run.status)) {
            assert.deepEqual(providerFailures, [], "recorded provider adapter failures");
            return;
          }
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
      const candidate = candidates.find((item) => item.candidate_id === runtimeCandidateId(fixture, runId!));
      assert.ok(candidate, "fixture candidate is identifiable by canonical issuer identity");
      const expectedHit = fixture.search_hits.find((hit) => hit.url === fixture.candidate.search_url)!;
      const provenance = await db.query<{ origins: string[]; lead_hit_ids: string[] }>(
        "select origins,lead_hit_ids from discovery_candidates where run_id=$1::uuid and candidate_id=$2::uuid",
        [runId, candidate.candidate_id],
      );
      assert.equal(provenance.rowCount, 1);
      assert.deepEqual(provenance.rows[0]!.origins, ["web"], "candidate is admitted from the recorded web lead, never existing evidence");
      assert.deepEqual(provenance.rows[0]!.lead_hit_ids, [searchHitId(fixture, expectedHit)]);
      const identityAttempts = await db.query<{ outcome: string }>(
        "select outcome from discovery_attempts where run_id=$1::uuid and operation_key=$2 and resource='identity' order by attempt_number",
        [runId, `${runId}/discovery/${candidate.candidate_id}/identity`],
      );
      assert.deepEqual(identityAttempts.rows, [{ outcome: "success" }], "recorded canonical identity resolution is metered");
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
      assert.ok(operationContract !== null);
      operationContract.assertComplete();
    },
    async assertOperationContractRejectsWrongCandidateAndDuplicate() {
      assert.ok(runId !== null && operationContract !== null && fixture.candidate !== null);
      const valid = `${runId}/discovery/pool/search/0`;
      const wrong = `${runId}/research/${stableUuid("wrong fixture candidate")}/evidence/document/0`;
      assert.throws(() => operationContract!.consume(wrong), /unexpected fixture operation/);
      operationContract.consume(valid);
      assert.throws(() => operationContract!.consume(valid), /duplicate or over-count fixture operation/);
    },
    async assertForeignUserDenied() {
      assert.ok(runId !== null);
      const response = await api(`/v1/discovery/runs/${runId}`, {}, FOREIGN_USER);
      assert.equal(response.status, 404);
    },
  });
}

function isoTimestamp(value: unknown): string {
  const date = new Date(String(value));
  assert.ok(Number.isFinite(date.getTime()), `expected timestamp, received ${String(value)}`);
  return date.toISOString();
}

function scoutResponse(fixture: Fixture): unknown {
  if (fixture.candidate === null) return { hit_ids: [], seeds: [] };
  const selected = fixture.search_hits.find((hit) => hit.url === fixture.candidate!.search_url);
  assert.ok(selected, "fixture candidate must point to a recorded search hit");
  return { hit_ids: [searchHitId(fixture, selected)], seeds: [] };
}

function responseFor(role: "planner" | "analyst" | "skeptic" | "summary", fixture: Fixture, packet: EvidencePacket | undefined): unknown {
  assert.ok(fixture.candidate !== null, `unsupported fixture cannot call ${role}`);
  assert.ok(packet, `recorded evidence packet is required for ${role}`);
  const [primary, counter] = packet.excerpts;
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
  return validateFixture(JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")), name);
}

export async function recordedFixtureAssessments() {
  const fixtures: FixtureName[] = ["power-infrastructure", "industrial-automation", "supply-disruption"];
  return (await Promise.all(fixtures.map(loadFixture))).flatMap((fixture) => fixture.recorded_assessments ?? []);
}

/**
 * Fixtures are untrusted input too. Production owns brief/search/identity/
 * evidence parsing, so this loader invokes those boundaries where they exist
 * and applies the same narrow shape checks to recorded transport payloads that
 * have no production wire parser.
 */
function validateFixture(value: unknown, name: FixtureName): Fixture {
  const root = fixtureRecord(value, "fixture", [
    "fixture", "question", "brief", "candidate", "search_hits", "identities", "financial_facts", "financial_missing_fields",
    "role_responses", "operation_outcomes", "operation_order", "expected", "recorded_assessments",
  ]);
  assert.equal(root.fixture, name, "fixture name");
  const question = fixtureText(root.question, "fixture.question", 20, 4_000);
  const brief = parseBrief(root.brief);
  assert.equal(brief.question, question, "fixture question must be the production-validated brief question");
  const search_hits = fixtureArray(root.search_hits, "fixture.search_hits").map((raw, index) => {
    const hit = fixtureRecord(raw, `fixture.search_hits[${index}]`, ["query_index", "title", "url", "description"]);
    assert.ok(Number.isInteger(hit.query_index) && (hit.query_index as number) >= 0 && (hit.query_index as number) < brief.queries.length, `fixture.search_hits[${index}].query_index`);
    const url = fixtureHttps(hit.url, `fixture.search_hits[${index}].url`);
    return { query_index: hit.query_index as number, title: fixtureText(hit.title, `fixture.search_hits[${index}].title`, 1, 500), url, description: fixtureText(hit.description, `fixture.search_hits[${index}].description`, 0, 1_000) };
  });
  for (const index of brief.queries.keys()) assert.ok(search_hits.some((hit) => hit.query_index === index), `fixture must record a valid search result for query ${index}`);

  const identities = fixtureArray(root.identities, "fixture.identities").map((raw, index) => fixtureIdentity(raw, `fixture.identities[${index}]`));
  const candidate = root.candidate === null ? null : fixtureCandidate(root.candidate, "fixture.candidate");
  if (candidate === null) assert.equal(identities.length, 0, "empty fixture cannot declare identities");
  else {
    assert.ok(search_hits.some((hit) => hit.url === candidate.search_url), "fixture candidate must originate in a recorded search hit");
    assert.ok(identities.some((identity) => identity.issuer_id === candidate.identity.issuer_id && identity.listing_id === candidate.identity.listing_id), "fixture candidate identity must be a recorded identity response");
  }
  const financial_facts = fixtureArray(root.financial_facts, "fixture.financial_facts") as EvidencePacket["facts"];
  const financial_missing_fields = fixtureArray(root.financial_missing_fields, "fixture.financial_missing_fields").map((field, index) => fixtureText(field, `fixture.financial_missing_fields[${index}]`, 1, 120));
  const role_responses = fixtureRoleResponses(root.role_responses);
  const operation_outcomes = fixtureOperationOutcomes(root.operation_outcomes);
  const operation_order = fixtureArray(root.operation_order, "fixture.operation_order").map((entry, index) => fixtureText(entry, `fixture.operation_order[${index}]`, 1, 300));
  const expected = fixtureExpected(root.expected);
  const recorded_assessments = root.recorded_assessments === undefined ? undefined : fixtureAssessments(root.recorded_assessments, candidate);
  const fixture = { fixture: name, question, brief, candidate, search_hits, identities, financial_facts, financial_missing_fields, role_responses, operation_outcomes, operation_order, expected, recorded_assessments } satisfies Fixture;
  if (candidate !== null) assert.equal(candidate.lead_key, `hit:${searchHitId(fixture, search_hits.find((hit) => hit.url === candidate.search_url)!)}`, "fixture candidate lead_key is grounded in the recorded search hit");
  return fixture;
}

function fixtureCandidate(value: unknown, label: string): NonNullable<Fixture["candidate"]> {
  const candidate = fixtureRecord(value, label, ["candidate_id", "lead_key", "name", "search_url", "identity", "excerpts"]);
  const identity = fixtureIdentity(candidate.identity, `${label}.identity`);
  const excerpts = fixtureArray(candidate.excerpts, `${label}.excerpts`).map((raw, index) => fixtureExcerpt(raw, `${label}.excerpts[${index}]`));
  assert.equal(excerpts.length, 2, `${label}.excerpts requires a primary and counter source`);
  return {
    candidate_id: fixtureUuid(candidate.candidate_id, `${label}.candidate_id`), lead_key: fixtureText(candidate.lead_key, `${label}.lead_key`, 1, 600),
    name: fixtureText(candidate.name, `${label}.name`, 1, 500), search_url: fixtureHttps(candidate.search_url, `${label}.search_url`), identity, excerpts,
  };
}

function fixtureExcerpt(value: unknown, label: string): EvidencePacket["excerpts"][number] {
  const excerpt = fixtureRecord(value, label, ["excerpt_id", "document_id", "source_id", "family_key", "title", "url", "published_at", "retrieved_at", "document_hash", "normalized_start", "text", "primary", "primary_eligible"]);
  assert.ok(excerpt.published_at === null || typeof excerpt.published_at === "string" && Number.isFinite(Date.parse(excerpt.published_at)), `${label}.published_at`);
  assert.ok(Number.isInteger(excerpt.normalized_start) && (excerpt.normalized_start as number) >= 0, `${label}.normalized_start`);
  assert.equal(excerpt.primary, true, `${label}.primary`);
  assert.equal(excerpt.primary_eligible, true, `${label}.primary_eligible`);
  return {
    excerpt_id: fixtureUuid(excerpt.excerpt_id, `${label}.excerpt_id`), document_id: fixtureUuid(excerpt.document_id, `${label}.document_id`), source_id: fixtureUuid(excerpt.source_id, `${label}.source_id`),
    family_key: fixtureText(excerpt.family_key, `${label}.family_key`, 1, 300), title: fixtureText(excerpt.title, `${label}.title`, 1, 500), url: fixtureHttps(excerpt.url, `${label}.url`),
    published_at: excerpt.published_at as string | null, retrieved_at: fixtureTimestamp(excerpt.retrieved_at, `${label}.retrieved_at`), document_hash: fixtureText(excerpt.document_hash, `${label}.document_hash`, 8, 200),
    normalized_start: excerpt.normalized_start as number, text: fixtureText(excerpt.text, `${label}.text`, 8, 8_000), primary: true, primary_eligible: true,
  };
}

function fixtureIdentity(value: unknown, label: string): CompanyIdentity {
  const identity = fixtureRecord(value, label, ["issuer_id", "listing_id", "legal_name", "ticker", "mic", "currency", "asset_type", "identity_source_ids"]);
  assert.ok(identity.asset_type === "common_stock" || identity.asset_type === "adr", `${label}.asset_type`);
  const ids = fixtureArray(identity.identity_source_ids, `${label}.identity_source_ids`).map((item, index) => fixtureUuid(item, `${label}.identity_source_ids[${index}]`));
  return {
    issuer_id: fixtureUuid(identity.issuer_id, `${label}.issuer_id`), listing_id: fixtureUuid(identity.listing_id, `${label}.listing_id`), legal_name: fixtureText(identity.legal_name, `${label}.legal_name`, 1, 500),
    ticker: fixtureText(identity.ticker, `${label}.ticker`, 1, 10), mic: fixtureText(identity.mic, `${label}.mic`, 4, 4), currency: fixtureText(identity.currency, `${label}.currency`, 3, 3), asset_type: identity.asset_type, identity_source_ids: ids,
  };
}

function fixtureRoleResponses(value: unknown): Fixture["role_responses"] {
  const roles = fixtureRecord(value, "fixture.role_responses", ["analyst", "skeptic"]);
  const result: Fixture["role_responses"] = {};
  for (const role of ["analyst", "skeptic"] as const) {
    if (roles[role] === undefined) continue;
    const response = fixtureRecord(roles[role], `fixture.role_responses.${role}`, ["exposure", "criterion_outcome", "criterion_source"]);
    assert.ok(response.exposure === "weak" || response.exposure === "moderate" || response.exposure === "strong", `${role}.exposure`);
    assert.ok(response.criterion_outcome === "pass" || response.criterion_outcome === "fail" || response.criterion_outcome === "unknown", `${role}.criterion_outcome`);
    assert.ok(response.criterion_source === "primary" || response.criterion_source === "counter", `${role}.criterion_source`);
    result[role] = response as Fixture["role_responses"][typeof role];
  }
  return result;
}

function fixtureOperationOutcomes(value: unknown): Fixture["operation_outcomes"] {
  const outcomes = fixtureRecord(value, "fixture.operation_outcomes", ["search", "identity", "document", "financial", "model"]);
  return Object.fromEntries(Object.entries(outcomes).map(([key, values]) => [key, fixtureArray(values, `fixture.operation_outcomes.${key}`).map((entry, index) => fixtureText(entry, `fixture.operation_outcomes.${key}[${index}]`, 1, 300))])) as Fixture["operation_outcomes"];
}

function fixtureExpected(value: unknown): Fixture["expected"] {
  const expected = fixtureRecord(value, "fixture.expected", ["status", "states", "ranks", "unknown_valuation", "quote_cache_before_run", "famous_company_excluded", "counterevidence_excludes", "zero_qualified"]);
  assert.equal(expected.status, "completed", "fixture.expected.status");
  const states = fixtureDictionary(expected.states, "fixture.expected.states");
  const ranks = fixtureDictionary(expected.ranks, "fixture.expected.ranks");
  for (const [key, state] of Object.entries(states)) { fixtureUuid(key, "fixture.expected.states key"); assert.ok(typeof state === "string"); }
  for (const [key, rank] of Object.entries(ranks)) { fixtureUuid(key, "fixture.expected.ranks key"); assert.ok(Number.isInteger(rank) && (rank as number) > 0); }
  for (const key of ["unknown_valuation", "quote_cache_before_run", "famous_company_excluded", "counterevidence_excludes", "zero_qualified"] as const) if (expected[key] !== undefined) assert.equal(typeof expected[key], "boolean", `fixture.expected.${key}`);
  return expected as Fixture["expected"];
}

function fixtureAssessments(value: unknown, candidate: Fixture["candidate"]): NonNullable<Fixture["recorded_assessments"]> {
  const assessments = fixtureArray(value, "fixture.recorded_assessments").map((raw, index) => {
    const entry = fixtureRecord(raw, `fixture.recorded_assessments[${index}]`, ["assessment_id", "candidate_id", "primary_source_id", "counter_source_id"]);
    return { assessment_id: fixtureText(entry.assessment_id, `fixture.recorded_assessments[${index}].assessment_id`, 4, 160), candidate_id: fixtureText(entry.candidate_id, `fixture.recorded_assessments[${index}].candidate_id`, 4, 160), primary_source_id: fixtureUuid(entry.primary_source_id, `fixture.recorded_assessments[${index}].primary_source_id`), counter_source_id: fixtureUuid(entry.counter_source_id, `fixture.recorded_assessments[${index}].counter_source_id`) };
  });
  assert.ok(candidate !== null || assessments.length === 0, "empty fixture cannot declare review assessments");
  const ids = new Set(assessments.map((entry) => entry.assessment_id));
  assert.equal(ids.size, assessments.length, "fixture review assessment IDs must be unique");
  const candidateIds = new Set(assessments.map((entry) => entry.candidate_id));
  assert.equal(candidateIds.size, assessments.length, "fixture review candidate IDs must be unique");
  if (candidate !== null) {
    const sourceIds = new Set(candidate.excerpts.map((excerpt) => excerpt.source_id));
    for (const assessment of assessments) {
      assert.ok(sourceIds.has(assessment.primary_source_id), "fixture review primary source must be recorded");
      assert.ok(sourceIds.has(assessment.counter_source_id), "fixture review counter source must be recorded");
    }
  }
  return assessments;
}

function fixtureRecord(value: unknown, label: string, allowed: readonly string[]): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) assert.ok(allowed.includes(key), `${label}.${key} is not allowed`);
  return record;
}
function fixtureDictionary(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}
function fixtureArray(value: unknown, label: string): unknown[] { assert.ok(Array.isArray(value), `${label} must be an array`); return value; }
function fixtureText(value: unknown, label: string, min: number, max: number): string { assert.ok(typeof value === "string" && value === value.trim() && value.length >= min && value.length <= max, `${label} is invalid`); return value; }
function fixtureUuid(value: unknown, label: string): string { const text = fixtureText(value, label, 36, 36); assert.match(text, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu, label); return text; }
function fixtureTimestamp(value: unknown, label: string): string { const text = fixtureText(value, label, 20, 40); assert.ok(Number.isFinite(Date.parse(text)), `${label} is invalid`); return text; }
function fixtureHttps(value: unknown, label: string): string { const text = fixtureText(value, label, 12, 2_000); const url = new URL(text); assert.equal(url.protocol, "https:", label); assert.equal(url.username, "", label); assert.equal(url.password, "", label); return url.toString(); }

class FixtureOperationContract {
  readonly calls: string[] = [];
  readonly expected: string[];
  readonly expectedCounts: Map<string, number>;
  readonly actualCounts = new Map<string, number>();
  readonly runId: string;

  constructor(fixture: Fixture, runId: string) {
    this.runId = runId;
    this.expected = fixture.operation_order.map((operation) => concreteOperation(fixture, runId, operation));
    this.expectedCounts = counts(this.expected);
    const categorized = Object.values(fixture.operation_outcomes).flat().map((operation) => concreteOperation(fixture, runId, operation));
    assert.deepEqual(counts(categorized), this.expectedCounts, "fixture operation_order must be the exact declared operation multiset");
  }

  consume(operationKey: string): void {
    const prefix = `${this.runId}/`;
    assert.ok(operationKey.startsWith(prefix), `unexpected fixture operation ${operationKey}`);
    const suffix = operationKey.slice(prefix.length);
    const expected = this.expectedCounts.get(suffix) ?? 0;
    const actual = this.actualCounts.get(suffix) ?? 0;
    assert.ok(expected > 0, `unexpected fixture operation ${suffix}`);
    assert.ok(actual < expected, `duplicate or over-count fixture operation ${suffix}`);
    this.actualCounts.set(suffix, actual + 1);
    this.calls.push(suffix);
  }

  assertComplete(): void {
    assert.deepEqual(this.actualCounts, this.expectedCounts, "fixture operation multiset must be exact");
    assert.deepEqual(this.calls, this.expected, "fixture operation order must be exact");
  }
}

function createFixtureOperationContract(fixture: Fixture, runId: string): FixtureOperationContract {
  return new FixtureOperationContract(fixture, runId);
}

function counts(values: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function concreteOperation(fixture: Fixture, runId: string, operation: string): string {
  if (!operation.includes("{candidate_id}")) return operation;
  assert.ok(fixture.candidate !== null, "empty fixture cannot declare candidate operation");
  return operation.replaceAll("{candidate_id}", runtimeCandidateId(fixture, runId));
}

function runtimeCandidateId(fixture: Fixture, runId: string): string {
  assert.ok(fixture.candidate !== null, "empty fixture has no runtime candidate");
  const hit = fixture.search_hits.find((item) => item.url === fixture.candidate!.search_url);
  assert.ok(hit, "fixture candidate search URL is not recorded");
  return stableUuid(`discovery-candidate\u0000${runId}\u0000hit:${searchHitId(fixture, hit)}`);
}

function fixtureCandidateForRuntimeId(fixture: Fixture, runId: string | null, candidateId: string | undefined) {
  if (fixture.candidate === null || runId === null || candidateId !== runtimeCandidateId(fixture, runId)) return null;
  return fixture.candidate;
}

function recordedSearchResults(fixture: Fixture, operationKey: string, runId: string | null): Array<{ title: string; url: string; description: string }> {
  assert.ok(runId !== null, "recorded search requires a run id");
  const suffix = operationKey.slice(`${runId}/`.length);
  const index = suffix.startsWith("discovery/pool/search/") ? Number(suffix.slice("discovery/pool/search/".length)) : 0;
  assert.ok(Number.isInteger(index) && index >= 0, `recorded search operation is invalid: ${suffix}`);
  return fixture.search_hits.filter((hit) => hit.query_index === index).map(({ title, url, description }) => ({ title, url, description }));
}

function searchHitId(fixture: Fixture, hit: Fixture["search_hits"][number]): string {
  const index = fixture.search_hits.filter((item) => item.query_index === hit.query_index).findIndex((item) => item.url === hit.url);
  assert.ok(index >= 0, "recorded search hit must retain its result order");
  return stableUuid(`${hit.query_index}\u0000${index}\u0000${new URL(hit.url).toString()}`);
}

function campaignDocument(excerpt: EvidencePacket["excerpts"][number]): CampaignDocument {
  return Object.freeze({
    document_id: excerpt.document_id, source_id: excerpt.source_id, family_key: excerpt.family_key,
    title: excerpt.title, url: excerpt.url, published_at: excerpt.published_at, retrieved_at: excerpt.retrieved_at,
    document_hash: excerpt.document_hash, normalized_text: excerpt.text, primary: excerpt.primary,
    primary_eligible: excerpt.primary_eligible, claims: [],
  });
}

async function seedIdentityPrerequisite(db: { query: Function }, identity: CompanyIdentity): Promise<void> {
  const instrumentId = randomUUID();
  await db.query("insert into issuers (issuer_id,legal_name,former_names) values ($1::uuid,$2,'[]'::jsonb) on conflict (issuer_id) do nothing", [identity.issuer_id, identity.legal_name]);
  await db.query("insert into instruments (instrument_id,issuer_id,asset_type) values ($1::uuid,$2::uuid,$3) on conflict (instrument_id) do nothing", [instrumentId, identity.issuer_id, identity.asset_type]);
  await db.query("insert into listings (listing_id,instrument_id,mic,ticker,trading_currency,timezone) values ($1::uuid,$2::uuid,$3,$4,$5,'America/New_York') on conflict (listing_id) do nothing", [identity.listing_id, instrumentId, identity.mic, identity.ticker, identity.currency]);
}

async function seedRecordedDocument(db: { query: Function }, issuerId: string, excerpt: EvidencePacket["excerpts"][number]): Promise<void> {
  await db.query("insert into sources (source_id,provider,kind,canonical_url,trust_tier,license_class,retrieved_at) values ($1::uuid,'sec_edgar','filing',$2,'primary','test',$3::timestamptz) on conflict (source_id) do nothing", [excerpt.source_id, excerpt.url, excerpt.retrieved_at]);
  await db.query("insert into documents (document_id,source_id,kind,title,published_at,content_hash,raw_blob_id,parse_status) values ($1::uuid,$2::uuid,'filing',$3,$4::timestamptz,$5,$5,'parsed') on conflict (document_id) do nothing", [excerpt.document_id, excerpt.source_id, excerpt.title, excerpt.published_at, excerpt.document_hash]);
  await db.query("insert into mentions (document_id,subject_kind,subject_id,prominence,confidence) values ($1::uuid,'issuer',$2::uuid,'body',1) on conflict do nothing", [excerpt.document_id, issuerId]);
}
