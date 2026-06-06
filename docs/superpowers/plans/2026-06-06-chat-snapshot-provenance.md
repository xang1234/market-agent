# Chat Snapshot Provenance Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cite quote+fundamentals `source_id`s and fundamentals `fact_id`s in sealed chat snapshots, so answers grounded in structured data are provenance-linked.

**Architecture:** Thread the structured context's refs through the existing blocks → manifest → verifier pipeline: the reader exposes `fact_id`; the tool runtime seeds block default-refs from the structured context; `manifest.fact_refs` derives from blocks (symmetric with `source_ids`); the seal loads those facts and passes them to the verifier.

**Tech Stack:** Node `--experimental-strip-types` services, `node:test`, PostgreSQL (`facts`/`snapshots`), docker-pg harness at `db/test/docker-pg.ts`.

**Branch:** cut `feat/fra-eegq-snapshot-provenance` off `feat/fra-savt-fundamentals-reader` (this extends that reader).

**Test commands:**
- Fundamentals: `cd services/fundamentals && node --experimental-strip-types --test 'test/**/*.test.ts'`
- Evidence: `cd services/evidence && node --experimental-strip-types --test 'test/**/*.test.ts'`
- Chat: `cd services/chat && node --experimental-strip-types --test 'test/**/*.test.ts'`
- Single file: `node --experimental-strip-types --test test/<file>.test.ts`

---

## File Structure

- **Modify** `services/fundamentals/src/issuer-fundamentals-reader.ts` — add `fact_id` to `IssuerFundamentalFact` + select.
- **Modify** `services/fundamentals/test/issuer-fundamentals-reader.test.ts` — assert `fact_id`.
- **Create** in `services/evidence/src/local-runtime-evidence.ts` — `loadVerifierFactsForRefs` (sibling of `loadVerifierRowsForRefs`).
- **Create** `services/evidence/test/load-verifier-facts.test.ts` — recording-fake unit test for the loader.
- **Modify** `services/chat/src/local-runtime.ts` — structured extractor, combined default-refs, block `fact_refs` default, manifest `fact_refs`, seal loads+passes facts.
- **Create** `services/chat/test/local-runtime-structured-refs.test.ts` — pure unit test for the extractor + combined default-refs.
- **Modify** `services/chat/test/local-runtime.integration.test.ts` — e2e seal test asserting `fact_refs`/`source_ids`.

---

## Task 0: Branch

- [ ] **Step 1: Cut the stacked branch**

```bash
cd /Users/admin/Documents/Work/market-agent
git checkout feat/fra-savt-fundamentals-reader
git checkout -b feat/fra-eegq-snapshot-provenance
bd update fra-eegq --claim
```

---

## Task 1: Reader exposes `fact_id`

**Files:**
- Modify: `services/fundamentals/src/issuer-fundamentals-reader.ts`
- Test: `services/fundamentals/test/issuer-fundamentals-reader.test.ts`

- [ ] **Step 1: Extend the existing reader unit test**

In `services/fundamentals/test/issuer-fundamentals-reader.test.ts`, in the third test ("coerces numeric/Date columns..."), add `fact_id` to the seeded row and assert it:

```ts
  const { db } = recordingDb([
    {
      fact_id: "99999999-9999-4999-8999-999999999999",
      metric_key: "revenue",
      display_name: "Revenue",
      value_num: "190872000",
      value_text: null,
      unit: "currency",
      currency: "USD",
      fiscal_year: 2021,
      fiscal_period: "FY",
      as_of: new Date("2026-05-08T16:57:05.951Z"),
      source_id: "00000000-0000-4000-a000-000000000001",
    },
  ]);
  const [fact] = await loadRecentIssuerFundamentals(db, ISSUER, { limit: 24 });
  assert.equal(fact.fact_id, "99999999-9999-4999-8999-999999999999");
  assert.equal(fact.value_num, 190872000);
```

Also add to the first test (the query-shape test) an assertion that `f.fact_id` is selected:

```ts
  assert.match(text, /f\.fact_id::text as fact_id/);
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/fundamentals && node --experimental-strip-types --test test/issuer-fundamentals-reader.test.ts`
Expected: FAIL — `fact.fact_id` is undefined and the SQL lacks `f.fact_id`.

- [ ] **Step 3: Add `fact_id` to the reader**

In `services/fundamentals/src/issuer-fundamentals-reader.ts`:

Add to `IssuerFundamentalFact` (first field):
```ts
export type IssuerFundamentalFact = {
  fact_id: string;
  metric_key: string;
  // ...unchanged
```

Add `fact_id` to the private `FactRow` type (first field):
```ts
type FactRow = {
  fact_id: string;
  metric_key: string;
  // ...unchanged
```

Add the column to the select (first selected column):
```ts
    `select f.fact_id::text as fact_id,
            m.metric_key,
            m.display_name,
            // ...unchanged
```

Add to `factFromRow` (first mapped field):
```ts
function factFromRow(row: FactRow): IssuerFundamentalFact {
  return Object.freeze({
    fact_id: row.fact_id,
    metric_key: row.metric_key,
    // ...unchanged
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd services/fundamentals && node --experimental-strip-types --test test/issuer-fundamentals-reader.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/fundamentals/src/issuer-fundamentals-reader.ts services/fundamentals/test/issuer-fundamentals-reader.test.ts
git commit -m "feat(fundamentals): expose fact_id on IssuerFundamentalFact (fra-eegq)"
```

---

## Task 2: `loadVerifierFactsForRefs` in evidence

**Files:**
- Modify: `services/evidence/src/local-runtime-evidence.ts`
- Test: `services/evidence/test/load-verifier-facts.test.ts`

This loads the facts the seal must hand the verifier (today the chat seal passes none). It mirrors `loadVerifierRowsForRefs` (same file). Entitlement of the *sources* is enforced by the existing source load; this loads facts by id (active rows only).

- [ ] **Step 1: Write the failing unit test**

Create `services/evidence/test/load-verifier-facts.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { QueryExecutor } from "../src/types.ts";
import { loadVerifierFactsForRefs } from "../src/local-runtime-evidence.ts";

const FACT_ID = "11111111-1111-4111-8111-111111111111";

function recordingDb(rows: unknown[]): { db: QueryExecutor; calls: Array<{ text: string; values: unknown[] }> } {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db: QueryExecutor = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values: values ?? [] });
      return { rows, rowCount: rows.length } as never;
    },
  };
  return { db, calls };
}

test("loadVerifierFactsForRefs returns [] without a query when there are no refs", async () => {
  const { db, calls } = recordingDb([]);
  const facts = await loadVerifierFactsForRefs(db, { fact_refs: [] });
  assert.deepEqual(facts, []);
  assert.equal(calls.length, 0);
});

test("loadVerifierFactsForRefs selects verifier fact fields for active facts by id", async () => {
  const { db, calls } = recordingDb([
    {
      fact_id: FACT_ID,
      source_id: "22222222-2222-4222-8222-222222222222",
      unit: "currency",
      period_kind: "fiscal_y",
      period_start: null,
      period_end: null,
      fiscal_year: 2024,
      fiscal_period: "FY",
    },
  ]);
  const facts = await loadVerifierFactsForRefs(db, { fact_refs: [FACT_ID, FACT_ID] });
  // de-duped fact_ids bound as a uuid[] param
  assert.deepEqual(calls[0].values, [[FACT_ID]]);
  assert.match(calls[0].text, /from facts/);
  assert.match(calls[0].text, /fact_id = any\(\$1::uuid\[\]\)/);
  assert.match(calls[0].text, /superseded_by is null/);
  assert.match(calls[0].text, /invalidated_at is null/);
  assert.deepEqual(facts, [
    {
      fact_id: FACT_ID,
      source_id: "22222222-2222-4222-8222-222222222222",
      unit: "currency",
      period_kind: "fiscal_y",
      period_start: null,
      period_end: null,
      fiscal_year: 2024,
      fiscal_period: "FY",
    },
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/evidence && node --experimental-strip-types --test test/load-verifier-facts.test.ts`
Expected: FAIL — `loadVerifierFactsForRefs` is not exported.

- [ ] **Step 3: Implement the loader**

In `services/evidence/src/local-runtime-evidence.ts`, add an import of `VerifierFact` (top of file, with the other snapshot imports — confirm the path resolves; `VerifierFact` is exported from `../../snapshot/src/snapshot-verifier.ts`):

```ts
import type { VerifierFact } from "../../snapshot/src/snapshot-verifier.ts";
```

Add the function next to `loadVerifierRowsForRefs` (it reuses the file's existing `unique` helper):

```ts
export async function loadVerifierFactsForRefs(
  db: QueryExecutor,
  input: { fact_refs: ReadonlyArray<string>; user_id?: string | null },
): Promise<ReadonlyArray<VerifierFact>> {
  const factIds = unique(input.fact_refs);
  if (factIds.length === 0) return Object.freeze([]);
  const { rows } = await db.query<{
    fact_id: string;
    source_id: string;
    unit: string | null;
    period_kind: string | null;
    period_start: string | null;
    period_end: string | null;
    fiscal_year: number | null;
    fiscal_period: string | null;
  }>(
    `select fact_id::text as fact_id,
            source_id::text as source_id,
            unit,
            period_kind,
            period_start::text as period_start,
            period_end::text as period_end,
            fiscal_year,
            fiscal_period
       from facts
      where fact_id = any($1::uuid[])
        and superseded_by is null
        and invalidated_at is null`,
    [factIds],
  );
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        fact_id: row.fact_id,
        source_id: row.source_id,
        unit: row.unit ?? undefined,
        period_kind: row.period_kind ?? undefined,
        period_start: row.period_start,
        period_end: row.period_end,
        fiscal_year: row.fiscal_year,
        fiscal_period: row.fiscal_period,
      }),
    ),
  );
}
```

Note: the test expects exact-equality on the returned object, so the mapping above must match the test's expected shape. If `unit`/`period_kind` come back as `undefined` (via `?? undefined`) the test's expected object uses concrete strings (non-null row), so they match. Keep the mapping as written.

- [ ] **Step 4: Run to verify it passes**

Run: `cd services/evidence && node --experimental-strip-types --test test/load-verifier-facts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/evidence/src/local-runtime-evidence.ts services/evidence/test/load-verifier-facts.test.ts
git commit -m "feat(evidence): loadVerifierFactsForRefs for snapshot seal (fra-eegq)"
```

---

## Task 3: thread structured refs through chat blocks → manifest → seal

**Files:**
- Modify: `services/chat/src/local-runtime.ts`
- Test: `services/chat/test/local-runtime-structured-refs.test.ts`

The pure ref-combining logic gets a unit test; the manifest+seal wiring is proven by Task 4's integration test.

- [ ] **Step 1: Write the failing unit test**

Create `services/chat/test/local-runtime-structured-refs.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { combinedDefaultRefs } from "../src/local-runtime.ts";

test("combinedDefaultRefs unions evidence + structured source_ids and collects fact_ids", () => {
  const refs = combinedDefaultRefs(
    // evidence
    [{ source_ids: ["s-evi-1", "s-shared"], claim_refs: ["c-1"], document_refs: ["d-1"] }],
    // structured context entries
    [
      {
        source_ids: ["s-shared", "s-fact-1", "s-quote-1"],
        facts: [{ fact_id: "f-1" }, { fact_id: "f-2" }],
      },
    ],
  );
  assert.deepEqual(refs.source_refs, ["s-evi-1", "s-shared", "s-fact-1", "s-quote-1"]);
  assert.deepEqual(refs.claim_refs, ["c-1"]);
  assert.deepEqual(refs.document_refs, ["d-1"]);
  assert.deepEqual(refs.fact_refs, ["f-1", "f-2"]);
});

test("combinedDefaultRefs with no structured context equals the evidence-only refs", () => {
  const refs = combinedDefaultRefs(
    [{ source_ids: ["s-1"], claim_refs: ["c-1"], document_refs: [] }],
    [],
  );
  assert.deepEqual(refs.source_refs, ["s-1"]);
  assert.deepEqual(refs.fact_refs, []);
});
```

(`combinedDefaultRefs` takes the same `LocalRuntimeEvidence[]` shape `defaultEvidenceRefs` consumes — only `source_ids`/`claim_refs`/`document_refs` are read — plus extracted structured entries.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/chat && node --experimental-strip-types --test test/local-runtime-structured-refs.test.ts`
Expected: FAIL — `combinedDefaultRefs` is not exported.

- [ ] **Step 3: Add the extractor + combined refs, and wire them in**

In `services/chat/src/local-runtime.ts`:

(a) Add a structured-context extractor next to `evidenceForToolCalls` (mirrors it; uses the existing `isJsonObject`):

```ts
type StructuredContextRefs = {
  source_ids: ReadonlyArray<string>;
  facts: ReadonlyArray<{ fact_id: string }>;
};

function structuredContextForToolCalls(
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>,
): ReadonlyArray<StructuredContextRefs> {
  return Object.freeze(
    toolCalls.flatMap((toolCall) => {
      if (toolCall.status !== "ok" || !isJsonObject(toolCall.result)) return [];
      const ctx = toolCall.result.structured_context;
      if (!isJsonObject(ctx)) return [];
      const source_ids = Array.isArray(ctx.source_ids)
        ? ctx.source_ids.filter((id): id is string => typeof id === "string")
        : [];
      const facts = Array.isArray(ctx.facts)
        ? ctx.facts.flatMap((fact) =>
            isJsonObject(fact) && typeof fact.fact_id === "string" ? [{ fact_id: fact.fact_id }] : [],
          )
        : [];
      return [{ source_ids, facts }];
    }),
  );
}
```

(b) Add `combinedDefaultRefs` (extends `defaultEvidenceRefs`; `firstSeen` already exists in this file):

```ts
export function combinedDefaultRefs(
  evidence: ReadonlyArray<LocalRuntimeEvidence>,
  structured: ReadonlyArray<StructuredContextRefs>,
): {
  source_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  fact_refs: ReadonlyArray<string>;
} {
  const base = defaultEvidenceRefs(evidence);
  return {
    source_refs: firstSeen([...base.source_refs, ...structured.flatMap((s) => s.source_ids)]),
    claim_refs: base.claim_refs,
    document_refs: base.document_refs,
    fact_refs: firstSeen(structured.flatMap((s) => s.facts.map((f) => f.fact_id))),
  };
}
```

(c) Replace line ~136 `const defaultRefs = defaultEvidenceRefs(evidence);` with:

```ts
  const structured = structuredContextForToolCalls(result.tool_calls ?? []);
  const defaultRefs = combinedDefaultRefs(evidence, structured);
```

(d) In `normalizeAssistantBlock`, add `fact_refs` to the `defaultRefs` param type and default it on the block (parallel to `source_refs`):

```ts
    defaultRefs: {
      source_refs: ReadonlyArray<string>;
      claim_refs: ReadonlyArray<string>;
      document_refs: ReadonlyArray<string>;
      fact_refs: ReadonlyArray<string>;
    };
```
and in the returned object (after `document_refs`):
```ts
    fact_refs: Array.isArray(block.fact_refs) && block.fact_refs.length > 0
      ? block.fact_refs
      : input.defaultRefs.fact_refs,
```

(e) In `manifestFromBlockRefs`, change `fact_refs: Object.freeze([])` to:
```ts
    fact_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "fact_refs")),
```

(f) In `sealAssistantMessageSnapshot`, after `const verifierRows = await loadVerifierRowsForRefs(...)`, load the facts and pass them. Add `loadVerifierFactsForRefs` to the import from `../../evidence/src/local-runtime-evidence.ts`, then:

```ts
  const facts = await loadVerifierFactsForRefs(pool(), {
    fact_refs: manifest.fact_refs,
    user_id: userId,
  });
  return sealSnapshotWithPool(pool(), {
    snapshot_id: snapshotId,
    thread_id: input.threadId,
    manifest,
    blocks: blocks as never,
    facts,
    sources: verifierRows.sources,
    documents: verifierRows.documents,
    claims: verifierRows.claims,
  });
```

- [ ] **Step 4: Run the unit test + the full chat suite**

Run: `cd services/chat && node --experimental-strip-types --test test/local-runtime-structured-refs.test.ts`
Expected: PASS (2 tests).

Run: `cd services/chat && node --experimental-strip-types --test 'test/**/*.test.ts'`
Expected: PASS (the existing integration test still passes — with no structured context its `fact_refs` are `[]`, identical to before).

- [ ] **Step 5: Commit**

```bash
git add services/chat/src/local-runtime.ts services/chat/test/local-runtime-structured-refs.test.ts
git commit -m "feat(chat): thread structured source/fact refs into sealed manifest (fra-eegq)"
```

---

## Task 4: end-to-end seal integration test

**Files:**
- Modify: `services/chat/test/local-runtime.integration.test.ts`

Prove the full path: a resolved issuer subject with a seeded fundamentals fact → blocks carry `fact_refs` + the fact's `source_refs` → the persisted snapshot has `fact_refs == [factId]` and `source_ids` ⊇ {fact source}, **and the seal verifies** (persistence succeeds).

`analystToolRuntime` surfaces structured context only when `context.subjectPreResolution.status === "resolved"`. `structuredRefsFromHandoff` yields the issuer when `handoff.subject_ref.kind === "issuer"`, so a minimal handoff `{ subject_ref: issuerRef, context: {} }` is enough (no listings → no quote; the quote's source-merge is covered by Task 3's unit test).

**Before writing:** read the `ChatSubjectPreResolution` / `HydratedSubjectHandoff` types (imported in `local-runtime.ts` from `./subjects.ts` and `../../resolver/src/flow.ts`) to fill any required fields on the fixtures below; and read `createFact` + the `metrics` insert from `services/fundamentals/test/issuer-fundamentals-reader.integration.test.ts` (Task 3 of fra-savt) — reuse that exact `seedSource`/`seedRevenueMetric`/`revenueFact` pattern.

- [ ] **Step 1: Add the integration test**

Append to `services/chat/test/local-runtime.integration.test.ts` (imports: add `createFact` from `../../evidence/src/fact-repo.ts`):

```ts
test("chat snapshot cites fundamentals fact_refs and their source for a resolved issuer", {
  skip: !dockerAvailable(),
  timeout: 120_000,
}, async (t) => {
  const ISSUER_ID = "40000000-0000-4000-8000-000000000004";
  const { databaseUrl } = await bootstrapDatabase(t, "chat-provenance");
  const previousChatUrl = process.env.CHAT_DATABASE_URL;
  process.env.CHAT_DATABASE_URL = databaseUrl;
  delete process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  registerLifoCleanup(t, async () => {
    await closeLocalRuntimePoolForTests();
    restoreEnv("CHAT_DATABASE_URL", previousChatUrl);
  });

  const client = await connectedClient(t, databaseUrl);
  await seedUser(client);
  const thread = await createThread(client, USER_ID, { title: "Provenance" });

  // Seed a public source + revenue metric + one authoritative app-entitled FY fact.
  // (Reuse the seedSource/seedRevenueMetric/revenueFact helpers from the fra-savt
  //  fundamentals integration test — same column shapes.)
  const sourceId = await seedSource(client);          // public source (user_id null)
  const metricId = await seedRevenueMetric(client);
  const fact = await createFact(client, /* revenueFact(metricId, sourceId, { fiscal_year: 2024, value_num: 100, verification_status: "authoritative", entitlement_channels: ["app"] }) with subject_id: ISSUER_ID */ undefined as never);
  const factId = fact.fact_id;

  const issuerRef = { kind: "issuer" as const, id: ISSUER_ID };
  const result = await analystToolRuntime({
    threadId: thread.thread_id,
    runId: RUN_ID,
    turnId: TURN_ID,
    userId: USER_ID,
    bundleId: "single_subject_analysis",
    userIntent: "Summarize revenue",
    emit: (() => ({}) as never),
    // Minimal resolved handoff so structuredRefsFromHandoff yields the issuer.
    subjectPreResolution: {
      status: "resolved",
      subject_ref: issuerRef,
      handoff: { subject_ref: issuerRef, context: {} },
    } as never,
  });

  // The answer's blocks default-cite the fundamentals fact + its source.
  assert.ok((result.blocks[0]?.fact_refs as unknown[]).includes(factId));
  assert.ok((result.blocks[0]?.source_refs as unknown[]).includes(sourceId));

  const persisted = await persistAssistantMessage({
    threadId: thread.thread_id,
    runId: RUN_ID,
    turnId: TURN_ID,
    role: "assistant",
    blocks: result.blocks,
    content_hash: contentHash(JSON.stringify(result.blocks)),
  });
  // Seal verified (no throw) and the manifest carries the provenance.
  assert.equal(persisted.snapshot_id, result.snapshot_id);

  const snap = (await client.query<{ fact_refs: unknown; source_ids: unknown }>(
    `select fact_refs, source_ids from snapshots where snapshot_id = $1::uuid`,
    [result.snapshot_id],
  )).rows[0];
  assert.deepEqual(snap?.fact_refs, [factId]);
  assert.ok((snap?.source_ids as string[]).includes(sourceId));
});
```

Fill the `createFact` call with the concrete `revenueFact(...)` input (subject_id = `ISSUER_ID`) once you've copied the helpers. Copy `seedSource`/`seedRevenueMetric`/`revenueFact` verbatim from `services/fundamentals/test/issuer-fundamentals-reader.integration.test.ts`.

- [ ] **Step 2: Run it**

Run: `cd services/chat && node --experimental-strip-types --test test/local-runtime.integration.test.ts`
Expected: with Docker — PASS (both the existing test and the new one). If the new test fails on `missing_fact_ref`/`missing_source_ref`, the seal didn't load the fact or its source — check that `loadVerifierFactsForRefs` is wired into `sealAssistantMessageSnapshot` and that the source is public (`user_id` null).

- [ ] **Step 3: Commit**

```bash
git add services/chat/test/local-runtime.integration.test.ts
git commit -m "test(chat): e2e snapshot cites fundamentals fact_refs + source (fra-eegq)"
```

---

## Task 5: full verification + finish

- [ ] **Step 1: Run the three affected suites**

```bash
cd services/fundamentals && node --experimental-strip-types --test 'test/**/*.test.ts'
cd ../evidence && node --experimental-strip-types --test 'test/**/*.test.ts'
cd ../chat && node --experimental-strip-types --test 'test/**/*.test.ts'
```
Expected: all pass (docker integration tests run when Docker is available).

- [ ] **Step 2: Close the bead, push**

```bash
bd close fra-eegq --reason="Chat snapshots now cite quote+fundamentals source_ids and fundamentals fact_refs: reader exposes fact_id, tool runtime seeds block default-refs from structured context, manifest.fact_refs derives from blocks, seal loads facts via loadVerifierFactsForRefs and passes them to the verifier. e2e integration test proves fact_refs + source cited and seal verifies."
git push -u origin feat/fra-eegq-snapshot-provenance
```

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch to verify tests and present merge/PR options.

---

## Self-Review

**Spec coverage:**
- Reader `fact_id` → Task 1. ✓
- Structured refs into block default-refs (extractor + combined refs + normalizeAssistantBlock) → Task 3 (a)(b)(c)(d). ✓
- Manifest `fact_refs` from blocks → Task 3 (e). ✓
- Seal loads facts + passes to verifier (`loadVerifierFactsForRefs`) → Task 2 + Task 3 (f). ✓
- Verifier unchanged → no task (correct). ✓
- Error handling (hard-fail, public-source invariant) → covered by Task 4 proving the happy-path seal verifies. ✓
- Tests: reader unit (T1), loader unit (T2), refs unit (T3), e2e seal (T4). ✓

**Placeholder scan:** Task 4's `createFact(...)` input and the `seedSource`/`seedRevenueMetric`/`revenueFact` helpers are explicitly deferred to copy-from-fra-savt-test, not invented — the assertions (`fact_refs == [factId]`, `source_ids` ⊇ sourceId, seal succeeds) are fully concrete. The `subjectPreResolution`/`handoff` fixtures are typed `as never` with a read-the-types instruction because their exact required fields must match `ChatSubjectPreResolution`/`HydratedSubjectHandoff`.

**Type consistency:** `loadVerifierFactsForRefs(db, { fact_refs, user_id })` and `VerifierFact` used identically in Tasks 2/3. `combinedDefaultRefs(evidence, structured)` shape matches its consumer in Task 3(c) and the `normalizeAssistantBlock` `defaultRefs` type in 3(d). `IssuerFundamentalFact.fact_id` (T1) is what the structured extractor reads (T3a) and the manifest cites (T3e).
