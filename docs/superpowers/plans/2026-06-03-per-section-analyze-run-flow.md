# Per-Section Analyze Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host deterministic block producers in the analyze run so the `peer_table` section emits a real `metrics_comparison` block alongside the narrative memo, sealed into one snapshot.

**Architecture:** A producer registry maps `(playbook_id, section_id)` → a producer that returns a `SnapshotSealInput`. A pure `mergeSealInputs` folds the narrative memo's seal input and the section producers' seal inputs into one. dev-api's analyze run builds the memo as a `SnapshotSealInput`, runs the deterministic sections on the pool, merges, and seals the merged input.

**Tech Stack:** Node `--experimental-strip-types`, `node:test`. Tests: `cd services/analyze && npm test` (and `services/dev-api`). Single file: `node --experimental-strip-types --test test/<file>.test.ts`.

**Spec:** `docs/superpowers/specs/2026-06-03-per-section-analyze-run-flow-design.md`. **Bead:** fra-tx2o.

**Commit trailer (every commit):** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Verified contracts (read before starting)

- `SnapshotSealInput` = `Omit<SnapshotVerificationInput,"manifest"> & { manifest: SnapshotManifestDraft }` → `{ snapshot_id, manifest, blocks, facts?, claims?, events?, documents?, sources?, thread_id? }` (`services/snapshot/src/snapshot-sealer.ts:13`).
- `SnapshotManifestDraft` fields: `subject_refs, fact_refs, claim_refs, event_refs, document_refs, series_specs, source_ids, tool_call_ids, tool_call_result_hashes, as_of, basis, normalization, coverage_start, allowed_transforms, model_version, parent_snapshot` (`services/snapshot/src/manifest-staging.ts:58`).
- `emitPeerComparisonBlock(deps, input): Promise<SnapshotSealInput | null>` — `deps = { peers: PeerSetResolver, stats: StatsRepository, db: QueryExecutor, clock? }`, `input = { primary: IssuerSubjectRef, snapshotId: UUID, blockId: string, asOf: string, peerLimit?, title? }` (`services/analyze/src/metrics-comparison-emitter.ts:24,51`).
- `AnalyzePlaybook` = `{ playbook_id, version, name, …, sections: AnalyzePlaybookSection[] }`; `AnalyzePlaybookSection` = `{ section_id, title, required, block_hint }` (`services/analyze/src/playbook.ts:1,8`). The `peer_comparison` playbook has a `peer_table` section.
- dev-api `createRun` (`services/dev-api/src/http.ts:950`) resolves the playbook, calls `deps.runAnalyzeWorkflow` (memo block), then `persistAnalyzeTemplateRunAfterSnapshotSealWithPool(deps.db, { blocks, sealSnapshot })`. `deps.sealAnalyzeSnapshot` (`services/dev-api/src/local-runtime.ts`) stages a manifest via `manifestFromBlockRefs` (`fact_refs:[]`) and calls `sealSnapshotWithPool`.

---

## File Structure

- Create `services/analyze/src/seal-input-merge.ts` — `mergeSealInputs(base, sections)` (pure).
- Create `services/analyze/src/section-producers.ts` — registry + `lookupSectionProducer`, `sectionBlockId`.
- Create `services/analyze/src/section-runner.ts` — `runDeterministicSections(deps, input)`.
- Modify `services/dev-api/src/local-runtime.ts` — add `buildMemoSealInput`; route the run through sections + merge.
- Modify `services/dev-api/src/http.ts` — `createRun` runs sections, merges, seals merged.
- Tests: `services/analyze/test/seal-input-merge.test.ts`, `services/analyze/test/section-producers.test.ts`, `services/analyze/test/section-runner.test.ts`, and extend `services/dev-api/test/*analyze*`.

---

### Task 1: `mergeSealInputs` (pure)

**Files:**
- Create: `services/analyze/src/seal-input-merge.ts`
- Test: `services/analyze/test/seal-input-merge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/analyze/test/seal-input-merge.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { mergeSealInputs } from "../src/seal-input-merge.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";

function manifest(over: Record<string, unknown> = {}) {
  return {
    subject_refs: [],
    fact_refs: [],
    claim_refs: [],
    event_refs: [],
    document_refs: [],
    series_specs: [],
    source_ids: [],
    tool_call_ids: [],
    tool_call_result_hashes: [],
    as_of: "2026-01-01T00:00:00.000Z",
    basis: "unadjusted",
    normalization: "raw",
    coverage_start: null,
    allowed_transforms: null,
    model_version: "dev",
    parent_snapshot: null,
    ...over,
  };
}

function seal(over: Partial<SnapshotSealInput> & { manifest?: Record<string, unknown> } = {}): SnapshotSealInput {
  return {
    snapshot_id: SNAP,
    blocks: [],
    facts: [],
    sources: [],
    ...over,
    manifest: manifest(over.manifest) as never,
  } as SnapshotSealInput;
}

test("mergeSealInputs returns base unchanged when there are no sections", () => {
  const base = seal({ blocks: [{ id: "memo" }] as never });
  assert.equal(mergeSealInputs(base, []), base);
});

test("mergeSealInputs concats blocks/facts and unions manifest refs", () => {
  const base = seal({
    blocks: [{ id: "memo" }] as never,
    sources: ["s1"],
    manifest: { claim_refs: ["c1"], source_ids: ["s1"], subject_refs: [{ kind: "issuer", id: "i1" }], as_of: "2026-01-01T00:00:00.000Z" },
  });
  const section = seal({
    blocks: [{ id: "peer" }] as never,
    facts: [{ fact_id: "f1" }] as never,
    sources: ["s1", "s2"],
    manifest: { fact_refs: ["f1"], source_ids: ["s1", "s2"], subject_refs: [{ kind: "issuer", id: "i1" }, { kind: "issuer", id: "i2" }], as_of: "2026-03-01T00:00:00.000Z" },
  });

  const merged = mergeSealInputs(base, [section]);

  assert.deepEqual(merged.blocks.map((b) => (b as { id: string }).id), ["memo", "peer"]);
  assert.deepEqual((merged.facts ?? []).map((f) => (f as { fact_id: string }).fact_id), ["f1"]);
  assert.deepEqual([...merged.manifest.fact_refs], ["f1"]);
  assert.deepEqual([...merged.manifest.claim_refs], ["c1"]);
  assert.deepEqual([...merged.manifest.source_ids], ["s1", "s2"]);
  assert.deepEqual([...(merged.sources ?? [])], ["s1", "s2"]);
  assert.equal(merged.manifest.subject_refs.length, 2);
  // as_of takes the max across inputs.
  assert.equal(merged.manifest.as_of, "2026-03-01T00:00:00.000Z");
});

test("mergeSealInputs throws on a snapshot_id mismatch", () => {
  const base = seal();
  const section = seal({ snapshot_id: "22222222-2222-4222-a222-222222222222" });
  assert.throws(() => mergeSealInputs(base, [section]), /snapshot_id/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyze && node --experimental-strip-types --test test/seal-input-merge.test.ts`
Expected: FAIL — cannot find module `../src/seal-input-merge.ts`.

- [ ] **Step 3: Implement**

Create `services/analyze/src/seal-input-merge.ts`:

```ts
import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

function uniq<T>(values: ReadonlyArray<T>): T[] {
  return [...new Set(values)];
}

function dedupeSubjectRefs(refs: ReadonlyArray<SnapshotSubjectRef>): SnapshotSubjectRef[] {
  const seen = new Set<string>();
  const out: SnapshotSubjectRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function dedupeFacts(facts: ReadonlyArray<unknown>): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const fact of facts) {
    const id = (fact as { fact_id?: string }).fact_id;
    if (id !== undefined) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(fact);
  }
  return out;
}

// Folds the narrative memo's seal input (base) and the deterministic sections'
// seal inputs into one. Concats blocks/facts/claims/events/documents, unions the
// manifest ref arrays and sources, takes the max as_of, and keeps base's scalar
// manifest fields (basis, normalization, model_version, …). Pure.
export function mergeSealInputs(
  base: SnapshotSealInput,
  sections: ReadonlyArray<SnapshotSealInput>,
): SnapshotSealInput {
  if (sections.length === 0) return base;
  for (const section of sections) {
    if (section.snapshot_id !== base.snapshot_id) {
      throw new Error(
        `mergeSealInputs: snapshot_id mismatch (${section.snapshot_id} != ${base.snapshot_id})`,
      );
    }
  }
  const all = [base, ...sections];
  const flat = <T>(pick: (s: SnapshotSealInput) => ReadonlyArray<T> | undefined): T[] =>
    all.flatMap((s) => [...(pick(s) ?? [])]);
  const maxAsOf = all
    .map((s) => s.manifest.as_of)
    .reduce((a, b) => (b > a ? b : a));

  return Object.freeze({
    ...base,
    blocks: Object.freeze(flat((s) => s.blocks)),
    facts: Object.freeze(dedupeFacts(flat((s) => s.facts)) as never),
    claims: Object.freeze(flat((s) => s.claims) as never),
    events: Object.freeze(flat((s) => s.events) as never),
    documents: Object.freeze(flat((s) => s.documents) as never),
    sources: Object.freeze(uniq(flat((s) => s.sources)) as never),
    manifest: Object.freeze({
      ...base.manifest,
      subject_refs: Object.freeze(dedupeSubjectRefs(flat((s) => s.manifest.subject_refs))),
      fact_refs: Object.freeze(uniq(flat((s) => s.manifest.fact_refs))),
      claim_refs: Object.freeze(uniq(flat((s) => s.manifest.claim_refs))),
      document_refs: Object.freeze(uniq(flat((s) => s.manifest.document_refs))),
      event_refs: Object.freeze(uniq(flat((s) => s.manifest.event_refs))),
      source_ids: Object.freeze(uniq(flat((s) => s.manifest.source_ids))),
      tool_call_ids: Object.freeze(uniq(flat((s) => s.manifest.tool_call_ids))),
      tool_call_result_hashes: Object.freeze(flat((s) => s.manifest.tool_call_result_hashes)),
      series_specs: Object.freeze(flat((s) => s.manifest.series_specs)),
      as_of: maxAsOf,
    }),
  }) as SnapshotSealInput;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/analyze && node --experimental-strip-types --test test/seal-input-merge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/analyze/src/seal-input-merge.ts services/analyze/test/seal-input-merge.test.ts
git commit -m "feat(analyze): mergeSealInputs — fold section seal inputs into one

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: producer registry (`section-producers.ts`)

**Files:**
- Create: `services/analyze/src/section-producers.ts`
- Test: `services/analyze/test/section-producers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/analyze/test/section-producers.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { lookupSectionProducer, sectionBlockId } from "../src/section-producers.ts";

test("lookupSectionProducer resolves the peer_table producer for peer_comparison", () => {
  assert.equal(typeof lookupSectionProducer("peer_comparison", "peer_table"), "function");
});

test("lookupSectionProducer returns undefined for narrative sections and unknown playbooks", () => {
  assert.equal(lookupSectionProducer("peer_comparison", "summary"), undefined);
  assert.equal(lookupSectionProducer("earnings_quality", "margin_bridge"), undefined);
  assert.equal(lookupSectionProducer("nope", "peer_table"), undefined);
});

test("sectionBlockId is stable and section-scoped", () => {
  assert.equal(sectionBlockId("peer_table"), "peer_table-1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyze && node --experimental-strip-types --test test/section-producers.test.ts`
Expected: FAIL — cannot find module `../src/section-producers.ts`.

- [ ] **Step 3: Implement**

Create `services/analyze/src/section-producers.ts`:

```ts
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { PeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { StatsRepository } from "../../fundamentals/src/stats-repository.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import { emitPeerComparisonBlock } from "./metrics-comparison-emitter.ts";

export type SectionProducerDeps = {
  db: QueryExecutor;
  peers: PeerSetResolver;
  stats: StatsRepository;
  clock?: () => Date;
};

export type SectionProducerContext = {
  primary: IssuerSubjectRef;
  snapshotId: UUID;
  asOf: string;
};

export type SectionProducer = (
  deps: SectionProducerDeps,
  ctx: SectionProducerContext,
) => Promise<SnapshotSealInput | null>;

// Stable per-section block id. One block per section for now.
export function sectionBlockId(sectionId: string): string {
  return `${sectionId}-1`;
}

const PEER_TABLE_PRODUCER: SectionProducer = (deps, ctx) =>
  emitPeerComparisonBlock(
    { peers: deps.peers, stats: deps.stats, db: deps.db, clock: deps.clock },
    {
      primary: ctx.primary,
      snapshotId: ctx.snapshotId,
      blockId: sectionBlockId("peer_table"),
      asOf: ctx.asOf,
    },
  );

// Registry keyed by `${playbook_id}:${section_id}`. Sections absent here have no
// deterministic producer and are covered by the narrative memo.
const SECTION_PRODUCERS: ReadonlyMap<string, SectionProducer> = new Map([
  ["peer_comparison:peer_table", PEER_TABLE_PRODUCER],
]);

export function lookupSectionProducer(
  playbookId: string,
  sectionId: string,
): SectionProducer | undefined {
  return SECTION_PRODUCERS.get(`${playbookId}:${sectionId}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/analyze && node --experimental-strip-types --test test/section-producers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/analyze/src/section-producers.ts services/analyze/test/section-producers.test.ts
git commit -m "feat(analyze): section producer registry (peer_table -> emitter)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `runDeterministicSections`

**Files:**
- Create: `services/analyze/src/section-runner.ts`
- Test: `services/analyze/test/section-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/analyze/test/section-runner.test.ts`. It drives the real emitter through the runner using the same fake `peers`/`stats`/`db` shape as `services/analyze/test/metrics-comparison-emitter.test.ts` (read that file and reuse its `resolver`, `stats`, and `fakeDb()` constructions — copy them into this test's setup, or import shared helpers if you extract them). The two assertions that matter:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { runDeterministicSections } from "../src/section-runner.ts";
import { ANALYZE_PLAYBOOKS } from "../src/playbook.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
// Reuse the emitter test's fakes: copy `resolver`, `stats`, `fakeDb`, PRIMARY,
// AS_OF, SNAP from services/analyze/test/metrics-comparison-emitter.test.ts.
// (They build a one-peer gross_margin envelope + a stateful fake DB.)

const peerComparison = ANALYZE_PLAYBOOKS.find((p) => p.playbook_id === "peer_comparison")!;
const earningsQuality = ANALYZE_PLAYBOOKS.find((p) => p.playbook_id === "earnings_quality")!;

test("runDeterministicSections emits a metrics_comparison seal input for peer_comparison", async () => {
  const { db } = fakeDb();
  const seals = await runDeterministicSections(
    { db, peers: resolver, stats, clock: () => new Date("2025-01-15T12:00:00.000Z") },
    { playbook: peerComparison, primary: PRIMARY, snapshotId: SNAP, asOf: AS_OF },
  );

  assert.equal(seals.length, 1);
  assert.equal((seals[0].blocks[0] as { kind: string }).kind, "metrics_comparison");
  assert.ok(seals[0].manifest.fact_refs.length > 0);
});

test("runDeterministicSections returns [] when the playbook has no deterministic sections", async () => {
  const { db } = fakeDb();
  const seals = await runDeterministicSections(
    { db, peers: resolver, stats },
    { playbook: earningsQuality, primary: PRIMARY, snapshotId: SNAP, asOf: AS_OF },
  );
  assert.deepEqual(seals, []);
});

test("runDeterministicSections skips peer_table when primary is null", async () => {
  const { db } = fakeDb();
  const seals = await runDeterministicSections(
    { db, peers: resolver, stats },
    { playbook: peerComparison, primary: null, snapshotId: SNAP, asOf: AS_OF },
  );
  assert.deepEqual(seals, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyze && node --experimental-strip-types --test test/section-runner.test.ts`
Expected: FAIL — cannot find module `../src/section-runner.ts`.

- [ ] **Step 3: Implement**

Create `services/analyze/src/section-runner.ts`:

```ts
import type { AnalyzePlaybook } from "./playbook.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import { lookupSectionProducer, type SectionProducerDeps } from "./section-producers.ts";

export type RunSectionsInput = {
  playbook: AnalyzePlaybook;
  primary: IssuerSubjectRef | null;
  snapshotId: UUID;
  asOf: string;
};

// Walks the playbook's sections, invoking each registered deterministic producer
// and collecting its non-null seal input (in section order). Producers that need
// an issuer primary (peer_table) are skipped when `primary` is null. A producer
// returning null (no peers/facts) is skipped; a producer that throws propagates.
export async function runDeterministicSections(
  deps: SectionProducerDeps,
  input: RunSectionsInput,
): Promise<ReadonlyArray<SnapshotSealInput>> {
  const seals: SnapshotSealInput[] = [];
  for (const section of input.playbook.sections) {
    const producer = lookupSectionProducer(input.playbook.playbook_id, section.section_id);
    if (producer === undefined) continue;
    if (input.primary === null) continue; // every registered producer needs an issuer primary today
    const seal = await producer(deps, {
      primary: input.primary,
      snapshotId: input.snapshotId,
      asOf: input.asOf,
    });
    if (seal !== null) seals.push(seal);
  }
  return Object.freeze(seals);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/analyze && node --experimental-strip-types --test test/section-runner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full analyze suite (no regression)**

Run: `cd services/analyze && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/analyze/src/section-runner.ts services/analyze/test/section-runner.test.ts
git commit -m "feat(analyze): runDeterministicSections — walk playbook, collect seal inputs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `buildMemoSealInput` (memo path → SnapshotSealInput)

**Files:**
- Modify: `services/dev-api/src/local-runtime.ts`
- Test: `services/dev-api/test/local-runtime.integration.test.ts` (or the existing analyze run test — locate it)

Refactor `sealAnalyzeSnapshot` so its manifest-staging body becomes a reusable `buildMemoSealInput` that returns a `SnapshotSealInput`. `sealAnalyzeSnapshot` then becomes: build the memo seal input, seal it. This makes the memo path uniform with section seal inputs for merging in Task 5. Behavior is unchanged.

- [ ] **Step 1: Add `buildMemoSealInput` and route `sealAnalyzeSnapshot` through it**

In `services/dev-api/src/local-runtime.ts`, replace the body of `sealAnalyzeSnapshot` with:

```ts
export async function buildMemoSealInput(input: {
  snapshotId: string;
  userId: string;
  blocks: ReadonlyArray<Record<string, unknown>>;
}): Promise<SnapshotSealInput> {
  const blocks = input.blocks;
  const asOf = maxBlockAsOf(blocks) ?? new Date().toISOString();
  const subjectRefs = subjectRefsFromBlocks(blocks);
  const manifest = await manifestFromBlockRefs({
    subjectRefs,
    asOf,
    modelVersion: "dev-api-local-runtime",
    blocks,
  });
  const verifierRows = await loadVerifierRowsForRefs(pool(), {
    source_ids: manifest.source_ids,
    document_refs: manifest.document_refs,
    claim_refs: manifest.claim_refs,
    user_id: input.userId,
  });
  return {
    snapshot_id: input.snapshotId,
    manifest,
    blocks: blocks as never,
    sources: verifierRows.sources,
    documents: verifierRows.documents,
    claims: verifierRows.claims,
  };
}

export async function sealAnalyzeSnapshot(
  input: Parameters<DevApiServiceAdapterDeps["sealAnalyzeSnapshot"]>[0],
) {
  const sealInput = await buildMemoSealInput({
    snapshotId: input.snapshotId,
    userId: input.userId,
    blocks: input.blocks as ReadonlyArray<Record<string, unknown>>,
  });
  return sealSnapshotWithPool(pool(), sealInput);
}
```

Add the import for the type at the top of the file if not present:

```ts
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
```

- [ ] **Step 2: Run the dev-api analyze tests (behavior unchanged)**

Run: `cd services/dev-api && npm test`
Expected: PASS (the existing analyze run + seal tests still pass — `sealAnalyzeSnapshot` produces the same seal as before).

- [ ] **Step 3: Commit**

```bash
git add services/dev-api/src/local-runtime.ts
git commit -m "refactor(dev-api): extract buildMemoSealInput from sealAnalyzeSnapshot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire sections + merge into the analyze run path

**Files:**
- Modify: `services/dev-api/src/local-runtime.ts` (a new `sealAnalyzeSnapshotWithSections` helper)
- Modify: `services/dev-api/src/http.ts` (`createRun` passes the resolved playbook + primary issuer; the seal callback merges)
- Test: extend `services/dev-api/test/*analyze*`

The run must: build the memo seal input, run the deterministic sections on the pool, merge, and seal the merged input. The section deps (`peers`, `stats`) are constructed from the dev-api pool + SEC env. **Scope note:** wire only the `createRun` path (`http.ts:985`); the `rerun` path (`http.ts:1084`) stays memo-only for v1 — leave it on `deps.sealAnalyzeSnapshot` and file a follow-up bead to extend rerun once createRun lands.

- [ ] **Step 1: Add the section deps + primary-issuer helpers in `local-runtime.ts`**

Add to `services/dev-api/src/local-runtime.ts` (imports at top). The section deps (`peers`, `stats`) are constructed from the pool + SEC env exactly as `services/fundamentals/src/dev.ts:44-52` does it — the stats repo is SEC-backed and needs a `statements` repo + an optional fetcher, NOT a bare `(pool)` call:

```ts
import { runDeterministicSections } from "../../analyze/src/section-runner.ts";
import { mergeSealInputs } from "../../analyze/src/seal-input-merge.ts";
import type { AnalyzePlaybook } from "../../analyze/src/playbook.ts";
import { createSqlPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import {
  createSecBackedStatementRepository,
  createSecBackedStatsRepository,
} from "../../fundamentals/src/sec-facts-repository.ts";
import { createSecCompanyFactsHttpFetcher } from "../../fundamentals/src/sec-edgar-http.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "../../fundamentals/src/provider-sources.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
```

> Confirm two import paths before writing (they are stable but verify): `SEC_EDGAR_FILING_SOURCE_ID`'s module (grep `rg -n "export const SEC_EDGAR_FILING_SOURCE_ID" services/fundamentals/src`) and that `createSecBackedStatementRepository(pool, { fetcher, sourceId })` matches `services/fundamentals/src/dev.ts:50-53`.

```ts
// Mirrors services/fundamentals/src/dev.ts: a SEC-backed stats repo reading
// persisted facts, with an optional live fetcher when SEC_EDGAR_USER_AGENT is set.
function analyzeSectionDeps() {
  const db = pool();
  const secFetcher = process.env.SEC_EDGAR_USER_AGENT
    ? createSecCompanyFactsHttpFetcher({
        userAgent: process.env.SEC_EDGAR_USER_AGENT,
        baseUrl: process.env.SEC_EDGAR_BASE_URL,
      })
    : null;
  const statements = createSecBackedStatementRepository(db, {
    fetcher: secFetcher,
    sourceId: SEC_EDGAR_FILING_SOURCE_ID,
  });
  const stats = createSecBackedStatsRepository(db, { statements, fetcher: secFetcher });
  return { db, peers: createSqlPeerSetResolver(db), stats };
}

function primaryIssuerRef(
  subjectRefs: ReadonlyArray<{ kind: string; id: string }>,
): IssuerSubjectRef | null {
  const issuer = subjectRefs.find((ref) => ref.kind === "issuer");
  return issuer ? { kind: "issuer", id: issuer.id } : null;
}
```

`SnapshotSealResult` is already imported in this file (used by `sealAnalyzeSnapshot`'s return); if not, add `import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";`.

- [ ] **Step 2: Make the section seal's blocks reach persistence**

The persisted run row stores `blocks` (passed to `persistAnalyzeTemplateRunAfterSnapshotSealWithPool`). The section blocks live inside the merged seal input, which is built inside the seal callback — too late for the persisted `blocks` arg. So `createRun` must compute the section blocks up front. Refactor: run the sections once in `createRun`, use the result for BOTH the persisted `blocks` and the seal. Update `sealAnalyzeSnapshotWithSections` to accept a precomputed `sectionSeals` instead of running them itself — keeping a single section run:

In `local-runtime.ts`, split the helper:

```ts
export async function buildAnalyzeRunSeals(input: {
  snapshotId: string;
  userId: string;
  memoBlocks: ReadonlyArray<Record<string, unknown>>;
  playbook: AnalyzePlaybook;
  subjectRefs: ReadonlyArray<{ kind: string; id: string }>;
  asOf: string;
}): Promise<{ blocks: ReadonlyArray<Record<string, unknown>>; merged: SnapshotSealInput }> {
  const memoSeal = await buildMemoSealInput({
    snapshotId: input.snapshotId,
    userId: input.userId,
    blocks: input.memoBlocks,
  });
  const sectionSeals = await runDeterministicSections(
    analyzeSectionDeps(),
    { playbook: input.playbook, primary: primaryIssuerRef(input.subjectRefs), snapshotId: input.snapshotId, asOf: input.asOf },
  );
  const merged = mergeSealInputs(memoSeal, sectionSeals);
  return { blocks: merged.blocks as ReadonlyArray<Record<string, unknown>>, merged };
}
```

- [ ] **Step 3: Wire `createRun` to use it**

In `services/dev-api/src/http.ts` `createRun`, after `const rendered = await deps.runAnalyzeWorkflow({...})` and the `const blocks = Object.freeze(...)` line, compute the run seals and use `merged.blocks` for persistence + the merged seal in the callback. Replace the `persistAnalyzeTemplateRunAfterSnapshotSealWithPool(...)` block with:

```ts
        const memoBlocks = rendered.blocks.map((block) => ({ ...block }));
        const runAsOf = (memoBlocks[0]?.as_of as string | undefined) ?? new Date().toISOString();
        const runSeals = await deps.buildAnalyzeRunSeals({
          snapshotId,
          userId,
          memoBlocks,
          playbook: resolvedPlaybook.playbook,
          subjectRefs,
          asOf: runAsOf,
        });
        const blocks = Object.freeze(runSeals.blocks.map((block) => Object.freeze({ ...block })));
        const persisted = await persistAnalyzeTemplateRunAfterSnapshotSealWithPool(deps.db, {
          template_id: template.template_id,
          template_version: template.version,
          blocks: blocks as JsonValue,
          playbook_id: resolvedPlaybook.playbook.playbook_id,
          run_metadata: runMetadata as unknown as JsonValue,
          sealSnapshot: async () => {
            const seal = await sealSnapshotWithPool(deps.pool(), runSeals.merged);
            if (seal.ok && seal.snapshot.snapshot_id !== snapshotId) {
              return { ok: false, verification: { ok: false, failures: [{ reason_code: "invalid_block_binding", details: { reason: "analyze_snapshot_id_mismatch", expected_snapshot_id: snapshotId, actual_snapshot_id: seal.snapshot.snapshot_id } }] } };
            }
            return seal;
          },
        });
```

Wire `deps.buildAnalyzeRunSeals` (and `deps.pool`/`sealSnapshotWithPool`) into the `DevApiServiceAdapterDeps` the same way `deps.sealAnalyzeSnapshot` is wired today (find where the adapter deps object is constructed — likely `services/dev-api/src/dev.ts` or a `createDevApiServiceAdapter` — and add `buildAnalyzeRunSeals: buildAnalyzeRunSeals`). `deps.sealAnalyzeSnapshot` may now be unused by `createRun`; leave it (other callers/rerun may use it) unless grep shows no remaining users.

> Before this step, grep the deps wiring: `rg -n "sealAnalyzeSnapshot|runAnalyzeWorkflow|DevApiServiceAdapterDeps" services/dev-api/src` to find exactly where to register `buildAnalyzeRunSeals` and how `pool`/`sealSnapshotWithPool` are reached inside `createRun`.

- [ ] **Step 4: Write/extend the run-path test**

Extend the existing dev-api analyze run test (locate via `rg -ln "createRun|analyze/runs|runAnalyzeWorkflow" services/dev-api/test`). Add a case: a `peer_comparison` run (with an issuer subject and a fake/seeded peer + metric facts) produces blocks containing a `metrics_comparison` block AND the merged seal verifies with non-empty `fact_refs`. If the existing test harness can't seed peers/facts, assert the narrower invariant the integration guarantees: for a playbook with no deterministic sections (e.g. `earnings_quality`), `buildAnalyzeRunSeals` returns `merged.blocks` equal to the memo blocks and `merged === memoSeal`-equivalent (behavior unchanged) — and unit-cover the `peer_comparison` value path via Task 3.

```ts
// Minimal regression: earnings_quality (no deterministic sections) is unchanged.
test("buildAnalyzeRunSeals leaves a no-producer playbook's blocks unchanged", async () => {
  const memoBlocks = [{ id: "memo", kind: "rich_text", as_of: "2026-01-01T00:00:00.000Z", subject_refs: [{ kind: "issuer", id: "00000000-0000-4000-a000-000000000001" }] }];
  const { blocks } = await buildAnalyzeRunSeals({
    snapshotId: "11111111-1111-4111-a111-111111111111",
    userId: "00000000-0000-4000-a000-0000000000aa",
    memoBlocks,
    playbook: ANALYZE_PLAYBOOKS.find((p) => p.playbook_id === "earnings_quality")!,
    subjectRefs: [{ kind: "issuer", id: "00000000-0000-4000-a000-000000000001" }],
    asOf: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(blocks.length, 1);
  assert.equal((blocks[0] as { id: string }).id, "memo");
});
```

(This test needs a live pool for `buildMemoSealInput`'s `loadVerifierRowsForRefs`/`manifestFromBlockRefs`; if the dev-api test suite runs against the dev DB like its other integration tests, follow that harness. If not, keep the deterministic value-path coverage in Task 3 and assert the merge invariants in Task 1, and limit this step to confirming the run compiles + the full suite is green.)

- [ ] **Step 5: Run the dev-api suite**

Run: `cd services/dev-api && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/dev-api/src/local-runtime.ts services/dev-api/src/http.ts services/dev-api/src/dev.ts services/dev-api/test
git commit -m "feat(dev-api): run deterministic sections + merge into the analyze seal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Producer registry `(playbook_id, section_id) → SectionProducer` (spec Unit 1) → Task 2. ✓
- `runDeterministicSections` + null-primary skip + null/throw handling (spec Unit 2) → Task 3. ✓
- `mergeSealInputs` pure fold (spec Unit 2 / the heart) → Task 1. ✓
- Memo path yields a `SnapshotSealInput` (spec dev-api wiring) → Task 4. ✓
- dev-api run path: run sections on pool, merge, seal merged; section blocks persisted (spec data flow) → Task 5. ✓
- Materialize-on-pool, separate seal/persist txns (spec atomicity) → Task 5 (deps.db = pool). ✓
- Non-issuer subject → skip peer_table (spec edge) → Task 3 (`primary: null`) + Task 5 (`primaryIssuerRef`). ✓
- Tests: registry, merge, runner, run-path (spec Testing) → Tasks 1–3, 5. ✓

**Type consistency:** `SectionProducerDeps`/`SectionProducerContext`/`SectionProducer` defined in Task 2, consumed in Task 3 + Task 5. `mergeSealInputs(base, sections)` defined Task 1, used Task 5. `buildMemoSealInput` defined Task 4, used Task 5. `runDeterministicSections(deps, {playbook, primary, snapshotId, asOf})` identical across Task 3 def/test and Task 5 call. `SnapshotSealInput` is the shared currency throughout. ✓

**Placeholder scan:** Tasks 1–4 carry complete code + assertions. Task 5 contains two explicit "grep to confirm before writing" notes (stats-repo constructor name; deps-wiring location) — these are genuine integration-discovery points the implementer must resolve against live code, not vague hand-waving; the surrounding edits are concrete. Acceptable, but flagged so the executor reads those two call sites first.
