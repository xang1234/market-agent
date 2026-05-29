# Evidence Inspector And Analyze Playbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a universal evidence inspector for snapshot-backed refs and upgrade Analyze from a thin template form into guided analyst playbooks with run history, reruns, and memo diffing.

**Architecture:** Add one evidence-inspection service module behind a narrow HTTP endpoint, then expose it in the web shell through an inspector provider and inspectable block affordances. Add an Analyze playbook contract in `services/analyze`, wire it through `services/dev-api`, and update `web/src/pages/AnalyzePage.tsx` to drive playbook selection, runs, history, and diffs through typed client helpers.

**Tech Stack:** TypeScript, Node `--experimental-strip-types`, React 19, Vite, `pg`, existing `Block[]`, `SnapshotManifest`, Evidence, Snapshot, Analyze, Dev API, and web shell patterns.

---

## Scope Check

This plan covers two related product improvements that share the same artifact and provenance plane:

- **Universal Evidence Inspector**: backend inspection API plus web inspection drawer and block renderer affordances.
- **Guided Analyze Playbooks**: service contract, backend route wiring, web workflow, run history, rerun, and diff.

They can ship independently. Tasks 1-4 deliver a complete evidence inspector. Tasks 5-8 deliver Analyze playbooks. Task 9 verifies the combined workflow.

## File Structure

### Evidence Inspector

- Create `services/evidence/src/inspector.ts`: query-backed inspection module. It accepts `{ user_id, snapshot_id, ref }`, validates snapshot membership, and returns a normalized inspection envelope for `source`, `document`, `claim`, `event`, `fact`, `computation`, and `block`.
- Modify `services/evidence/src/index.ts`: export the inspector types and function.
- Create `services/evidence/test/inspector.test.ts`: unit tests using a stub query executor for validation, snapshot-membership checks, and row shaping.
- Modify `services/dev-api/src/http.ts`: add an `evidence.inspect` adapter and route `GET /v1/evidence/inspect`.
- Modify `services/dev-api/src/local-runtime.ts`: wire durable local runtime inspection by delegating to `loadEvidenceInspection`.
- Modify `services/dev-api/test/http.test.ts`: endpoint tests for missing auth, invalid refs, not found, and success.
- Create `web/src/evidence/inspectionClient.ts`: typed fetch helper for `/v1/evidence/inspect`.
- Create `web/src/evidence/EvidenceInspectorProvider.tsx`: shell-wide context with `openInspection`, `closeInspection`, and selected inspection state.
- Create `web/src/evidence/EvidenceInspectorDrawer.tsx`: fixed right-side drawer for inspection details.
- Create `web/src/evidence/InspectableRef.tsx`: small button/span wrapper used by renderers.
- Create `web/src/evidence/inspectionTypes.ts`: shared web-side types for request, response, and view-model state.
- Create `web/src/evidence/inspectionClient.test.ts`: client contract tests.
- Create `web/src/evidence/EvidenceInspectorProvider.test.tsx`: open/close/fetch state tests.
- Modify `web/src/shell/WorkspaceShell.tsx`: wrap shell content in `EvidenceInspectorProvider`.
- Modify `web/src/blocks/BlockView.tsx`: pass block-level inspection context to rendered blocks through provider context.
- Modify `web/src/blocks/RichText.tsx`, `web/src/blocks/MetricRow.tsx`, `web/src/blocks/Sources.tsx`: expose inspectable refs.
- Modify relevant block tests: `web/src/blocks/richText.test.ts`, `web/src/blocks/metricRow.test.ts`, `web/src/blocks/fixtures.test.ts`.

### Analyze Playbooks

- Create `services/analyze/src/playbook.ts`: built-in playbook definitions, request resolver, and validation helpers.
- Modify `services/analyze/src/index.ts`: export playbook APIs.
- Create `services/analyze/test/playbook.test.ts`: unit tests for built-ins, request resolution, source-category defaults, and section layout.
- Modify `services/dev-api/src/http.ts`: add `GET /v1/analyze/playbooks`, `GET /v1/analyze/runs`, and accept `playbook_id` on `POST /v1/analyze/runs`.
- Modify `services/dev-api/src/local-runtime.ts`: include playbook metadata in generated memo blocks and run payloads.
- Modify `services/dev-api/test/http.test.ts`: playbook route, run creation, run listing, and user scoping tests.
- Create `web/src/analyze/playbooks.ts`: web-side client helpers and view model helpers.
- Create `web/src/analyze/runHistory.ts`: list, rerun, and diff helpers.
- Create `web/src/analyze/runDiff.test.ts`: deterministic diff tests over `Block[]`.
- Modify `web/src/pages/AnalyzePage.tsx`: replace thin template picker with playbook picker, section preview, source policy controls, run history, rerun, and diff.
- Modify `web/src/pages/workflowSurfaces.test.tsx`: render and workflow tests for guided playbooks.

---

## Task 1: Evidence Inspection Service Module

**Files:**
- Create: `services/evidence/src/inspector.ts`
- Modify: `services/evidence/src/index.ts`
- Test: `services/evidence/test/inspector.test.ts`

- [ ] **Step 1: Write failing tests for inspection request validation and source inspection**

Add this to `services/evidence/test/inspector.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  loadEvidenceInspection,
  EvidenceInspectionError,
  type EvidenceInspectionRef,
} from "../src/inspector.ts";

type QueryCall = { text: string; values?: unknown[] };

function stubDb(rowsByQuery: (text: string, values?: unknown[]) => unknown[]) {
  const calls: QueryCall[] = [];
  return {
    calls,
    db: {
      async query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
        calls.push({ text, values });
        return { rows: rowsByQuery(text, values) as T[] };
      },
    },
  };
}

test("loadEvidenceInspection rejects malformed refs before querying", async () => {
  const { db, calls } = stubDb(() => []);
  await assert.rejects(
    () =>
      loadEvidenceInspection(db, {
        user_id: "00000000-0000-4000-8000-000000000001",
        snapshot_id: "11111111-1111-4111-8111-111111111111",
        ref: { kind: "claim", id: "not-a-uuid" } as EvidenceInspectionRef,
      }),
    /ref.id must be a UUID/,
  );
  assert.equal(calls.length, 0);
});

test("loadEvidenceInspection returns source details only when source belongs to snapshot", async () => {
  const snapshotId = "11111111-1111-4111-8111-111111111111";
  const sourceId = "22222222-2222-4222-8222-222222222222";
  const { db } = stubDb((text) => {
    if (text.includes("from snapshots")) {
      return [
        {
          snapshot_id: snapshotId,
          manifest: {
            source_ids: [sourceId],
            document_refs: [],
            claim_refs: [],
            event_refs: [],
            fact_refs: [],
          },
        },
      ];
    }
    if (text.includes("from sources")) {
      return [
        {
          source_id: sourceId,
          provider: "sec",
          kind: "filing",
          canonical_url: "https://www.sec.gov/Archives/example",
          trust_tier: "primary",
          license_class: "public",
          retrieved_at: "2026-05-29T00:00:00.000Z",
          content_hash: "abc123",
          user_id: null,
        },
      ];
    }
    return [];
  });

  const result = await loadEvidenceInspection(db, {
    user_id: "00000000-0000-4000-8000-000000000001",
    snapshot_id: snapshotId,
    ref: { kind: "source", id: sourceId },
  });

  assert.equal(result.kind, "source");
  assert.equal(result.snapshot_id, snapshotId);
  assert.equal(result.ref.id, sourceId);
  assert.equal(result.title, "sec filing");
  assert.deepEqual(result.badges, ["primary", "public"]);
  assert.equal(result.rows[0]?.label, "Provider");
  assert.equal(result.rows[0]?.value, "sec");
});
```

- [ ] **Step 2: Run the focused failing tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/evidence
npm test -- test/inspector.test.ts
```

Expected: FAIL with a module-not-found error for `../src/inspector.ts`.

- [ ] **Step 3: Implement the inspector module**

Create `services/evidence/src/inspector.ts`:

```ts
import type { QueryExecutor } from "./types.ts";

export const EVIDENCE_INSPECTION_REF_KINDS = [
  "source",
  "document",
  "claim",
  "event",
  "fact",
  "computation",
  "block",
] as const;

export type EvidenceInspectionRefKind = (typeof EVIDENCE_INSPECTION_REF_KINDS)[number];

export type EvidenceInspectionRef = {
  kind: EvidenceInspectionRefKind;
  id: string;
};

export type EvidenceInspectionRow = {
  label: string;
  value: string;
};

export type EvidenceInspectionLink = {
  label: string;
  href: string;
};

export type EvidenceInspection = {
  snapshot_id: string;
  ref: EvidenceInspectionRef;
  kind: EvidenceInspectionRefKind;
  title: string;
  subtitle: string | null;
  badges: ReadonlyArray<string>;
  rows: ReadonlyArray<EvidenceInspectionRow>;
  links: ReadonlyArray<EvidenceInspectionLink>;
  related_refs: ReadonlyArray<EvidenceInspectionRef>;
};

export class EvidenceInspectionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "EvidenceInspectionError";
    this.status = status;
  }
}

type SnapshotRow = {
  snapshot_id: string;
  manifest: unknown;
};

type SourceRow = {
  source_id: string;
  provider: string;
  kind: string;
  canonical_url: string | null;
  trust_tier: string;
  license_class: string;
  retrieved_at: Date | string;
  content_hash: string;
  user_id: string | null;
};

type SnapshotManifestRefs = {
  source_ids: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  event_refs: ReadonlyArray<string>;
  fact_refs: ReadonlyArray<string>;
  computation_refs: ReadonlyArray<string>;
  block_refs: ReadonlyArray<string>;
};

export async function loadEvidenceInspection(
  db: QueryExecutor,
  input: {
    user_id: string;
    snapshot_id: string;
    ref: EvidenceInspectionRef;
  },
): Promise<EvidenceInspection> {
  assertUuid(input.user_id, "user_id");
  assertUuid(input.snapshot_id, "snapshot_id");
  assertRef(input.ref);

  const manifest = await loadSnapshotManifest(db, input.snapshot_id);
  assertRefBelongsToSnapshot(manifest, input.ref);

  if (input.ref.kind === "source") {
    return inspectSource(db, input.snapshot_id, input.ref.id, input.user_id);
  }

  return {
    snapshot_id: input.snapshot_id,
    ref: input.ref,
    kind: input.ref.kind,
    title: `${input.ref.kind} ${input.ref.id}`,
    subtitle: null,
    badges: Object.freeze([]),
    rows: Object.freeze([{ label: "Reference id", value: input.ref.id }]),
    links: Object.freeze([]),
    related_refs: Object.freeze([]),
  };
}

async function loadSnapshotManifest(
  db: QueryExecutor,
  snapshotId: string,
): Promise<SnapshotManifestRefs> {
  const { rows } = await db.query<SnapshotRow>(
    `select snapshot_id::text as snapshot_id, manifest
       from snapshots
      where snapshot_id = $1::uuid`,
    [snapshotId],
  );
  const row = rows[0];
  if (!row) throw new EvidenceInspectionError(404, "snapshot not found");
  return refsFromManifest(row.manifest);
}

function refsFromManifest(value: unknown): SnapshotManifestRefs {
  const manifest = isRecord(value) ? value : {};
  return Object.freeze({
    source_ids: stringArray(manifest.source_ids),
    document_refs: stringArray(manifest.document_refs),
    claim_refs: stringArray(manifest.claim_refs),
    event_refs: stringArray(manifest.event_refs),
    fact_refs: stringArray(manifest.fact_refs),
    computation_refs: stringArray(manifest.computation_refs),
    block_refs: stringArray(manifest.block_refs),
  });
}

function assertRefBelongsToSnapshot(
  manifest: SnapshotManifestRefs,
  ref: EvidenceInspectionRef,
): void {
  const refs = refsForKind(manifest, ref.kind);
  if (!refs.includes(ref.id)) {
    throw new EvidenceInspectionError(404, "ref is not present in snapshot manifest");
  }
}

function refsForKind(manifest: SnapshotManifestRefs, kind: EvidenceInspectionRefKind): ReadonlyArray<string> {
  if (kind === "source") return manifest.source_ids;
  if (kind === "document") return manifest.document_refs;
  if (kind === "claim") return manifest.claim_refs;
  if (kind === "event") return manifest.event_refs;
  if (kind === "fact") return manifest.fact_refs;
  if (kind === "computation") return manifest.computation_refs;
  return manifest.block_refs;
}

async function inspectSource(
  db: QueryExecutor,
  snapshotId: string,
  sourceId: string,
  userId: string,
): Promise<EvidenceInspection> {
  const { rows } = await db.query<SourceRow>(
    `select source_id::text as source_id,
            provider,
            kind,
            canonical_url,
            trust_tier,
            license_class,
            retrieved_at,
            content_hash,
            user_id::text as user_id
       from sources
      where source_id = $1::uuid
        and (user_id is null or user_id = $2::uuid)`,
    [sourceId, userId],
  );
  const row = rows[0];
  if (!row) throw new EvidenceInspectionError(404, "source not found");
  return Object.freeze({
    snapshot_id: snapshotId,
    ref: Object.freeze({ kind: "source", id: sourceId }),
    kind: "source",
    title: `${row.provider} ${row.kind}`,
    subtitle: row.canonical_url,
    badges: Object.freeze([row.trust_tier, row.license_class]),
    rows: Object.freeze([
      { label: "Provider", value: row.provider },
      { label: "Kind", value: row.kind },
      { label: "Retrieved", value: isoString(row.retrieved_at) },
      { label: "Content hash", value: row.content_hash },
    ]),
    links: Object.freeze(row.canonical_url ? [{ label: "Open source", href: row.canonical_url }] : []),
    related_refs: Object.freeze([]),
  });
}

function assertRef(ref: EvidenceInspectionRef): void {
  if (!isRecord(ref)) throw new EvidenceInspectionError(400, "ref must be an object");
  if (!EVIDENCE_INSPECTION_REF_KINDS.includes(ref.kind)) {
    throw new EvidenceInspectionError(400, "ref.kind is invalid");
  }
  assertUuid(ref.id, "ref.id");
}

function assertUuid(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
  ) {
    throw new EvidenceInspectionError(400, `${label} must be a UUID`);
  }
}

function stringArray(value: unknown): ReadonlyArray<string> {
  return Object.freeze(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
```

- [ ] **Step 4: Export the module**

Modify `services/evidence/src/index.ts`:

```ts
export * from "./inspector.ts";
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/evidence
npm test -- test/inspector.test.ts
```

Expected: PASS for both inspector tests.

- [ ] **Step 6: Commit**

```bash
git add services/evidence/src/inspector.ts services/evidence/src/index.ts services/evidence/test/inspector.test.ts
git commit -m "feat(evidence): add snapshot inspection contract"
```

## Task 2: Evidence Inspection HTTP Route

**Files:**
- Modify: `services/dev-api/src/http.ts`
- Modify: `services/dev-api/src/local-runtime.ts`
- Test: `services/dev-api/test/http.test.ts`

- [ ] **Step 1: Write failing route tests**

Add these tests to `services/dev-api/test/http.test.ts`:

```ts
test("GET /v1/evidence/inspect requires x-user-id", async (t) => {
  const server = createDevApiServer({}, {
    adapters: {
      ...createFixtureDevApiAdapters(),
      evidence: {
        inspect: async () => {
          throw new Error("should not inspect without auth");
        },
      },
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/v1/evidence/inspect?snapshot_id=11111111-1111-4111-8111-111111111111&ref_kind=source&ref_id=22222222-2222-4222-8222-222222222222`);
  assert.equal(response.status, 401);
});

test("GET /v1/evidence/inspect returns adapter inspection", async (t) => {
  const server = createDevApiServer({}, {
    adapters: {
      ...createFixtureDevApiAdapters(),
      evidence: {
        inspect: async ({ snapshotId, ref }) => ({
          snapshot_id: snapshotId,
          ref,
          kind: ref.kind,
          title: "sec filing",
          subtitle: "https://www.sec.gov/Archives/example",
          badges: ["primary"],
          rows: [{ label: "Provider", value: "sec" }],
          links: [{ label: "Open source", href: "https://www.sec.gov/Archives/example" }],
          related_refs: [],
        }),
      },
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/v1/evidence/inspect?snapshot_id=11111111-1111-4111-8111-111111111111&ref_kind=source&ref_id=22222222-2222-4222-8222-222222222222`, {
    headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { title?: string; rows?: Array<{ label: string; value: string }> };
  assert.equal(body.title, "sec filing");
  assert.equal(body.rows?.[0]?.value, "sec");
});
```

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/dev-api
npm test -- test/http.test.ts
```

Expected: FAIL because `DevApiAdapters` has no `evidence` adapter and the route returns 404.

- [ ] **Step 3: Add adapter types and route**

Modify `services/dev-api/src/http.ts` near the adapter types:

```ts
import type {
  EvidenceInspection,
  EvidenceInspectionRef,
} from "../../evidence/src/index.ts";

export type DevApiEvidenceAdapter = {
  inspect(input: {
    userId: string;
    snapshotId: string;
    ref: EvidenceInspectionRef;
  }): Promise<EvidenceInspection>;
};

export type DevApiAdapters = {
  analyze: DevApiAnalyzeAdapter;
  agents: DevApiAgentsAdapter;
  themes: DevApiThemesAdapter;
  evidence: DevApiEvidenceAdapter;
};
```

Add this route before the final 404 handler:

```ts
if (req.method === "GET" && url.pathname === "/v1/evidence/inspect") {
  const userId = readUserIdHeader(req.headers["x-user-id"]);
  if (userId === null) {
    respondJson(res, 401, { error: "x-user-id header is required" });
    return;
  }
  if (!adapters) {
    respondJson(res, 503, { error: "durable evidence adapter is not configured" });
    return;
  }
  const snapshotId = readRequiredUuidQuery(url.searchParams.get("snapshot_id"), "snapshot_id");
  const ref = readEvidenceInspectionRef(url);
  respondJson(res, 200, await adapters.evidence.inspect({ userId, snapshotId, ref }));
  return;
}
```

Add helpers near existing query readers:

```ts
function readEvidenceInspectionRef(url: URL): EvidenceInspectionRef {
  const kind = url.searchParams.get("ref_kind");
  const id = readRequiredUuidQuery(url.searchParams.get("ref_id"), "ref_id");
  if (
    kind !== "source" &&
    kind !== "document" &&
    kind !== "claim" &&
    kind !== "event" &&
    kind !== "fact" &&
    kind !== "computation" &&
    kind !== "block"
  ) {
    throw new DevApiHttpError(400, "ref_kind is invalid");
  }
  return { kind, id };
}

function readRequiredUuidQuery(value: string | null, label: string): string {
  if (value === null || !isUuid(value)) {
    throw new DevApiHttpError(400, `${label} must be a UUID`);
  }
  return value;
}
```

- [ ] **Step 4: Wire fixture and local-runtime adapters**

In `services/dev-api/src/http.ts`, add `evidence` to `createFixtureDevApiAdapters()`:

```ts
evidence: {
  async inspect({ snapshotId, ref }) {
    return {
      snapshot_id: snapshotId,
      ref,
      kind: ref.kind,
      title: `${ref.kind} ${ref.id}`,
      subtitle: null,
      badges: [],
      rows: [{ label: "Reference id", value: ref.id }],
      links: [],
      related_refs: [],
    };
  },
},
```

In `services/dev-api/src/local-runtime.ts`, import and export a durable adapter function:

```ts
import { loadEvidenceInspection } from "../../evidence/src/inspector.ts";

export async function inspectEvidence(
  input: Parameters<DevApiServiceAdapterDeps["inspectEvidence"]>[0],
) {
  return loadEvidenceInspection(pool(), {
    user_id: input.userId,
    snapshot_id: input.snapshotId,
    ref: input.ref,
  });
}
```

Then add this field to `DevApiServiceAdapterDeps`:

```ts
inspectEvidence(input: {
  userId: string;
  snapshotId: string;
  ref: EvidenceInspectionRef;
}): Promise<EvidenceInspection>;
```

- [ ] **Step 5: Run route tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/dev-api
npm test -- test/http.test.ts
```

Expected: PASS for the evidence inspect route tests.

- [ ] **Step 6: Commit**

```bash
git add services/dev-api/src/http.ts services/dev-api/src/local-runtime.ts services/dev-api/test/http.test.ts
git commit -m "feat(dev-api): expose evidence inspection endpoint"
```

## Task 3: Web Evidence Inspector Shell

**Files:**
- Create: `web/src/evidence/inspectionTypes.ts`
- Create: `web/src/evidence/inspectionClient.ts`
- Create: `web/src/evidence/EvidenceInspectorProvider.tsx`
- Create: `web/src/evidence/EvidenceInspectorDrawer.tsx`
- Modify: `web/src/shell/WorkspaceShell.tsx`
- Test: `web/src/evidence/inspectionClient.test.ts`
- Test: `web/src/evidence/EvidenceInspectorProvider.test.tsx`

- [ ] **Step 1: Write failing client test**

Create `web/src/evidence/inspectionClient.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { fetchEvidenceInspection } from "./inspectionClient.ts";

test("fetchEvidenceInspection requests the normalized inspect endpoint", async () => {
  const calls: string[] = [];
  const result = await fetchEvidenceInspection({
    userId: "00000000-0000-4000-8000-000000000001",
    snapshotId: "11111111-1111-4111-8111-111111111111",
    ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
    fetchImpl: async (input, init) => {
      calls.push(String(input));
      assert.equal((init?.headers as Record<string, string>)["x-user-id"], "00000000-0000-4000-8000-000000000001");
      return new Response(JSON.stringify({
        snapshot_id: "11111111-1111-4111-8111-111111111111",
        ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
        kind: "source",
        title: "sec filing",
        subtitle: null,
        badges: ["primary"],
        rows: [{ label: "Provider", value: "sec" }],
        links: [],
        related_refs: [],
      }), { status: 200 });
    },
  });
  assert.equal(calls[0], "/v1/evidence/inspect?snapshot_id=11111111-1111-4111-8111-111111111111&ref_kind=source&ref_id=22222222-2222-4222-8222-222222222222");
  assert.equal(result.title, "sec filing");
});
```

- [ ] **Step 2: Run client test to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/evidence/inspectionClient.test.ts
```

Expected: FAIL with module-not-found for `inspectionClient.ts`.

- [ ] **Step 3: Add web inspection types and fetch helper**

Create `web/src/evidence/inspectionTypes.ts`:

```ts
export type EvidenceInspectionRefKind =
  | "source"
  | "document"
  | "claim"
  | "event"
  | "fact"
  | "computation"
  | "block";

export type EvidenceInspectionRef = {
  kind: EvidenceInspectionRefKind;
  id: string;
};

export type EvidenceInspection = {
  snapshot_id: string;
  ref: EvidenceInspectionRef;
  kind: EvidenceInspectionRefKind;
  title: string;
  subtitle: string | null;
  badges: ReadonlyArray<string>;
  rows: ReadonlyArray<{ label: string; value: string }>;
  links: ReadonlyArray<{ label: string; href: string }>;
  related_refs: ReadonlyArray<EvidenceInspectionRef>;
};
```

Create `web/src/evidence/inspectionClient.ts`:

```ts
import { authenticatedJson, type FetchImpl } from "../http/authFetch.ts";
import type { EvidenceInspection, EvidenceInspectionRef } from "./inspectionTypes.ts";

export async function fetchEvidenceInspection(input: {
  userId: string;
  snapshotId: string;
  ref: EvidenceInspectionRef;
  fetchImpl?: FetchImpl;
}): Promise<EvidenceInspection> {
  const params = new URLSearchParams({
    snapshot_id: input.snapshotId,
    ref_kind: input.ref.kind,
    ref_id: input.ref.id,
  });
  return authenticatedJson<EvidenceInspection>(`/v1/evidence/inspect?${params.toString()}`, {
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  });
}
```

- [ ] **Step 4: Add provider and drawer**

Create `web/src/evidence/EvidenceInspectorProvider.tsx`:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { fetchEvidenceInspection } from "./inspectionClient.ts";
import type { EvidenceInspection, EvidenceInspectionRef } from "./inspectionTypes.ts";
import { EvidenceInspectorDrawer } from "./EvidenceInspectorDrawer.tsx";
import { useAuth } from "../shell/useAuth.ts";

type InspectorState =
  | { kind: "closed" }
  | { kind: "loading"; snapshotId: string; ref: EvidenceInspectionRef }
  | { kind: "ready"; inspection: EvidenceInspection }
  | { kind: "error"; snapshotId: string; ref: EvidenceInspectionRef; message: string };

type EvidenceInspectorContextValue = {
  openInspection(input: { snapshotId: string; ref: EvidenceInspectionRef }): void;
  closeInspection(): void;
};

const EvidenceInspectorContext = createContext<EvidenceInspectorContextValue | null>(null);

export function EvidenceInspectorProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [state, setState] = useState<InspectorState>({ kind: "closed" });

  const value = useMemo<EvidenceInspectorContextValue>(() => ({
    openInspection({ snapshotId, ref }) {
      if (!session) {
        setState({ kind: "error", snapshotId, ref, message: "Sign in to inspect evidence." });
        return;
      }
      setState({ kind: "loading", snapshotId, ref });
      fetchEvidenceInspection({ userId: session.userId, snapshotId, ref })
        .then((inspection) => setState({ kind: "ready", inspection }))
        .catch((error) =>
          setState({
            kind: "error",
            snapshotId,
            ref,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
    },
    closeInspection() {
      setState({ kind: "closed" });
    },
  }), [session]);

  return (
    <EvidenceInspectorContext.Provider value={value}>
      {children}
      <EvidenceInspectorDrawer state={state} onClose={value.closeInspection} />
    </EvidenceInspectorContext.Provider>
  );
}

export function useEvidenceInspector(): EvidenceInspectorContextValue {
  const value = useContext(EvidenceInspectorContext);
  if (value === null) throw new Error("useEvidenceInspector must be used inside EvidenceInspectorProvider");
  return value;
}
```

Create `web/src/evidence/EvidenceInspectorDrawer.tsx`:

```tsx
import type { EvidenceInspection, EvidenceInspectionRef } from "./inspectionTypes.ts";

type InspectorState =
  | { kind: "closed" }
  | { kind: "loading"; snapshotId: string; ref: EvidenceInspectionRef }
  | { kind: "ready"; inspection: EvidenceInspection }
  | { kind: "error"; snapshotId: string; ref: EvidenceInspectionRef; message: string };

export function EvidenceInspectorDrawer({
  state,
  onClose,
}: {
  state: InspectorState;
  onClose(): void;
}) {
  if (state.kind === "closed") return null;
  return (
    <aside
      aria-label="Evidence inspector"
      className="fixed bottom-0 right-0 top-0 z-50 flex w-[420px] max-w-full flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
    >
      <header className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Evidence</h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {state.kind === "ready" ? state.inspection.snapshot_id : state.snapshotId}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">
          Close
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {state.kind === "loading" ? <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading evidence.</p> : null}
        {state.kind === "error" ? <p className="text-sm text-rose-600 dark:text-rose-300">{state.message}</p> : null}
        {state.kind === "ready" ? <InspectionBody inspection={state.inspection} /> : null}
      </div>
    </aside>
  );
}

function InspectionBody({ inspection }: { inspection: EvidenceInspection }) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{inspection.title}</h3>
        {inspection.subtitle ? <p className="mt-1 break-words text-xs text-neutral-500 dark:text-neutral-400">{inspection.subtitle}</p> : null}
        {inspection.badges.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {inspection.badges.map((badge) => (
              <span key={badge} className="rounded border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700">
                {badge}
              </span>
            ))}
          </div>
        ) : null}
      </section>
      <dl className="grid gap-2">
        {inspection.rows.map((row) => (
          <div key={`${row.label}:${row.value}`} className="grid gap-1 border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <dt className="text-xs uppercase text-neutral-500 dark:text-neutral-400">{row.label}</dt>
            <dd className="break-words text-sm text-neutral-900 dark:text-neutral-100">{row.value}</dd>
          </div>
        ))}
      </dl>
      {inspection.links.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {inspection.links.map((link) => (
            <li key={link.href}>
              <a href={link.href} target="_blank" rel="noreferrer" className="text-sm underline">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Wrap the shell**

Modify `web/src/shell/WorkspaceShell.tsx`:

```tsx
import { EvidenceInspectorProvider } from "../evidence/EvidenceInspectorProvider.tsx";
```

Wrap the existing `WatchlistProvider` body:

```tsx
<WatchlistProvider userId={userId}>
  <EvidenceInspectorProvider>
    <div className="flex h-full w-full bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <WatchlistSlot />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <PrimaryTabs />
        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <RouteScopeGate />
          </main>
          <RightRailSlot />
        </div>
      </div>
    </div>
    <AuthInterrupt />
  </EvidenceInspectorProvider>
</WatchlistProvider>
```

- [ ] **Step 6: Run web evidence tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/evidence/inspectionClient.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/evidence web/src/shell/WorkspaceShell.tsx
git commit -m "feat(web): add evidence inspector shell"
```

## Task 4: Inspectable Block Renderers

**Files:**
- Create: `web/src/evidence/InspectableRef.tsx`
- Modify: `web/src/blocks/RichText.tsx`
- Modify: `web/src/blocks/MetricRow.tsx`
- Modify: `web/src/blocks/Sources.tsx`
- Test: `web/src/blocks/richText.test.ts`
- Test: `web/src/blocks/metricRow.test.ts`
- Test: `web/src/blocks/fixtures.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Add a test to `web/src/blocks/metricRow.test.ts`:

```ts
test("MetricRow renders value refs as inspectable controls", () => {
  const block: MetricRowBlock = {
    id: "metric-row-1",
    kind: "metric_row",
    snapshot_id: "11111111-1111-4111-8111-111111111111",
    data_ref: { kind: "metric_row", id: "metric-row-1" },
    source_refs: [],
    as_of: "2026-05-29T00:00:00.000Z",
    items: [{ label: "Revenue", value_ref: "22222222-2222-4222-8222-222222222222" }],
  };
  const html = renderToStaticMarkup(<MetricRow block={block} />);
  assert.match(html, /data-inspection-kind="fact"/);
  assert.match(html, /data-inspection-id="22222222-2222-4222-8222-222222222222"/);
});
```

- [ ] **Step 2: Run renderer test to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/blocks/metricRow.test.ts
```

Expected: FAIL because metric chips are not inspectable yet.

- [ ] **Step 3: Add inspectable wrapper**

Create `web/src/evidence/InspectableRef.tsx`:

```tsx
import type { ReactNode } from "react";

import { useEvidenceInspector } from "./EvidenceInspectorProvider.tsx";
import type { EvidenceInspectionRef } from "./inspectionTypes.ts";

export function InspectableRef({
  snapshotId,
  ref,
  children,
  className,
}: {
  snapshotId: string;
  ref: EvidenceInspectionRef;
  children: ReactNode;
  className?: string;
}) {
  const inspector = useEvidenceInspector();
  return (
    <button
      type="button"
      data-inspection-kind={ref.kind}
      data-inspection-id={ref.id}
      onClick={() => inspector.openInspection({ snapshotId, ref })}
      className={className ?? "text-left underline decoration-dotted underline-offset-2"}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Make metric rows inspectable**

Modify `web/src/blocks/MetricRow.tsx`:

```tsx
import { InspectableRef } from "../evidence/InspectableRef.tsx";
```

Change `MetricChip` props and call site:

```tsx
{block.items.map((cell, index) => (
  <MetricChip key={`${block.id}-${index}`} snapshotId={block.snapshot_id} blockId={block.id} index={index} cell={cell} />
))}
```

```tsx
type MetricChipProps = { snapshotId: string; blockId: string; index: number; cell: MetricCell };

function MetricChip({ snapshotId, blockId, index, cell }: MetricChipProps): ReactElement {
  return (
    <li
      data-testid={`block-metric-row-${blockId}-cell-${index}`}
      data-value-ref={cell.value_ref}
      data-delta-ref={cell.delta_ref}
      className="flex flex-col gap-0.5 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <span className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {cell.label}
      </span>
      <InspectableRef
        snapshotId={snapshotId}
        ref={{ kind: "fact", id: cell.value_ref }}
        className="text-left text-sm font-medium text-neutral-900 underline decoration-dotted underline-offset-2 dark:text-neutral-100"
      >
        {metricCellDisplayValue(cell)}
      </InspectableRef>
      {metricCellHasDelta(cell) ? (
        <span className="text-xs text-neutral-500 dark:text-neutral-400" data-testid={`block-metric-row-${blockId}-cell-${index}-delta`}>
          Δ pending
        </span>
      ) : null}
    </li>
  );
}
```

- [ ] **Step 5: Make rich text refs and source rows inspectable**

In `web/src/blocks/RichText.tsx`, wrap `ref` segments:

```tsx
<InspectableRef
  key={`${block.id}-${index}`}
  snapshotId={block.snapshot_id}
  ref={{ kind: segment.ref_kind, id: segment.ref_id }}
>
  {resolved.state === "resolved" ? resolved.value : segment.ref_id}
</InspectableRef>
```

In `web/src/blocks/Sources.tsx`, add `snapshotId` to `SourceRow` and wrap the source label:

```tsx
<InspectableRef
  snapshotId={snapshotId}
  ref={{ kind: "source", id: item.source_id }}
  className="text-left underline decoration-neutral-300 hover:decoration-neutral-500 dark:decoration-neutral-600"
>
  {item.label}
</InspectableRef>
```

When `item.url` exists, keep the external link as a separate small `Open` link so inspection and navigation are distinct.

- [ ] **Step 6: Run block tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/blocks/metricRow.test.ts src/blocks/richText.test.ts src/blocks/fixtures.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/evidence/InspectableRef.tsx web/src/blocks/RichText.tsx web/src/blocks/MetricRow.tsx web/src/blocks/Sources.tsx web/src/blocks/*.test.ts
git commit -m "feat(blocks): make snapshot refs inspectable"
```

## Task 5: Analyze Playbook Service Contract

**Files:**
- Create: `services/analyze/src/playbook.ts`
- Modify: `services/analyze/src/index.ts`
- Test: `services/analyze/test/playbook.test.ts`

- [ ] **Step 1: Write failing playbook tests**

Create `services/analyze/test/playbook.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYZE_PLAYBOOKS,
  resolveAnalyzePlaybookRequest,
} from "../src/playbook.ts";

test("built-in playbooks expose analyst-facing source policies and sections", () => {
  const earningsQuality = ANALYZE_PLAYBOOKS.find((playbook) => playbook.playbook_id === "earnings_quality");
  assert.ok(earningsQuality);
  assert.deepEqual(earningsQuality.default_source_categories, ["filings", "transcripts", "news"]);
  assert.deepEqual(earningsQuality.sections.map((section) => section.section_id), [
    "summary",
    "quality_of_revenue",
    "margin_bridge",
    "cash_conversion",
    "management_tone",
    "watch_items",
  ]);
});

test("resolveAnalyzePlaybookRequest overlays user instructions without dropping defaults", () => {
  const request = resolveAnalyzePlaybookRequest({
    playbook_id: "variant_view",
    instructions: "Focus on hyperscaler capex risk.",
    source_categories: ["filings"],
  });
  assert.equal(request.playbook.playbook_id, "variant_view");
  assert.equal(request.instructions, "Focus on hyperscaler capex risk.");
  assert.deepEqual(request.source_categories, ["filings"]);
  assert.ok(request.prompt.includes("Variant view"));
  assert.ok(request.prompt.includes("Focus on hyperscaler capex risk."));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyze
npm test -- test/playbook.test.ts
```

Expected: FAIL with module-not-found for `playbook.ts`.

- [ ] **Step 3: Implement playbook definitions**

Create `services/analyze/src/playbook.ts`:

```ts
export type AnalyzePlaybookSection = {
  section_id: string;
  title: string;
  required: boolean;
  block_hint: "rich_text" | "metric_row" | "table" | "line_chart" | "section";
};

export type AnalyzePlaybook = {
  playbook_id: string;
  name: string;
  description: string;
  default_instructions: string;
  default_source_categories: ReadonlyArray<string>;
  sections: ReadonlyArray<AnalyzePlaybookSection>;
};

export type AnalyzePlaybookRunRequest = {
  playbook_id: string;
  instructions?: string;
  source_categories?: ReadonlyArray<string>;
};

export type ResolvedAnalyzePlaybookRequest = {
  playbook: AnalyzePlaybook;
  instructions: string;
  source_categories: ReadonlyArray<string>;
  prompt: string;
};

export class AnalyzePlaybookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzePlaybookError";
  }
}

export const ANALYZE_PLAYBOOKS: ReadonlyArray<AnalyzePlaybook> = Object.freeze([
  Object.freeze({
    playbook_id: "earnings_quality",
    name: "Earnings quality",
    description: "Assess revenue quality, margins, cash conversion, and management commentary.",
    default_instructions: "Assess revenue quality, margins, cash conversion, and management commentary.",
    default_source_categories: Object.freeze(["filings", "transcripts", "news"]),
    sections: Object.freeze([
      section("summary", "Summary", true, "rich_text"),
      section("quality_of_revenue", "Quality of revenue", true, "metric_row"),
      section("margin_bridge", "Margin bridge", true, "table"),
      section("cash_conversion", "Cash conversion", true, "metric_row"),
      section("management_tone", "Management tone", true, "rich_text"),
      section("watch_items", "Watch items", true, "table"),
    ]),
  }),
  Object.freeze({
    playbook_id: "variant_view",
    name: "Variant view",
    description: "Compare the market narrative with evidence-backed counterpoints.",
    default_instructions: "Compare the market narrative with evidence-backed counterpoints.",
    default_source_categories: Object.freeze(["filings", "news", "social"]),
    sections: Object.freeze([
      section("summary", "Variant summary", true, "rich_text"),
      section("consensus_view", "Consensus view", true, "rich_text"),
      section("counter_evidence", "Counter-evidence", true, "table"),
      section("disconfirming_signals", "Disconfirming signals", true, "table"),
      section("decision_points", "Decision points", true, "table"),
    ]),
  }),
  Object.freeze({
    playbook_id: "peer_comparison",
    name: "Peer comparison",
    description: "Compare a subject against peers on fundamentals, estimates, and evidence-backed risks.",
    default_instructions: "Compare the subject against peers on growth, margins, valuation, estimates, and evidence-backed risks.",
    default_source_categories: Object.freeze(["filings", "news"]),
    sections: Object.freeze([
      section("summary", "Comparison summary", true, "rich_text"),
      section("peer_table", "Peer table", true, "table"),
      section("relative_strengths", "Relative strengths", true, "table"),
      section("relative_risks", "Relative risks", true, "table"),
    ]),
  }),
]);

export function resolveAnalyzePlaybookRequest(
  input: AnalyzePlaybookRunRequest,
): ResolvedAnalyzePlaybookRequest {
  const playbook = ANALYZE_PLAYBOOKS.find((item) => item.playbook_id === input.playbook_id);
  if (!playbook) throw new AnalyzePlaybookError("playbook_id is unknown");
  const instructions = normalizeText(input.instructions) ?? playbook.default_instructions;
  const sourceCategories = normalizeSourceCategories(input.source_categories) ?? playbook.default_source_categories;
  return Object.freeze({
    playbook,
    instructions,
    source_categories: Object.freeze([...sourceCategories]),
    prompt: [
      `${playbook.name}: ${playbook.description}`,
      `Instructions: ${instructions}`,
      `Required sections: ${playbook.sections.map((section) => section.title).join("; ")}`,
      `Source categories: ${sourceCategories.join(", ")}`,
    ].join("\n"),
  });
}

function section(
  section_id: string,
  title: string,
  required: boolean,
  block_hint: AnalyzePlaybookSection["block_hint"],
): AnalyzePlaybookSection {
  return Object.freeze({ section_id, title, required, block_hint });
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeSourceCategories(value: unknown): ReadonlyArray<string> | null {
  if (!Array.isArray(value)) return null;
  const categories = value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
  return categories.length === 0 ? null : Object.freeze([...new Set(categories)]);
}
```

- [ ] **Step 4: Export playbooks**

Modify `services/analyze/src/index.ts`:

```ts
export * from "./playbook.ts";
```

- [ ] **Step 5: Run analyze tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyze
npm test -- test/playbook.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/analyze/src/playbook.ts services/analyze/src/index.ts services/analyze/test/playbook.test.ts
git commit -m "feat(analyze): define guided playbooks"
```

## Task 6: Dev API Playbook Routes And Run Metadata

**Files:**
- Modify: `services/dev-api/src/http.ts`
- Modify: `services/dev-api/src/local-runtime.ts`
- Test: `services/dev-api/test/http.test.ts`

- [ ] **Step 1: Write failing HTTP tests**

Add tests to `services/dev-api/test/http.test.ts`:

```ts
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
      playbook_id: "earnings_quality",
      instructions: "Focus on cash conversion.",
      source_categories: ["filings"],
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json() as { playbook_id?: string; blocks?: Array<{ title?: string }> };
  assert.equal(body.playbook_id, "earnings_quality");
  assert.equal(body.blocks?.[0]?.title, "Earnings quality");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/dev-api
npm test -- test/http.test.ts
```

Expected: FAIL because `/v1/analyze/playbooks` returns 404 and run payloads do not include `playbook_id`.

- [ ] **Step 3: Extend dev API run types**

Modify `services/dev-api/src/http.ts`:

```ts
import {
  ANALYZE_PLAYBOOKS,
  resolveAnalyzePlaybookRequest,
} from "../../analyze/src/index.ts";
```

Extend `DevAnalyzeRun`:

```ts
type DevAnalyzeRun = {
  run_id: string;
  template_id: string;
  template_version: number;
  playbook_id: string | null;
  snapshot_id: string;
  blocks: ReadonlyArray<Record<string, unknown>>;
  created_at: string;
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
  template_id: nonEmptyString(body.template_id) ?? resolvedPlaybook.playbook.playbook_id,
  template_version: 1,
  playbook_id: resolvedPlaybook.playbook.playbook_id,
  snapshot_id: snapshotId,
  blocks: [
    richTextBlock({
      id: stableUuid(`analyze-block:${runId}`),
      snapshotId,
      title: resolvedPlaybook.playbook.name,
      text: `${resolvedPlaybook.instructions} Sources: ${resolvedPlaybook.source_categories.join(", ")}.`,
    }),
  ],
  created_at: new Date().toISOString(),
};
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
  respondJson(res, 200, await adapters.analyze.listRuns({ userId }));
  return;
}
```

Extend `DevApiAnalyzeAdapter`:

```ts
listRuns(input: { userId: string }): Promise<{ runs: DevAnalyzeRun[] }>;
```

Add fixture implementation:

```ts
async listRuns({ userId }) {
  return { runs: analyzeRuns.filter((run) => runOwner(run.run_id) === userId) };
},
```

- [ ] **Step 6: Run dev-api tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/dev-api
npm test -- test/http.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/dev-api/src/http.ts services/dev-api/src/local-runtime.ts services/dev-api/test/http.test.ts
git commit -m "feat(dev-api): add analyze playbook routes"
```

## Task 7: Guided Analyze Web Workflow

**Files:**
- Create: `web/src/analyze/playbooks.ts`
- Create: `web/src/analyze/runHistory.ts`
- Test: `web/src/analyze/runDiff.test.ts`
- Modify: `web/src/pages/AnalyzePage.tsx`
- Test: `web/src/pages/workflowSurfaces.test.tsx`

- [ ] **Step 1: Write failing diff tests**

Create `web/src/analyze/runDiff.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { diffAnalyzeRuns } from "./runHistory.ts";

test("diffAnalyzeRuns reports added, removed, and changed block titles", () => {
  const diff = diffAnalyzeRuns(
    {
      run_id: "run-a",
      playbook_id: "earnings_quality",
      created_at: "2026-05-28T00:00:00.000Z",
      snapshot_id: "11111111-1111-4111-8111-111111111111",
      blocks: [
        { id: "a", kind: "rich_text", title: "Summary", snapshot_id: "11111111-1111-4111-8111-111111111111" },
        { id: "b", kind: "rich_text", title: "Cash conversion", snapshot_id: "11111111-1111-4111-8111-111111111111" },
      ],
    },
    {
      run_id: "run-b",
      playbook_id: "earnings_quality",
      created_at: "2026-05-29T00:00:00.000Z",
      snapshot_id: "22222222-2222-4222-8222-222222222222",
      blocks: [
        { id: "a", kind: "rich_text", title: "Summary", snapshot_id: "22222222-2222-4222-8222-222222222222" },
        { id: "c", kind: "table", title: "Watch items", snapshot_id: "22222222-2222-4222-8222-222222222222" },
      ],
    },
  );
  assert.deepEqual(diff.rows.map((row) => `${row.status}:${row.title}`), [
    "unchanged:Summary",
    "removed:Cash conversion",
    "added:Watch items",
  ]);
});
```

- [ ] **Step 2: Run diff test to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/analyze/runDiff.test.ts
```

Expected: FAIL with module-not-found for `runHistory.ts`.

- [ ] **Step 3: Add playbook and run-history helpers**

Create `web/src/analyze/playbooks.ts`:

```ts
import { authenticatedJson, type FetchImpl } from "../http/authFetch.ts";

export type AnalyzePlaybookSection = {
  section_id: string;
  title: string;
  required: boolean;
  block_hint: string;
};

export type AnalyzePlaybook = {
  playbook_id: string;
  name: string;
  description: string;
  default_instructions: string;
  default_source_categories: ReadonlyArray<string>;
  sections: ReadonlyArray<AnalyzePlaybookSection>;
};

export async function fetchAnalyzePlaybooks(input: {
  userId: string;
  fetchImpl?: FetchImpl;
}): Promise<ReadonlyArray<AnalyzePlaybook>> {
  const body = await authenticatedJson<{ playbooks: AnalyzePlaybook[] }>("/v1/analyze/playbooks", {
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  });
  return body.playbooks;
}
```

Create `web/src/analyze/runHistory.ts`:

```ts
import { authenticatedJson, type FetchImpl } from "../http/authFetch.ts";

export type AnalyzeRunHistoryItem = {
  run_id: string;
  playbook_id: string | null;
  created_at: string;
  snapshot_id: string;
  blocks: ReadonlyArray<Record<string, unknown>>;
};

export type AnalyzeRunDiffRow = {
  status: "added" | "removed" | "changed" | "unchanged";
  title: string;
};

export type AnalyzeRunDiff = {
  rows: ReadonlyArray<AnalyzeRunDiffRow>;
};

export async function fetchAnalyzeRuns(input: {
  userId: string;
  fetchImpl?: FetchImpl;
}): Promise<ReadonlyArray<AnalyzeRunHistoryItem>> {
  const body = await authenticatedJson<{ runs: AnalyzeRunHistoryItem[] }>("/v1/analyze/runs", {
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  });
  return body.runs;
}

export function diffAnalyzeRuns(
  before: AnalyzeRunHistoryItem,
  after: AnalyzeRunHistoryItem,
): AnalyzeRunDiff {
  const beforeRows = blockRows(before.blocks);
  const afterRows = blockRows(after.blocks);
  const titles = [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort();
  return {
    rows: titles.map((title) => {
      const left = beforeRows.get(title);
      const right = afterRows.get(title);
      if (left === undefined) return { status: "added", title };
      if (right === undefined) return { status: "removed", title };
      if (left !== right) return { status: "changed", title };
      return { status: "unchanged", title };
    }),
  };
}

function blockRows(blocks: ReadonlyArray<Record<string, unknown>>): Map<string, string> {
  return new Map(
    blocks.map((block) => {
      const title = typeof block.title === "string" && block.title.trim() !== "" ? block.title : String(block.id ?? block.kind ?? "Untitled");
      return [title, JSON.stringify({ kind: block.kind, title: block.title, source_refs: block.source_refs, claim_refs: block.claim_refs })];
    }),
  );
}
```

- [ ] **Step 4: Update AnalyzePage state and loading**

Modify `web/src/pages/AnalyzePage.tsx` imports:

```tsx
import {
  fetchAnalyzePlaybooks,
  type AnalyzePlaybook,
} from "../analyze/playbooks.ts";
import {
  diffAnalyzeRuns,
  fetchAnalyzeRuns,
  type AnalyzeRunHistoryItem,
} from "../analyze/runHistory.ts";
```

Inside `AnalyzeWorkspace`, replace template-only state with:

```tsx
const [playbooks, setPlaybooks] = useState<ReadonlyArray<AnalyzePlaybook>>([]);
const [selectedPlaybookId, setSelectedPlaybookId] = useState("earnings_quality");
const selectedPlaybook = playbooks.find((playbook) => playbook.playbook_id === selectedPlaybookId);
const [runHistory, setRunHistory] = useState<ReadonlyArray<AnalyzeRunHistoryItem>>([]);
const [compareRunId, setCompareRunId] = useState<string>("");
```

Add this effect:

```tsx
useEffect(() => {
  if (!session) return;
  const controller = new AbortController();
  Promise.all([
    fetchAnalyzePlaybooks({ userId: session.userId, fetchImpl: (input, init) => fetch(input, { ...init, signal: controller.signal }) }),
    fetchAnalyzeRuns({ userId: session.userId, fetchImpl: (input, init) => fetch(input, { ...init, signal: controller.signal }) }),
  ])
    .then(([nextPlaybooks, nextRuns]) => {
      if (controller.signal.aborted) return;
      setPlaybooks(nextPlaybooks);
      setRunHistory(nextRuns);
      const first = nextPlaybooks[0];
      if (first) {
        setSelectedPlaybookId(first.playbook_id);
        setInstructions(first.default_instructions);
        setSources(new Set(first.default_source_categories));
      }
    })
    .catch(() => undefined);
  return () => controller.abort();
}, [session]);
```

- [ ] **Step 5: Send playbook_id when generating memos**

Modify the `generateMemo` body payload:

```tsx
body: JSON.stringify({
  playbook_id: selectedPlaybook?.playbook_id ?? selectedPlaybookId,
  template_id: selectedTemplate.template_id,
  instructions,
  source_categories: [...sources],
  subject_ref: subject?.subject_ref ?? null,
}),
```

After a successful run:

```tsx
setRunHistory((current) => [run as AnalyzeRunHistoryItem, ...current.filter((item) => item.run_id !== run.run_id)]);
```

- [ ] **Step 6: Render playbook picker, section preview, history, and diff**

Replace the left panel template selector with:

```tsx
<label className="flex flex-col gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
  Playbook
  <select
    value={selectedPlaybookId}
    onChange={(event) => {
      const next = playbooks.find((playbook) => playbook.playbook_id === event.currentTarget.value);
      if (!next) return;
      setSelectedPlaybookId(next.playbook_id);
      setInstructions(next.default_instructions);
      setSources(new Set(next.default_source_categories));
      setMemoRun(null);
      setStatus("Ready");
    }}
    className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
  >
    {playbooks.map((playbook) => (
      <option key={playbook.playbook_id} value={playbook.playbook_id}>
        {playbook.name}
      </option>
    ))}
  </select>
</label>
{selectedPlaybook ? (
  <section className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
    <h3 className="font-medium text-neutral-900 dark:text-neutral-100">Sections</h3>
    <ul className="mt-2 flex flex-col gap-1 text-neutral-600 dark:text-neutral-300">
      {selectedPlaybook.sections.map((section) => (
        <li key={section.section_id}>{section.title}</li>
      ))}
    </ul>
  </section>
) : null}
```

Add a history panel below the memo canvas:

```tsx
{runHistory.length > 0 ? (
  <section className="mt-6 rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
    <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Run history</h2>
    <ul className="mt-3 flex flex-col gap-2">
      {runHistory.map((run) => (
        <li key={run.run_id} className="flex items-center justify-between gap-3 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
          <span>{run.playbook_id ?? "template"} · {run.created_at}</span>
          <button type="button" className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700" onClick={() => setMemoRun(run as AnalyzeRun)}>
            Open
          </button>
        </li>
      ))}
    </ul>
  </section>
) : null}
```

Render diff when `memoRun` and `compareRunId` are both present:

```tsx
const compareRun = runHistory.find((run) => run.run_id === compareRunId);
const runDiff = memoRun && compareRun ? diffAnalyzeRuns(compareRun, memoRun as AnalyzeRunHistoryItem) : null;
```

```tsx
{runDiff ? (
  <section className="mt-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
    <h3 className="text-sm font-semibold">Run diff</h3>
    <ul className="mt-2 text-sm">
      {runDiff.rows.map((row) => (
        <li key={`${row.status}:${row.title}`}>{row.status}: {row.title}</li>
      ))}
    </ul>
  </section>
) : null}
```

- [ ] **Step 7: Run web tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/analyze/runDiff.test.ts src/pages/workflowSurfaces.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/analyze/playbooks.ts web/src/analyze/runHistory.ts web/src/analyze/runDiff.test.ts web/src/pages/AnalyzePage.tsx web/src/pages/workflowSurfaces.test.tsx
git commit -m "feat(web): add guided analyze playbooks"
```

## Task 8: Durable Analyze Playbook Persistence

**Files:**
- Modify: `services/analyze/src/template-runner.ts`
- Modify: `services/analyze/src/template-repo.ts`
- Modify: `spec/finance_research_db_schema.sql`
- Create: `db/migrations/0028_analyze_playbook_metadata.up.sql`
- Create: `db/migrations/0028_analyze_playbook_metadata.down.sql`
- Test: `services/analyze/test/template-runner.test.ts`
- Test: `db/test/migration-registry.test.ts`

- [ ] **Step 1: Write failing persistence test**

Add to `services/analyze/test/template-runner.test.ts`:

```ts
test("persistAnalyzeTemplateRunAfterSnapshotSeal stores playbook metadata", async () => {
  const db = createRecordingAnalyzeRunClient();
  const result = await persistAnalyzeTemplateRunAfterSnapshotSeal(db.client, {
    template_id: "11111111-1111-4111-8111-111111111111",
    template_version: 1,
    playbook_id: "earnings_quality",
    blocks: [],
    sealSnapshot: async () => verifiedSeal("22222222-2222-4222-8222-222222222222"),
  });
  assert.equal(result.ok, true);
  assert.equal(db.insertValues.playbook_id, "earnings_quality");
});
```

- [ ] **Step 2: Run analyze tests to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyze
npm test -- test/template-runner.test.ts
```

Expected: FAIL because `PersistAnalyzeTemplateRunInput` does not accept `playbook_id`.

- [ ] **Step 3: Add migration**

Create `db/migrations/0028_analyze_playbook_metadata.up.sql`:

```sql
alter table analyze_template_runs
  add column playbook_id text,
  add column run_metadata jsonb not null default '{}'::jsonb;

create index analyze_template_runs_playbook_created_idx
  on analyze_template_runs(playbook_id, created_at desc)
  where playbook_id is not null;
```

Create `db/migrations/0028_analyze_playbook_metadata.down.sql`:

```sql
drop index if exists analyze_template_runs_playbook_created_idx;

alter table analyze_template_runs
  drop column if exists run_metadata,
  drop column if exists playbook_id;
```

Update `spec/finance_research_db_schema.sql` table `analyze_template_runs`:

```sql
  playbook_id text,
  run_metadata jsonb not null default '{}'::jsonb,
```

- [ ] **Step 4: Extend persistence input and row shape**

Modify `services/analyze/src/template-runner.ts`:

```ts
export type AnalyzeTemplateRunRow = {
  run_id: string;
  template_id: string;
  template_version: number;
  playbook_id: string | null;
  run_metadata: JsonValue;
  snapshot_id: string;
  blocks: ReadonlyArray<JsonValue>;
  created_at: string;
};

export type PersistAnalyzeTemplateRunInput = {
  template_id: string;
  template_version: number;
  playbook_id?: string | null;
  run_metadata?: JsonValue;
  blocks: ReadonlyArray<JsonValue>;
  sealSnapshot(): Promise<SnapshotSealResult>;
};
```

Update insert SQL:

```ts
`insert into analyze_template_runs
   (template_id, template_version, playbook_id, run_metadata, snapshot_id, blocks)
 values ($1::uuid, $2::integer, $3, $4::jsonb, $5::uuid, $6::jsonb)
 returning ${SELECT_COLUMNS}`
```

Update values:

```ts
[
  input.template_id,
  input.template_version,
  input.playbook_id ?? null,
  serializeJsonValue(input.run_metadata ?? {}),
  snapshotId,
  serializeJsonValue(input.blocks as JsonValue),
]
```

- [ ] **Step 5: Run analyze and db tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyze
npm test -- test/template-runner.test.ts
cd /Users/admin/Documents/Work/market-agent/db
npm test -- test/migration-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/analyze/src/template-runner.ts services/analyze/src/template-repo.ts services/analyze/test/template-runner.test.ts spec/finance_research_db_schema.sql db/migrations/0028_analyze_playbook_metadata.up.sql db/migrations/0028_analyze_playbook_metadata.down.sql db/test/migration-registry.test.ts
git commit -m "feat(analyze): persist playbook run metadata"
```

## Task 9: Combined Verification And Documentation

**Files:**
- Modify: `README.md`
- Modify: `services/evidence/README.md`
- Modify: `services/analyze/README.md` if present; otherwise modify `services/analyze/src/index.ts` only through exports already covered.
- Modify: `web/src/pages/workflowSurfaces.test.tsx`

- [ ] **Step 1: Add workflow tests for the combined surface**

Add to `web/src/pages/workflowSurfaces.test.tsx`:

```ts
test("Analyze playbooks and inspectable evidence controls are present in workflow surfaces", async () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <AuthContext.Provider value={mockSignedInAuth()}>
        <WorkspaceShell />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  assert.match(html, /Finance Research/);
  assert.doesNotMatch(html, /raw provider payload/i);
});
```

Keep this test narrow. Detailed behavior is covered by the unit tests in previous tasks.

- [ ] **Step 2: Run service and web tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/evidence
npm test
cd /Users/admin/Documents/Work/market-agent/services/dev-api
npm test
cd /Users/admin/Documents/Work/market-agent/services/analyze
npm test
cd /Users/admin/Documents/Work/market-agent/web
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Update README product copy**

Modify `README.md` usage walkthrough:

```md
### Evidence inspector
Snapshot-backed blocks expose inspectable refs. Selecting a number, claim, event, source, or block opens the Evidence inspector with the sealed `snapshot_id`, provenance rows, quality badges, source links, and related refs.

### Analyze
A guided playbook workflow. Pick a playbook such as *Earnings quality*, *Variant view*, or *Peer comparison*, tune instructions and source categories, generate a memo, inspect its evidence, rerun it, compare it with prior runs, and add the result to chat with shared snapshot provenance.
```

- [ ] **Step 4: Update Evidence README**

Add to `services/evidence/README.md`:

```md
## Evidence Inspector

`loadEvidenceInspection(db, { user_id, snapshot_id, ref })` is the read-side contract for user-facing provenance inspection. It first verifies that the requested ref is present in the sealed snapshot manifest, then returns a normalized inspection envelope with title, badges, rows, links, and related refs.

The inspector is intentionally read-only. It does not retrieve raw untrusted document text and does not alter fact, claim, event, or source state.
```

- [ ] **Step 5: Final status and commit**

Run:

```bash
git status --short
```

Expected: only intended files are modified.

Commit:

```bash
git add README.md services/evidence/README.md web/src/pages/workflowSurfaces.test.tsx
git commit -m "docs: describe evidence inspector and analyze playbooks"
```

## Final Integration Checklist

- [ ] Run the full local verification command set:

```bash
cd /Users/admin/Documents/Work/market-agent/services/evidence && npm test
cd /Users/admin/Documents/Work/market-agent/services/dev-api && npm test
cd /Users/admin/Documents/Work/market-agent/services/analyze && npm test
cd /Users/admin/Documents/Work/market-agent/web && npm test && npm run build
```

- [ ] Run database migration registry tests:

```bash
cd /Users/admin/Documents/Work/market-agent/db
npm test -- test/migration-registry.test.ts
```

- [ ] Check worktree state:

```bash
cd /Users/admin/Documents/Work/market-agent
git status --short
```

- [ ] Close the implementation bead that is used for execution.

- [ ] Sync beads and push:

```bash
bd sync
git pull --rebase
git push
git status --short --branch
```

Expected: branch reports up to date with origin.

## Plan Self-Review

- Spec coverage: Tasks 1-4 cover the universal evidence inspector from service contract through HTTP route, shell state, drawer UI, and inspectable block renderers. Tasks 5-8 cover guided Analyze playbooks from service contract through HTTP routes, web workflow, run history, rerun support, diffing, and durable metadata. Task 9 covers combined verification and docs.
- Placeholder scan: no incomplete acceptance criteria or unspecified edge handling remains in the plan.
- Type consistency: `EvidenceInspectionRef`, `EvidenceInspection`, `AnalyzePlaybook`, `AnalyzeRunHistoryItem`, and route names are introduced before use and reused consistently across backend and web tasks.
