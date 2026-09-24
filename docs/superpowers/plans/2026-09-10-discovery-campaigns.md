# Discovery Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an approved US-listed thematic investment question into a sourced, challenged, reproducible shortlist of research opportunities, with an understandable agent activity trail.

**Architecture:** A dedicated `services/discovery` package owns campaign briefs, bounded research runs, candidate decisions and durable checkpoints. Reuse the resolver, evidence, financial facts, snapshots and model router; extend the router with optional per-provider-attempt controls. A database-leased worker executes bounded stages independently of the browser; protected web routes expose progress, evidence and existing analysis/thesis handoffs.

**Tech Stack:** Node.js >=22.19.0, TypeScript with explicit `.ts` imports, PostgreSQL/pg, existing React/Vite UI, native fetch and existing test tooling.

**Spec:** [Approved discovery campaign design](../specs/2026-09-10-discovery-campaigns-design.md).

**Contract companion:** [Types, interfaces and policy decisions](2026-09-10-discovery-campaigns-contracts.md). Read both documents before executing any task. Names in the companion are binding integration contracts, not pseudonymous suggestions.

**Baseline:** `c12529e` on main; PR #107 is included. Refresh main before implementation and adapt insertion points if files moved. Do not reuse the unrelated dirty `feat/13f-amendments` checkout.

## Global Constraints

- Node.js >=22.19.0; TypeScript with explicit `.ts` imports; PostgreSQL; existing React/Vite UI.
- No new agent framework, message broker, vector database, search SDK, or browser automation dependency.
- Keep domain types browser-safe and canonical; do not duplicate DTOs in the web app.
- New modules should stay focused, normally below 400 lines; do not grow existing giant API/runtime files with inline campaign logic.
- Unique candidates / researched / shortlisted: 100 / 25 / 10.
- External search attempts: 80. Document fetch attempts: 150; at most six documents per company. Identity lookup attempts: 120. Financial-provider attempts: 50. Model provider attempts: 64.
- Model request input / output: **64,000 input characters / 10,000 output tokens**. Input measurement is `JSON.stringify(messages).length`; limits include system messages. Output is a ceiling, not a verbosity target.
- Individual external request: 30 seconds. Whole run: 45 minutes from start; includes downtime. One active run per user; one company evaluation at a time in v1.
- No hard-dollar guarantee. No silently reduced output ceiling when a provider cannot support it; surface provider/configuration failure and retain completed work.
- Every retry, repair and fallback is a paid-attempt boundary. Persist reservations before dispatch; missing outcome never refunds a reservation.
- Search snippets are leads, never sufficient primary evidence. Unknown financial values never become zero, favorable scores or invented numerical conditions.
- Respect ownership and current source visibility on result reads, activity, exports, inspection and handoff.
- This task produced documents only. Executing this plan is a separate user instruction.

## Work allocation and integration order

| Task | Deliverable | Depends on | Exclusive file ownership |
|---|---|---|---|
| 1 | Domain contracts, schema and repository | — | discovery types/ports/validation/repositories; migration; schema mirror |
| 2 | Metered provider calls and model controls | 1 | discovery budget/attempt/model modules; llm router/adapter |
| 3 | Search, identity and evidence acquisition | 1, 2 | discovery provider adapters; evidence campaign acquisition/claim input boundary |
| 4 | Discovery pool and fair research cohort | 1, 3 | discovery scout and cohort modules |
| 5 | Analyst, Skeptic, gates and snapshots | 1, 2, 3 | discovery assessment/prompt/selection/seal modules |
| 6 | Durable run execution and recovery | 1, 2, 4, 5 | discovery worker/runner/stages/CLI |
| 7 | API, visibility and deletion | 1, 6 | discovery service/http/read-model/lifecycle; dev-api wiring; inspector/blob GC |
| 8 | Campaign UI, drafts and live results | 1; 7 for integration | discovery UI/api; App routes; sidebar |
| 9 | Research trail, exports and handoffs | 5, 7, 8 | discovery learning/export/handoff; existing handoff/AgentsPage integration |
| 10 | End-to-end fixtures, release and operations | 1–9 | integration/evaluation fixtures; CI; dev-shell; operator docs; CONTEXT |

Parallelism: after Task 1, Task 8 may build against the shared DTO contract while Tasks 2–3 establish providers. After Task 3, Tasks 4 and 5 can run independently. Task 7 owns all edits to the large dev API; Task 9 alone edits the existing thesis-handoff flow. Contract changes must land in Task 1's files before consumers adopt them. Each worker reads its dependencies' commits, returns changed files/test evidence/limitations, and does not edit another task's files without coordination.

Use one task-sized commit or small coherent commits per task. Before starting each task, create/claim a `bd` issue linked to the implementation epic; this planning issue is `fra-svlk`. Do not start all workers against mutable, unpublished DTOs. Review each task before dependent work lands; integrate each passing vertical slice into a shared implementation branch. No live providers or paid calls in CI.

## Shared test setup

Task 1 creates `services/discovery/test/fixtures.ts` with these concrete fixtures and exports `briefFixture`, `identityFixture`, `packetFixture`, `analystFixture`, `skepticFixture`. All use stable UUIDs; no real company claims or live ticker expectations.

```ts
export const IDS = {
  user: '10000000-0000-4000-8000-000000000001',
  other: '10000000-0000-4000-8000-000000000002',
  issuer: '20000000-0000-4000-8000-000000000001',
  listing: '30000000-0000-4000-8000-000000000001',
  mechanism: '40000000-0000-4000-8000-000000000001',
  criterion: '50000000-0000-4000-8000-000000000001',
  document: '60000000-0000-4000-8000-000000000001',
  source: '70000000-0000-4000-8000-000000000001',
  claim: '80000000-0000-4000-8000-000000000001',
};
```

The fixture company is “Example Grid Components”; its synthetic primary excerpt is “We manufacture transformers used by electric utilities. Grid equipment is our principal business.” Its synthetic counterexample is “Customer investment can be delayed by permitting constraints.” Mark the fixtures as synthetic in metadata. Task 1's packet factory contains both excerpts from the same document, published 2026-09-01, retrieved 2026-09-10, and no financial facts. Task 5 adds a second distinct document when testing strong evidence. The criterion is “The company sells equipment used to expand electricity supply,” with falsifier “The company's products have no documented electricity infrastructure use.” Create a second mechanism in `briefFixture` (backup-power equipment) so the 2–4 mechanism validator is exercised. Analyst and Skeptic fixtures both pass that narrative criterion with citations to the first excerpt; quality and valuation remain unknown. Factories return fresh objects, not shared mutable singletons.

Task 1 also creates `test/db-fixture.ts` exporting `withCampaignDb(t)` → `{db,pool,repo,userId,otherUserId,clock,createApprovedRun}` using `db/test/docker-pg.ts`. Seed two users; `createApprovedRun(brief=briefFixture())` creates a campaign, saves version 1, and starts with a fresh UUID request key, returning `{campaign,brief,run}`. Inject `clock` fixed at `2026-09-10T12:00:00.000Z`. Use `registerLifoCleanup`; tests skip only when Docker is unavailable. Tests needing issuer/listing rows seed them using existing resolver integration patterns, never fake foreign keys.

## Task 1: Versioned campaign domain and transactional repository

**Files:**
- Create `services/discovery/package.json`, `src/types.ts`, `src/ports.ts`, `src/validation.ts`, `src/policy.ts`.
- Create `src/campaign-repo.ts`, `src/run-repo.ts`, `src/candidate-repo.ts`, `src/attempt-repo.ts`, `src/event-repo.ts`, `src/repository.ts`.
- Create `db/migrations/0040_discovery_campaigns.up.sql` and `.down.sql`; modify `spec/finance_research_db_schema.sql` to mirror the migration. If 0040 was used meanwhile, choose the next unused number and change every reference in the task branch.
- Create `services/discovery/test/fixtures.ts`, `test/db-fixture.ts`, `test/validation.test.ts`, `test/repository.integration.test.ts`, `db/test/discovery-schema.test.ts`.

**Interfaces:** Copy public types and repository method signatures from the contract companion. `createDiscoveryRepository(db, {clock})` returns `DiscoveryRepository`; repositories use the existing transaction helper and parameterized SQL. `parseBrief(value)` and `validateModelRequest(messages,maxTokens)` are the only authoritative validators for those shapes.

- [ ] Write concrete validation tests first:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBrief, validateModelRequest } from '../src/validation.ts';
import { briefFixture } from './fixtures.ts';
test('briefs reject unsupported scope and model requests enforce approved ceilings', () => {
  assert.throws(() => parseBrief({...briefFixture(), market: 'global'}));
  assert.throws(() => parseBrief({...briefFixture(), mechanisms: []}));
  assert.throws(() => validateModelRequest([{role:'user',content:'x'.repeat(64_000)}],10_000));
  assert.doesNotThrow(() => validateModelRequest([{role:'user',content:'x'.repeat(63_900)}],10_000));
  assert.throws(() => validateModelRequest([{role:'user',content:'ok'}],10_001));
});
```

- [ ] Run `node --experimental-strip-types --test services/discovery/test/validation.test.ts`; expect missing exports before implementation.
- [ ] Implement the companion's parsers, defaults, DTOs and six tables. Core SQL constraints must include:

```sql
-- Within the full table definitions described by the companion:
-- campaigns: UNIQUE(campaign_id,user_id)
-- briefs: UNIQUE(campaign_id,version), UNIQUE(brief_id,campaign_id)
-- runs: FK(campaign_id,user_id) → campaigns; FK(brief_id,campaign_id) → briefs
create unique index discovery_one_active_run_per_user
  on discovery_runs(user_id) where status in ('queued','running');
create unique index discovery_request_identity on discovery_runs(campaign_id,request_key);
create unique index discovery_candidate_issuer on discovery_candidates(run_id,issuer_id)
  where issuer_id is not null;
create unique index discovery_candidate_lead on discovery_candidates(run_id,lead_key);
create unique index discovery_shortlist_rank on discovery_candidates(run_id,rank)
  where rank is not null;
-- CHECK(rank IS NULL OR rank BETWEEN 1 AND 10)
-- attempts: UNIQUE(campaign_id,operation_key,attempt_number)
-- events: UNIQUE(run_id,sequence)
```

- [ ] Implement optimistic saves under a campaign row lock; `expected_version=0` creates version 1. Starting locks the owner user row and campaign, checks exact current version/hash, sets approved_at if absent, inserts the immutable run, and returns an existing matching request key without approving another version. Reject reuse of a key with different brief data. Lock the run for candidate admission, event sequence allocation and attempt reservation. Network calls never run in these transactions.
- [ ] Add database tests for two concurrent starts by one user across different campaigns (one wins), identical repeated starts (same run), stale brief hash/version (409), foreign ownership (404), candidate 101 rejection, duplicate issuer merge, lease-epoch mismatch and approval immutability. Example:

```ts
test('a stale editor cannot replace an approved brief', dbOptions, async t => {
  const {repo,createApprovedRun,userId} = await withCampaignDb(t);
  const {campaign,brief} = await createApprovedRun();
  await repo.saveBrief(userId,campaign.campaign_id,brief.version,briefFixture());
  await assert.rejects(repo.saveBrief(userId,campaign.campaign_id,brief.version,briefFixture()), {code:'stale_brief'});
  assert.deepEqual((await repo.getBrief(userId,brief.brief_id)).brief,brief.brief);
});
```

`dbOptions` is exported by `db-fixture.ts` as `{skip: !dockerAvailable(),timeout:120_000}`. All database examples import it and `withCampaignDb` from that file.
- [ ] Run the new validation/repository/schema tests and existing migration registry tests. Verify fresh-schema and migrated-schema paths both contain the six tables/constraints. Down migration removes only discovery-owned objects.
- [ ] Commit: `git add services/discovery db/migrations/0040_discovery_campaigns.* db/test/discovery-schema.test.ts spec/finance_research_db_schema.sql && git commit -m 'feat(discovery): add versioned campaigns and durable run storage'`.

## Task 2: Attempt accounting, timeouts and bounded model execution

**Files:** Create `services/discovery/src/budget.ts`, `src/operations.ts`, `src/model.ts`, `test/budget.integration.test.ts`, `test/model.test.ts`, `test/fake-operations.ts`; modify `services/llm/src/router.ts`, `src/pi-adapter.ts` and their existing tests.

**Interfaces:** Produce `createOperationRunner(repo,lease,signal): OperationRunner` and `createCampaignModel(router,operations): CampaignModel` from the companion. Add `complete(request, controls?: LlmExecutionControls)` to the existing router, preserving every existing one-argument call.

- [ ] Write tests for actual fallback accounting before edits. Use existing router test settings with two enabled deployments and a fake client that fails the first. Add this assertion pattern:

```ts
const dispatched: string[] = [];
const reservations: number[] = [];
const router = createLlmRouter({settings: settings(), client: async d => {
  dispatched.push(d.model); throw new Error('transient');
}});
await assert.rejects(router.complete({messages:[{role:'user',content:'test'}]}, {
  maxAttempts: 2,
  beforeAttempt: async ({index}) => { reservations.push(index); if(index === 1) throw new Error('budget'); },
}));
assert.equal(dispatched.length,1);
assert.deepEqual(reservations,[0,1]);
```

Place this test in `services/llm/test/router.test.ts`, where the existing `settings()` fixture supplies the enabled deployments; do not invent a second settings parser. The hook rejection happens outside provider-error recovery, so it cannot trigger another provider fallback.
- [ ] Run new router/budget tests; confirm the second provider currently executes or the controls API is absent.
- [ ] Implement the optional controls contract: run `beforeAttempt` outside the provider catch block, propagate AbortSignal to the actual Pi client, cap the number of deployments tried, and stop dispatch on abort/budget/lease failures. `maxAttempts=2` covers original plus one retry/fallback; no caller retry loop around an already-two-attempt router operation. Record provider outcome separately from control-hook failures. Do not merely Promise.race an uncancellable request and call it aborted.
- [ ] Implement atomic reservation: lock run, check lease/epoch/cancellation/deadline and resource/sub-budget, insert unique attempt, increment usage, commit, then dispatch. A duplicate completed operation loads stored result; a reserved operation after crash becomes unknown and consumes its unit. Recovery can create attempt_number=2 only; otherwise mark operation exhausted. The persisted result must be available before advancing the stage checkpoint.
- [ ] Enforce all request-size/call caps, not just model counts. Reserve at least two initial model attempts for every not-yet-assessed selected company before allowing optional repairs/summaries to spend remaining capacity; do not count a logical Analyst pass twice. Draft attempts use campaign-level lease/rate limits, not run budgets. Output parser caps are independent of the provider token ceiling; oversize structured JSON fails visibly and may consume the one allowed repair.
- [ ] Add real-DB tests: race for last budget slot → exactly one provider dispatch; fallback consumes two units; fail after reservation → no refund; duplicate operation resumes cached output; deadline includes downtime; >64,000 input is rejected without reservation; 10,000 maxTokens reaches the client unchanged; 10,001 is rejected. Add AbortSignal tests at router and Pi boundaries and preserve existing callers' tests.
- [ ] Run discovery budget/model and full llm tests. Commit owned modules and tests with `feat(discovery): enforce budgets at provider attempt boundaries`.

## Task 3: Source-backed discovery and company evidence adapters

**Files:** Create `services/discovery/src/providers/search.ts`, `src/providers/identity.ts`, `src/providers/financials.ts`, `src/providers/evidence.ts`, and matching tests. Create `services/evidence/src/campaign-documents.ts`, `src/public-document-fetch.ts`, corresponding tests. Reuse `source-repo.ts`, `ingest.ts`, `sec-edgar.ts`, `issuer-ir-extraction.ts`, resolver discovery and normalized financial readers.

**Interfaces:** Implement `SearchProvider.search`, `IdentityProvider.resolve`, `EvidenceProvider.acquire`, `FinancialProvider.read` from the companion. Every external request uses the supplied OperationRunner; cached database reads do not reserve a network unit. The evidence service owns bytes/excerpts and source registration. Campaign controllers never receive raw bytes.

- [ ] Test a Brave adapter using injected fetch:

```ts
test('search returns bounded leads and cannot create primary evidence', async () => {
  const calls: URL[] = [];
  const provider = createBraveSearchProvider({apiKey:'test',fetch:async url => {
    calls.push(new URL(String(url)));
    return new Response(JSON.stringify({web:{results:[{title:'Example',url:'https://example.test/story',description:'Transformer supplier'}]}}));
  }});
  const hits = await provider.search({query:'grid suppliers',query_index:0}, fakeOperations());
  assert.equal(calls[0].origin,'https://api.search.brave.com');
  assert.equal(hits[0].url,'https://example.test/story');
  assert.equal('claim_id' in hits[0],false);
});
```

Task 2's `test/fake-operations.ts` exports `fakeOperations()` implementing the real interface with an in-memory attempt ledger, success cache and injected clock; it must still call the supplied operation function and is not a fake evidence generator.
- [ ] Run the adapter test to see the missing module/export, then implement native fetch to Brave's documented `/res/v1/web/search`, header `X-Subscription-Token`, `q`, `count=10`, `country=US`, `search_lang=en`. Validate response fields and HTTPS URLs, cap descriptions at 1,000 characters, retain query/result order and retrieval time. Map 401/403, 429, 5xx and timeout to typed errors; never log the key or accept a user-controlled API base URL in product requests.
- [ ] Resolve names/ticker hints through the existing provider-backed resolver. Verify active listing→instrument→issuer relations and asset type. Eligible MICs in v1: XNYS, XNAS, XASE, ARCX, BATS, IEXG; treat this as a versioned supported-listing policy, not an assertion of exhaustive exchange coverage. An ambiguous result stays unresolved. Do not require a cached quote or non-null sector. No discovery through generated identities.
- [ ] Build primary source acquisition: use stored accessible evidence first, then latest relevant SEC documents and verified issuer IR. Reuse `issuerIrTextFromBytes` for supported text normalization. Pin verified public destination IPs for HTTPS requests while retaining original hostname for TLS, validate every redirect and reject private/link-local/loopback/multicast/IPv4-mapped private IPv6 destinations, credentials, unsupported content, >5 MB and >3 redirects. Inject DNS and transport for tests. Use native Node HTTPS transport for IP pinning; no new browser/fetch SDK. Search result URLs do not establish an IR domain; use a SEC-linked company website and same registrable verified issuer domain, or existing verified registry entry.
- [ ] Produce source excerpts by deterministic query-term windows (up to six documents, up to 8,000 characters/document, at most 48,000 across the packet). Keep original document id/hash and normalized-text offsets with each excerpt. Package brief plus evidence and run `validateModelRequest`; if necessary reduce low-priority windows before dispatch, recording exclusions. Source publication/retrieval times and primary eligibility travel with each excerpt. Existing stored claims remain usable; new excerpt-grounded quotes will be persisted as claims by Task 5 without a separate unbudgeted extraction model call.
- [ ] Financial read: return eligible, sourced raw facts and explicit missing fields using existing readers. Limit external hydration to the configured financial budget, preserve dates/scale/units and disallow cross-currency aggregation. If an existing high-level reader hides several provider requests, instrument the actual request boundary or use cache-only mode and report that gap; do not count the whole multi-request reader as one attempt.
- [ ] Add tests for no-quote new issuer, ADR with foreign domicile, ETF/OTC exclusion, ambiguous company, stale/unknown primary publication date, blocked URL/redirect/DNS rebinding, unsupported PDF, absent API key, inherited source ownership and actual document/reporting-source mismatch. Run affected resolver/evidence and adapter suites.
- [ ] Commit with `feat(discovery): acquire verified identities and bounded source evidence`.

## Task 4: Scout and fair research-cohort selection

**Files:** Create `services/discovery/src/scout.ts`, `src/scout-prompt.ts`, `src/cohort.ts`, `test/scout.test.ts`, `test/cohort.test.ts`.

**Interfaces:** `discoverCandidates(context): Promise<DiscoveryPool>` consumes Brief, providers, model and OperationRunner. `chooseResearchCohort(brief,candidates): string[]` returns candidate IDs in persistent evaluation order. Neither function finalizes shortlist rank.

- [ ] Create a fixture with 30 resolved companies spread across two mechanisms and reversed provider completion order. Test stable round-robin selection:

```ts
const pool = Array.from({length:30},(_,i) => leadFixture(i,{mechanism:i%2}));
const a = chooseResearchCohort(briefFixture(),pool);
const b = chooseResearchCohort(briefFixture(),[...pool].reverse());
assert.deepEqual(a,b);
assert.equal(a.length,25);
assert.equal(new Set(a).size,25);
```

Define `leadFixture(index,{mechanism})` in this test using `identityFixture(index)` and the companion's DiscoveredCandidate fields: stable ids, `first_seen=[floor(index/10),index%10]`, resolved identity, mechanism ID from the brief, `origins=['web']`, `primary_domain_lead=false`, `seed=false`.
- [ ] Run and confirm failure before adding selection.
- [ ] Implement phase budget allocation: max20 discovery searches, distribute deterministic query order across 2–4 mechanisms. Merge seeds/existing issuer-linked evidence/search lead outputs; Scout may only name candidates tied to supplied hit IDs or approved seed strings. Persist all query outcomes, admitted leads and overflow counts. Extract at most four model batches; if input cannot fit 64,000 serialized characters, reduce/skip batches and mark coverage rather than dropping the evidence silently.
- [ ] Resolve each admitted lead with the metered identity adapter, merge issuer duplicates while preserving origins/mechanisms, and persist at most100 records under the repository lock. Existing issuer-linked evidence can provide candidates without a provider call, but must pass ownership/listing checks.
- [ ] Choose at most five eligible seed companies first; round-robin mechanisms using primary-domain lead, then first query/result order, then issuer UUID. Skip already selected multi-mechanism companies, continue until25 or exhausted. Persist the immutable cohort before company research. Mark the rest `not_selected`; unresolved identities keep their state and remain visible.
- [ ] Add tests for all-unknown identities, 101st lead cap, duplicate listing/issuer, seeds spanning mechanisms, prompt-injected search snippets, source-private existing evidence, 20-search exhaustion and a budget stop during resolution. Assert no unselected company triggers Analyst calls.
- [ ] Run scout/cohort tests and commit `feat(discovery): build bounded candidate pools and fair research cohorts`.

## Task 5: Independent assessment, evidence gates and deterministic shortlist

**Files:** Create `services/discovery/src/assessment.ts`, `src/assessment-validation.ts`, `src/assessment-prompts.ts`, `src/selection.ts`, `src/seal.ts`, tests for each; create `services/evidence/src/campaign-claims.ts` and its tests.

**Interfaces:** `assessCompany(context): Promise<CandidateDecision>`; pure `decideCandidate(brief,packet,analyst,skeptic,asOf): CandidateDecision`; `rankShortlist(decisions): RankedDecision[]`; `sealCandidateAssessment(tx,input): Promise<string>` returns snapshot ID. Use the exact raw-role and normalized evidence types in the companion.

- [ ] Start with zero-data and fabricated-citation tests:

```ts
test('primary evidence is required and missing financials stay unknown', () => {
  const packet = packetFixture();
  const result = decideCandidate(briefFixture(),{...packet,excerpts:[]},analystFixture(),skepticFixture(),'2026-09-10T12:00:00Z');
  assert.equal(result.state,'needs_evidence');
  assert.equal(result.dimensions.valuation_context.level,'unknown');
});
test('the validator rejects a citation outside the supplied packet', () => {
  const raw = analystFixture();
  raw.exposure.citations=[{kind:'claim',id:'90000000-0000-4000-8000-000000000099'}];
  assert.throws(() => validateAnalystOutput(raw,briefFixture(),packetFixture()),/citation/);
});
```

- [ ] Run failing tests, then implement two independent model calls using the same immutable company packet. The Skeptic prompt contains no Analyst output. Both calls ask for structured conclusions, not private reasoning. Treat document text as data. Do not let either role change limits, filters, criteria or identity. Include horizon/observation dates and return every criterion exactly once.
- [ ] Implement quote citations: `{kind:'excerpt',id,quote}` must match a nonempty normalized substring in the supplied excerpt, 20–1,000 characters. Persist the exact quote—not a model-generated paraphrase—as a source-linked claim with document locator through `campaign-claims.ts`, using operation-derived idempotency and a hash of document+offset+quote. Inferences remain in the role output as labeled interpretations, not authoritative facts. Normalize quote citations to claim IDs, keeping actual document source. Unsupported numbers in prose fail validation unless present in cited text/facts; finite metric criteria are calculated by canonical deterministic metric evaluation with exact unit/period/scale/freshness, never by prose.
- [ ] Implement decision policy from the companion: conservative narrative agreement, deterministic metric outcomes, current primary exposure support, completed skeptic and counter-search gates. Citation validation is necessary but not proof of semantic support; disagreement or a skeptic unsupported-exposure finding prevents admission. Unknown must-have → needs_evidence; confirmed failure → excluded; missing financial context alone stays unknown. Compute evidence strength from distinct substantive documents/families, not number of citations.
- [ ] Rank eligible companies by exposure, evidence strength, quality, issuer UUID. Do not include valuation in the comparator. Retain other eligible companies as `eligible_not_shortlisted`. Persist ranks1–10 in one fenced finalization transaction. An optional final summary references only validated candidate IDs and cannot change ranks.
- [ ] Seal every usable investigated assessment, including evidence-backed exclusion. Reuse `buildClaimBackedSealInput`, `buildFactBackedSealInput`, `toSealFactRow` and existing merge/sealer helpers. The snapshot includes source/document/fact/claim/tool hashes; pure observations preserve `as_of` when `period_end` is null. Persist candidate result and snapshot atomically, with a valid run lease; if sealing fails, no candidate becomes shortlisted.
- [ ] Add tests for both roles agreeing on failure, opposing narrative conclusions, malformed/duplicate/missing criteria, non-finite/wrong-period/wrong-currency facts, expired/unknown-dated primary evidence, duplicated syndication, stale source ownership, zero/three/25 eligible candidates, stable ties, no valuation effect on rank, exact-quote mismatch and retry-safe claim creation. Exercise actual snapshot verification in integration tests.
- [ ] Run affected discovery/evidence/snapshot/agents tests and commit `feat(discovery): challenge and verify research shortlist decisions`.

## Task 6: Durable worker, cancellation and recovery

**Files:** Create `services/discovery/src/runner.ts`, `src/stages.ts`, `src/worker.ts`, `src/worker-cli.ts`, `test/runner.integration.test.ts`, `test/recovery.integration.test.ts`.

**Interfaces:** `executeDiscoveryRun(deps,lease,signal): Promise<void>` and `runDiscoveryWorker(deps,{signal,pollMs}): Promise<void>`. Deps and Lease are in the companion. All writes use the fenced repository, not raw SQL in stage functions.

- [ ] Write this concrete recovery test using the repository fixture and fake providers from Tasks2–5:

```ts
test('restart reuses committed company output and fences the old worker', dbOptions, async t => {
  const h = await createRunnerHarness(t,{crashAfter:'candidate_commit'});
  await assert.rejects(h.executeOnce(),/injected crash/);
  const callsBefore = h.callsForCompany(IDS.issuer);
  h.advanceClock(91_000);
  await h.resumeWithWorker('replacement');
  assert.equal(h.callsForCompany(IDS.issuer),callsBefore);
  await assert.rejects(h.commitUsingOldLease(),{code:'lease_lost'});
  assert.equal((await h.repo.readRun(h.userId,h.runId)).status,'completed');
});
```

Create `test/runner-harness.ts` in this task. It wraps `withCampaignDb`, two deterministic candidate packets and the real stage functions; the fake provider records operation keys before returning fixture responses. Its `crashAfter` hook throws immediately after the real fenced `commitAssessment` transaction; `resumeWithWorker` uses `claimNextRun` after advancing the injected clock. It must not bypass budget reservation, candidate decisions or sealing.
- [ ] Run to confirm absent resume/fencing behavior. Implement claim with skip-locked, lease90s, heartbeat20s, stage checkpoints and one company at a time. Run providers outside transactions. Heartbeat loss aborts the run controller; stage code checks before every call and commit. Stop accepting work on process signal and drain/abort in-flight work without falsely declaring completion.
- [ ] Stages: discover → commit cohort → acquire company packet/counter-search → Analyst → Skeptic → verify/seal/commit company → finalize rankings/coverage. Persist role outputs after each successful model operation so a crash between Analyst and Skeptic does not redo the Analyst. Reserve/capture operation responses before stage advancement. Partial acquisition cannot be advertised as complete company research.
- [ ] Terminal policy: cancelled request wins over normal completion; deadline/budget exhaustion → partial, even with zero assessments; non-systemic provider incompleteness → partial; systemic provider/configuration failure preventing every assessment → failed. Exhaustive processing of the bounded pool with no qualifying companies → completed with empty shortlist. If discovery finds no candidates after successfully executing its plan, completed with zero is correct. Distinguish intentional cohort/candidate caps (completed bounded scope) from an attempt budget stopping planned work (partial).
- [ ] Add failure injection at reservation, response persistence, Analyst commit, company commit and finalization. Test two workers contending, process death, deadline during downtime, cancellation in queued/running/terminal states, event cursor monotonicity, no duplicate snapshot/result after retry and no lost-worker side effects. Assert all final counters reconcile with the ledger.
- [ ] Run real-DB recovery tests and commit `feat(discovery): execute campaigns with durable checkpoints and cancellation`.

## Task 7: API, authorized result reads and lifecycle

**Files:** Create `services/discovery/src/service.ts`, `src/http.ts`, `src/read-model.ts`, `src/visibility.ts`, `src/lifecycle.ts`, `test/http.test.ts`, `test/visibility.integration.test.ts`, `test/lifecycle.integration.test.ts`; create `services/dev-api/src/discovery-adapter.ts`, `src/discovery-http.ts`; minimally modify `services/dev-api/src/http.ts`, `src/runtime.ts`, `src/local-runtime.ts`; modify `services/evidence/src/inspector.ts`, `src/blob-gc-repo.ts` and related tests; create `services/evidence/src/snapshot-reachability.ts` and `test/snapshot-reachability.test.ts` for shared-reference checks; update `spec/finance_research_openapi.yaml` and `scripts/openapi-contract.test.ts`.

**Interfaces:** Implement `DiscoveryService` from the companion. `handleDiscoveryHttp(req,res,{userId,service}): Promise<boolean>` returns false for non-discovery routes; one top-level dev-api delegation invokes it. The service composes repositories/stages and is independently tested; do not inline campaign SQL in the 1,000+ line API file.

- [ ] Use the existing dev-api HTTP test server harness to assert unauthenticated access fails before provider calls, foreign IDs return404, malformed body returns400, stale version409, draft rate limit429, missing provider config503, and duplicate start returns the same run. Test all spec endpoints, not only happy-path creation.
- [ ] Implement readiness for search/model/reference capabilities; the API saves questions/briefs without network access. Drafting returns a proposal, never overwrites the saved brief. After model drafting, recheck `expected_version` and return409 on concurrent save. Starting snapshots configured model identities/limits but no secrets. A queued run older than90s reports worker-waiting state without claiming an empty result.
- [ ] Add a shared discovery `authorizedRunView` that checks current availability of every cited source/document/fact before returning cached assessment text/dimensions/events or exporting/handoff. A revoked candidate may retain company identity and historical state, but derived content is redacted and promotion disabled. Apply the same filter to event summaries; do not protect only the evidence drawer. Source access is checked in batch, not once per sentence.
- [ ] Extend inspector ownership with a discovery candidate→run→campaign user join, preserving all existing ownership branches. Add this integration scenario:

```ts
const h = await createVisibleCandidateHarness(t); // real sealed candidate from Task6 harness
await h.assertReadableByOwner();
await h.assertHiddenFromOtherUser();
await h.revokePrimarySource();
const view = await h.service.getRun(h.userId,h.runId);
assert.equal(view.shortlist[0].evidence_available,false);
assert.equal(view.shortlist[0].assessment,null);
assert.equal(view.shortlist[0].can_promote,false);
assert.ok((await h.service.getEvents(h.userId,h.runId,0)).items.every(e => !e.summary.includes(h.privateQuote)));
```

Define `createVisibleCandidateHarness` in `test/visibility-harness.ts` by extending Task6's real DB harness and setting primary source `user_id` to OTHER on revocation; include deletion and entitlement variants as separate tests.
- [ ] Implement DELETE transaction after queued cancellation or running-worker quiescence; live lease→409. Lock the owner user row in lease claim/checkpoint paths so user erasure cannot race an authorized post-erasure write. Delete campaign-owned rows via cascades and explicitly remove source-derived operation logs/results; remove a snapshot only if no remaining chat/analyze/grid/thesis/discovery reference exists. Do not delete shared sources. Extend `deleteUserAndQueueObjectBlobs` at its existing locked transaction boundary with discovery cleanup, using evidence-owned SQL helpers rather than an evidence→discovery service import cycle.
- [ ] Verify no raw bytes/prompts/API keys in HTTP responses, DTOs or logs returned to users; tests check source privacy after cached result creation. Run new API/lifecycle tests plus existing dev-api/inspector/erasure suites.
- [ ] Commit `feat(discovery): expose owned campaign APIs and safe evidence lifecycle`.

## Task 8: Question, brief, live research and results UI

**Files:** Create `web/src/discovery/api.ts`, `CampaignList.tsx`, `CampaignPage.tsx`, `BriefEditor.tsx`, `RunProgress.tsx`, `CampaignResults.tsx`, `CandidateCard.tsx`, `useCampaignRun.ts` and colocated tests; modify `web/src/App.tsx`, `web/src/shell/SidebarNav.tsx` and the existing sidebar configuration if separate.

**Interfaces:** Import DTOs directly from `services/discovery/src/types.ts`; do not introduce parallel web types. Routes: `/discovery`, `/discovery/:campaignId`, `/discovery/:campaignId/runs/:runId`. `CampaignPage` owns selected run identity; `BriefEditor` owns its draft and base version. Backend polling must not replace editor state.

- [ ] Start with browser tests using existing jsdom/React harness patterns:

```ts
// In BriefEditor.test.tsx, mount real BriefEditor with fetched version1.
await harness.edit('Question','Find suppliers of electricity infrastructure equipment.');
await harness.receiveServerBrief({...savedBrief,version:2});
assert.equal(harness.field('Question').value,'Find suppliers of electricity infrastructure equipment.');
await harness.click('Save research brief');
assert.equal(harness.lastBody.expected_version,1);
```

Implement the local harness using the same event/render helpers as `web/src/agents/ThesisPanel.test.tsx`; `receiveServerBrief` rerenders props, not internal state. Add a separate test that explicit “Load saved brief” replaces the draft and advances the base version.
- [ ] Run the new UI tests before implementing. Build list/create form, editable mechanism/criterion/seed/horizon brief, and one “Approve brief and start” action that sends version/hash/request_key. Keep the key stable while retrying an ambiguous submission; create a new key only for a new user-initiated run. Surface API conflicts without clearing local work.
- [ ] Implement active-run polling2s when visible, 10s after errors, disabled on terminal/hidden/unmount; retain last successful data on transient failures. Use AbortController to avoid cross-campaign response races. Show remaining counts/time, incomplete stage, cancellation request and waiting-for-worker state. Do not label all successful terminal results as “10 companies found.”
- [ ] Results expose shortlist, investigated, not-selected/unresolved and trail entry point; render separate labeled dimensions, unknown values, evidence-unavailable redaction, risk/next-question and source drawer. Shortlist count is actual, not padded. Same-brief run comparison is a deterministic issuer-ID diff; different brief versions show a different-question label and no implied comparable rank delta.
- [ ] Add tests for double-click start, stale brief, pending/cancelled/partial/failed/zero-result runs, valuation unknown, revoked evidence, URL switch during fetch, background refresh failure, mechanism counts and accessible keyboard labels. Verify no technical lease/JSON copy leaks into UI.
- [ ] Run `cd web && npm test -- --test-name-pattern=Discovery` only if the local npm runner forwards the filter correctly; otherwise use `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test 'src/discovery/*.test.ts' 'src/discovery/*.test.tsx'`. Run web typecheck/build/lint. Commit `feat(discovery): add campaign brief and research results experience`.

## Task 9: Learning trail, cited exports and analysis/thesis handoffs

**Files:** Create `web/src/discovery/ResearchTrail.tsx`, `learning.ts`, `export.ts`, `handoff.ts` and tests; modify `web/src/analyze/thesisHandoff.ts`, `web/src/pages/AgentsPage.tsx`, `web/src/analyze/thesisHandoff.test.ts`, `web/src/analyze/analyzeEntry.ts`, `web/src/analyze/analyzeEntry.test.ts`, `web/src/pages/AnalyzePage.tsx` and `web/src/pages/thesisHandoffPage.test.tsx`. Use Task7's existing authorized GET run/candidates methods for fresh handoff/export reads; do not add service mutations.

**Interfaces:** `learningForEvent(event): {title:string; explanation:string}|null`; `formatCampaignMarkdown(view): string`; `readResearchHandoff(state): ResearchHandoff|null`. Extend the existing handoff model additively; retain existing AnalyzeThesisHandoff compatibility.

- [ ] Write tests before adding UI:

```ts
assert.equal(learningForEvent({...eventFixture(),kind:'budget_exhausted'})?.title,'Why the agent stopped');
const markdown = formatCampaignMarkdown(runViewFixture({valuation:'unknown'}));
assert.match(markdown,/Research shortlist/);
assert.match(markdown,/Valuation.*unknown/i);
assert.doesNotMatch(markdown,/Buy rating|expected return/i);
assert.equal(readResearchHandoff({researchHandoff:{kind:'discovery',runId:'bad'}}),null);
```

Define event/run-view fixture factories in this task from the shared DTOs, with real stable UUID shapes and synthetic cited evidence. No undocumented optional fields.
- [ ] Trail pages event cursors and groups observable work by role/stage. Learning mapping: brief→planning; search→tool use; document→retrieval; criterion decision→structured output/verification; skeptic→independent context; budget stop→resource control; resumed run→checkpointing. Explanations say the critic is a second model pass and can also be wrong. Never construct fake step narratives for missing events or show hidden reasoning.
- [ ] Copy/export uses an authorized current run view and lists source titles/URLs, evidence dates, limits, missing data and rank policy. Do not export redacted/private text retained in browser cache. Request a fresh authorized view on export and promotion; cancel the action if permission changed.
- [ ] Analyze handoff carries canonical listing ref and a bounded summary. Thesis handoff carries issuer/listing ref, draft thesis, at most five falsifiers/conditions, and `{campaign_id,run_id,candidate_id}` provenance. Extend the existing reader with a discriminated union so discovery does not impersonate an Analyze `sourceRunId`. Validate state before use. Prefill editor only; saving a new agent/thesis still uses existing explicit actions and validation. Financial unknowns cannot generate numerical conditions.
- [ ] Test real route entry, no auto-save/network mutation on navigation, old Analyze handoff compatibility, malformed/foreign/revoked state, >5 conditions trimming with visible explanation, and refresh-safe source identity. Run existing thesis handoff/AgentsPage tests and new discovery tests.
- [ ] Commit `feat(discovery): explain research actions and preserve cited handoffs`.

## Task 10: Full-path evaluations, startup and release evidence

**Files:** Create `services/discovery/test/campaign-e2e.integration.test.ts`, `test/campaign-evaluation.test.ts`, `test/fixtures/power-infrastructure.json`, `industrial-automation.json`, `supply-disruption.json`, `unsupported-theme.json`; create `docs/discovery-campaigns-operations.md`, update `CONTEXT.md`, `.github/workflows/ci.yml`, `scripts/dev-shell.sh`, `.env.dev.example`, and integration assertions in `scripts/openapi-contract.test.ts` after Task7’s endpoint schema changes merge.

**Interfaces:** Use actual `DiscoveryService`, worker, real database, HTTP and snapshot verifier. Replace only external providers/model responses with recorded synthetic fixtures. Each fixture supplies question/brief, search hits, identities, dated primary/counter documents, financial facts, role responses, expected candidate states/ranks, and operation outcomes. Fixture packets must pass the same validators as production.

- [ ] Write the first failing end-to-end assertion:

```ts
test('approved theme research reaches an inspectable shortlist without live providers', dbOptions, async t => {
  const h = await createCampaignE2eHarness(t,'power-infrastructure');
  const started = await h.approveAndStart();
  await h.workerUntilTerminal();
  const result = await h.getRun(started.run_id);
  assert.equal(result.status,'completed');
  assert.ok(result.shortlist.length > 0 && result.shortlist.length <= 10);
  for(const candidate of result.shortlist) {
    assert.equal(candidate.evidence_available,true);
    await h.assertSnapshotVerifies(candidate.snapshot_id);
  }
  await h.assertAllLimitsRespected();
  await h.assertForeignUserDenied();
});
```

Create `test/e2e-harness.ts` with HTTP requests through the real API handler and the real worker using a temporary database. Load a named fixture from disk and fail on any unexpected external operation key; do not return permissive generic responses. Assert all expected provider operations were either used or explicitly excluded by coverage policy.
- [ ] Complete all four fixture paths: misleading well-known company excluded, less-known supported company discovered without quote cache, unknown valuation retained, counterevidence prevents admission, duplicated sources do not inflate evidence, fabricated citation rejected, zero-qualified completed result, partial failure and resume/cancel. Ensure deterministic ranks across input ordering and repetitions.
- [ ] Add a test with maximum-size serialized input64,000 and maxTokens10,000, exact boundary acceptance/rejection, and fallback/repair sharing budgets. Verify malformed large output fails without hanging or retries outside the 64-attempt ceiling. Test timeout/abort against a controllable slow provider transport.
- [ ] Integrate worker lifecycle into the existing dev-shell service group and process cleanup; add dedicated `npm run worker` in discovery, feature flag `DISCOVERY_ENABLED=false` by default, deployment settings for existing model/reference providers plus `DISCOVERY_SEARCH_API_KEY`. Startup docs distinguish API from worker readiness. Add CI jobs with dependency installation for db/discovery/llm/evidence/web as required, synthetic credentials only. Keep paid live smoke tests opt-in and outside normal CI.
- [ ] Verify current API contract file by inspecting `scripts/openapi-contract.test.ts`; update its referenced file and add discovery endpoints/DTOs. Verify newly added routing is authenticated even where nearby screener routes are public. Document local commands, restart recovery, unknown attempt outcomes, provider configuration errors, 30-second attempt timeouts, 45-minute deadline, and rollback by disabling the feature/worker before schema rollback.
- [ ] Run quality gates: db migration/schema tests; full discovery suite; affected llm/resolver/evidence/snapshot/dev-api/agents suites; existing Analyze handoff tests; web typecheck/build/lint; CI contract/dev-shell tests. Report actual results and pre-existing unrelated failures separately. Never claim the whole backend type check passed if only the no-new-diagnostics comparison passed.
- [ ] Human release evaluation: review ten recorded candidate assessments across the three positive fixtures, checking the cited source actually supports exposure and whether the counterargument is useful. Record reviewer, fixture/candidate IDs, verdict and reason in the operator document. Gate: at least9/10 acceptable, zero fabricated exposure claims; deterministic tests require100% citation/identity/ownership/budget validity and zero unsupported numerical claims. Keep feature disabled until this evaluation is recorded. This is software/research-quality evaluation, not a forecast of investment performance.
- [ ] Commit `test(discovery): verify complete campaigns and document safe rollout`; update/close owned issues, pull/rebase, export only owned bead changes with the supported CLI, push the implementation branch and verify a clean synchronized checkout. Do not delete other workers' stashes/branches.

## Final handoff checklist

- [ ] Every acceptance item in spec §13 maps to Task1–10 and a concrete passing test or the explicit human evaluation.
- [ ] All workers used the companion's names/signatures; no parallel web DTOs, ad-hoc identity types or duplicated ranking rules.
- [ ] Fresh source visibility is enforced on every derived-content route and user erasure.
- [ ] No external call bypasses attempt metering or abort controls; no hidden fallback/repair budget.
- [ ] Evidence/privacy gates and restart recovery ship before enabling the feature.
- [ ] Documentation states caps are64,000 input characters and10,000 output tokens, not input tokens; all counts/time limits match the approved spec.
- [ ] Open follow-ups name concrete gaps; no acceptance requirement is silently deferred. Feature remains off if a release gate fails.

## Spec coverage map

| Spec section | Implementing tasks |
|---|---|
| 1–2 outcome, brief, saved runs | 1, 6, 7, 8 |
| 3 evidence gates and separate dimensions | 3, 5, 8 |
| 4 coverage and candidate selection | 3, 4, 6, 8 |
| 5 roles and agent learning | 2, 4, 5, 6, 9 |
| 6 budgets, retries, terminal states | 1, 2, 6, 8, 10 |
| 7 architecture and provider configuration | 1–3, 6, 7, 10 |
| 8 ownership, versioning, recovery | 1, 2, 6, 7 |
| 9 source verification, lifecycle | 3, 5, 7, 9 |
| 10 APIs | 7, 10 |
| 11 UI and handoffs | 8, 9 |
| 12 exclusions | All tasks; release scope review10 |
| 13 acceptance/evaluation | Task-specific tests; integrated gate10 |
| 14 constraints | Global constraints; integration gate10 |
