# Analyst Grid Reader Columns ("Question Columns") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add free-form question columns to Analyst Grids: per row, select recent documents for the subject, extract question-relevant claims with the reader LLM, and seal a claim-backed `rich_text` answer into the cell.

**Architecture:** A new `reader_question` column-catalog entry runs a per-cell pipeline (document selection via `mentions` → reader LLM extraction → claim persistence → tool-call log → claim-backed seal). Column params (`{prompt}`) thread from `ColumnSpec.params` through run engine → cell runner → producer. Seals go through the **normal** tool-call provenance audit (STAGED manifest, never `DETERMINISTIC_SNAPSHOT_MANIFEST`).

**Tech Stack:** Node 22 + TypeScript (native `node:test`), Postgres (pg), existing services: `services/snapshot` (sealer/verifier), `services/evidence` (claims/documents/object-store), `services/llm` (router), `services/observability` (tool-call log), React 19 web app.

**Spec:** `docs/superpowers/specs/2026-06-10-analyst-grid-reader-columns-design.md`

**Conventions:**
- Run service tests with `npm test` from `services/analyst-grids/` (Docker/Postgres integration tests auto-skip when unavailable; pattern in existing `*.test.ts`).
- Unit tests use fake `QueryExecutor` objects (see `services/analyst-grids/test/column-catalog-unit.test.ts` for the house style).
- Commit after every green test, message style `feat(analyst-grids): ...`.

---

### Task 1: Thread column params + reader deps through engine, cell runner, and producers

**Files:**
- Modify: `services/analyst-grids/src/column-catalog.ts` (context/deps types)
- Modify: `services/analyst-grids/src/run-engine.ts` (pair specs with entries, thread params)
- Modify: `services/analyst-grids/src/cell-runner.ts` (accept params + reader deps)
- Modify: `services/analyst-grids/src/http.ts` (pass reader deps through `AnalystGridsServerDeps`)
- Test: `services/analyst-grids/test/params-threading.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// services/analyst-grids/test/params-threading.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { GridColumnContext, GridColumnProducer } from "../src/column-catalog.ts";
import { computeAndPersistCell } from "../src/cell-runner.ts";

test("cell runner passes column params and reader deps to the producer", async () => {
  let seenParams: unknown = "unset";
  let seenReader: unknown = "unset";
  const producer: GridColumnProducer = async (deps, ctx: GridColumnContext) => {
    seenParams = ctx.params;
    seenReader = deps.reader;
    return { status: "missing_data", display: { value: "—", tone: null } };
  };
  const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }) } as never;
  const fakeReader = { llm: { complete: async () => ({ text: "" }) }, loadDocumentText: async () => null };
  await computeAndPersistCell(
    { db: fakeDb, pool: { connect: async () => { throw new Error("unused"); } }, reader: fakeReader },
    {
      column: { column_key: "x", label: "X", kind: "reader", producer },
      params: { prompt: "Any China exposure?" },
      gridRowId: "11111111-1111-4111-8111-111111111111",
      subject: { kind: "issuer", id: "22222222-2222-4222-8222-222222222222" },
      period: null,
      asOf: "2026-06-10T00:00:00Z",
    },
  );
  assert.deepEqual(seenParams, { prompt: "Any China exposure?" });
  assert.equal(seenReader, fakeReader);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyst-grids && node --test test/params-threading.test.ts`
Expected: FAIL — TypeScript/compile error: `params` does not exist on `ComputeCellInput`, `reader` not on deps.

- [ ] **Step 3: Implement the type threading**

In `services/analyst-grids/src/column-catalog.ts` — extend the context and deps (top of file, after existing imports add `import type { JsonValue } from "../../observability/src/types.ts";`):

```ts
// The reader-side dependencies a reader-kind column needs. llm matches the
// services/llm router's complete() surface; loadDocumentText resolves a
// document's raw blob to utf-8 text (null when the blob is missing/ephemeral).
export type ReaderLlm = {
  complete(request: {
    messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; deployment?: { channel: string; model: string } }>;
};

export type ReaderColumnDeps = {
  llm: ReaderLlm;
  loadDocumentText: (rawBlobId: string) => Promise<string | null>;
};

export type GridColumnDeps = { db: QueryExecutor; reader?: ReaderColumnDeps };

export type GridColumnContext = {
  subject: SubjectRef;
  period: PeriodContext;
  snapshotId: string;
  asOf: string;
  params: JsonValue | null; // the column's ColumnSpec.params, verbatim
};
```

In `services/analyst-grids/src/cell-runner.ts`:

```ts
import type { JsonValue } from "../../observability/src/types.ts";
import type { ReaderColumnDeps } from "./column-catalog.ts";

export type CellRunnerDeps = { db: QueryExecutor; pool: SnapshotClientPool; reader?: ReaderColumnDeps };

export type ComputeCellInput = {
  column: ColumnCatalogEntry;
  params: JsonValue | null;
  gridRowId: string;
  subject: SubjectRef;
  period: PeriodContext;
  asOf: string;
};
```

and pass both through in the producer call:

```ts
    result = await input.column.producer(
      { db: deps.db, reader: deps.reader },
      { subject: input.subject, period: input.period, snapshotId, asOf: input.asOf, params: input.params },
    );
```

In `services/analyst-grids/src/run-engine.ts` — pair catalog entries with their spec params and thread them (add `import type { JsonValue } from "../../observability/src/types.ts";` and import `ReaderColumnDeps` from `./column-catalog.ts`):

```ts
export type RunEngineDeps = {
  db: QueryExecutor;
  pool: SnapshotClientPool;
  universe: UniverseResolverDeps;
  reader?: ReaderColumnDeps;
};

type RunColumn = { entry: ColumnCatalogEntry; params: JsonValue | null };
```

In `startGridRun`, replace the `columns` mapping:

```ts
  const columns: RunColumn[] = grid.column_specs.map((spec) => {
    const entry = getColumn(spec.column_key);
    if (!entry) throw new GridValidationError(`unknown column_key: ${spec.column_key}`);
    return { entry, params: spec.params ?? null };
  });
```

Update the two uses inside the transaction (`columns.length` is unchanged; `column.column_key` becomes `column.entry.column_key`) and the worker loop:

```ts
      for (const column of ctx.columns) {
        const status = await computeAndPersistCell(
          { db: deps.db, pool: deps.pool, reader: deps.reader },
          { column: column.entry, params: column.params, gridRowId, subject, period, asOf: ctx.asOf },
        );
        if (status === "error") errored = true;
        await bumpCellDone(deps.db, ctx.runId);
      }
```

(`runWorker`'s ctx type changes to `columns: RunColumn[]`.)

In `services/analyst-grids/src/http.ts`, add reader to the server deps and pass it to the engine:

```ts
import type { ReaderColumnDeps } from "./column-catalog.ts";

export type AnalystGridsServerDeps = {
  db: QueryExecutor;
  pool: SnapshotClientPool;
  universe: UniverseResolverDeps;
  reader?: ReaderColumnDeps;
  auth?: RequestAuthConfig;
};
```

and in the run-start handler: `const engineDeps: RunEngineDeps = { db, pool, universe, reader: deps.reader };`

- [ ] **Step 4: Run the new test and the whole suite**

Run: `cd services/analyst-grids && node --test test/params-threading.test.ts && npm test`
Expected: new test PASS; existing suite PASS (the only call-site changes are additive — existing tests construct producers positionally and are unaffected by the extra ctx field).

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src services/analyst-grids/test/params-threading.test.ts
git commit -m "feat(analyst-grids): thread column params and reader deps to producers"
```

---

### Task 2: Column-spec validation (prompt rules + reader-column cap)

**Files:**
- Modify: `services/analyst-grids/src/column-catalog.ts` (add `validateColumnSpecs`)
- Modify: `services/analyst-grids/src/http.ts` (use it in `parseCreateInput`)
- Test: `services/analyst-grids/test/validate-column-specs.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// services/analyst-grids/test/validate-column-specs.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateColumnSpecs, READER_QUESTION_COLUMN_KEY } from "../src/column-catalog.ts";
import { GridValidationError } from "../src/types.ts";

const q = (prompt: unknown) => ({ column_key: READER_QUESTION_COLUMN_KEY, params: { prompt } });

test("accepts a deterministic column and a valid question column", () => {
  validateColumnSpecs([{ column_key: "latest_market_cap" }, q("Any China exposure flagged in risk factors?")]);
});

test("rejects unknown column keys", () => {
  assert.throws(() => validateColumnSpecs([{ column_key: "nope" }]), GridValidationError);
});

test("rejects a question column without params.prompt", () => {
  assert.throws(() => validateColumnSpecs([{ column_key: READER_QUESTION_COLUMN_KEY }]), GridValidationError);
  assert.throws(() => validateColumnSpecs([q(42)]), GridValidationError);
});

test("rejects prompts shorter than 8 or longer than 300 chars", () => {
  assert.throws(() => validateColumnSpecs([q("short")]), GridValidationError);
  assert.throws(() => validateColumnSpecs([q("x".repeat(301))]), GridValidationError);
  validateColumnSpecs([q("x".repeat(300))]); // boundary ok
});

test("rejects more than 3 reader columns per grid", () => {
  const four = [q("question one ok"), q("question two ok"), q("question three ok"), q("question four ok")];
  assert.throws(() => validateColumnSpecs(four), GridValidationError);
  validateColumnSpecs(four.slice(0, 3));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyst-grids && node --test test/validate-column-specs.test.ts`
Expected: FAIL — `validateColumnSpecs` / `READER_QUESTION_COLUMN_KEY` not exported.

- [ ] **Step 3: Implement validation in `column-catalog.ts`**

```ts
export const READER_QUESTION_COLUMN_KEY = "reader_question";
export const MAX_READER_COLUMNS_PER_GRID = 3;
const PROMPT_MIN = 8;
const PROMPT_MAX = 300;

// Create/run-time validation for a grid's column specs. Throws
// GridValidationError (surfaced as HTTP 400 by the existing handler).
export function validateColumnSpecs(
  specs: ReadonlyArray<{ column_key: string; params?: unknown }>,
): void {
  let readerCount = 0;
  for (const spec of specs) {
    const entry = CATALOG.get(spec.column_key);
    if (!entry) throw new GridValidationError(`unknown column_key: ${spec.column_key}`);
    if (entry.kind === "reader") readerCount += 1;
    if (spec.column_key === READER_QUESTION_COLUMN_KEY) {
      const prompt = (spec.params as { prompt?: unknown } | undefined)?.prompt;
      if (typeof prompt !== "string") {
        throw new GridValidationError("reader_question requires params.prompt (string)");
      }
      const len = prompt.trim().length;
      if (len < PROMPT_MIN || len > PROMPT_MAX) {
        throw new GridValidationError(`params.prompt must be ${PROMPT_MIN}-${PROMPT_MAX} characters`);
      }
    }
  }
  if (readerCount > MAX_READER_COLUMNS_PER_GRID) {
    throw new GridValidationError(`at most ${MAX_READER_COLUMNS_PER_GRID} question columns per grid`);
  }
}
```

(Import `GridValidationError` from `./types.ts`. The `reader_question` CATALOG entry does not exist until Task 7 — for this task's tests to pass, register a placeholder entry now with a producer that returns `{ status: "error", display: EMPTY_DISPLAY }`; Task 7 replaces it with the real producer. This keeps every task independently green.)

In `services/analyst-grids/src/http.ts`, replace the per-spec loop body in `parseCreateInput` with one call (keep the `column_key is string` check first, then after the loop):

```ts
  for (const spec of body.column_specs) {
    const columnKey = (spec as { column_key?: unknown } | null)?.column_key;
    if (typeof columnKey !== "string") {
      throw new GridValidationError("each column_spec needs a string 'column_key'");
    }
  }
  validateColumnSpecs(body.column_specs as Array<{ column_key: string; params?: unknown }>);
```

(remove the now-redundant `getColumn` check and its import if unused.)

- [ ] **Step 4: Run tests**

Run: `cd services/analyst-grids && node --test test/validate-column-specs.test.ts && npm test`
Expected: PASS (http.test.ts still green — unknown-column create still 400s, now via `validateColumnSpecs`).

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/column-catalog.ts services/analyst-grids/src/http.ts services/analyst-grids/test/validate-column-specs.test.ts
git commit -m "feat(analyst-grids): validate question-column prompts and cap reader columns"
```

---

### Task 3: `buildClaimBackedSealInput` (claim-backed STAGED manifests)

**Files:**
- Modify: `services/analyze/src/block-seal-input.ts` (sibling of `buildFactBackedSealInput`)
- Test: `services/analyze/test/claim-seal-input.test.ts` (new; follow the existing test layout in `services/analyze/test/`)

- [ ] **Step 1: Write the failing test**

```ts
// services/analyze/test/claim-seal-input.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildClaimBackedSealInput } from "../src/block-seal-input.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import {
  DETERMINISTIC_SNAPSHOT_MANIFEST,
} from "../../snapshot/src/manifest-staging.ts";

const SNAPSHOT_ID = "8b6c8b1e-6a1f-4d2a-9a3b-0c1d2e3f4a5b";
const CLAIM_ID = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const DOC_ID = "2b3c4d5e-6f7a-4b2c-8d3e-4f5a6b7c8d9e";
const SOURCE_ID = "3c4d5e6f-7a8b-4c3d-8e4f-5a6b7c8d9e0f";
const TOOL_CALL_ID = "4d5e6f7a-8b9c-4d4e-8f5a-6b7c8d9e0f1a";
const SUBJECT_ID = "5e6f7a8b-9c0d-4e5f-8a6b-7c8d9e0f1a2b";
const AS_OF = "2026-06-10T00:00:00Z";

const BLOCK_ID = "6f7a8b9c-0d1e-4f6a-8b7c-8d9e0f1a2b3c";
function block() {
  return {
    id: BLOCK_ID,
    kind: "rich_text" as const,
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
    source_refs: [SOURCE_ID],
    data_ref: { kind: "rich_text", id: BLOCK_ID, params: { column_key: "reader_question" } },
    segments: [
      { type: "text", text: "Management flagged China tariff exposure in Q1." },
      { type: "ref", ref_kind: "claim", ref_id: CLAIM_ID },
    ],
  };
}

function sealInput() {
  return buildClaimBackedSealInput({
    block: block(),
    claims: [{ claim_id: CLAIM_ID, source_id: SOURCE_ID }],
    documents: [{ document_id: DOC_ID, source_id: SOURCE_ID }],
    subjectRefs: [{ kind: "issuer", id: SUBJECT_ID }],
    toolCalls: [{ tool_call_id: TOOL_CALL_ID, result_hash: "a".repeat(64) }],
    modelVersion: "reader:test-model",
  });
}

test("claim-backed seal passes the snapshot verifier", () => {
  const input = sealInput();
  const result = verifySnapshotSeal(input);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test("manifest is STAGED but NOT deterministic (tool-call audit applies)", () => {
  const input = sealInput();
  assert.notEqual(
    (input.manifest as Record<PropertyKey, unknown>)[DETERMINISTIC_SNAPSHOT_MANIFEST as unknown as PropertyKey],
    true,
  );
  assert.deepEqual(input.manifest.tool_call_ids, [TOOL_CALL_ID]);
  assert.deepEqual(input.manifest.claim_refs, [CLAIM_ID]);
  assert.deepEqual(input.manifest.document_refs, [DOC_ID]);
});

test("a block citing a claim missing from the manifest fails verification", () => {
  const input = sealInput();
  const broken = { ...input, manifest: { ...input.manifest, claim_refs: [] } };
  const result = verifySnapshotSeal(broken as typeof input);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.reason_code === "missing_claim_ref"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyze && node --test test/claim-seal-input.test.ts`
Expected: FAIL — `buildClaimBackedSealInput` is not exported.

- [ ] **Step 3: Implement in `services/analyze/src/block-seal-input.ts`**

```ts
export type ClaimSealClaim = { claim_id: UUID; source_id: UUID };
export type ClaimSealDocument = { document_id: UUID; source_id: UUID | null };
export type SealToolCallRef = { tool_call_id: UUID; result_hash: string };

// The claim-backed sibling of buildFactBackedSealInput, for LLM-derived blocks
// (analyst-grid reader cells). The manifest is STAGED only — never
// DETERMINISTIC — so the sealer's tool-call provenance audit applies: every
// tool_call_id must exist in tool_call_logs with a matching result_hash.
export function buildClaimBackedSealInput(input: {
  block: SealableBlock & {
    kind: string;
    source_refs: ReadonlyArray<string>;
    segments: ReadonlyArray<unknown>;
  };
  claims: ReadonlyArray<ClaimSealClaim>;
  documents: ReadonlyArray<ClaimSealDocument>;
  subjectRefs: ReadonlyArray<{ kind: string; id: string }>;
  toolCalls: ReadonlyArray<SealToolCallRef>;
  modelVersion?: string | null;
}): SnapshotSealInput {
  const claimRefs = distinct(input.claims.map((claim) => claim.claim_id));
  const documentRefs = distinct(input.documents.map((doc) => doc.document_id));
  const sourceIds = distinct([
    ...input.claims.map((claim) => claim.source_id),
    ...input.documents.flatMap((doc) => (doc.source_id === null ? [] : [doc.source_id])),
  ]);

  const manifest: SnapshotManifestDraft = Object.freeze({
    [STAGED_SNAPSHOT_MANIFEST]: true,
    subject_refs: Object.freeze(input.subjectRefs.map((s) => ({ kind: s.kind, id: s.id }))),
    fact_refs: Object.freeze([]),
    claim_refs: Object.freeze(claimRefs),
    event_refs: Object.freeze([]),
    document_refs: Object.freeze(documentRefs),
    series_specs: Object.freeze([]),
    source_ids: Object.freeze(sourceIds),
    tool_call_ids: Object.freeze(input.toolCalls.map((t) => t.tool_call_id)),
    tool_call_result_hashes: Object.freeze(
      input.toolCalls.map((t) => ({ tool_call_id: t.tool_call_id, result_hash: t.result_hash })),
    ),
    as_of: input.block.as_of,
    basis: "unadjusted",
    normalization: "raw",
    coverage_start: null,
    allowed_transforms: Object.freeze({}),
    model_version: input.modelVersion ?? null,
    parent_snapshot: null,
  });

  return {
    snapshot_id: input.block.snapshot_id,
    manifest,
    blocks: [input.block as unknown as VerifierBlock],
    claims: input.claims.map((claim) => ({ ...claim })),
    documents: input.documents.map((doc) => ({ ...doc })),
    sources: sourceIds,
  };
}
```

(If `tool_call_result_hashes`'s draft type rejects the object shape, check `SnapshotManifestDraft` in `services/snapshot/src/manifest-staging.ts:61-80` and match the element type used by `auditManifestToolCallLog` — it reads `tool_call_result_hashes[index].tool_call_id` and `.result_hash`, so objects are the audited shape.)

- [ ] **Step 4: Run tests**

Run: `cd services/analyze && node --test test/claim-seal-input.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/analyze/src/block-seal-input.ts services/analyze/test/claim-seal-input.test.ts
git commit -m "feat(analyze): claim-backed STAGED seal input for LLM-derived blocks"
```

---

### Task 4: Reader document selection

**Files:**
- Create: `services/analyst-grids/src/reader-documents.ts`
- Test: `services/analyst-grids/test/reader-documents.test.ts` (Docker/Postgres integration; follow `services/analyst-grids/test/period-context.test.ts` for the harness/skip pattern)

- [ ] **Step 1: Write the failing test**

```ts
// services/analyst-grids/test/reader-documents.test.ts
// Follow period-context.test.ts: same ephemeral-Postgres harness and
// `test.skip` guard when Docker is unavailable. Seed inside a transaction:
//   - source A: kind 'filing', license_class 'public', trust_tier 'primary'
//   - source B: kind 'article', license_class 'ephemeral'  (GDELT-style)
//   - documents: d1 filing (published 10d ago, source A), d2 article
//     (published 5d ago, source B/ephemeral), d3 transcript (published 400d
//     ago, source A) — all with mentions rows for issuer X
//   - one document for issuer Y (must not appear for X)
import test from "node:test";
import assert from "node:assert/strict";
import { selectReaderDocuments } from "../src/reader-documents.ts";

// ... harness boilerplate identical to period-context.test.ts ...

test("selects recent, non-ephemeral documents for the issuer, kind-ranked", async () => {
  const rows = await selectReaderDocuments(db, issuerXId, 5);
  // d2 excluded (ephemeral license), d3 excluded (outside 180-day window)
  assert.deepEqual(rows.map((r) => r.document_id), [d1Id]);
  assert.equal(rows[0].source_id, sourceAId);
  assert.equal(typeof rows[0].raw_blob_id, "string");
});

test("returns empty array when the issuer has no eligible documents", async () => {
  const rows = await selectReaderDocuments(db, issuerWithNoDocsId, 5);
  assert.deepEqual(rows, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyst-grids && node --test test/reader-documents.test.ts`
Expected: FAIL — module `../src/reader-documents.ts` not found (or skip if no Docker — then proceed and rely on Step 4 in CI/dev with Docker).

- [ ] **Step 3: Implement `reader-documents.ts`**

```ts
import type { QueryExecutor } from "./types.ts";

export type ReaderDocumentRow = {
  document_id: string;
  source_id: string;
  raw_blob_id: string;
  doc_kind: string;
  published_at: string | null;
};

export const READER_DOCUMENT_WINDOW_DAYS = 180;
export const READER_DOCUMENTS_PER_CELL = 5;

// Recent, non-ephemeral documents mentioning the issuer, preferring primary
// document kinds. Ranking: kind preference (filing > transcript >
// press_release > article > everything else), then recency. The ephemeral
// filter excludes metadata-only ingests (GDELT) whose raw text we may not
// store or display.
export async function selectReaderDocuments(
  db: QueryExecutor,
  issuerId: string,
  limit: number = READER_DOCUMENTS_PER_CELL,
): Promise<ReaderDocumentRow[]> {
  const { rows } = await db.query<ReaderDocumentRow>(
    `select distinct on (d.document_id)
            d.document_id::text as document_id,
            d.source_id::text as source_id,
            d.raw_blob_id,
            d.kind::text as doc_kind,
            d.published_at::text as published_at
       from mentions m
       join documents d on d.document_id = m.document_id
       join sources s on s.source_id = d.source_id
      where m.subject_kind = 'issuer'
        and m.subject_id = $1
        and d.deleted_at is null
        and s.license_class <> 'ephemeral'
        and d.raw_blob_id not like 'ephemeral:%'
        and coalesce(d.published_at, d.created_at) >= now() - ($2 || ' days')::interval
      order by d.document_id
      limit 200`,
    [issuerId, String(READER_DOCUMENT_WINDOW_DAYS)],
  );
  const kindRank = (kind: string): number =>
    ({ filing: 0, transcript: 1, press_release: 2, article: 3 } as Record<string, number>)[kind] ?? 4;
  return rows
    .sort(
      (a, b) =>
        kindRank(a.doc_kind) - kindRank(b.doc_kind) ||
        (b.published_at ?? "").localeCompare(a.published_at ?? ""),
    )
    .slice(0, limit);
}
```

(Sorting in JS keeps the SQL simple and the preference order unit-testable; 200 is a safety cap on candidates.)

- [ ] **Step 4: Run tests (with Docker up)**

Run: `cd services/analyst-grids && npm test`
Expected: PASS (integration test seeds and verifies; skips cleanly without Docker).

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/reader-documents.ts services/analyst-grids/test/reader-documents.test.ts
git commit -m "feat(analyst-grids): reader document selection via mentions"
```

---

### Task 5: Reader prompt construction + response parsing (pure)

**Files:**
- Create: `services/analyst-grids/src/reader-llm.ts`
- Test: `services/analyst-grids/test/reader-llm.test.ts` (new, pure unit tests)

- [ ] **Step 1: Write the failing test**

```ts
// services/analyst-grids/test/reader-llm.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildReaderMessages, parseReaderResponse, MAX_ANSWER_CHARS } from "../src/reader-llm.ts";

const DOC_A = "2b3c4d5e-6f7a-4b2c-8d3e-4f5a6b7c8d9e";

test("buildReaderMessages includes the question and per-document delimiters", () => {
  const messages = buildReaderMessages("Any China exposure?", [
    { document_id: DOC_A, doc_kind: "filing", text: "Item 1A. Risks. China tariffs ..." },
  ]);
  assert.equal(messages[0].role, "system");
  const user = messages[1].content;
  assert.match(user, /Any China exposure\?/);
  assert.match(user, new RegExp(DOC_A));
});

test("parseReaderResponse accepts a valid JSON answer with claims", () => {
  const parsed = parseReaderResponse(
    JSON.stringify({
      answer: "Yes — tariff exposure flagged in Item 1A.",
      claims: [
        {
          document_id: DOC_A,
          predicate: "risk_exposure",
          text_canonical: "The company flags China tariff exposure in Item 1A.",
          polarity: "negative",
          modality: "asserted",
          confidence: 0.85,
        },
      ],
      not_discussed: false,
    }),
    new Set([DOC_A]),
  );
  assert.equal(parsed.kind, "answered");
  if (parsed.kind === "answered") {
    assert.equal(parsed.claims.length, 1);
    assert.ok(parsed.answer.length <= MAX_ANSWER_CHARS);
  }
});

test("parseReaderResponse strips markdown code fences", () => {
  const body = JSON.stringify({ answer: "x".repeat(10), claims: [], not_discussed: true });
  const parsed = parseReaderResponse("```json\n" + body + "\n```", new Set([DOC_A]));
  assert.equal(parsed.kind, "not_discussed");
});

test("rejects claims citing unknown document ids", () => {
  const body = JSON.stringify({
    answer: "ok answer",
    claims: [{ document_id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", predicate: "p", text_canonical: "t", polarity: "neutral", modality: "asserted", confidence: 0.5 }],
    not_discussed: false,
  });
  assert.throws(() => parseReaderResponse(body, new Set([DOC_A])), /unknown document_id/);
});

test("rejects invalid polarity/modality/confidence and non-JSON", () => {
  assert.throws(() => parseReaderResponse("not json at all", new Set([DOC_A])));
  const bad = (patch: object) =>
    JSON.stringify({
      answer: "ok answer",
      not_discussed: false,
      claims: [{ document_id: DOC_A, predicate: "p", text_canonical: "t", polarity: "neutral", modality: "asserted", confidence: 0.5, ...patch }],
    });
  assert.throws(() => parseReaderResponse(bad({ polarity: "sideways" }), new Set([DOC_A])));
  assert.throws(() => parseReaderResponse(bad({ modality: "vibes" }), new Set([DOC_A])));
  assert.throws(() => parseReaderResponse(bad({ confidence: 1.5 }), new Set([DOC_A])));
});

test("answered with zero claims is treated as not_discussed", () => {
  const parsed = parseReaderResponse(
    JSON.stringify({ answer: "Nothing relevant.", claims: [], not_discussed: false }),
    new Set([DOC_A]),
  );
  assert.equal(parsed.kind, "not_discussed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyst-grids && node --test test/reader-llm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reader-llm.ts`**

```ts
import {
  CLAIM_MODALITIES,
  CLAIM_POLARITIES,
  type ClaimModality,
  type ClaimPolarity,
} from "../../evidence/src/claim-repo.ts";

export const MAX_ANSWER_CHARS = 140;
export const MAX_DOC_CHARS = 12_000;

export type ReaderDocText = { document_id: string; doc_kind: string; text: string };

export type ParsedReaderClaim = {
  document_id: string;
  predicate: string;
  text_canonical: string;
  polarity: ClaimPolarity;
  modality: ClaimModality;
  confidence: number;
};

export type ParsedReaderResponse =
  | { kind: "answered"; answer: string; claims: ParsedReaderClaim[] }
  | { kind: "not_discussed" };

const SYSTEM_PROMPT = [
  "You are a financial research reader. You receive a research question and",
  "excerpts of source documents about one company. Extract only what the",
  "documents support — never outside knowledge. Respond with EXACTLY one JSON",
  'object: {"answer": string (<=140 chars), "claims": [{"document_id",',
  '"predicate", "text_canonical", "polarity": "positive"|"negative"|"neutral"|"mixed",',
  '"modality": "asserted"|"estimated"|"speculative"|"rumored"|"quoted",',
  '"confidence": number 0..1}], "not_discussed": boolean}.',
  "If the documents do not address the question, set not_discussed=true and claims=[].",
  "Every claim's document_id must be one of the provided documents.",
].join(" ");

export function buildReaderMessages(
  question: string,
  docs: ReadonlyArray<ReaderDocText>,
): Array<{ role: "system" | "user"; content: string }> {
  const docSections = docs
    .map(
      (doc) =>
        `--- DOCUMENT ${doc.document_id} (${doc.doc_kind}) ---\n${doc.text.slice(0, MAX_DOC_CHARS)}`,
    )
    .join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `QUESTION: ${question}\n\n${docSections}` },
  ];
}

export function parseReaderResponse(
  raw: string,
  allowedDocumentIds: ReadonlySet<string>,
): ParsedReaderResponse {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) throw new Error("reader response must be a JSON object");
  const body = parsed as { answer?: unknown; claims?: unknown; not_discussed?: unknown };
  if (body.not_discussed === true) return { kind: "not_discussed" };
  if (typeof body.answer !== "string" || body.answer.trim().length === 0) {
    throw new Error("reader response missing answer");
  }
  if (!Array.isArray(body.claims)) throw new Error("reader response missing claims array");
  const claims = body.claims.map((claim, index) => parseClaim(claim, index, allowedDocumentIds));
  if (claims.length === 0) return { kind: "not_discussed" };
  return { kind: "answered", answer: body.answer.trim().slice(0, MAX_ANSWER_CHARS), claims };
}

function parseClaim(value: unknown, index: number, allowed: ReadonlySet<string>): ParsedReaderClaim {
  if (typeof value !== "object" || value === null) throw new Error(`claims[${index}] must be an object`);
  const claim = value as Record<string, unknown>;
  if (typeof claim.document_id !== "string" || !allowed.has(claim.document_id)) {
    throw new Error(`claims[${index}]: unknown document_id`);
  }
  if (typeof claim.predicate !== "string" || claim.predicate.length === 0) throw new Error(`claims[${index}]: predicate required`);
  if (typeof claim.text_canonical !== "string" || claim.text_canonical.length === 0) throw new Error(`claims[${index}]: text_canonical required`);
  if (!(CLAIM_POLARITIES as readonly string[]).includes(claim.polarity as string)) throw new Error(`claims[${index}]: invalid polarity`);
  if (!(CLAIM_MODALITIES as readonly string[]).includes(claim.modality as string)) throw new Error(`claims[${index}]: invalid modality`);
  if (typeof claim.confidence !== "number" || !Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) {
    throw new Error(`claims[${index}]: confidence must be in [0,1]`);
  }
  return {
    document_id: claim.document_id,
    predicate: claim.predicate,
    text_canonical: claim.text_canonical,
    polarity: claim.polarity as ClaimPolarity,
    modality: claim.modality as ClaimModality,
    confidence: claim.confidence,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd services/analyst-grids && node --test test/reader-llm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/reader-llm.ts services/analyst-grids/test/reader-llm.test.ts
git commit -m "feat(analyst-grids): reader prompt builder and strict response parser"
```

---

### Task 6: The `reader_question` producer

**Files:**
- Create: `services/analyst-grids/src/reader-question-column.ts`
- Test: `services/analyst-grids/test/reader-question-column.test.ts` (unit, fake db + fake reader deps)

- [ ] **Step 1: Write the failing test**

```ts
// services/analyst-grids/test/reader-question-column.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readerQuestionProducer } from "../src/reader-question-column.ts";

const ISSUER = "22222222-2222-4222-8222-222222222222";
const DOC = "2b3c4d5e-6f7a-4b2c-8d3e-4f5a6b7c8d9e";
const SOURCE = "3c4d5e6f-7a8b-4c3d-8e4f-5a6b7c8d9e0f";
const CLAIM = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const TOOL_CALL = "4d5e6f7a-8b9c-4d4e-8f5a-6b7c8d9e0f1a";

const ctx = (params: unknown) => ({
  subject: { kind: "issuer" as const, id: ISSUER },
  period: null,
  snapshotId: "8b6c8b1e-6a1f-4d2a-9a3b-0c1d2e3f4a5b",
  asOf: "2026-06-10T00:00:00.000Z",
  params: params as never,
});

// A scripted fake db: routes by SQL shape. `docs` feeds the mentions/documents
// select; claim inserts return CLAIM; tool_call_logs insert returns TOOL_CALL.
function fakeDb(docs: unknown[]) {
  return {
    query: async (text: string) => {
      if (text.includes("from mentions")) return { rows: docs, rowCount: docs.length };
      if (text.includes("insert into claims")) {
        return {
          rows: [{
            claim_id: CLAIM, document_id: DOC, predicate: "p", text_canonical: "t",
            polarity: "negative", modality: "asserted", reported_by_source_id: SOURCE,
            attributed_to_type: null, attributed_to_id: null, effective_time: null,
            confidence: 0.8, status: "extracted",
            created_at: "2026-06-10T00:00:00.000Z", updated_at: "2026-06-10T00:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      if (text.includes("insert into tool_call_logs")) {
        return { rows: [{ tool_call_id: TOOL_CALL, created_at: new Date() }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    },
  } as never;
}

const docRow = { document_id: DOC, source_id: SOURCE, raw_blob_id: "sha256:abc", doc_kind: "filing", published_at: "2026-06-01T00:00:00Z" };

const answeringLlm = {
  complete: async () => ({
    text: JSON.stringify({
      answer: "Yes — tariff exposure flagged in Item 1A.",
      claims: [{ document_id: DOC, predicate: "risk_exposure", text_canonical: "Flags China tariff exposure.", polarity: "negative", modality: "asserted", confidence: 0.85 }],
      not_discussed: false,
    }),
    deployment: { channel: "reader", model: "test-model" },
  }),
};

test("answers with a sealed, claim-backed ok cell", async () => {
  const reader = { llm: answeringLlm, loadDocumentText: async () => "Item 1A. China tariffs ..." };
  const result = await readerQuestionProducer(
    { db: fakeDb([docRow]), reader },
    ctx({ prompt: "Any China exposure flagged in risk factors?" }),
  );
  assert.equal(result.status, "ok");
  assert.equal(result.display.value, "Yes — tariff exposure flagged in Item 1A.");
  assert.deepEqual(result.primaryRef, { kind: "claim", id: CLAIM });
  assert.ok(result.seal);
  assert.deepEqual(result.seal!.manifest.claim_refs, [CLAIM]);
  assert.deepEqual(result.seal!.manifest.document_refs, [DOC]);
  assert.deepEqual(result.seal!.manifest.tool_call_ids, [TOOL_CALL]);
});

test("non-issuer subject -> no_coverage", async () => {
  const reader = { llm: answeringLlm, loadDocumentText: async () => null };
  const result = await readerQuestionProducer(
    { db: fakeDb([]), reader },
    { ...ctx({ prompt: "Any China exposure flagged?" }), subject: { kind: "theme", id: ISSUER } },
  );
  assert.equal(result.status, "no_coverage");
});

test("no eligible documents -> no_coverage with coverage flag", async () => {
  const reader = { llm: answeringLlm, loadDocumentText: async () => null };
  const result = await readerQuestionProducer(
    { db: fakeDb([]), reader },
    ctx({ prompt: "Any China exposure flagged?" }),
  );
  assert.equal(result.status, "no_coverage");
  assert.equal(result.coverageFlag, "no_documents");
  assert.equal(result.seal, undefined);
});

test("documents but not discussed -> missing_data with no_relevant_claims", async () => {
  const notDiscussedLlm = {
    complete: async () => ({ text: JSON.stringify({ answer: "", claims: [], not_discussed: true }) }),
  };
  const reader = { llm: notDiscussedLlm, loadDocumentText: async () => "Quarterly results were solid." };
  const result = await readerQuestionProducer(
    { db: fakeDb([docRow]), reader },
    ctx({ prompt: "Any China exposure flagged?" }),
  );
  assert.equal(result.status, "missing_data");
  assert.equal(result.coverageFlag, "no_relevant_claims");
});

test("missing reader deps or missing prompt -> throws (cell runner turns it into error)", async () => {
  await assert.rejects(() =>
    readerQuestionProducer({ db: fakeDb([docRow]) }, ctx({ prompt: "Any China exposure flagged?" })),
  );
  const reader = { llm: answeringLlm, loadDocumentText: async () => "text" };
  await assert.rejects(() => readerQuestionProducer({ db: fakeDb([docRow]), reader }, ctx(null)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyst-grids && node --test test/reader-question-column.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reader-question-column.ts`**

```ts
import { createHash, randomUUID } from "node:crypto";
import { createClaim } from "../../evidence/src/claim-repo.ts";
import { writeToolCallLog } from "../../observability/src/tool-call.ts";
import { buildClaimBackedSealInput } from "../../analyze/src/block-seal-input.ts";
import { selectReaderDocuments, READER_DOCUMENTS_PER_CELL } from "./reader-documents.ts";
import { buildReaderMessages, parseReaderResponse, type ReaderDocText } from "./reader-llm.ts";
import type { GridColumnProducer, GridCellResult } from "./column-catalog.ts";
import { EMPTY_DISPLAY } from "./column-catalog.ts";

export const READER_TOOL_NAME = "grid_reader_question";

const NO_COVERAGE = (flag: string): GridCellResult => ({
  status: "no_coverage",
  display: EMPTY_DISPLAY,
  coverageFlag: flag,
});

export const readerQuestionProducer: GridColumnProducer = async (deps, ctx) => {
  if (ctx.subject.kind !== "issuer") return NO_COVERAGE("issuer_only");
  const reader = deps.reader;
  if (!reader) throw new Error("reader_question: reader deps not configured");
  const prompt = (ctx.params as { prompt?: unknown } | null)?.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("reader_question: params.prompt required");
  }

  const docs = await selectReaderDocuments(deps.db, ctx.subject.id, ctx.userId, READER_DOCUMENTS_PER_CELL);
  if (docs.length === 0) return NO_COVERAGE("no_documents");

  const texts: ReaderDocText[] = [];
  for (const doc of docs) {
    const text = await reader.loadDocumentText(doc.raw_blob_id);
    if (text !== null && text.trim().length > 0) {
      texts.push({ document_id: doc.document_id, doc_kind: doc.doc_kind, text });
    }
  }
  if (texts.length === 0) return NO_COVERAGE("no_document_text");

  const completion = await reader.llm.complete({
    messages: buildReaderMessages(prompt.trim(), texts),
    temperature: 0,
    maxTokens: 1500,
  });
  const parsed = parseReaderResponse(completion.text, new Set(texts.map((t) => t.document_id)));
  if (parsed.kind === "not_discussed") {
    return { status: "missing_data", display: EMPTY_DISPLAY, coverageFlag: "no_relevant_claims" };
  }

  const docById = new Map(docs.map((doc) => [doc.document_id, doc]));
  const claimRows = [];
  for (const claim of parsed.claims) {
    const doc = docById.get(claim.document_id)!;
    claimRows.push(
      await createClaim(deps.db, {
        document_id: claim.document_id,
        predicate: claim.predicate,
        text_canonical: claim.text_canonical,
        polarity: claim.polarity,
        modality: claim.modality,
        reported_by_source_id: doc.source_id,
        confidence: claim.confidence,
        status: "extracted",
      }),
    );
  }

  // The audited result: answer + the claim ids it rests on. The hash is passed
  // explicitly so the manifest entry and the tool_call_logs row agree.
  const toolResult = { answer: parsed.answer, claim_ids: claimRows.map((c) => c.claim_id) };
  // The audit requires the "sha256:"-prefixed format (assertResultHash in
  // services/snapshot/src/manifest-staging.ts).
  const resultHash = "sha256:" + createHash("sha256").update(JSON.stringify(toolResult)).digest("hex");
  const logged = await writeToolCallLog(deps.db, {
    tool_name: READER_TOOL_NAME,
    args: { subject_id: ctx.subject.id, prompt: prompt.trim(), document_ids: texts.map((t) => t.document_id) },
    result_hash: resultHash,
    status: "ok",
  });

  const sourceRefs = [...new Set([
    ...claimRows.map((c) => c.reported_by_source_id),
    ...texts.map((t) => docById.get(t.document_id)!.source_id),
  ])];
  const blockId = randomUUID();
  const block = {
    id: blockId,
    kind: "rich_text" as const,
    snapshot_id: ctx.snapshotId,
    as_of: ctx.asOf,
    source_refs: sourceRefs,
    data_ref: { kind: "rich_text", id: blockId, params: { column_key: "reader_question" } },
    segments: [
      { type: "text", text: parsed.answer },
      ...claimRows.map((c) => ({ type: "ref", ref_kind: "claim", ref_id: c.claim_id })),
    ],
  };

  const seal = buildClaimBackedSealInput({
    block,
    claims: claimRows.map((c) => ({ claim_id: c.claim_id, source_id: c.reported_by_source_id })),
    documents: texts.map((t) => {
      const doc = docById.get(t.document_id)!;
      return { document_id: doc.document_id, source_id: doc.source_id };
    }),
    subjectRefs: [{ kind: ctx.subject.kind, id: ctx.subject.id }],
    toolCalls: [{ tool_call_id: logged.tool_call_id, result_hash: resultHash }],
    modelVersion: completion.deployment ? `reader:${completion.deployment.model}` : null,
  });

  return {
    status: "ok",
    display: { value: parsed.answer, tone: null },
    primaryRef: { kind: "claim", id: claimRows[0].claim_id },
    seal,
  };
};
```

- [ ] **Step 4: Run tests**

Run: `cd services/analyst-grids && node --test test/reader-question-column.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/reader-question-column.ts services/analyst-grids/test/reader-question-column.test.ts
git commit -m "feat(analyst-grids): reader_question producer (extract, persist claims, claim-backed seal)"
```

---

### Task 7: Register `reader_question` in the catalog

**Files:**
- Modify: `services/analyst-grids/src/column-catalog.ts` (replace the Task-2 placeholder entry)
- Test: extend `services/analyst-grids/test/validate-column-specs.test.ts` style checks in `services/analyst-grids/test/column-catalog-unit.test.ts`

- [ ] **Step 1: Write the failing test (append to `test/column-catalog-unit.test.ts`)**

```ts
test("catalog advertises reader_question as a reader column", () => {
  const columns = listColumns();
  const entry = columns.find((c) => c.column_key === "reader_question");
  assert.ok(entry);
  assert.equal(entry!.kind, "reader");
  assert.equal(entry!.label, "Question");
});

test("getColumn resolves reader_question to the reader producer", () => {
  const entry = getColumn("reader_question");
  assert.ok(entry);
  assert.equal(entry!.producer, readerQuestionProducer);
});
```

(add `import { readerQuestionProducer } from "../src/reader-question-column.ts";` to the test imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyst-grids && node --test test/column-catalog-unit.test.ts`
Expected: FAIL — placeholder producer (Task 2) is not `readerQuestionProducer` / label mismatch.

- [ ] **Step 3: Register the real entry**

In `column-catalog.ts` (import at top: `import { readerQuestionProducer } from "./reader-question-column.ts";`), replace the placeholder CATALOG entry with:

```ts
  [
    READER_QUESTION_COLUMN_KEY,
    {
      column_key: READER_QUESTION_COLUMN_KEY,
      label: "Question",
      kind: "reader",
      producer: readerQuestionProducer,
    },
  ],
```

- [ ] **Step 4: Run the full service suite**

Run: `cd services/analyst-grids && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/column-catalog.ts services/analyst-grids/test/column-catalog-unit.test.ts
git commit -m "feat(analyst-grids): register reader_question column"
```

---

### Task 8: Wiring — reader deps from env (LLM router + object store)

**Files:**
- Create: `services/analyst-grids/src/reader-wiring.ts`
- Modify: `services/analyst-grids/src/dev.ts`
- Test: `services/analyst-grids/test/reader-wiring.test.ts` (unit: text decoding + absent-config behavior)

- [ ] **Step 1: Write the failing test**

```ts
// services/analyst-grids/test/reader-wiring.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createLoadDocumentText, createReaderColumnDepsFromEnv } from "../src/reader-wiring.ts";

test("createLoadDocumentText decodes stored blob bytes as utf-8", async () => {
  const bytes = new TextEncoder().encode("Item 1A. Risk Factors.");
  const store = {
    get: async (id: string) => (id === "sha256:abc" ? { raw_blob_id: id, size: bytes.byteLength, bytes } : null),
    put: async () => { throw new Error("unused"); },
    has: async () => true,
    delete: async () => false,
  };
  const load = createLoadDocumentText(store as never);
  assert.equal(await load("sha256:abc"), "Item 1A. Risk Factors.");
  assert.equal(await load("sha256:missing"), null);
});

test("returns undefined when LLM or S3 env is not configured", async () => {
  const deps = await createReaderColumnDepsFromEnv({});
  assert.equal(deps, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/analyst-grids && node --test test/reader-wiring.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reader-wiring.ts`**

```ts
import { S3Client } from "@aws-sdk/client-s3";
import { S3ObjectStore } from "../../evidence/src/s3-object-store.ts";
import type { ObjectStore } from "../../evidence/src/object-store.ts";
import { createLlmRouterFromEnv, type LlmSettingsLoaderEnv } from "../../llm/src/settings-loader.ts";
import type { ReaderColumnDeps } from "./column-catalog.ts";

export function createLoadDocumentText(store: ObjectStore): ReaderColumnDeps["loadDocumentText"] {
  return async (rawBlobId) => {
    const blob = await store.get(rawBlobId);
    if (blob === null) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(blob.bytes);
  };
}

type ReaderWiringEnv = LlmSettingsLoaderEnv & {
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE?: string;
};

// Reader deps are optional: when the LLM router or the object store is not
// configured, the server runs without them and reader cells fail closed (the
// producer throws -> cell status "error"). Env names match .env.dev.
export async function createReaderColumnDepsFromEnv(
  env: ReaderWiringEnv = process.env as ReaderWiringEnv,
): Promise<ReaderColumnDeps | undefined> {
  if (!env.S3_BUCKET || !env.S3_REGION) return undefined;
  const router = await createLlmRouterFromEnv(env).catch(() => null);
  if (router === null) return undefined;

  const client = new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    ...(env.S3_FORCE_PATH_STYLE === "true" ? { forcePathStyle: true } : {}),
    ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } }
      : {}),
  });
  const store = new S3ObjectStore({ client, bucket: env.S3_BUCKET });

  return {
    llm: { complete: (request) => router.complete(request) },
    loadDocumentText: createLoadDocumentText(store),
  };
}
```

In `dev.ts`, wire it in (the listen callback moves inside an async bootstrap):

```ts
import { createReaderColumnDepsFromEnv } from "./reader-wiring.ts";

const reader = await createReaderColumnDepsFromEnv();
if (!reader) console.log("analyst-grids: reader columns disabled (LLM or S3 env not configured)");
const server = createAnalystGridsServer({
  db: pool,
  pool,
  universe: createUniverseResolverDeps(pool),
  reader,
});
```

(Check `package.json` deps of analyst-grids: add `@aws-sdk/client-s3` if not already resolvable through the evidence workspace import — match how analyst-grids already depends on evidence/`transaction.ts`.)

- [ ] **Step 4: Run tests**

Run: `cd services/analyst-grids && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/reader-wiring.ts services/analyst-grids/src/dev.ts services/analyst-grids/test/reader-wiring.test.ts
git commit -m "feat(analyst-grids): wire reader deps from env (LLM router + S3 object store)"
```

---

### Task 9: Web UI — question column in GridBuilder

**Files:**
- Modify: `web/src/analyst-grids/gridsTypes.ts` (ColumnSpec with params)
- Modify: `web/src/analyst-grids/GridBuilder.tsx` (question prompt input)
- Modify: `web/src/analyst-grids/gridsClient.ts` only if its create payload type names column specs (mirror the new type)
- Test: `web/src/analyst-grids/GridBuilder.test.tsx` (extend)

- [ ] **Step 1: Write the failing test (append to `GridBuilder.test.tsx`, following its existing render/submit helpers)**

```tsx
test("includes a reader_question column when a question is entered", async () => {
  const onSubmit = vi.fn();           // or the file's existing spy util
  renderBuilder({ onSubmit });        // existing helper; columns list need not include reader_question
  fireEvent.change(screen.getByTestId("grid-builder-question-input"), {
    target: { value: "Any China exposure flagged in risk factors?" },
  });
  fillManualUniverseAndSelectColumn(); // existing helper pattern: manual ids + one checkbox
  fireEvent.click(screen.getByTestId("grid-builder-submit"));
  const submitted = onSubmit.mock.calls[0][0];
  expect(submitted.column_specs).toContainEqual({
    column_key: "reader_question",
    params: { prompt: "Any China exposure flagged in risk factors?" },
  });
});

test("omits reader_question when the question field is empty", () => {
  // same flow without typing a question; submitted specs contain no reader_question
});
```

(Adapt helper names to the file's actual helpers — keep the assertions exactly.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- GridBuilder`
Expected: FAIL — no `grid-builder-question-input` test id.

- [ ] **Step 3: Implement**

`gridsTypes.ts`:

```ts
export type ColumnSpecInput = { column_key: string; params?: { prompt: string } };
```

`GridBuilder.tsx` — update the submit type and form:

```ts
export type GridBuilderSubmit = { universe_spec: unknown; column_specs: Array<{ column_key: string; params?: { prompt: string } }> };
```

In `handleSubmit`, after building `column_specs` from checkboxes:

```ts
    const question = String(fd.get("question") ?? "").trim();
    const column_specs: GridBuilderSubmit["column_specs"] = columns
      .filter((c) => selectedKeys.has(c.column_key))
      .map((c) => ({ column_key: c.column_key }));
    if (question.length > 0) {
      column_specs.push({ column_key: "reader_question", params: { prompt: question } });
    }
    if (column_specs.length === 0) return; // a grid needs at least one column
```

And in the JSX, after the columns fieldset:

```tsx
      <label className="block text-sm">
        Question column <span className="text-muted">(optional — asked per company, answered from documents)</span>
        <textarea
          name="question"
          data-testid="grid-builder-question-input"
          className="w-full rounded border border-line bg-surface-2 px-2 py-1"
          placeholder='e.g. "Any China exposure flagged in risk factors?"'
          maxLength={300}
        />
      </label>
```

(Filter `reader_question` out of the checkbox list if the columns endpoint includes it: `columns.filter((c) => c.kind !== "reader")` in the fieldset map — the question textarea is its UI.)

- [ ] **Step 4: Run web tests**

Run: `cd web && npm test -- GridBuilder`
Expected: PASS (and the full `npm test` stays green).

- [ ] **Step 5: Commit**

```bash
git add web/src/analyst-grids
git commit -m "feat(web): question column input in GridBuilder"
```

---

### Task 10: End-to-end integration test + acceptance check

**Files:**
- Test: `services/analyst-grids/test/reader-run-e2e.test.ts` (Docker/Postgres; follow `run-engine.test.ts` harness)

- [ ] **Step 1: Write the test**

```ts
// services/analyst-grids/test/reader-run-e2e.test.ts
// Harness: same ephemeral-Postgres + migrations setup as run-engine.test.ts.
// Seed: one issuer, one 'filing' source (license_class 'public'), one document
// with raw_blob_id 'sha256:e2e', a mentions row binding doc -> issuer.
// Reader deps: fake llm returning a fixed valid JSON answer (one claim citing
// the seeded document), loadDocumentText returning fixture text for
// 'sha256:e2e'.
//
// Grid: universe manual [issuer], column_specs:
//   [{ column_key: "reader_question", params: { prompt: "Any China exposure flagged in risk factors?" } }]
//
// Assertions after startGridRun + polling getRunDetail until terminal:
//   - run.status === "completed"
//   - the cell: status "ok", display.value === the fake answer,
//     primary_ref.kind === "claim", snapshot_id !== null
//   - snapshots row exists for cell.snapshot_id; its manifest has the claim in
//     claim_refs and the tool_call_id in tool_call_ids
//   - tool_call_logs row exists with tool_name 'grid_reader_question' and the
//     matching result_hash (i.e. the seal's audit actually passed against it)
//   - claims row exists, status 'extracted', document bound to the seeded doc
//
// Second scenario: an issuer with no documents ->
//   cell status "no_coverage", coverage_flag "no_documents", run "completed".
```

Write it concretely against the harness utilities `run-engine.test.ts` uses (db setup, polling helper). Both scenarios in one file.

- [ ] **Step 2: Run with Docker up**

Run: `cd services/analyst-grids && npm test`
Expected: PASS — this is the spec's acceptance criterion in miniature (sealed, inspector-traceable cells; honest no_coverage).

- [ ] **Step 3: Full-repo sanity**

Run: `cd services/analyze && npm test && cd ../snapshot && npm test && cd ../../web && npm test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add services/analyst-grids/test/reader-run-e2e.test.ts
git commit -m "test(analyst-grids): end-to-end reader question column run"
```

---

## Verification (manual, after all tasks)

1. `docker compose up -d` (Postgres + MinIO), configure `.env.llm` with a `reader` channel (any OpenAI-compatible model).
2. Start dev servers; open `/analyst-grids`.
3. Create a grid: manual universe with 3 issuers that have ingested filings; add the question "Any China exposure flagged in risk factors?".
4. Run; watch progress; confirm: answers appear in cells; clicking a cell opens the evidence inspector showing the claims + documents; issuers without documents show no-coverage (not fabricated text).

## Out of scope (deferred per spec §6)

Cross-run caching, curated templates, listing→issuer mapping, cross-run diffing.
