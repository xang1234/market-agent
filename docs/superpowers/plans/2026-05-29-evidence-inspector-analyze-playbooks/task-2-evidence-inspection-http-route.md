# Task 2: Evidence Inspection HTTP Route


**Files:**
- Modify: `services/dev-api/src/http.ts`
- Modify: `services/dev-api/src/local-runtime.ts`
- Test: `services/dev-api/test/http.test.ts`
- Modify: `spec/finance_research_openapi.yaml`

- [ ] **Step 1: Write failing route tests**

Add these tests to `services/dev-api/test/http.test.ts`:

```ts
import {
  EvidenceInspectionError,
} from "../../evidence/src/index.ts";

test("POST /v1/evidence/inspect requires x-user-id", async (t) => {
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
  const response = await fetch(`${base}/v1/evidence/inspect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      snapshot_id: "11111111-1111-4111-8111-111111111111",
      ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
    }),
  });
  assert.equal(response.status, 401);
});

test("POST /v1/evidence/inspect returns adapter inspection", async (t) => {
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
  const response = await fetch(`${base}/v1/evidence/inspect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "00000000-0000-4000-8000-000000000001",
    },
    body: JSON.stringify({
      snapshot_id: "11111111-1111-4111-8111-111111111111",
      ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as { title?: string; rows?: Array<{ label: string; value: string }> };
  assert.equal(body.title, "sec filing");
  assert.equal(body.rows?.[0]?.value, "sec");
});

test("POST /v1/evidence/inspect hides missing and authorization reason", async (t) => {
  const server = createDevApiServer({}, {
    adapters: {
      ...createFixtureDevApiAdapters(),
      evidence: {
        inspect: async () => {
          throw new EvidenceInspectionError(404, "source not found");
        },
      },
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/v1/evidence/inspect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "00000000-0000-4000-8000-000000000001",
    },
    body: JSON.stringify({
      snapshot_id: "11111111-1111-4111-8111-111111111111",
      ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
    }),
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as { error?: string };
  assert.equal(body.error, "evidence is not available for this artifact");
  assert.equal(JSON.stringify(body).includes("source not found"), false);
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
import {
  EvidenceInspectionError,
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
if (req.method === "POST" && url.pathname === "/v1/evidence/inspect") {
  res.setHeader("cache-control", "no-store");
  const userId = readUserIdHeader(req.headers["x-user-id"]);
  if (userId === null) {
    respondJson(res, 401, { error: "x-user-id header is required" });
    return;
  }
  if (!adapters) {
    respondJson(res, 503, { error: "durable evidence adapter is not configured" });
    return;
  }
  const body = await readJson(req).catch(() => BAD_JSON);
  if (body === BAD_JSON) {
    respondJson(res, 400, { error: "request body must be valid JSON" });
    return;
  }
  const { snapshotId, ref } = readEvidenceInspectionBody(body);
  try {
    respondJson(res, 200, await adapters.evidence.inspect({ userId, snapshotId, ref }));
  } catch (error) {
    if (error instanceof EvidenceInspectionError && error.status === 404) {
      respondJson(res, 404, { error: EVIDENCE_INSPECTION_UNAVAILABLE_ERROR });
      return;
    }
    if (error instanceof EvidenceInspectionError) {
      throw new DevApiHttpError(error.status, error.message);
    }
    throw error;
  }
  return;
}
```

Add helpers near existing query readers:

```ts
const EVIDENCE_INSPECTION_UNAVAILABLE_ERROR = "evidence is not available for this artifact";

function readEvidenceInspectionBody(value: unknown): { snapshotId: string; ref: EvidenceInspectionRef } {
  if (!isObjectRecord(value)) {
    throw new DevApiHttpError(400, "request body must be an object");
  }
  return {
    snapshotId: readRequiredUuidValue(value.snapshot_id, "snapshot_id"),
    ref: readEvidenceInspectionRefValue(value.ref),
  };
}

function readEvidenceInspectionRefValue(value: unknown): EvidenceInspectionRef {
  if (!isObjectRecord(value)) {
    throw new DevApiHttpError(400, "ref must be an object");
  }
  const kind = value.kind;
  const id = readRequiredUuidValue(value.id, "ref.id");
  if (
    kind !== "source" &&
    kind !== "document" &&
    kind !== "claim" &&
    kind !== "event" &&
    kind !== "fact"
  ) {
    throw new DevApiHttpError(400, "ref.kind is invalid");
  }
  return { kind, id };
}

function readRequiredUuidValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !isUuid(value)) {
    throw new DevApiHttpError(400, `${label} must be a UUID`);
  }
  return value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

- [ ] **Step 5: Update OpenAPI contract**

Modify `spec/finance_research_openapi.yaml`:

- Add `POST /v1/evidence/inspect` with `operationId: inspectEvidence`.
- Request body schema: `EvidenceInspectionRequest` with required `snapshot_id` and `ref`.
- Add `EvidenceInspectionRef`, `EvidenceInspection`, `EvidenceInspectionRow`, and `EvidenceInspectionLink` schemas.
- Document `Cache-Control: no-store` in the `200` and generic `404` responses.
- Document that `404` intentionally covers missing snapshot, invisible artifact, ref absent from snapshot, missing row, and entitlement denial with the same message: `evidence is not available for this artifact`.

Do not document a parallel `GET` route.

- [ ] **Step 6: Run route tests and parse OpenAPI**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/dev-api
npm test -- test/http.test.ts
cd /Users/admin/Documents/Work/market-agent
ruby -e 'require "yaml"; YAML.load_file("spec/finance_research_openapi.yaml")'
```

Expected: PASS for the evidence inspect route tests, and the OpenAPI YAML parses.

- [ ] **Step 7: Commit**

```bash
git add services/dev-api/src/http.ts services/dev-api/src/local-runtime.ts services/dev-api/test/http.test.ts spec/finance_research_openapi.yaml
git commit -m "feat(dev-api): expose evidence inspection endpoint"
```
