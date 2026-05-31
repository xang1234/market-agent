# Task 6: Dev API Playbook Routes And Run Metadata


**Files:**
- Modify: `services/dev-api/src/http.ts`
- Modify: `services/dev-api/src/local-runtime.ts`
- Test: `services/dev-api/test/http.test.ts`
- Modify: `spec/finance_research_openapi.yaml`

- [ ] **Step 1: Write failing HTTP tests**

Add tests to `services/dev-api/test/http.test.ts`:

```ts
const EARNINGS_TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";

test("GET /v1/analyze/playbooks returns built-in playbooks", async (t) => {
  const server = createDevApiServer({}, { adapters: createFixtureDevApiAdapters() });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/v1/analyze/playbooks`, {
    headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { playbooks?: Array<{ playbook_id: string }> };
  assert.ok(body.playbooks?.some((playbook) => playbook.playbook_id === "earnings_quality"));
});

test("POST /v1/analyze/runs accepts playbook_id and records it on the run", async (t) => {
  const server = createDevApiServer({}, { adapters: createFixtureDevApiAdapters() });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/v1/analyze/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "00000000-0000-4000-8000-000000000001",
    },
    body: JSON.stringify({
      template_id: EARNINGS_TEMPLATE_ID,
      playbook_id: "earnings_quality",
      instructions: "Focus on cash conversion.",
      source_categories: ["filings"],
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json() as {
    template_id?: string;
    template_name?: string;
    playbook_id?: string;
    playbook_name?: string | null;
    playbook_version?: number;
    display_title?: string;
    can_rerun?: boolean;
    rerun_unavailable_reason?: string | null;
    run_metadata?: { schema_version?: number };
    blocks?: Array<{ title?: string; data_ref?: { params?: { playbook_section_id?: string } } }>;
  };
  assert.equal(body.template_id, EARNINGS_TEMPLATE_ID);
  assert.equal(body.template_name, "Earnings template");
  assert.equal(body.playbook_id, "earnings_quality");
  assert.equal(body.playbook_name, "Earnings quality");
  assert.equal(body.playbook_version, 1);
  assert.equal(body.display_title, "Earnings quality");
  assert.equal(body.can_rerun, true);
  assert.equal(body.rerun_unavailable_reason, null);
  assert.equal(body.run_metadata?.schema_version, 1);
  assert.equal(body.blocks?.[0]?.title, "Earnings quality");
  assert.equal(body.blocks?.[0]?.data_ref?.params?.playbook_section_id, "summary");
});

test("POST /v1/analyze/runs/:id/rerun uses stored run metadata", async (t) => {
  const server = createDevApiServer({}, { adapters: createFixtureDevApiAdapters() });
  t.after(() => server.close());
  const base = await listen(server);
  const createdResponse = await fetch(`${base}/v1/analyze/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "00000000-0000-4000-8000-000000000001",
    },
    body: JSON.stringify({
      template_id: EARNINGS_TEMPLATE_ID,
      playbook_id: "earnings_quality",
      instructions: "Focus on cash conversion.",
      source_categories: ["filings"],
    }),
  });
  const created = await createdResponse.json() as { run_id: string };

  const rerunResponse = await fetch(`${base}/v1/analyze/runs/${created.run_id}/rerun`, {
    method: "POST",
    headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
  });

  assert.equal(rerunResponse.status, 201);
  const rerun = await rerunResponse.json() as { run_id?: string; display_title?: string; can_rerun?: boolean; rerun_unavailable_reason?: string | null; run_metadata?: { schema_version?: number; rerun_of_run_id?: string } };
  assert.notEqual(rerun.run_id, created.run_id);
  assert.equal(rerun.display_title, "Earnings quality");
  assert.equal(rerun.can_rerun, true);
  assert.equal(rerun.rerun_unavailable_reason, null);
  assert.equal(rerun.run_metadata?.schema_version, 1);
  assert.equal(rerun.run_metadata?.rerun_of_run_id, created.run_id);
});

test("GET /v1/analyze/runs paginates user run history with an opaque cursor", async (t) => {
  const server = createDevApiServer({}, { adapters: createFixtureDevApiAdapters() });
  t.after(() => server.close());
  const base = await listen(server);
  const headers = {
    "content-type": "application/json",
    "x-user-id": "00000000-0000-4000-8000-000000000001",
  };
  for (const instructions of ["First run", "Second run"]) {
    const response = await fetch(`${base}/v1/analyze/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        template_id: EARNINGS_TEMPLATE_ID,
        playbook_id: "earnings_quality",
        instructions,
        source_categories: ["filings"],
      }),
    });
    assert.equal(response.status, 201);
  }

  const firstPageResponse = await fetch(`${base}/v1/analyze/runs?limit=1`, {
    headers: { "x-user-id": headers["x-user-id"] },
  });
  assert.equal(firstPageResponse.status, 200);
  const firstPage = await firstPageResponse.json() as { runs?: Array<{ run_id: string; display_title?: string }>; next_cursor?: string | null };
  assert.equal(firstPage.runs?.length, 1);
  assert.equal("blocks" in (firstPage.runs?.[0] ?? {}), false);
  assert.equal(firstPage.runs?.[0]?.display_title, "Earnings quality");
  assert.equal(typeof firstPage.next_cursor, "string");

  const secondPageResponse = await fetch(`${base}/v1/analyze/runs?limit=1&cursor=${encodeURIComponent(firstPage.next_cursor ?? "")}`, {
    headers: { "x-user-id": headers["x-user-id"] },
  });
  assert.equal(secondPageResponse.status, 200);
  const secondPage = await secondPageResponse.json() as { runs?: Array<{ run_id: string }>; next_cursor?: string | null };
  assert.equal(secondPage.runs?.length, 1);
  assert.notEqual(secondPage.runs?.[0]?.run_id, firstPage.runs?.[0]?.run_id);
});

test("GET /v1/analyze/runs/:id returns full run detail with blocks", async (t) => {
  const server = createDevApiServer({}, { adapters: createFixtureDevApiAdapters() });
  t.after(() => server.close());
  const base = await listen(server);
  const createdResponse = await fetch(`${base}/v1/analyze/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "00000000-0000-4000-8000-000000000001",
    },
    body: JSON.stringify({
      template_id: EARNINGS_TEMPLATE_ID,
      playbook_id: "earnings_quality",
      instructions: "Focus on cash conversion.",
      source_categories: ["filings"],
    }),
  });
  const created = await createdResponse.json() as { run_id: string };

  const detailResponse = await fetch(`${base}/v1/analyze/runs/${created.run_id}`, {
    headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
  });
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json() as { run_id?: string; display_title?: string; blocks?: Array<{ title?: string }> };
  assert.equal(detail.run_id, created.run_id);
  assert.equal(detail.display_title, "Earnings quality");
  assert.equal(detail.blocks?.[0]?.title, "Earnings quality");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/dev-api
npm test -- test/http.test.ts
```

Expected: FAIL because `/v1/analyze/playbooks` returns 404, run payloads do not include
`playbook_id`, `playbook_version`, or display labels, `/v1/analyze/runs` is not
paginated, and the run-detail endpoint does not exist.

- [ ] **Step 3: Extend dev API run types**

Modify `services/dev-api/src/http.ts`:

```ts
import {
  ANALYZE_PLAYBOOKS,
  resolveAnalyzePlaybookRequest,
  serializeAnalyzeRunMetadataV1,
  parseAnalyzeRunMetadata,
  withRerunOfRunId,
} from "../../analyze/src/index.ts";
import type { AnalyzeRunMetadataV1 } from "../../analyze/src/index.ts";
```

Split list summaries from full run details:

```ts
type DevAnalyzeRunSummary = {
  run_id: string;
  template_id: string;
  template_name: string;
  template_version: number;
  playbook_id: string | null;
  playbook_name: string | null;
  playbook_version: number | null;
  display_title: string;
  run_metadata: unknown;
  can_rerun: boolean;
  rerun_unavailable_reason: string | null;
  snapshot_id: string;
  created_at: string;
};

type DevAnalyzeRun = DevAnalyzeRunSummary & {
  blocks: ReadonlyArray<Record<string, unknown>>;
};
```

Add a route before `/v1/analyze/templates`:

```ts
if (req.method === "GET" && url.pathname === "/v1/analyze/playbooks") {
  const userId = readUserIdHeader(req.headers["x-user-id"]);
  if (userId === null) {
    respondJson(res, 401, { error: "x-user-id header is required" });
    return;
  }
  respondJson(res, 200, { playbooks: ANALYZE_PLAYBOOKS });
  return;
}
```

- [ ] **Step 4: Record playbook metadata in fixture runs**

In fixture `createRun`, resolve the playbook:

```ts
const playbookId = nonEmptyString(body.playbook_id) ?? "earnings_quality";
const primarySubjectRef = readOptionalSubjectRef(body.subject_ref ?? body.primary_subject_ref);
const subjectRefs = primarySubjectRef ? [primarySubjectRef] : [];
const resolvedPlaybook = resolveAnalyzePlaybookRequest({
  playbook_id: playbookId,
  instructions: nonEmptyString(body.instructions) ?? undefined,
  source_categories: Array.isArray(body.source_categories)
    ? body.source_categories.filter((category): category is string => typeof category === "string")
    : undefined,
});
```

Set the run fields:

```ts
const run: DevAnalyzeRun = {
  run_id: runId,
  template_id: nonEmptyString(body.template_id) ?? EARNINGS_TEMPLATE_ID,
  template_name: fixtureTemplateName(nonEmptyString(body.template_id) ?? EARNINGS_TEMPLATE_ID),
  template_version: 1,
  playbook_id: resolvedPlaybook.playbook.playbook_id,
  playbook_name: resolvedPlaybook.playbook.name,
  playbook_version: resolvedPlaybook.playbook.version,
  display_title: resolvedPlaybook.playbook.name,
  run_metadata: serializeAnalyzeRunMetadataV1({
    playbook_id: resolvedPlaybook.playbook.playbook_id,
    playbook_version: resolvedPlaybook.playbook.version,
    template_id: nonEmptyString(body.template_id) ?? EARNINGS_TEMPLATE_ID,
    template_version: 1,
    instructions: resolvedPlaybook.instructions,
    source_categories: [...resolvedPlaybook.source_categories],
    subject_refs: subjectRefs,
  }),
  can_rerun: true,
  rerun_unavailable_reason: null,
  snapshot_id: snapshotId,
  blocks: [
    richTextBlock({
      id: stableUuid(`analyze-block:${runId}`),
      snapshotId,
      title: resolvedPlaybook.playbook.name,
      text: `${resolvedPlaybook.instructions} Sources: ${resolvedPlaybook.source_categories.join(", ")}.`,
      playbookSectionId: resolvedPlaybook.playbook.sections[0]?.section_id ?? "summary",
    }),
  ],
  created_at: new Date().toISOString(),
};
```

Add fixture label helpers:

```ts
function fixtureTemplateName(templateId: string): string {
  return defaultAnalyzeTemplates().find((template) => template.template_id === templateId)?.name ?? "Analyze template";
}
```

Define stable fixture template ids near the fixture template helpers:

```ts
const EARNINGS_TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
```

Use those UUIDs in `defaultAnalyzeTemplates()`:

```ts
template_id: EARNINGS_TEMPLATE_ID,
name: "Earnings template",
```

and

```ts
template_id: VARIANT_TEMPLATE_ID,
```

Do not use slug-shaped values such as `earnings-quality` for `template_id`. The
template selector should render `template.name` as the visible label and keep the UUID
only as the submitted value.

In durable `createRun`, keep `template_id` required and resolve it with
`getAnalyzeTemplate` before applying playbook guidance. `playbook_id` must never be
used as a substitute for `template_id` in durable mode. Return `playbook_version`
from the resolved playbook, return `template_name`, `playbook_name`, and
`display_title` on the run response, and persist playbook version inside
`run_metadata`, not as a separate database column.
Keep the create-run request API singular for the primary subject: accept
`subject_ref` (and continue honoring the existing `primary_subject_ref` alias), then
persist `run_metadata.subject_refs` as the resolved plural set:
`[primary subject_ref, ...template.added_subject_refs]` with duplicates removed.
Do not add a public `subject_refs` request field in this slice.

Generated Analyze blocks that correspond to playbook sections must store the stable
section id in `data_ref.params.playbook_section_id`. Do not add a top-level
`section_id` field to blocks because the concrete block schema uses
`unevaluatedProperties: false`.

Extend the fixture `richTextBlock` helper to accept `playbookSectionId?: string` and
emit:

```ts
data_ref: input.playbookSectionId
  ? { kind: "analyze_run", id: input.id, params: { playbook_section_id: input.playbookSectionId } }
  : { kind: "analyze_run", id: input.id },
```

- [ ] **Step 5: Add run listing endpoint**

Add this route after run creation:

```ts
if (req.method === "GET" && url.pathname === "/v1/analyze/runs") {
  const userId = readUserIdHeader(req.headers["x-user-id"]);
  if (userId === null) {
    respondJson(res, 401, { error: "x-user-id header is required" });
    return;
  }
  if (!adapters) {
    respondJson(res, 503, { error: "durable analyze adapter is not configured" });
    return;
  }
  const pagination = readAnalyzeRunPagination(url.searchParams);
  respondJson(res, 200, await adapters.analyze.listRuns({ userId, ...pagination }));
  return;
}
```

Add pagination helpers in `services/dev-api/src/http.ts`:

```ts
const DEFAULT_ANALYZE_RUN_LIMIT = 25;
const MAX_ANALYZE_RUN_LIMIT = 100;

type AnalyzeRunPaginationInput = {
  limit: number;
  cursor: string | null;
};

function readAnalyzeRunPagination(params: URLSearchParams): AnalyzeRunPaginationInput {
  return {
    limit: readBoundedLimit(params.get("limit"), DEFAULT_ANALYZE_RUN_LIMIT, MAX_ANALYZE_RUN_LIMIT),
    cursor: nonEmptyString(params.get("cursor")) ?? null,
  };
}

function readBoundedLimit(value: string | null, defaultLimit: number, maxLimit: number): number {
  if (value === null || value.trim() === "") return defaultLimit;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DevApiHttpError(400, "limit must be a positive integer");
  }
  return Math.min(parsed, maxLimit);
}
```

Return `400` for malformed `limit` or malformed cursor values. The cursor should be
opaque to clients and encode the last row's `{ created_at, run_id }` position.
Use the same `encodeAnalyzeRunCursor` / `decodeAnalyzeRunCursor` shape specified
in task 8: base64url-encoded JSON with non-empty `created_at` and `run_id`
fields. The HTTP layer may keep the adapter argument as the opaque cursor string,
but fixture and durable adapters must decode it before applying pagination and
must translate decode failures into `400 "cursor: invalid analyze run cursor"`.

Example cursor payload before encoding:

```json
{ "created_at": "2026-05-30T12:00:00.000Z", "run_id": "11111111-1111-4111-8111-111111111111" }
```

Extend `DevApiAnalyzeAdapter`:

```ts
listRuns(input: { userId: string; limit: number; cursor: string | null }): Promise<{ runs: DevAnalyzeRunSummary[]; next_cursor: string | null }>;
```

Add fixture implementation:

```ts
async listRuns({ userId, limit, cursor }) {
  const runs = analyzeRuns
    .filter((run) => runOwner(run.run_id) === userId)
    .sort(compareAnalyzeRunsNewestFirst);
  const startIndex = cursor ? Math.max(0, runs.findIndex((run) => encodeAnalyzeRunCursor(run) === cursor) + 1) : 0;
  const page = runs.slice(startIndex, startIndex + limit);
  return {
    runs: page.map(toAnalyzeRunSummary),
    next_cursor: runs[startIndex + limit] ? encodeAnalyzeRunCursor(page[page.length - 1]) : null,
  };
},
```

Fixture run history should return `can_rerun` and `rerun_unavailable_reason` on every
run and must not include `blocks`. Durable run history should compute those fields
server-side; the web client must not infer eligibility from metadata shape alone.

Add a run-detail route after run listing and before rerun:

```ts
if (req.method === "GET" && /^\/v1\/analyze\/runs\/[^/]+$/.test(url.pathname)) {
  const userId = readUserIdHeader(req.headers["x-user-id"]);
  if (userId === null) {
    respondJson(res, 401, { error: "x-user-id header is required" });
    return;
  }
  if (!adapters) {
    respondJson(res, 503, { error: "durable analyze adapter is not configured" });
    return;
  }
  const runId = readRequiredUuidValue(url.pathname.split("/")[4] ?? "", "run_id");
  respondJson(res, 200, await adapters.analyze.getRun({ userId, runId }));
  return;
}
```

Extend `DevApiAnalyzeAdapter`:

```ts
getRun(input: { userId: string; runId: string }): Promise<DevAnalyzeRun>;
```

Add fixture implementation:

```ts
async getRun({ userId, runId }) {
  const run = analyzeRuns.find((item) => item.run_id === runId && runOwner(item.run_id) === userId);
  if (!run) throw new DevApiHttpError(404, "analyze run not found");
  return run;
},
```

Add a shared summary mapper:

```ts
function toAnalyzeRunSummary(run: DevAnalyzeRun): DevAnalyzeRunSummary {
  const { blocks: _blocks, ...summary } = run;
  return summary;
}
```

Add rerun route after the run-detail route:

```ts
if (req.method === "POST" && /^\/v1\/analyze\/runs\/[^/]+\/rerun$/.test(url.pathname)) {
  const userId = readUserIdHeader(req.headers["x-user-id"]);
  if (userId === null) {
    respondJson(res, 401, { error: "x-user-id header is required" });
    return;
  }
  if (!adapters) {
    respondJson(res, 503, { error: "durable analyze adapter is not configured" });
    return;
  }
  const runId = readRequiredUuidValue(url.pathname.split("/")[4] ?? "", "run_id");
  respondJson(res, 201, await adapters.analyze.rerun({ userId, runId }));
  return;
}
```

Extend `DevApiAnalyzeAdapter`:

```ts
rerun(input: { userId: string; runId: string }): Promise<DevAnalyzeRun>;
```

Add fixture implementation:

```ts
async rerun({ userId, runId }) {
  const original = analyzeRuns.find((run) => run.run_id === runId && runOwner(run.run_id) === userId);
  if (!original) throw new DevApiHttpError(404, "analyze run not found");
  const rerunId = stableUuid(`analyze-rerun:${userId}:${runId}:${analyzeRuns.length}`);
  const rerun: DevAnalyzeRun = {
    ...original,
    run_id: rerunId,
    snapshot_id: stableUuid(`analyze-snapshot:${rerunId}`),
    created_at: new Date().toISOString(),
    run_metadata: withRerunOfRunId(parseAnalyzeRunMetadata(original.run_metadata), original.run_id),
    can_rerun: true,
    rerun_unavailable_reason: null,
  };
  analyzeRuns.unshift(rerun);
  return rerun;
},
```

Add durable implementation in `createServiceDevApiAdapters`:

```ts
async listRuns({ userId, limit, cursor }) {
  const page = await listAnalyzeTemplateRunsByUser(deps.db, { userId, limit, cursor });
  return {
    runs: await Promise.all(page.runs.map((run) => toAnalyzeRunSummaryResponse(deps.db, run))),
    next_cursor: page.next_cursor,
  };
},
async getRun({ userId, runId }) {
  const run = await getAnalyzeTemplateRunForUser(deps.db, { userId, runId });
  if (run === null) throw new DevApiHttpError(404, "analyze run not found");
  return toAnalyzeRunDetailResponse(deps.db, run);
},
async rerun({ userId, runId }) {
  const original = await getAnalyzeTemplateRunForUser(deps.db, { userId, runId });
  if (original === null) throw new DevApiHttpError(404, "analyze run not found");
  const metadata = parseAnalyzeRunMetadata(original.run_metadata);
  return createAnalyzeRunFromStoredMetadata({
    userId,
    original,
    metadata,
    rerunOfRunId: runId,
  });
},
```

Add a server-side response mapper:

```ts
async function toAnalyzeRunDetailResponse(
  db: QueryExecutor,
  run: AnalyzeTemplateRunWithTemplateRow,
): Promise<DevAnalyzeRun> {
  const eligibility = await computeAnalyzeRerunEligibility(db, run);
  return {
    ...run,
    playbook_version: eligibility.metadata?.playbook_version ?? null,
    playbook_name: playbookNameForRun(eligibility.metadata),
    display_title: displayTitleForRun(run, eligibility.metadata),
    run_metadata: run.run_metadata,
    can_rerun: eligibility.can_rerun,
    rerun_unavailable_reason: eligibility.rerun_unavailable_reason,
  };
}

async function toAnalyzeRunSummaryResponse(
  db: QueryExecutor,
  run: AnalyzeTemplateRunSummaryRow,
): Promise<DevAnalyzeRunSummary> {
  const eligibility = await computeAnalyzeRerunEligibility(db, run);
  return {
    ...run,
    playbook_version: eligibility.metadata?.playbook_version ?? null,
    playbook_name: playbookNameForRun(eligibility.metadata),
    display_title: displayTitleForRun(run, eligibility.metadata),
    run_metadata: run.run_metadata,
    can_rerun: eligibility.can_rerun,
    rerun_unavailable_reason: eligibility.rerun_unavailable_reason,
  };
}

function playbookNameForRun(metadata: AnalyzeRunMetadataV1 | null): string | null {
  if (!metadata?.playbook_id) return null;
  return ANALYZE_PLAYBOOKS.find((playbook) => playbook.playbook_id === metadata.playbook_id)?.name ?? null;
}

function displayTitleForRun(
  run: Pick<AnalyzeTemplateRunSummaryRow, "template_name">,
  metadata: AnalyzeRunMetadataV1 | null,
): string {
  return playbookNameForRun(metadata) ?? run.template_name ?? "Analyze run";
}

// Do not use playbook_id or template_id as the primary display title. If a
// playbook id is no longer known to the built-in catalog, fall back to the
// historical template_name.

async function computeAnalyzeRerunEligibility(
  db: QueryExecutor,
  run: AnalyzeTemplateRunSummaryRow,
): Promise<{
  can_rerun: boolean;
  rerun_unavailable_reason: string | null;
  metadata: AnalyzeRunMetadataV1 | null;
}> {
  let metadata: AnalyzeRunMetadataV1;
  try {
    metadata = parseAnalyzeRunMetadata(run.run_metadata);
  } catch {
    return {
      can_rerun: false,
      rerun_unavailable_reason: "This run's metadata is not rerunnable.",
      metadata: null,
    };
  }
  const template = await getAnalyzeTemplate(db, metadata.template_id);
  if (template === null) {
    return {
      can_rerun: false,
      rerun_unavailable_reason: "The template used by this run is no longer runnable.",
      metadata,
    };
  }
  return { can_rerun: true, rerun_unavailable_reason: null, metadata };
}
```

Use the same `computeAnalyzeRerunEligibility` check inside `rerun` before executing.
The endpoint remains authoritative even when history listed the run as rerunnable a
moment earlier.

`GET /v1/analyze/runs` must use a user-scoped query rather than flattening
`listAnalyzeTemplateRunsByTemplate` across every template in application code.
It must be paginated from day one: default `limit=25`, maximum `limit=100`,
`next_cursor` response field, and stable ordering by `created_at desc, run_id desc`.
Compute rerun eligibility only for the returned page. List rows are summaries and
must not include `blocks`; `GET /v1/analyze/runs/{runId}` is the full run-detail
endpoint that returns `blocks` for open and diff workflows.
`POST /v1/analyze/runs/{runId}/rerun` must load the original user-owned run and reuse
its stored `run_metadata`; the web client must not rebuild rerun inputs from visible
fields.

Refactor durable `createRun` enough that both fresh creates and reruns pass through
one internal `createAnalyzeRunFromStoredMetadata`/`createAnalyzeRunFromResolvedInput`
path for rendering, snapshot sealing, and persistence. Rerun should merge
`rerun_of_run_id` into the new run metadata after loading the original metadata.
If parsing `run_metadata` fails because the schema is missing, malformed, or
unsupported, the run should remain openable in history but the rerun endpoint should
return a typed non-destructive error such as `409` with message
`analyze run metadata is not rerunnable`.
Map `AnalyzeRunMetadataError` to that `409`; keep missing run/user-scope failures as
the existing generic `404`.
If the current active template referenced by the parsed metadata no longer exists
because it was soft-deleted, return `409` with message
`analyze template is no longer runnable`; do not delete or hide the historical run.

- [ ] **Step 6: Update OpenAPI Analyze contract**

Modify `spec/finance_research_openapi.yaml`:

- Add `GET /v1/analyze/playbooks` with `operationId: listAnalyzePlaybooks`.
- Add `GET /v1/analyze/runs` with `operationId: listAnalyzeRuns`, optional query params `limit` and `cursor`, default limit 25, max limit 100, and response field `next_cursor`.
- Add `GET /v1/analyze/runs/{runId}` with `operationId: getAnalyzeRun`.
- Add `POST /v1/analyze/runs/{runId}/rerun` with `operationId: rerunAnalyzeRun`.
- Extend `AnalyzeRunInput` with required UUID `template_id` for durable mode and optional `playbook_id`, `instructions`, `source_categories`, and singular `subject_ref`. Keep `primary_subject_ref` as a backward-compatible alias if the existing schema already exposes it; do not add public plural `subject_refs` yet.
- Add `AnalyzePlaybook`, `AnalyzePlaybookSection`, `AnalyzePlaybookListResponse`, `AnalyzeRunSummary`, and `AnalyzeRunListResponse` schemas. `AnalyzeRunListResponse` is `{ runs, next_cursor }`, with `runs` containing summaries and `next_cursor` nullable.
- Add an `AnalyzeRunMetadataV1` schema with required `schema_version: 1`, `template_id`, `template_version`, `playbook_id`, `playbook_version`, `instructions`, `source_categories`, `subject_refs`, and optional `rerun_of_run_id`.
- Extend `AnalyzeRunSummary` and `AnalyzeRun` with `template_name`, `playbook_name`, and `display_title`.
- Extend `AnalyzeRun` with `template_version`, `playbook_id`, `playbook_version`, `run_metadata`, `can_rerun`, `rerun_unavailable_reason`, and `blocks`.
- Document that `AnalyzeRunSummary` intentionally omits `blocks`; clients must call `getAnalyzeRun` before opening or diffing a historical run.
- Document that `playbook_id` never substitutes for `template_id`, that `template_id` uses `format: uuid`, that reruns are created from stored server-side `run_metadata`, that unsupported metadata versions are viewable but not rerunnable, and that reruns return `409` when the active template was deleted.

- [ ] **Step 7: Run dev-api tests and parse OpenAPI**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/dev-api
npm test -- test/http.test.ts
cd /Users/admin/Documents/Work/market-agent
ruby -e 'require "yaml"; YAML.load_file("spec/finance_research_openapi.yaml")'
```

Expected: PASS, and the OpenAPI YAML parses.

- [ ] **Step 8: Commit**

```bash
git add services/dev-api/src/http.ts services/dev-api/src/local-runtime.ts services/dev-api/test/http.test.ts spec/finance_research_openapi.yaml
git commit -m "feat(dev-api): add analyze playbook routes"
```
