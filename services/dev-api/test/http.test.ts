import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import {
  createDevApiServer,
  createFixtureDevApiAdapters,
  createServiceDevApiAdapters,
} from "../src/http.ts";
import { ANALYZE_BASE_BUNDLE_ID } from "../../analyze/src/index.ts";
import { EvidenceInspectionError } from "../../evidence/src/index.ts";

const EARNINGS_TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";

async function startServer(
  t: TestContext,
  env: Record<string, string | undefined> = {},
  options: Parameters<typeof createDevApiServer>[1] = { adapters: createFixtureDevApiAdapters() },
): Promise<string> {
  const server = createDevApiServer(env, options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("health endpoint reports ok plus parsed flags", async (t) => {
  const base = await startServer(t, { MA_FLAG_SHOW_DEV_BANNER: "true" });

  const response = await fetch(`${base}/healthz`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.deepEqual(body.flags, {
    placeholderApiEnabled: true,
    showDevBanner: true,
  });
});

test("placeholder route returns 503 when placeholder API is disabled", async (t) => {
  const base = await startServer(t, { MA_FLAG_PLACEHOLDER_API: "false" });

  const response = await fetch(`${base}/v1/dev/placeholders`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.error, "placeholder api disabled");
});

test("GET /v1/analyze/templates returns session-scoped template options", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/analyze/templates`, {
    headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
  });
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.templates));
  assert.match(JSON.stringify(body.templates), /Earnings template/);
});

test("GET /v1/analyze/playbooks returns built-in playbooks", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/analyze/playbooks`, {
    headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { playbooks?: Array<{ playbook_id: string }> };
  assert.ok(body.playbooks?.some((playbook) => playbook.playbook_id === "earnings_quality"));
});

test("POST /v1/analyze/runs returns a generated Block[] memo", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/analyze/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "00000000-0000-4000-8000-000000000001",
    },
    body: JSON.stringify({
      template_id: EARNINGS_TEMPLATE_ID,
      instructions: "Review margin quality",
      source_categories: ["filings", "news"],
    }),
  });
  const body = await response.json() as { blocks?: Array<Record<string, unknown>> };

  assert.equal(response.status, 201);
  assert.ok(Array.isArray(body.blocks));
  assert.equal(body.blocks[0].kind, "rich_text");
  assert.match(JSON.stringify(body.blocks), /Review margin quality/);
});

test("POST /v1/analyze/runs accepts playbook_id and records it on the run", async (t) => {
  const base = await startServer(t);

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
  const base = await startServer(t);
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
  const rerun = await rerunResponse.json() as {
    run_id?: string;
    display_title?: string;
    can_rerun?: boolean;
    rerun_unavailable_reason?: string | null;
    run_metadata?: { schema_version?: number; rerun_of_run_id?: string };
  };
  assert.notEqual(rerun.run_id, created.run_id);
  assert.equal(rerun.display_title, "Earnings quality");
  assert.equal(rerun.can_rerun, true);
  assert.equal(rerun.rerun_unavailable_reason, null);
  assert.equal(rerun.run_metadata?.schema_version, 1);
  assert.equal(rerun.run_metadata?.rerun_of_run_id, created.run_id);
});

test("GET /v1/analyze/runs paginates user run history with an opaque cursor", async (t) => {
  const base = await startServer(t);
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
  const firstPage = await firstPageResponse.json() as {
    runs?: Array<{ run_id: string; display_title?: string }>;
    next_cursor?: string | null;
  };
  assert.equal(firstPage.runs?.length, 1);
  assert.equal("blocks" in (firstPage.runs?.[0] ?? {}), false);
  assert.equal("run_metadata" in (firstPage.runs?.[0] ?? {}), false);
  assert.equal(firstPage.runs?.[0]?.display_title, "Earnings quality");
  assert.equal(typeof firstPage.next_cursor, "string");

  const secondPageResponse = await fetch(
    `${base}/v1/analyze/runs?limit=1&cursor=${encodeURIComponent(firstPage.next_cursor ?? "")}`,
    { headers: { "x-user-id": headers["x-user-id"] } },
  );
  assert.equal(secondPageResponse.status, 200);
  const secondPage = await secondPageResponse.json() as { runs?: Array<{ run_id: string }>; next_cursor?: string | null };
  assert.equal(secondPage.runs?.length, 1);
  assert.notEqual(secondPage.runs?.[0]?.run_id, firstPage.runs?.[0]?.run_id);
});

test("GET /v1/analyze/runs/:id returns full run detail with blocks", async (t) => {
  const base = await startServer(t);
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
  const detail = await detailResponse.json() as {
    run_id?: string;
    display_title?: string;
    run_metadata?: { schema_version?: number };
    blocks?: Array<{ title?: string }>;
  };
  assert.equal(detail.run_id, created.run_id);
  assert.equal(detail.display_title, "Earnings quality");
  assert.equal(detail.run_metadata?.schema_version, 1);
  assert.equal(detail.blocks?.[0]?.title, "Earnings quality");
});

test("POST /v1/evidence/inspect requires x-user-id", async (t) => {
  const base = await startServer(t, {}, {
    adapters: {
      ...createFixtureDevApiAdapters(),
      evidence: {
        inspect: async () => {
          throw new Error("should not inspect without auth");
        },
      },
    } as never,
  });

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
  const base = await startServer(t, {}, {
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
    } as never,
  });

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
  const base = await startServer(t, {}, {
    adapters: {
      ...createFixtureDevApiAdapters(),
      evidence: {
        inspect: async () => {
          throw new EvidenceInspectionError(404, "source not found");
        },
      },
    } as never,
  });

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

test("GET /v1/agents and POST /v1/agents/:id/runs expose agent workflow data", async (t) => {
  const base = await startServer(t);
  const headers = { "x-user-id": "00000000-0000-4000-8000-000000000001" };

  const list = await fetch(`${base}/v1/agents`, { headers });
  const listBody = await list.json() as { agents?: Array<{ agent_id: string }> };
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(listBody.agents));
  assert.ok(listBody.agents.length > 0);

  const run = await fetch(`${base}/v1/agents/${listBody.agents[0].agent_id}/runs`, {
    method: "POST",
    headers,
  });
  const runBody = await run.json() as Record<string, unknown>;
  assert.equal(run.status, 201);
  assert.equal(runBody.agent_id, listBody.agents[0].agent_id);
  assert.equal(runBody.status, "completed");
});

test("GET /v1/themes/membership-rationales hydrates service-backed theme rationale", async (t) => {
  const subjectId = "33333333-3333-4333-8333-333333333333";
  const calls: unknown[] = [];
  const adapters = {
    ...createFixtureDevApiAdapters(),
    themes: {
      async listMembershipRationales(input: unknown) {
        calls.push(input);
        return {
          memberships: [
            {
              theme_id: "11111111-1111-4111-8111-111111111111",
              theme_name: "AI infrastructure",
              theme_description: "Source-backed AI buildout claims",
              membership_mode: "rule_based",
              score: 0.75,
              rationale_supported: true,
              rationale_claim_ids: ["44444444-4444-4444-8444-444444444444"],
            },
          ],
          truncated: false,
        };
      },
    },
  };
  const base = await startServer(t, {}, { adapters: adapters as never });

  const response = await fetch(
    `${base}/v1/themes/membership-rationales?subject_kind=issuer&subject_id=${subjectId}&limit=8`,
  );
  const body = await response.json() as {
    memberships?: Array<{ theme_name?: string; rationale_claim_ids?: string[] }>;
    truncated?: boolean;
  };

  assert.equal(response.status, 200);
  assert.equal(body.memberships?.[0]?.theme_name, "AI infrastructure");
  assert.deepEqual(body.memberships?.[0]?.rationale_claim_ids, [
    "44444444-4444-4444-8444-444444444444",
  ]);
  assert.equal(body.truncated, false);
  assert.deepEqual(calls, [
    {
      subjectRef: { kind: "issuer", id: subjectId },
      asOf: undefined,
      limit: 8,
    },
  ]);
});

test("GET /v1/themes/membership-rationales validates subject and limit query params", async (t) => {
  const base = await startServer(t);

  const missing = await fetch(`${base}/v1/themes/membership-rationales`);
  const badSubjectId = await fetch(
    `${base}/v1/themes/membership-rationales?subject_kind=issuer&subject_id=AAPL`,
  );
  const badLimit = await fetch(
    `${base}/v1/themes/membership-rationales?subject_kind=issuer&subject_id=33333333-3333-4333-8333-333333333333&limit=0`,
  );
  const badAsOf = await fetch(
    `${base}/v1/themes/membership-rationales?subject_kind=issuer&subject_id=33333333-3333-4333-8333-333333333333&as_of=not-a-date`,
  );
  const dateOnlyAsOf = await fetch(
    `${base}/v1/themes/membership-rationales?subject_kind=issuer&subject_id=33333333-3333-4333-8333-333333333333&as_of=2026-05-08`,
  );

  assert.equal(missing.status, 400);
  assert.equal(badSubjectId.status, 400);
  assert.equal(badLimit.status, 400);
  assert.equal(badAsOf.status, 400);
  assert.equal(dateOnlyAsOf.status, 400);
});

test("service Themes adapter lists membership rationale through the read model", async () => {
  const subjectId = "33333333-3333-4333-8333-333333333333";
  const db = {
    async query(text: string, values?: unknown[]) {
      assert.match(text, /from theme_memberships tm/i);
      assert.deepEqual(values, ["issuer", subjectId, "2026-05-08T00:00:00.000Z", 9]);
      return {
        rows: [
          {
            theme_membership_id: "22222222-2222-4222-8222-222222222222",
            theme_id: "11111111-1111-4111-8111-111111111111",
            theme_name: "Quality compounders",
            theme_description: null,
            membership_mode: "inferred",
            membership_spec: null,
            subject_kind: "issuer",
            subject_id: subjectId,
            score: "2",
            rationale_claim_ids: ["44444444-4444-4444-8444-444444444444"],
            effective_at: "2026-05-07T00:00:00.000Z",
            expires_at: null,
          },
        ],
      };
    },
  };
  const adapters = createServiceDevApiAdapters({
    db: db as never,
    async sealAnalyzeSnapshot() {
      throw new Error("analyze seal is not used");
    },
  });

  const result = await adapters.themes.listMembershipRationales({
    subjectRef: { kind: "issuer", id: subjectId },
    asOf: "2026-05-08T00:00:00.000Z",
    limit: 8,
  });

  assert.equal(result.memberships[0]?.theme_name, "Quality compounders");
  assert.equal(result.memberships[0]?.rationale_supported, true);
});

test("PATCH and DELETE /v1/agents expose update and delete controls", async (t) => {
  const base = await startServer(t);
  const headers = {
    "content-type": "application/json",
    "x-user-id": "00000000-0000-4000-8000-000000000001",
  };
  const issuerId = "11111111-1111-4111-8111-111111111111";
  const themeId = "22222222-2222-4222-8222-222222222222";

  const created = await fetch(`${base}/v1/agents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Review bot",
      thesis: "Track guidance",
      cadence: "daily",
      universe: { mode: "static", subject_refs: [{ kind: "issuer", id: issuerId }] },
      alert_rules: [
        {
          rule_id: "guidance-risk",
          severity_at_least: "high",
          headline_contains: "guidance",
          channels: ["email"],
        },
      ],
    }),
  });
  const agent = await created.json() as {
    agent_id: string;
    universe?: unknown;
    alert_rules?: unknown;
  };
  assert.deepEqual(agent.universe, { mode: "static", subject_refs: [{ kind: "issuer", id: issuerId }] });
  assert.deepEqual(agent.alert_rules, [
    {
      rule_id: "guidance-risk",
      severity_at_least: "high",
      headline_contains: "guidance",
      channels: ["email"],
    },
  ]);

  const patched = await fetch(`${base}/v1/agents/${agent.agent_id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      enabled: false,
      universe: { mode: "static", subject_refs: [{ kind: "theme", id: themeId }] },
      alert_rules: [
        {
          rule_id: "quality-risk",
          severity_at_least: "critical",
          headline_contains: "margin",
          channels: [],
        },
      ],
    }),
  });
  const patchBody = await patched.json() as Record<string, unknown>;
  assert.equal(patched.status, 200);
  assert.equal(patchBody.enabled, false);
  assert.deepEqual(patchBody.universe, { mode: "static", subject_refs: [{ kind: "theme", id: themeId }] });
  assert.deepEqual(patchBody.alert_rules, [
    {
      rule_id: "quality-risk",
      severity_at_least: "critical",
      headline_contains: "margin",
      channels: [],
    },
  ]);

  const malformedUniverse = await fetch(`${base}/v1/agents/${agent.agent_id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      universe: { mode: "static", subject_refs: [{ kind: "listing", id: "AAPL" }] },
    }),
  });
  assert.equal(malformedUniverse.status, 400);

  const deleted = await fetch(`${base}/v1/agents/${agent.agent_id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 204);
});

test("agent routes are scoped to the authenticated user", async (t) => {
  const base = await startServer(t);
  const userA = "00000000-0000-4000-8000-000000000001";
  const userB = "00000000-0000-4000-8000-000000000002";
  const headersA = {
    "content-type": "application/json",
    "x-user-id": userA,
  };

  const created = await fetch(`${base}/v1/agents`, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({ name: "Private monitor", thesis: "Track margins", cadence: "daily" }),
  });
  const agent = await created.json() as { agent_id: string };

  const run = await fetch(`${base}/v1/agents/${agent.agent_id}/runs`, {
    method: "POST",
    headers: { "x-user-id": userA },
  });
  assert.equal(run.status, 201);

  const listB = await fetch(`${base}/v1/agents`, {
    headers: { "x-user-id": userB },
  });
  const listBBody = await listB.json() as { agents?: unknown[]; runs?: unknown[] };
  assert.equal(listB.status, 200);
  assert.deepEqual(listBBody.agents, []);
  assert.deepEqual(listBBody.runs, []);

  const patchB = await fetch(`${base}/v1/agents/${agent.agent_id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-user-id": userB,
    },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(patchB.status, 404);

  const runB = await fetch(`${base}/v1/agents/${agent.agent_id}/runs`, {
    method: "POST",
    headers: { "x-user-id": userB },
  });
  assert.equal(runB.status, 404);

  const deleteB = await fetch(`${base}/v1/agents/${agent.agent_id}`, {
    method: "DELETE",
    headers: { "x-user-id": userB },
  });
  assert.equal(deleteB.status, 404);
});

test("Analyze and Agents BFF routes use durable adapters instead of server-local state", async (t) => {
  const adapters = createFixtureDevApiAdapters();
  const userId = "00000000-0000-4000-8000-000000000001";
  const headers = {
    "content-type": "application/json",
    "x-user-id": userId,
  };
  const firstBase = await startServer(t, {}, { adapters });

  const created = await fetch(`${firstBase}/v1/agents`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Durable monitor", thesis: "Track restarts", cadence: "daily" }),
  });
  const agent = await created.json() as { agent_id: string };
  assert.equal(created.status, 201);

  const run = await fetch(`${firstBase}/v1/agents/${agent.agent_id}/runs`, {
    method: "POST",
    headers: { "x-user-id": userId },
  });
  assert.equal(run.status, 201);

  const analyzeRun = await fetch(`${firstBase}/v1/analyze/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      template_id: EARNINGS_TEMPLATE_ID,
      instructions: "Persist this memo",
      source_categories: ["filings"],
    }),
  });
  assert.equal(analyzeRun.status, 201);

  const secondBase = await startServer(t, {}, { adapters });
  const persistedAgents = await fetch(`${secondBase}/v1/agents`, {
    headers: { "x-user-id": userId },
  });
  const persistedAgentsBody = await persistedAgents.json() as {
    agents?: Array<{ agent_id: string; name: string }>;
    runs?: Array<{ agent_id: string; status: string }>;
  };
  assert.equal(persistedAgents.status, 200);
  assert.ok(persistedAgentsBody.agents?.some((persisted) => persisted.agent_id === agent.agent_id));
  assert.ok(persistedAgentsBody.runs?.some((persisted) => persisted.agent_id === agent.agent_id));

  const persistedTemplates = await fetch(`${secondBase}/v1/analyze/templates`, {
    headers: { "x-user-id": userId },
  });
  const persistedTemplatesBody = await persistedTemplates.json() as { runs?: Array<{ template_id: string }> };
  assert.equal(persistedTemplates.status, 200);
  assert.ok(persistedTemplatesBody.runs?.some((persisted) => persisted.template_id === EARNINGS_TEMPLATE_ID));
});

test("service Analyze adapter writes blocks with the sealed snapshot id", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const templateId = "11111111-1111-4111-8111-111111111111";
  const primarySubject = { kind: "listing", id: "22222222-2222-4222-8222-222222222222" } as const;
  const addedSubject = { kind: "issuer", id: "33333333-3333-4333-8333-333333333333" } as const;
  const insertedBlocks: unknown[] = [];
  let workflowInput: Parameters<NonNullable<Parameters<typeof createServiceDevApiAdapters>[0]["runAnalyzeWorkflow"]>>[0] | null = null;
  const db = fakeAnalyzeDb({
    userId,
    templateId,
    addedSubjectRefs: [addedSubject],
    insertedBlocks,
  });
  const adapters = createServiceDevApiAdapters({
    db,
    async runAnalyzeWorkflow(input) {
      workflowInput = input;
      return {
        blocks: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            kind: "rich_text",
            snapshot_id: input.snapshotId,
            data_ref: {
              kind: "analyze_run",
              id: input.template.template_id,
              params: {
                bundle_ids: input.bundleIds,
                subject_refs: input.subjectRefs,
              },
            },
            source_refs: [],
            as_of: "2026-05-06T00:00:00.000Z",
            segments: [{ type: "text", text: "Workflow-rendered memo" }],
          },
        ],
      };
    },
    async sealAnalyzeSnapshot(input) {
      assert.equal(input.snapshotId, (input.blocks[0] as { snapshot_id?: string }).snapshot_id);
      return {
        ok: true,
        snapshot: {
          snapshot_id: input.snapshotId,
          subject_refs: [],
          fact_refs: [],
          claim_refs: [],
          event_refs: [],
          document_refs: [],
          series_specs: [],
          source_ids: [],
          tool_call_ids: [],
          tool_call_result_hashes: [],
          as_of: "2026-05-06T00:00:00.000Z",
          basis: "test",
          normalization: {},
          coverage_start: null,
          allowed_transforms: null,
          model_version: "test",
          parent_snapshot: null,
          created_at: "2026-05-06T00:00:00.000Z",
        },
        verification: { ok: true, failures: [] },
      };
    },
  });

  const run = await adapters.analyze.createRun({
    userId,
    body: {
      template_id: templateId,
      instructions: "Use sealed snapshot",
      source_categories: ["filings", "news"],
      subject_ref: primarySubject,
    },
  });

  assert.ok(workflowInput);
  assert.deepEqual(workflowInput.sourceCategories, ["filings", "news"]);
  assert.deepEqual(workflowInput.subjectRefs, [primarySubject, addedSubject]);
  assert.equal(workflowInput.playbookSectionId, "summary");
  assert.ok(workflowInput.bundleIds.includes("analyze_template_run"));
  assert.ok(workflowInput.bundleIds.includes("filing_research"));
  assert.ok(workflowInput.bundleIds.includes("document_research"));
  assert.notEqual(run.snapshot_id, "pending");
  assert.equal((run.blocks[0] as { snapshot_id?: string }).snapshot_id, run.snapshot_id);
  assert.equal(JSON.stringify(run.blocks).includes("Use sealed snapshot"), false);
  assert.deepEqual(insertedBlocks, run.blocks);
});

test("service Agent adapter runs the durable loop and writes activity before completion", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const agentId = "11111111-1111-4111-8111-111111111111";
  const db = fakeAgentLoopDb({ userId, agentId });
  const adapters = createServiceDevApiAdapters({
    db,
    createAgentLoopStages: createActivityAgentLoopStages,
    async sealAnalyzeSnapshot() {
      throw new Error("analyze seal is not used by agent runs");
    },
  });

  const run = await adapters.agents.run({ userId, agentId });

  assert.equal(run?.agent_id, agentId);
  assert.equal(run?.status, "completed");
  assert.ok(db.queries.some((query) => query.text.includes("insert into run_activities")));
  assert.ok(db.queries.some((query) => query.text.includes("update agents") && query.text.includes("watermarks")));
  assert.ok(db.queries.some((query) => query.text.includes("update agent_run_logs") && query.text.includes("status = 'completed'")));
  const completeQueryIndex = db.queries.findIndex((query) =>
    query.text.includes("update agent_run_logs") && query.text.includes("status = 'completed'")
  );
  const activityQueryIndex = db.queries.findIndex((query) => query.text.includes("insert into run_activities"));
  assert.ok(activityQueryIndex > -1);
  assert.ok(completeQueryIndex > activityQueryIndex);
});

test("service Agent adapter reloads watermarks after claiming the run", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const agentId = "11111111-1111-4111-8111-111111111111";
  const db = fakeAgentLoopDb({
    userId,
    agentId,
    agentWatermarksByRead: [{ cursor: "stale" }, { cursor: "fresh" }],
  });
  let observedWatermarks: unknown = null;
  const adapters = createServiceDevApiAdapters({
    db,
    createAgentLoopStages({ agent }) {
      assert.deepEqual(agent.watermarks, { cursor: "fresh" });
      return {
        readDeltas: async ({ current_watermarks }) => {
          observedWatermarks = current_watermarks;
          return {};
        },
        extractEvidence: async () => ({}),
        clusterEvidence: async () => ({}),
        analyze: async () => ({}),
        nextWatermarks: async () => ({ cursor: "next" }),
        applySideEffects: async () => ({ findings: 0 }),
      };
    },
    async sealAnalyzeSnapshot() {
      throw new Error("analyze seal is not used by agent runs");
    },
  });

  const run = await adapters.agents.run({ userId, agentId });

  assert.equal(run?.status, "completed");
  assert.deepEqual(observedWatermarks, { cursor: "fresh" });
  assert.equal(db.queries.filter((query) => query.text.includes("from agents") && query.text.includes("where agent_id")).length, 2);
});

test("service Agent adapter lets durable loop stages create findings and evaluate alerts", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const agentId = "11111111-1111-4111-8111-111111111111";
  const findingId = "44444444-4444-4444-8444-444444444444";
  const db = fakeAgentLoopDb({
    userId,
    agentId,
    alertRules: [
      {
        rule_id: "margin-risk",
        severity_at_least: "high",
        headline_contains: "margin risk",
        channels: ["email"],
      },
    ],
  });
  const finding = {
    finding_id: findingId,
    agent_id: agentId,
    snapshot_id: "55555555-5555-4555-8555-555555555555",
    subject_refs: [{ kind: "issuer", id: "22222222-2222-4222-8222-222222222222" }],
    claim_cluster_ids: [],
    severity: "critical",
    headline: "Margin risk widened after supplier warning",
    summary_blocks: [],
    created_at: "2026-05-06T00:00:00.000Z",
  };
  const adapters = createServiceDevApiAdapters({
    db,
    createAgentLoopStages() {
      return {
        readDeltas: async () => ({ cursor: "old" }),
        extractEvidence: async () => ({ docs: 1 }),
        clusterEvidence: async () => ({ clusters: 1 }),
        analyze: async () => ({ findings: [finding] }),
        nextWatermarks: async () => ({ cursor: "new" }),
        applySideEffects: async ({ tx, analysis }) => {
          await tx.query("insert into findings (finding_id, agent_id, headline) values ($1, $2, $3)", [
            analysis.findings[0].finding_id,
            analysis.findings[0].agent_id,
            analysis.findings[0].headline,
          ]);
          await tx.query("insert into run_activities (agent_id, stage, summary) values ($1, $2, $3)", [
            agentId,
            "found",
            "Created one finding",
          ]);
          return { findings: analysis.findings.length };
        },
        alertFindings: async ({ analysis }) => analysis.findings,
      };
    },
    async sealAnalyzeSnapshot() {
      throw new Error("analyze seal is not used by agent runs");
    },
  });

  const run = await adapters.agents.run({ userId, agentId });
  const completed = db.queries.find((query) =>
    query.text.includes("update agent_run_logs") && query.text.includes("status = 'completed'")
  );

  assert.equal(run?.status, "completed");
  assert.deepEqual(JSON.parse(String(completed?.values?.[1])), {
    trigger: "manual",
    status: "completed",
    findings: 1,
    alerts: { evaluated_rules: 1, evaluated_findings: 1, fired: 1 },
    next_watermarks: { cursor: "new" },
  });
  assert.ok(db.queries.some((query) => query.text.includes("insert into findings")));
  assert.ok(db.queries.some((query) => query.text.includes("insert into run_activities")));
  assert.ok(db.queries.some((query) => query.text.includes("insert into alerts_fired")));
});

test("GET /v1/agents/:id/findings and /activity expose the adapter-backed product surfaces", async (t) => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const agentId = "11111111-1111-4111-8111-111111111111";
  const calls: string[] = [];
  const adapters = {
    analyze: {
      listTemplates: async () => ({ templates: [] }),
      createRun: async () => {
        throw new Error("not used");
      },
      shareRunToChat: async () => {
        throw new Error("not used");
      },
    },
    agents: {
      list: async () => ({ agents: [], runs: [] }),
      create: async () => {
        throw new Error("not used");
      },
      update: async () => null,
      delete: async () => false,
      run: async () => null,
      listFindings: async (input: { userId: string; agentId: string }) => {
        calls.push(`findings:${input.userId}:${input.agentId}`);
        return {
          findings: [
            {
              finding_id: "44444444-4444-4444-8444-444444444444",
              agent_id: input.agentId,
              snapshot_id: "55555555-5555-4555-8555-555555555555",
              headline: "Operating margin quality improved",
              severity: "medium",
              subject_refs: [{ kind: "issuer", id: "22222222-2222-4222-8222-222222222222" }],
              summary_blocks: [],
              created_at: "2026-05-06T00:00:00.000Z",
            },
          ],
        };
      },
      listActivity: async (input: { userId: string; agentId: string }) => {
        calls.push(`activity:${input.userId}:${input.agentId}`);
        return {
          activity: [
            {
              run_activity_id: "33333333-3333-4333-8333-333333333333",
              agent_id: input.agentId,
              stage: "found",
              subject_refs: [{ kind: "issuer", id: "22222222-2222-4222-8222-222222222222" }],
              source_refs: ["66666666-6666-4666-8666-666666666666"],
              summary: "Created 1 source-backed finding.",
              ts: "2026-05-06T00:00:00.000Z",
            },
          ],
        };
      },
    },
  };
  const base = await startServer(t, {}, { adapters: adapters as never });

  const findingsResponse = await fetch(`${base}/v1/agents/${agentId}/findings`, {
    headers: { "x-user-id": userId },
  });
  const findingsBody = await findingsResponse.json() as { findings?: Array<{ headline?: string }> };
  const activityResponse = await fetch(`${base}/v1/agents/${agentId}/activity`, {
    headers: { "x-user-id": userId },
  });
  const activityBody = await activityResponse.json() as { activity?: Array<{ summary?: string }> };

  assert.equal(findingsResponse.status, 200);
  assert.equal(findingsBody.findings?.[0]?.headline, "Operating margin quality improved");
  assert.equal(activityResponse.status, 200);
  assert.equal(activityBody.activity?.[0]?.summary, "Created 1 source-backed finding.");
  assert.deepEqual(calls, [
    `findings:${userId}:${agentId}`,
    `activity:${userId}:${agentId}`,
  ]);
});

test("service Agent adapter lists owned durable findings and activity", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const agentId = "11111111-1111-4111-8111-111111111111";
  const db = fakeAgentDetailsDb({ userId, agentId });
  const adapters = createServiceDevApiAdapters({
    db,
    createAgentLoopStages: createActivityAgentLoopStages,
    async sealAnalyzeSnapshot() {
      throw new Error("analyze seal is not used");
    },
  });

  const findings = await adapters.agents.listFindings({ userId, agentId });
  const activity = await adapters.agents.listActivity({ userId, agentId });
  const missing = await adapters.agents.listFindings({
    userId: "00000000-0000-4000-8000-000000000099",
    agentId,
  });

  assert.deepEqual(findings?.findings.map((finding) => finding.headline), ["Operating margin quality improved"]);
  assert.deepEqual(activity?.activity.map((item) => item.summary), ["Created 1 source-backed finding."]);
  assert.equal(missing, null);
});

test("POST /v1/agents/:id/runs rejects durable adapter without loop stages", async (t) => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const agentId = "11111111-1111-4111-8111-111111111111";
  const db = fakeAgentLoopDb({ userId, agentId });
  const adapters = createServiceDevApiAdapters({
    db,
    async sealAnalyzeSnapshot() {
      throw new Error("analyze seal is not used by agent runs");
    },
  });
  const base = await startServer(t, {}, { adapters });

  const response = await fetch(`${base}/v1/agents/${agentId}/runs`, {
    method: "POST",
    headers: { "x-user-id": userId },
  });
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 503);
  assert.equal(body.error, "durable agent loop stages are not configured");
  assert.equal(db.queries.some((query) => query.text.includes("insert into agent_run_logs")), false);
});

test("service Analyze adapter rejects unknown source categories before persistence", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const templateId = "11111111-1111-4111-8111-111111111111";
  const insertedBlocks: unknown[] = [];
  let workflowCalls = 0;
  const adapters = createServiceDevApiAdapters({
    db: fakeAnalyzeDb({ userId, templateId, insertedBlocks }),
    runAnalyzeWorkflow() {
      workflowCalls += 1;
      return { blocks: [] };
    },
    async sealAnalyzeSnapshot() {
      throw new Error("invalid source categories should not seal a snapshot");
    },
  });

  await assert.rejects(
    adapters.analyze.createRun({
      userId,
      body: { template_id: templateId, source_categories: ["filings", "unknown-feed"] },
    }),
    /unknown source category/,
  );
  assert.equal(workflowCalls, 0);
  assert.deepEqual(insertedBlocks, []);
});

test("POST /v1/analyze/runs rejects unknown playbooks before workflow execution", async (t) => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const templateId = "11111111-1111-4111-8111-111111111111";
  const insertedBlocks: unknown[] = [];
  let workflowCalls = 0;
  const adapters = createServiceDevApiAdapters({
    db: fakeAnalyzeDb({ userId, templateId, insertedBlocks }),
    runAnalyzeWorkflow() {
      workflowCalls += 1;
      return { blocks: [] };
    },
    async sealAnalyzeSnapshot() {
      throw new Error("unknown playbooks should not seal a snapshot");
    },
  });
  const base = await startServer(t, {}, { adapters });

  const response = await fetch(`${base}/v1/analyze/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({
      template_id: templateId,
      playbook_id: "unknown-playbook",
      source_categories: ["filings"],
    }),
  });
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 400);
  assert.match(body.error ?? "", /playbook_id is unknown/);
  assert.equal(workflowCalls, 0);
  assert.deepEqual(insertedBlocks, []);
});

test("service Analyze adapter honors explicit empty source categories as base bundle only", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const templateId = "11111111-1111-4111-8111-111111111111";
  const insertedBlocks: unknown[] = [];
  let workflowInput: Parameters<NonNullable<Parameters<typeof createServiceDevApiAdapters>[0]["runAnalyzeWorkflow"]>>[0] | null = null;
  const adapters = createServiceDevApiAdapters({
    db: fakeAnalyzeDb({ userId, templateId, insertedBlocks }),
    runAnalyzeWorkflow(input) {
      workflowInput = input;
      return {
        blocks: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            kind: "rich_text",
            snapshot_id: input.snapshotId,
            source_refs: [],
            as_of: "2026-05-06T00:00:00.000Z",
            segments: [],
          },
        ],
      };
    },
    async sealAnalyzeSnapshot(input) {
      return {
        ok: true,
        snapshot: {
          snapshot_id: input.snapshotId,
          subject_refs: [],
          as_of: "2026-05-06T00:00:00.000Z",
          basis: "reported",
          normalization: "none",
          source_ids: [],
          fact_refs: [],
          claim_refs: [],
          event_refs: [],
          allowed_transforms: {},
        },
        verification: { ok: true, failures: [] },
      };
    },
  });

  await adapters.analyze.createRun({
    userId,
    body: { template_id: templateId, source_categories: [] },
  });

  assert.ok(workflowInput);
  assert.deepEqual(workflowInput.sourceCategories, []);
  assert.deepEqual(workflowInput.bundleIds, [ANALYZE_BASE_BUNDLE_ID]);
  assert.equal(workflowInput.playbookSectionId, "summary");
});

test("POST /v1/analyze/runs rejects verifier failures before persistence", async (t) => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const templateId = "11111111-1111-4111-8111-111111111111";
  const insertedBlocks: unknown[] = [];
  const adapters = createServiceDevApiAdapters({
    db: fakeAnalyzeDb({ userId, templateId, insertedBlocks }),
    runAnalyzeWorkflow(input) {
      return {
        blocks: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            kind: "rich_text",
            snapshot_id: input.snapshotId,
            source_refs: [],
            as_of: "2026-05-06T00:00:00.000Z",
            segments: [],
          },
        ],
      };
    },
    async sealAnalyzeSnapshot() {
      return {
        ok: false,
        verification: {
          ok: false,
          failures: [
            {
              reason_code: "missing_ref",
              details: { ref: "claim:missing" },
            },
          ],
        },
      };
    },
  });
  const base = await startServer(t, {}, { adapters });

  const response = await fetch(`${base}/v1/analyze/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({ template_id: templateId }),
  });
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 422);
  assert.equal(body.error, "snapshot seal failed");
  assert.deepEqual(insertedBlocks, []);
});

test("POST /v1/analyze/runs maps unknown source categories to 400", async (t) => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const templateId = "11111111-1111-4111-8111-111111111111";
  const adapters = createServiceDevApiAdapters({
    db: fakeAnalyzeDb({ userId, templateId, insertedBlocks: [] }),
    async sealAnalyzeSnapshot() {
      throw new Error("invalid source categories should not seal a snapshot");
    },
  });
  const base = await startServer(t, {}, { adapters });

  const response = await fetch(`${base}/v1/analyze/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({
      template_id: templateId,
      source_categories: ["unknown-feed"],
    }),
  });
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 400);
  assert.match(body.error ?? "", /unknown source category/);
});

test("POST /v1/analyze/runs rejects durable adapter without workflow renderer", async (t) => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const templateId = "11111111-1111-4111-8111-111111111111";
  const adapters = createServiceDevApiAdapters({
    db: fakeAnalyzeDb({ userId, templateId, insertedBlocks: [] }),
    async sealAnalyzeSnapshot() {
      throw new Error("missing workflow should not seal a snapshot");
    },
  });
  const base = await startServer(t, {}, { adapters });

  const response = await fetch(`${base}/v1/analyze/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({
      template_id: templateId,
      source_categories: ["filings"],
    }),
  });
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 503);
  assert.equal(body.error, "durable analyze workflow is not configured");
});

test("service Agent adapter marks the run failed when the durable loop fails", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const agentId = "11111111-1111-4111-8111-111111111111";
  const db = fakeAgentLoopDb({ userId, agentId });
  const adapters = createServiceDevApiAdapters({
    db,
    createAgentLoopStages() {
      return {
        readDeltas: async () => {
          throw new Error("evidence reader unavailable");
        },
        extractEvidence: async () => ({}),
        clusterEvidence: async () => ({}),
        analyze: async () => ({}),
        nextWatermarks: async () => ({}),
        applySideEffects: async () => ({}),
      };
    },
    async sealAnalyzeSnapshot() {
      throw new Error("analyze seal is not used by agent runs");
    },
  });

  const run = await adapters.agents.run({ userId, agentId });

  assert.equal(run?.status, "failed");
  assert.equal(run?.error, "evidence reader unavailable");
  assert.ok(db.queries.some((query) => query.text.includes("status = 'failed'")));
  assert.equal(db.queries.some((query) => query.text.includes("insert into run_activities")), false);
});

test("POST /v1/analyze/runs/:id/share-to-chat loads stored Analyze blocks and creates a durable chat message", async (t) => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const threadId = "11111111-1111-4111-8111-111111111111";
  const snapshotId = "22222222-2222-4222-8222-222222222222";
  const runId = "44444444-4444-4444-8444-444444444444";
  const block = {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "rich_text",
    snapshot_id: snapshotId,
    data_ref: { kind: "analyze_run", id: runId },
    source_refs: [],
    as_of: "2026-05-06T00:00:00.000Z",
    segments: [{ type: "text", text: "Durable imported memo" }],
  };
  const db = fakeArtifactShareDb({ userId, threadId, runId, snapshotId, blocks: [block] });
  const adapters = createServiceDevApiAdapters({
    db,
    async sealAnalyzeSnapshot() {
      throw new Error("analyze seal is not used by artifact share");
    },
  });
  const base = await startServer(t, {}, { adapters });

  const response = await fetch(`${base}/v1/analyze/runs/${runId}/share-to-chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({
      title: "Server-owned memo",
      origin_snapshot_id: "99999999-9999-4999-8999-999999999999",
      blocks: [
        {
          id: "client-forged",
          kind: "rich_text",
          snapshot_id: "99999999-9999-4999-8999-999999999999",
        },
      ],
    }),
  });
  const body = await response.json() as {
    thread?: { thread_id?: string; title?: string | null };
    message?: { snapshot_id?: string; blocks?: unknown[] };
    origin_snapshot_ids?: string[];
  };

  assert.equal(response.status, 201);
  assert.equal(body.thread?.thread_id, threadId);
  assert.equal(body.thread?.title, "Server-owned memo");
  assert.equal(body.message?.snapshot_id, snapshotId);
  assert.equal((body.message?.blocks?.[0] as { id?: string }).id, block.id);
  assert.equal(((body.message?.blocks?.[0] as { data_ref?: { params?: Record<string, unknown> } }).data_ref?.params?.analyze_run_id), runId);
  assert.equal(JSON.stringify(body.message?.blocks).includes("client-forged"), false);
  assert.deepEqual(body.origin_snapshot_ids, [snapshotId]);
  assert.equal(db.queries.some((query) => query.text.includes("update chat_threads")), false);
  assert.ok(db.queries.some((query) => query.text.includes("insert into chat_threads")));
});

test("POST /v1/analyze/runs/:id/share-to-chat rejects stored blocks outside the origin snapshot with details", async (t) => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const runId = "44444444-4444-4444-8444-444444444444";
  const db = fakeArtifactShareDb({
    userId,
    threadId: "11111111-1111-4111-8111-111111111111",
    runId,
    snapshotId: "22222222-2222-4222-8222-222222222222",
    blocks: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        kind: "rich_text",
        snapshot_id: "55555555-5555-4555-8555-555555555555",
      },
    ],
  });
  const adapters = createServiceDevApiAdapters({
    db,
    async sealAnalyzeSnapshot() {
      throw new Error("analyze seal is not used by artifact share");
    },
  });
  const base = await startServer(t, {}, { adapters });

  const response = await fetch(`${base}/v1/analyze/runs/${runId}/share-to-chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({ title: "Rejected memo" }),
  });
  const body = await response.json() as { error?: string; details?: Array<{ reason?: string }> };

  assert.equal(response.status, 422);
  assert.equal(body.error, "artifact share rejected");
  assert.equal(body.details?.[0]?.reason, "origin_snapshot_mismatch");
  assert.equal(db.queries.some((query) => query.text.includes("insert into chat_messages")), false);
  assert.equal(db.queries.some((query) => query.text.includes("insert into chat_threads")), false);
});

test("POST /v1/analyze/runs/:id/share-to-chat rejects runs owned by another user", async (t) => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const runId = "44444444-4444-4444-8444-444444444444";
  const db = fakeArtifactShareDb({
    userId: "00000000-0000-4000-8000-000000000002",
    threadId: "11111111-1111-4111-8111-111111111111",
    runId,
    snapshotId: "22222222-2222-4222-8222-222222222222",
    blocks: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        kind: "rich_text",
        snapshot_id: "22222222-2222-4222-8222-222222222222",
      },
    ],
  });
  const adapters = createServiceDevApiAdapters({
    db,
    async sealAnalyzeSnapshot() {
      throw new Error("analyze seal is not used by artifact share");
    },
  });
  const base = await startServer(t, {}, { adapters });

  const response = await fetch(`${base}/v1/analyze/runs/${runId}/share-to-chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({ title: "Wrong owner" }),
  });

  assert.equal(response.status, 404);
  assert.equal(db.queries.some((query) => query.text.includes("insert into chat_threads")), false);
});

test("GET /v1/agents requires an authenticated user", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/agents`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 401);
  assert.equal(body.error, "x-user-id header is required");
});

test("POST /v1/agents returns 400 for malformed JSON", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "00000000-0000-4000-8000-000000000001",
    },
    body: "{not json",
  });
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(body.error, "request body must be valid JSON");
});

test("GET /v1/dev/services documents local BFF routing and intentional exclusions", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/dev/services`);
  const body = await response.json() as { services?: Array<{ name: string; status: string }> };

  assert.equal(response.status, 200);
  assert.ok(body.services?.some((service) => service.name === "chat" && service.status === "vite_proxy"));
  assert.ok(body.services?.some((service) => service.name === "artifact" && service.status === "bff_durable_adapter"));
});

function fakeAnalyzeDb(input: {
  userId: string;
  templateId: string;
  addedSubjectRefs?: unknown[];
  insertedBlocks: unknown[];
}) {
  const client = {
    async query(text: string, values?: unknown[]) {
      if (text === "begin" || text === "commit" || text === "rollback") {
        return { rows: [], rowCount: null };
      }
      if (text.includes("from analyze_templates")) {
        return {
          rows: [
            {
              template_id: input.templateId,
              user_id: input.userId,
              name: "Earnings quality",
              prompt_template: "Review earnings quality",
              source_categories: ["filings"],
              added_subject_refs: input.addedSubjectRefs ?? [],
              block_layout_hint: null,
              peer_policy: null,
              disclosure_policy: null,
              version: 3,
              created_at: "2026-05-06T00:00:00.000Z",
              updated_at: "2026-05-06T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("insert into analyze_template_runs")) {
        const runMetadata = JSON.parse(String(values?.[3]));
        const blocks = JSON.parse(String(values?.[5]));
        input.insertedBlocks.splice(0, input.insertedBlocks.length, ...blocks);
        return {
          rows: [
            {
              run_id: "22222222-2222-4222-8222-222222222222",
              template_id: values?.[0],
              template_version: values?.[1],
              playbook_id: values?.[2],
              run_metadata: runMetadata,
              snapshot_id: values?.[4],
              blocks,
              created_at: "2026-05-06T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release() {
      // No-op test pool client.
    },
  };
  return {
    async connect() {
      return client;
    },
    query: client.query,
  };
}

function fakeAgentLoopDb(input: {
  userId: string;
  agentId: string;
  alertRules?: unknown[];
  agentWatermarksByRead?: unknown[];
}) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let agentReads = 0;
  const runIdFromInsert = () => queries.find((query) => query.text.includes("insert into agent_run_logs"))?.values?.[0] as string;
  const agentRow = () => ({
    agent_id: input.agentId,
    user_id: input.userId,
    name: "Durable loop monitor",
    thesis: "Track source-backed changes",
    universe: { mode: "static", subject_refs: [{ kind: "issuer", id: "22222222-2222-4222-8222-222222222222" }] },
    source_policy: null,
    cadence: "daily",
    prompt_template: null,
    alert_rules: input.alertRules ?? [],
    watermarks: input.agentWatermarksByRead?.[
      Math.min(agentReads, input.agentWatermarksByRead.length - 1)
    ] ?? { cursor: "old" },
    enabled: true,
    created_at: "2026-05-06T00:00:00.000Z",
    updated_at: "2026-05-06T00:00:00.000Z",
  });
  const db = {
    queries,
    async connect() {
      return db;
    },
    release() {
      // No-op test pool client.
    },
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text === "begin" || text === "commit" || text === "rollback") {
        return { rows: [], rowCount: null };
      }
      if (text.includes("claim_expires_at <= now()")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("from agents") && text.includes("where agent_id")) {
        const row = agentRow();
        agentReads += 1;
        return { rows: values?.[0] === input.agentId ? [row] : [], rowCount: null };
      }
      if (text.includes("insert into agent_run_logs")) {
        return {
          rows: [
            {
              agent_run_log_id: values?.[0],
              agent_id: values?.[1],
              started_at: "2026-05-06T00:00:00.000Z",
              ended_at: null,
              duration_ms: null,
              inputs_watermark: values?.[2] === null ? null : JSON.parse(String(values?.[2])),
              outputs_summary: null,
              status: "running",
              error: null,
              claim_expires_at: values?.[3],
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("insert into run_activities")) {
        if (values?.length === 3) {
          return {
            rows: [
              {
                run_activity_id: "33333333-3333-4333-8333-333333333333",
                user_id: input.userId,
                agent_id: values[0],
                stage: values[1],
                subject_refs: [],
                source_refs: [],
                summary: values[2],
                ts: "2026-05-06T00:00:00.000Z",
              },
            ],
            rowCount: 1,
          };
        }
        return {
          rows: [
            {
              run_activity_id: "33333333-3333-4333-8333-333333333333",
              user_id: values?.[0],
              agent_id: values?.[1],
              stage: values?.[2],
              subject_refs: JSON.parse(String(values?.[3])),
              source_refs: JSON.parse(String(values?.[4])),
              summary: values?.[5],
              ts: "2026-05-06T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("insert into findings")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("insert into alerts_fired")) {
        return {
          rows: [
            {
              alert_fired_id: "66666666-6666-4666-8666-666666666666",
              agent_id: input.agentId,
              run_id: runIdFromInsert(),
              rule_id: values?.[2],
              finding_id: values?.[3],
              channels: JSON.parse(String(values?.[4])),
              trigger_refs: JSON.parse(String(values?.[5])),
              status: "pending_notification",
              fired_at: "2026-05-06T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("update agents") && text.includes("watermarks")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("update agent_run_logs") && text.includes("status = 'completed'")) {
        return {
          rows: [
            {
              agent_run_log_id: values?.[0] ?? runIdFromInsert(),
              agent_id: input.agentId,
              started_at: "2026-05-06T00:00:00.000Z",
              ended_at: "2026-05-06T00:00:01.000Z",
              duration_ms: 1000,
              inputs_watermark: { trigger: "manual" },
              outputs_summary: JSON.parse(String(values?.[1])),
              status: "completed",
              error: null,
              claim_expires_at: null,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("update agent_run_logs") && text.includes("status = 'failed'")) {
        return {
          rows: [
            {
              agent_run_log_id: values?.[0] ?? runIdFromInsert(),
              agent_id: input.agentId,
              started_at: "2026-05-06T00:00:00.000Z",
              ended_at: "2026-05-06T00:00:01.000Z",
              duration_ms: 1000,
              inputs_watermark: { trigger: "manual" },
              outputs_summary: JSON.parse(String(values?.[1])),
              status: "failed",
              error: values?.[2],
              claim_expires_at: null,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return db;
}

function fakeAgentDetailsDb(input: {
  userId: string;
  agentId: string;
}) {
  const agentRow = {
    agent_id: input.agentId,
    user_id: input.userId,
    name: "Durable loop monitor",
    thesis: "Track source-backed changes",
    universe: { mode: "static", subject_refs: [{ kind: "issuer", id: "22222222-2222-4222-8222-222222222222" }] },
    source_policy: null,
    cadence: "daily",
    prompt_template: null,
    alert_rules: [],
    watermarks: { cursor: "old" },
    enabled: true,
    created_at: "2026-05-06T00:00:00.000Z",
    updated_at: "2026-05-06T00:00:00.000Z",
  };
  return {
    async connect() {
      return this;
    },
    release() {
      // No-op test pool client.
    },
    async query(text: string, values?: unknown[]) {
      if (text.includes("from agents") && text.includes("where agent_id")) {
        return { rows: values?.[0] === input.agentId ? [agentRow] : [], rowCount: null };
      }
      if (text.includes("from findings")) {
        return {
          rows: [
            {
              finding_id: "44444444-4444-4444-8444-444444444444",
              agent_id: input.agentId,
              snapshot_id: "55555555-5555-4555-8555-555555555555",
              headline: "Operating margin quality improved",
              severity: "medium",
              subject_refs: [{ kind: "issuer", id: "22222222-2222-4222-8222-222222222222" }],
              claim_cluster_ids: [],
              summary_blocks: [],
              created_at: "2026-05-06T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("from run_activities")) {
        return {
          rows: [
            {
              run_activity_id: "33333333-3333-4333-8333-333333333333",
              agent_id: input.agentId,
              stage: "found",
              subject_refs: [{ kind: "issuer", id: "22222222-2222-4222-8222-222222222222" }],
              source_refs: ["66666666-6666-4666-8666-666666666666"],
              summary: "Created 1 source-backed finding.",
              ts: "2026-05-06T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

function createActivityAgentLoopStages() {
  return {
    readDeltas: async () => ({ cursor: "old" }),
    extractEvidence: async () => ({ docs: 1 }),
    clusterEvidence: async () => ({ clusters: 1 }),
    analyze: async () => ({ findings: [] }),
    nextWatermarks: async () => ({ cursor: "new" }),
    applySideEffects: async ({ tx }: { tx: { query(text: string, values?: unknown[]): Promise<unknown> } }) => {
      await tx.query("insert into run_activities (agent_id, stage, summary) values ($1, $2, $3)", [
        "11111111-1111-4111-8111-111111111111",
        "found",
        "Completed agent run",
      ]);
      return { findings: 0, activities: 1 };
    },
  };
}

function fakeArtifactShareDb(input: {
  userId: string;
  threadId: string;
  runId: string;
  snapshotId: string;
  blocks: unknown[];
}) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db = {
    queries,
    async connect() {
      return db;
    },
    release() {
      // No-op test pool client.
    },
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text === "begin" || text === "commit" || text === "rollback") {
        return { rows: [], rowCount: null };
      }
      if (text.includes("from analyze_template_runs")) {
        return {
          rows: values?.[0] === input.userId && values?.[1] === input.runId
            ? [
                {
                  run_id: input.runId,
                  template_id: "77777777-7777-4777-8777-777777777777",
                  template_name: "Earnings quality",
                  template_version: 3,
                  playbook_id: "earnings_quality",
                  run_metadata: {
                    schema_version: 1,
                    template_id: "77777777-7777-4777-8777-777777777777",
                    template_version: 3,
                    playbook_id: "earnings_quality",
                    playbook_version: 1,
                    instructions: "Review earnings quality.",
                    source_categories: ["filings"],
                    subject_refs: [],
                  },
                  snapshot_id: input.snapshotId,
                  blocks: input.blocks,
                  created_at: "2026-05-06T00:00:00.000Z",
                },
              ]
            : [],
          rowCount: null,
        };
      }
      if (text.includes("from analyze_templates")) {
        return {
          rows: [
            {
              template_id: "77777777-7777-4777-8777-777777777777",
              user_id: input.userId,
              name: "Earnings quality",
              prompt_template: "Review earnings quality",
              source_categories: ["filings"],
              added_subject_refs: [],
              block_layout_hint: null,
              peer_policy: null,
              disclosure_policy: null,
              version: 3,
              created_at: "2026-05-06T00:00:00.000Z",
              updated_at: "2026-05-06T00:00:00.000Z",
            },
          ],
          rowCount: null,
        };
      }
      if (text.includes("insert into chat_threads")) {
        return {
          rows: [
            {
              thread_id: input.threadId,
              user_id: values?.[0],
              primary_subject_kind: values?.[1],
              primary_subject_id: values?.[2],
              title: values?.[3],
              latest_snapshot_id: null,
              archived_at: null,
              created_at: "2026-05-06T00:00:00.000Z",
              updated_at: "2026-05-06T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("from chat_threads")) {
        return {
          rows: values?.[0] === input.threadId && values?.[1] === input.userId ? [{ owned: true }] : [],
          rowCount: null,
        };
      }
      if (text.includes("insert into chat_messages")) {
        return {
          rows: [
            {
              message_id: "66666666-6666-4666-8666-666666666666",
              thread_id: values?.[0],
              role: values?.[2],
              snapshot_id: values?.[3],
              blocks: JSON.parse(String(values?.[4])),
              content_hash: values?.[5],
              created_at: "2026-05-06T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return db;
}
