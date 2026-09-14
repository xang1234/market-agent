import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { load } from "../web/node_modules/js-yaml/dist/js-yaml.mjs";

const REPO_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const OPENAPI_PATH = join(REPO_ROOT, "spec", "finance_research_openapi.yaml");

const FRONTEND_V1_ROUTES = [
  "/v1/agents",
  "/v1/agents/{agentId}",
  "/v1/agents/{agentId}/runs",
  "/v1/analyze/runs",
  "/v1/analyze/runs/{runId}/share-to-chat",
  "/v1/analyze/templates",
  "/v1/discovery/metric-options",
  "/v1/discovery/campaigns",
  "/v1/discovery/campaigns/{campaignId}",
  "/v1/discovery/campaigns/{campaignId}/draft",
  "/v1/discovery/campaigns/{campaignId}/brief",
  "/v1/discovery/campaigns/{campaignId}/runs",
  "/v1/discovery/runs/{runId}",
  "/v1/discovery/runs/{runId}/candidates",
  "/v1/discovery/runs/{runId}/events",
  "/v1/discovery/runs/{runId}/cancel",
  "/v1/chat/threads",
  "/v1/chat/threads/{threadId}/messages",
  "/v1/chat/threads/{threadId}/stream",
  "/v1/evidence/fact-review-queue",
  "/v1/evidence/fact-review-queue/{reviewId}/approve",
  "/v1/evidence/fact-review-queue/{reviewId}/candidate",
  "/v1/evidence/fact-review-queue/{reviewId}/reject",
  "/v1/fundamentals/consensus",
  "/v1/fundamentals/earnings",
  "/v1/fundamentals/holders",
  "/v1/fundamentals/profile",
  "/v1/fundamentals/segments",
  "/v1/fundamentals/statements",
  "/v1/fundamentals/stats",
  "/v1/home/summary",
  "/v1/market/quote",
  "/v1/market/series",
  "/v1/portfolios",
  "/v1/portfolios/{portfolioId}",
  "/v1/portfolios/{portfolioId}/holdings",
  "/v1/portfolios/{portfolioId}/holdings/{holdingId}",
  "/v1/portfolios/overlays",
  "/v1/run-activities/stream",
  "/v1/screener/screens",
  "/v1/screener/screens/{screenId}",
  "/v1/screener/search",
  "/v1/snapshots/{snapshotId}/transform",
  "/v1/subjects/resolve",
  "/v1/watchlists",
  "/v1/watchlists/{watchlist_id}",
  "/v1/watchlists/default/members",
  "/v1/watchlists/default/members/{subject_kind}/{subject_id}",
] as const;

const IMPLEMENTED_SERVICE_V1_ROUTES = [
  ...FRONTEND_V1_ROUTES,
  "/v1/dev/placeholders",
  "/v1/dev/services",
  "/v1/evidence/healthz",
  "/v1/home/healthz",
  "/v1/market/cache-audit",
] as const;

const FRONTEND_V1_OPERATIONS = [
  ["get", "/v1/agents"],
  ["post", "/v1/agents"],
  ["patch", "/v1/agents/{agentId}"],
  ["delete", "/v1/agents/{agentId}"],
  ["post", "/v1/agents/{agentId}/runs"],
  ["post", "/v1/analyze/runs"],
  ["post", "/v1/analyze/runs/{runId}/share-to-chat"],
  ["get", "/v1/discovery/metric-options"],
  ["get", "/v1/discovery/campaigns"],
  ["post", "/v1/discovery/campaigns"],
  ["get", "/v1/discovery/campaigns/{campaignId}"],
  ["delete", "/v1/discovery/campaigns/{campaignId}"],
  ["post", "/v1/discovery/campaigns/{campaignId}/draft"],
  ["put", "/v1/discovery/campaigns/{campaignId}/brief"],
  ["get", "/v1/discovery/campaigns/{campaignId}/runs"],
  ["post", "/v1/discovery/campaigns/{campaignId}/runs"],
  ["get", "/v1/discovery/runs/{runId}"],
  ["get", "/v1/discovery/runs/{runId}/candidates"],
  ["get", "/v1/discovery/runs/{runId}/events"],
  ["post", "/v1/discovery/runs/{runId}/cancel"],
  ["get", "/v1/chat/threads/{threadId}/messages"],
  ["post", "/v1/chat/threads/{threadId}/messages"],
] as const;

test("OpenAPI includes every frontend /v1 route", async () => {
  const routes = await openApiRoutes();

  assert.deepEqual(
    FRONTEND_V1_ROUTES.filter((route) => !routes.has(route)),
    [],
  );
});

test("OpenAPI route inventory documents implemented service /v1 routes", async () => {
  const spec = await readFile(OPENAPI_PATH, "utf8");

  for (const route of IMPLEMENTED_SERVICE_V1_ROUTES) {
    assert.match(spec, new RegExp(escapeRegExp(route)));
  }
});

test("OpenAPI includes frontend-used HTTP methods for mutable agent routes", async () => {
  const spec = await readFile(OPENAPI_PATH, "utf8");

  assert.deepEqual(
    FRONTEND_V1_OPERATIONS.filter(([method, route]) => !openApiRouteMethods(spec, route).has(method)),
    [],
  );
});

test("OpenAPI documents the Analyze run and share-to-chat payload contract", async () => {
  const spec = await readFile(OPENAPI_PATH, "utf8");
  const runSection = openApiRouteSection(spec, "/v1/analyze/runs");
  const shareSection = openApiRouteSection(spec, "/v1/analyze/runs/{runId}/share-to-chat");

  for (const expected of ["'201':", "$ref: '#/components/schemas/AnalyzeRun'"]) {
    assert.match(runSection, new RegExp(escapeRegExp(expected)));
  }
  for (const expected of ["AnalyzeRunInput", "template_id", "instructions", "source_categories", "subject_ref"]) {
    assert.match(spec, new RegExp(escapeRegExp(expected)));
  }

  for (const expected of ["runId", "$ref: '#/components/schemas/AnalyzeRunShareResult'"]) {
    assert.match(shareSection, new RegExp(escapeRegExp(expected)));
  }
  for (const expected of ["AnalyzeRunShareInput", "source_kind", "title", "primary_subject_ref"]) {
    assert.match(spec, new RegExp(escapeRegExp(expected)));
  }
});

test("OpenAPI gives every discovery operation browser-safe response and error schemas", async () => {
  const spec = await readFile(OPENAPI_PATH, "utf8");
  const operations = [
    ["get", "/v1/discovery/metric-options"], ["get", "/v1/discovery/campaigns"], ["post", "/v1/discovery/campaigns"],
    ["get", "/v1/discovery/campaigns/{campaignId}"], ["delete", "/v1/discovery/campaigns/{campaignId}"],
    ["post", "/v1/discovery/campaigns/{campaignId}/draft"], ["put", "/v1/discovery/campaigns/{campaignId}/brief"],
    ["get", "/v1/discovery/campaigns/{campaignId}/runs"], ["post", "/v1/discovery/campaigns/{campaignId}/runs"],
    ["get", "/v1/discovery/runs/{runId}"], ["get", "/v1/discovery/runs/{runId}/candidates"],
    ["get", "/v1/discovery/runs/{runId}/events"], ["post", "/v1/discovery/runs/{runId}/cancel"],
  ] as const;
  for (const [method, route] of operations) {
    const section = openApiOperationSection(spec, route, method);
    assert.match(section, /responses:/);
    assert.deepEqual([...section.matchAll(/^        '\d{3}':(?! \{ \$ref: '#\/components\/responses\/Discovery)/gm)].map((match) => match[0]), [], `${method} ${route} has a referenced response for every status`);
  }
  for (const expected of ["DiscoveryMetricOptionsResponse", "DiscoveryCampaignPageResponse", "DiscoveryRunViewResponse", "DiscoveryEventPageResponse", "DiscoveryBadRequest"]) {
    assert.match(spec, new RegExp(escapeRegExp(`    ${expected}:`)));
  }
  const model = componentSchemaSection(spec, "DiscoveryModelConfig");
  for (const expected of ["additionalProperties: false", "role:", "provider:", "model:", "max_output_tokens:", "as_of:"]) assert.match(model, new RegExp(escapeRegExp(expected)));
  assert.doesNotMatch(model, /api_key|apiKey|endpoint|headers/i);
  const metric = componentSchemaSection(spec, "DiscoveryMetricOption");
  for (const expected of ["metric_key:", "display_name:", "unit_class:", "aggregation:", "interpretation:", "canonical_source_class:"]) assert.match(metric, new RegExp(escapeRegExp(expected)));
});

test("OpenAPI recursively closes every discovery response object and preserves key DTO fields", async () => {
  const document = await openApiDocument();
  const visitedReferences = new Set<string>();

  for (const [label, schema] of discoveryResponseSchemas(document)) {
    assertClosedResponseObjects(document, schema, label, visitedReferences);
  }

  const successResponseByOperation = [
    ["get", "/v1/discovery/metric-options", "200", "DiscoveryMetricOptionsResponse"],
    ["get", "/v1/discovery/campaigns", "200", "DiscoveryCampaignPageResponse"],
    ["post", "/v1/discovery/campaigns", "201", "DiscoveryCampaignResponse"],
    ["get", "/v1/discovery/campaigns/{campaignId}", "200", "DiscoveryCampaignDetailResponse"],
    ["post", "/v1/discovery/campaigns/{campaignId}/draft", "200", "DiscoveryDraftResponse"],
    ["put", "/v1/discovery/campaigns/{campaignId}/brief", "200", "DiscoverySavedBriefResponse"],
    ["get", "/v1/discovery/campaigns/{campaignId}/runs", "200", "DiscoveryRunPageResponse"],
    ["post", "/v1/discovery/campaigns/{campaignId}/runs", "201", "DiscoveryRunResponse"],
    ["get", "/v1/discovery/runs/{runId}", "200", "DiscoveryRunViewResponse"],
    ["get", "/v1/discovery/runs/{runId}/candidates", "200", "DiscoveryCandidatePageResponse"],
    ["get", "/v1/discovery/runs/{runId}/events", "200", "DiscoveryEventPageResponse"],
    ["post", "/v1/discovery/runs/{runId}/cancel", "200", "DiscoveryRunResponse"],
  ] as const;
  for (const [method, path, status, responseName] of successResponseByOperation) {
    const operation = record(record(record(document.paths, "paths")[path], `paths.${path}`)[method], `${method} ${path}`);
    const response = record(record(operation.responses, `${method} ${path}.responses`)[status], `${method} ${path} ${status}`);
    assert.equal(response.$ref, `#/components/responses/${responseName}`, `${method.toUpperCase()} ${path} uses its named success response`);
  }

  const requiredByDto: Record<string, readonly string[]> = {
    DiscoveryMetricOption: ["metric_key", "display_name", "unit_class", "aggregation", "interpretation", "canonical_source_class"],
    DiscoveryCampaign: ["campaign_id", "user_id", "name", "question", "current_brief_version", "created_at", "updated_at", "archived_at"],
    DiscoveryCampaignPage: ["items", "next_cursor"],
    DiscoveryBrief: ["schema_version", "question", "market", "horizon_months", "lookback_months", "mechanisms", "criteria", "seed_queries", "exclusions", "preferences", "queries"],
    DiscoveryMechanism: ["mechanism_id", "label", "chain"],
    DiscoveryMetricCheck: ["metric_key", "unit", "period_kind", "operator", "threshold", "max_age_days"],
    DiscoveryCriterion: ["criterion_id", "importance", "statement", "falsifier"],
    DiscoveryBriefQuery: ["mechanism_id", "query"],
    DiscoverySavedBrief: ["brief_id", "campaign_id", "version", "brief", "hash", "approved_at", "created_at"],
    DiscoveryModelConfig: ["role", "provider", "model", "max_output_tokens", "as_of"],
    DiscoveryLimits: ["candidates", "research", "shortlist", "attempts", "input_chars", "output_tokens", "request_timeout_ms", "run_timeout_ms"],
    DiscoveryAttemptLimits: ["search", "document", "identity", "financial", "model"],
    DiscoveryUsage: ["search", "document", "identity", "financial", "model"],
    DiscoveryCoverage: ["searches_planned", "searches_completed", "hits_truncated", "leads_overflow", "extraction_batches_skipped", "unresolved", "discovered", "selected", "assessed", "not_selected", "mechanisms", "gaps"],
    DiscoveryCoverageMechanism: ["mechanism_id", "discovered", "selected", "assessed"],
    DiscoveryCoverageGap: ["code", "candidate_id", "detail"],
    DiscoveryRun: ["run_id", "campaign_id", "brief_id", "user_id", "status", "stage", "policy_version", "request_key", "model_config", "limits", "usage", "coverage", "started_at", "finished_at", "cancel_requested_at"],
    DiscoveryRunPage: ["items", "next_cursor"],
    DiscoveryRunView: ["run_id", "campaign_id", "brief_id", "user_id", "status", "stage", "policy_version", "request_key", "model_config", "limits", "usage", "coverage", "started_at", "finished_at", "cancel_requested_at", "shortlist", "cost", "worker_waiting"],
    DiscoveryCost: ["status"],
    DiscoveryReadiness: ["ready", "missing"],
    DiscoveryCompanyIdentity: ["issuer_id", "listing_id", "legal_name", "ticker", "mic", "currency", "asset_type", "identity_source_ids"],
    DiscoveryDimension: ["level", "explanation", "citations"],
    DiscoveryDimensions: ["theme_exposure", "evidence_strength", "business_quality", "valuation_context"],
    DiscoveryCriterionOutcome: ["criterion_id", "outcome", "explanation", "citations"],
    DiscoveryCounterargument: ["text", "citations"],
    DiscoveryCandidateDecision: ["candidate_id", "identity", "state", "dimensions", "criteria", "counterarguments", "unresolved_questions", "next_action", "reason_codes"],
    DiscoveryCandidate: ["candidate_id", "identity", "name", "state", "rank", "snapshot_id", "evidence_available", "can_promote", "assessment", "sources", "origins", "mechanism_ids", "reason_codes"],
    DiscoveryCandidatePage: ["items", "next_cursor"],
    DiscoveryCampaignDetail: ["campaign", "brief", "latest_run", "readiness"],
    DiscoveryDraft: ["brief", "base_version"],
    DiscoveryCitation: ["kind", "id"],
    DiscoverySourceView: ["citation", "title", "url", "published_at", "retrieved_at"],
    DiscoveryEvent: ["run_id", "sequence", "stage", "kind", "candidate_id", "summary", "citations", "created_at"],
    DiscoveryEventPage: ["items", "next_sequence", "has_more"],
  };

  for (const [name, required] of Object.entries(requiredByDto)) {
    const schema = componentSchema(document, name);
    assert.equal(schema.additionalProperties, false, `${name} closes its browser-safe shape`);
    assert.deepEqual(schema.required, required, `${name} lists every runtime field as required`);
  }

  const brief = componentSchema(document, "DiscoveryBrief");
  const briefProperties = record(brief.properties, "DiscoveryBrief.properties");
  assert.deepEqual(record(briefProperties.mechanisms, "DiscoveryBrief.mechanisms"), { $ref: "#/components/schemas/DiscoveryMechanismList" });
  assert.deepEqual(record(briefProperties.criteria, "DiscoveryBrief.criteria"), { $ref: "#/components/schemas/DiscoveryCriterionList" });
  assert.deepEqual(record(briefProperties.queries, "DiscoveryBrief.queries"), { $ref: "#/components/schemas/DiscoveryBriefQueryList" });
  assert.deepEqual(record(briefProperties.exclusions, "DiscoveryBrief.exclusions"), { $ref: "#/components/schemas/DiscoveryExclusionList" });
  assert.deepEqual(record(briefProperties.preferences, "DiscoveryBrief.preferences"), { $ref: "#/components/schemas/DiscoveryPreferenceList" });

  const run = componentSchema(document, "DiscoveryRun");
  const runProperties = record(run.properties, "DiscoveryRun.properties");
  assert.deepEqual(record(runProperties.usage, "DiscoveryRun.usage"), { $ref: "#/components/schemas/DiscoveryUsage" });
  assert.deepEqual(record(runProperties.coverage, "DiscoveryRun.coverage"), { $ref: "#/components/schemas/DiscoveryCoverage" });
});

test("OpenAPI matches discovery handler query, response, error, and DTO semantics", async () => {
  const document = await openApiDocument();
  const responsesByOperation: ReadonlyArray<readonly [string, string, Readonly<Record<string, string>>]> = [
    ["get", "/v1/discovery/metric-options", { "200": "DiscoveryMetricOptionsResponse", "401": "DiscoveryUnauthorized" }],
    ["get", "/v1/discovery/campaigns", { "200": "DiscoveryCampaignPageResponse", "401": "DiscoveryUnauthorized" }],
    ["post", "/v1/discovery/campaigns", { "201": "DiscoveryCampaignResponse", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized" }],
    ["get", "/v1/discovery/campaigns/{campaignId}", { "200": "DiscoveryCampaignDetailResponse", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized", "404": "DiscoveryNotFound" }],
    ["delete", "/v1/discovery/campaigns/{campaignId}", { "204": "DiscoveryNoContent", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized", "404": "DiscoveryNotFound", "409": "DiscoveryConflict" }],
    ["post", "/v1/discovery/campaigns/{campaignId}/draft", { "200": "DiscoveryDraftResponse", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized", "404": "DiscoveryNotFound", "409": "DiscoveryConflict", "429": "DiscoveryRateLimited", "503": "DiscoveryUnavailable" }],
    ["put", "/v1/discovery/campaigns/{campaignId}/brief", { "200": "DiscoverySavedBriefResponse", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized", "404": "DiscoveryNotFound", "409": "DiscoveryConflict" }],
    ["get", "/v1/discovery/campaigns/{campaignId}/runs", { "200": "DiscoveryRunPageResponse", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized", "404": "DiscoveryNotFound" }],
    ["post", "/v1/discovery/campaigns/{campaignId}/runs", { "201": "DiscoveryRunResponse", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized", "404": "DiscoveryNotFound", "409": "DiscoveryConflict" }],
    ["get", "/v1/discovery/runs/{runId}", { "200": "DiscoveryRunViewResponse", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized", "404": "DiscoveryNotFound" }],
    ["get", "/v1/discovery/runs/{runId}/candidates", { "200": "DiscoveryCandidatePageResponse", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized", "404": "DiscoveryNotFound" }],
    ["get", "/v1/discovery/runs/{runId}/events", { "200": "DiscoveryEventPageResponse", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized", "404": "DiscoveryNotFound" }],
    ["post", "/v1/discovery/runs/{runId}/cancel", { "200": "DiscoveryRunResponse", "400": "DiscoveryBadRequest", "401": "DiscoveryUnauthorized", "404": "DiscoveryNotFound" }],
  ];
  for (const [method, path, expected] of responsesByOperation) assertOperationResponses(document, method, path, expected);

  const queries: ReadonlyArray<readonly [string, string, Readonly<Record<string, QuerySchemaExpectation>>]> = [
    ["get", "/v1/discovery/campaigns", { cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }],
    ["get", "/v1/discovery/campaigns/{campaignId}/runs", { cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }],
    ["get", "/v1/discovery/runs/{runId}/candidates", {
      cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      state: { type: "string", enum: CANDIDATE_STATES },
    }],
    ["get", "/v1/discovery/runs/{runId}/events", { after: { type: "integer", minimum: 0, default: 0 } }],
  ];
  for (const [method, path, expected] of queries) assertQueryParameters(document, method, path, expected);

  for (const [response, schema] of [
    ["DiscoveryCampaignResponse", "DiscoveryCampaign"], ["DiscoveryCampaignPageResponse", "DiscoveryCampaignPage"],
    ["DiscoveryCampaignDetailResponse", "DiscoveryCampaignDetail"], ["DiscoveryDraftResponse", "DiscoveryDraft"],
    ["DiscoverySavedBriefResponse", "DiscoverySavedBrief"], ["DiscoveryRunResponse", "DiscoveryRun"],
    ["DiscoveryRunPageResponse", "DiscoveryRunPage"], ["DiscoveryRunViewResponse", "DiscoveryRunView"],
    ["DiscoveryCandidatePageResponse", "DiscoveryCandidatePage"], ["DiscoveryEventPageResponse", "DiscoveryEventPage"],
    ["DiscoveryBadRequest", "DiscoveryError"], ["DiscoveryNotFound", "DiscoveryError"], ["DiscoveryConflict", "DiscoveryError"],
    ["DiscoveryRateLimited", "DiscoveryError"], ["DiscoveryUnavailable", "DiscoveryError"], ["DiscoveryUnauthorized", "DiscoveryAuthenticationError"],
  ] as const) assertResponseSchemaReference(document, response, schema);
  assertNoContentResponse(document, "DiscoveryNoContent");
  assertMetricOptionsWrapper(document);

  assertClosedRequiredObject(document, "DiscoveryAuthenticationError", ["error"]);
  assertClosedRequiredObject(document, "DiscoveryError", ["error", "code"]);
  assertPropertyReference(document, "DiscoveryError", "code", "DiscoveryErrorCode");
  assertExactEnum(componentSchema(document, "DiscoveryErrorCode"), DISCOVERY_ERROR_CODES, "DiscoveryErrorCode");

  for (const [component, property, kind] of DISCOVERY_PROPERTY_KINDS) assertPropertyKind(document, component, property, kind);
  for (const [component, target] of DISCOVERY_ARRAY_SCHEMA_KINDS) assertArraySchemaKind(document, component, target);

  for (const [component, property, expected] of [
    ["DiscoveryRun", "status", RUN_STATUSES], ["DiscoveryRun", "stage", RUN_STAGES],
    ["DiscoveryRunView", "status", RUN_STATUSES], ["DiscoveryRunView", "stage", RUN_STAGES],
    ["DiscoveryCandidate", "state", CANDIDATE_STATES], ["DiscoveryCandidateDecision", "state", DECISION_STATES],
    ["DiscoveryEvent", "stage", RUN_STAGES], ["DiscoveryEvent", "kind", EVENT_KINDS],
  ] as const) assertPropertyEnum(document, component, property, expected);

  for (const component of ["DiscoveryUsage", "DiscoveryAttemptLimits"] as const) {
    const minimum = component === "DiscoveryUsage" ? 0 : 1;
    assertClosedRequiredObject(document, component, RESOURCES);
    for (const resource of RESOURCES) {
      const schema = schemaProperty(document, component, resource);
      assert.equal(schema.type, "integer", `${component}.${resource} is an integer`);
      assert.equal(schema.minimum, minimum, `${component}.${resource} has its runtime minimum`);
    }
  }

  for (const component of ["DiscoveryCampaignPage", "DiscoveryRunPage", "DiscoveryCandidatePage"] as const) {
    assertArrayPropertyReference(document, component, "items", component.replace("Page", ""));
    assertNullableType(document, component, "next_cursor", "string");
  }
  assertArrayPropertyReference(document, "DiscoveryEventPage", "items", "DiscoveryEvent");
  assertNullableType(document, "DiscoveryRun", "started_at", "string");
  assertNullableType(document, "DiscoveryRun", "finished_at", "string");
  assertNullableType(document, "DiscoveryRun", "cancel_requested_at", "string");
  assertNullableType(document, "DiscoveryCandidate", "rank", "integer");
  assertNullableType(document, "DiscoveryCandidate", "snapshot_id", "string");
  assertNullableType(document, "DiscoverySourceView", "published_at", "string");
  assertNullableType(document, "DiscoveryCampaign", "archived_at", "string");
});

test("OpenAPI response semantic manifest rejects constrained response-schema drift", async () => {
  const document = await openApiDocument();

  const mutations: ReadonlyArray<readonly [string, (value: OpenApiDocument) => void]> = [
    ["enum value", (value) => {
      record(record(schemaProperty(value, "DiscoveryReadiness", "missing").items, "DiscoveryReadiness.missing.items")).enum = ["model", "search"];
    }],
    ["const value", (value) => {
      schemaProperty(value, "DiscoveryCost", "status").const = "available";
    }],
    ["primitive array item", (value) => {
      record(schemaProperty(value, "DiscoveryCompanyIdentity", "identity_source_ids").items, "DiscoveryCompanyIdentity.identity_source_ids.items").type = "integer";
    }],
    ["new constrained path", (value) => {
      schemaProperty(value, "DiscoveryMetricOption", "metric_key").enum = ["price_to_earnings"];
    }],
  ];

  assertDiscoveryResponseSemanticManifest(document);
  for (const [label, mutate] of mutations) {
    const mutated = structuredClone(document);
    mutate(mutated);
    assert.throws(
      () => assertDiscoveryResponseSemanticManifest(mutated),
      /discovery response semantic manifest/,
      `${label} drift is rejected`,
    );
  }
});

test("OpenAPI no longer exposes the retired home feed route", async () => {
  const routes = await openApiRoutes();

  assert.equal(routes.has("/v1/home/feed"), false);
});

async function openApiRoutes(): Promise<ReadonlySet<string>> {
  const spec = await readFile(OPENAPI_PATH, "utf8");
  return new Set(
    [...spec.matchAll(/^  (\/v1\/[^:]+):$/gm)].map((match) => match[1]),
  );
}

type OpenApiDocument = Record<string, unknown>;
type OpenApiSchema = Record<string, unknown>;

async function openApiDocument(): Promise<OpenApiDocument> {
  return record(load(await readFile(OPENAPI_PATH, "utf8")), "OpenAPI document");
}

function assertDiscoveryResponseSemanticManifest(document: OpenApiDocument): void {
  assert.deepEqual(
    discoveryResponseSemanticContracts(document),
    DISCOVERY_RESPONSE_SEMANTIC_MANIFEST,
    "discovery response semantic manifest covers every reachable enum, const, and primitive array item",
  );
}

function discoveryResponseSemanticContracts(document: OpenApiDocument): Readonly<Record<string, ResponseSchemaSemantic>> {
  const contracts = new Map<string, ResponseSchemaSemantic>();
  const visitedReferences = new Set<string>();

  const add = (path: string, schema: OpenApiSchema, reference?: string): void => {
    const contract: Record<string, unknown> = {};
    if (reference !== undefined) contract.$ref = reference;
    for (const key of RESPONSE_SEMANTIC_KEYS) {
      if (schema[key] !== undefined) contract[key] = schema[key];
    }
    contracts.set(path, contract);
  };

  const walk = (schema: OpenApiSchema, path: string): void => {
    const reference = schema.$ref;
    if (typeof reference === "string" && reference.startsWith("#/components/schemas/")) {
      if (visitedReferences.has(reference)) return;
      visitedReferences.add(reference);
      walk(resolveComponent(document, schema, "schemas"), reference);
      return;
    }

    if (schema.enum !== undefined || schema.const !== undefined) add(path, schema);

    if (schemaIncludesType(schema, "array") && schema.items !== undefined) {
      const items = record(schema.items, `${path}.items`);
      const resolvedItems = typeof items.$ref === "string" ? resolveComponent(document, items, "schemas") : items;
      if (isPrimitiveSchema(resolvedItems)) add(path + ".items", resolvedItems, typeof items.$ref === "string" ? items.$ref : undefined);
      walk(items, path + ".items");
    }

    if (schema.properties !== undefined) {
      for (const [property, child] of Object.entries(record(schema.properties, `${path}.properties`))) {
        walk(record(child, `${path}.${property}`), `${path}.${property}`);
      }
    }
    for (const combinator of ["allOf", "anyOf", "oneOf"] as const) {
      const branches = schema[combinator];
      if (branches === undefined) continue;
      assert.ok(Array.isArray(branches), `${path}.${combinator} is an array`);
      for (const [index, branch] of branches.entries()) {
        walk(record(branch, `${path}.${combinator}[${index}]`), `${path}.${combinator}[${index}]`);
      }
    }
  };

  for (const [label, schema] of discoveryResponseSchemas(document)) walk(schema, label);
  return Object.fromEntries([...contracts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function isPrimitiveSchema(schema: OpenApiSchema): boolean {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.length > 0 && types.every((type) => type === "null" || PRIMITIVE_SCHEMA_TYPES.has(type));
}

function schemaIncludesType(schema: OpenApiSchema, expected: string): boolean {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.includes(expected);
}

function discoveryResponseSchemas(document: OpenApiDocument): Array<[string, OpenApiSchema]> {
  const paths = record(document.paths, "paths");
  const schemas: Array<[string, OpenApiSchema]> = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!path.startsWith("/v1/discovery/")) continue;
    for (const [method, operation] of Object.entries(record(pathItem, `paths.${path}`))) {
      if (!/^(get|post|put|delete)$/.test(method)) continue;
      const responses = record(record(operation, `${method} ${path}`).responses, `${method} ${path}.responses`);
      for (const [status, response] of Object.entries(responses)) {
        const resolvedResponse = resolveComponent(document, record(response, `${method} ${path} ${status}`), "responses");
        const content = resolvedResponse.content;
        if (content === undefined) continue;
        const applicationJson = record(record(content, `${method} ${path} ${status}.content`)["application/json"], `${method} ${path} ${status}.application/json`);
        schemas.push([`${method.toUpperCase()} ${path} ${status}`, record(applicationJson.schema, `${method} ${path} ${status}.schema`)]);
      }
    }
  }
  return schemas;
}

function assertClosedResponseObjects(document: OpenApiDocument, schema: OpenApiSchema, label: string, visitedReferences: Set<string>): void {
  const reference = schema.$ref;
  if (typeof reference === "string") {
    if (visitedReferences.has(reference)) return;
    visitedReferences.add(reference);
    assertClosedResponseObjects(document, resolveComponent(document, schema, "schemas"), `${label} -> ${reference}`, visitedReferences);
    return;
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("object")) assert.equal(schema.additionalProperties, false, `${label} must close object properties`);
  const properties = schema.properties;
  if (properties !== undefined) {
    for (const [property, child] of Object.entries(record(properties, `${label}.properties`))) {
      assertClosedResponseObjects(document, record(child, `${label}.${property}`), `${label}.${property}`, visitedReferences);
    }
  }
  const items = schema.items;
  if (items !== undefined) assertClosedResponseObjects(document, record(items, `${label}.items`), `${label}.items`, visitedReferences);
  for (const combinator of ["allOf", "anyOf", "oneOf"] as const) {
    const branches = schema[combinator];
    if (branches === undefined) continue;
    assert.ok(Array.isArray(branches), `${label}.${combinator} is an array`);
    for (const [index, branch] of branches.entries()) {
      assertClosedResponseObjects(document, record(branch, `${label}.${combinator}[${index}]`), `${label}.${combinator}[${index}]`, visitedReferences);
    }
  }
}

function componentSchema(document: OpenApiDocument, name: string): OpenApiSchema {
  return record(record(record(document.components, "components").schemas, "components.schemas")[name], `components.schemas.${name}`);
}

function resolveComponent(document: OpenApiDocument, value: OpenApiSchema, collection: "parameters" | "responses" | "schemas"): OpenApiSchema {
  const reference = value.$ref;
  if (typeof reference !== "string") return value;
  const expectedPrefix = `#/components/${collection}/`;
  assert.ok(reference.startsWith(expectedPrefix), `expected ${collection} reference, got ${reference}`);
  return record(record(record(document.components, "components")[collection], `components.${collection}`)[reference.slice(expectedPrefix.length)], reference);
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} is an object`);
  return value as Record<string, unknown>;
}

const RESOURCES = ["search", "document", "identity", "financial", "model"] as const;
const CANDIDATE_STATES = ["unresolved_identity", "discovered", "not_selected", "researching", "shortlisted", "eligible_not_shortlisted", "excluded", "needs_evidence", "research_error"] as const;
const DECISION_STATES = ["excluded", "needs_evidence", "eligible_not_shortlisted"] as const;
const RUN_STATUSES = ["queued", "running", "completed", "partial", "failed", "cancelled"] as const;
const RUN_STAGES = ["queued", "discovery", "research", "finalization"] as const;
const EVENT_KINDS = ["search_completed", "lead_resolved", "document_acquired", "criterion_assessed", "skeptic_completed", "budget_exhausted", "run_resumed", "run_finalized"] as const;
const DISCOVERY_ERROR_CODES = ["validation", "not_found", "stale_brief", "active_run", "request_conflict", "draft_rate_limit", "unavailable", "budget_exhausted", "deadline_exceeded", "lease_lost", "cancelled", "operation_in_progress"] as const;

type ResponseSchemaSemantic = Readonly<Record<string, unknown>>;

const PRIMITIVE_SCHEMA_TYPES = new Set(["string", "integer", "number", "boolean"]);
const RESPONSE_SEMANTIC_KEYS = [
  "type", "format", "enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern",
] as const;

const DISCOVERY_RESPONSE_SEMANTIC_MANIFEST: Readonly<Record<string, ResponseSchemaSemantic>> = {
  "#/components/schemas/DiscoveryBrief.market": { type: "string", const: "us_listed" },
  "#/components/schemas/DiscoveryBrief.schema_version": { type: "integer", const: 1 },
  "#/components/schemas/DiscoveryCandidate.mechanism_ids.items": { type: "string", format: "uuid" },
  "#/components/schemas/DiscoveryCandidate.origins.items": { type: "string", enum: ["seed", "existing", "web"] },
  "#/components/schemas/DiscoveryCandidate.reason_codes.items": { type: "string" },
  "#/components/schemas/DiscoveryCandidate.state": { type: "string", enum: CANDIDATE_STATES },
  "#/components/schemas/DiscoveryCandidateDecision.reason_codes.items": { type: "string" },
  "#/components/schemas/DiscoveryCandidateDecision.state": { type: "string", enum: DECISION_STATES },
  "#/components/schemas/DiscoveryCandidateDecision.unresolved_questions.items": { type: "string" },
  "#/components/schemas/DiscoveryCitation.kind": { type: "string", enum: ["claim", "fact"] },
  "#/components/schemas/DiscoveryCompanyIdentity.asset_type": { type: "string", enum: ["common_stock", "adr"] },
  "#/components/schemas/DiscoveryCompanyIdentity.identity_source_ids.items": { type: "string", format: "uuid" },
  "#/components/schemas/DiscoveryCost.status": { type: "string", const: "unavailable" },
  "#/components/schemas/DiscoveryCriterion.importance": { type: "string", enum: ["must", "prefer"] },
  "#/components/schemas/DiscoveryCriterionOutcome.outcome": { type: "string", enum: ["pass", "fail", "unknown"] },
  "#/components/schemas/DiscoveryDimension.level": { type: "string", enum: ["strong", "mixed", "weak", "unknown"] },
  "#/components/schemas/DiscoveryErrorCode": { type: "string", enum: DISCOVERY_ERROR_CODES },
  "#/components/schemas/DiscoveryEvent.kind": { type: "string", enum: EVENT_KINDS },
  "#/components/schemas/DiscoveryEvent.stage": { type: "string", enum: RUN_STAGES },
  "#/components/schemas/DiscoveryExclusionList.items": { type: "string", minLength: 1, maxLength: 300 },
  "#/components/schemas/DiscoveryMechanism.chain.items": { type: "string", minLength: 1, maxLength: 300 },
  "#/components/schemas/DiscoveryMetricCheck.operator": { type: "string", enum: ["gte", "lte"] },
  "#/components/schemas/DiscoveryMetricCheck.period_kind": { type: "string", enum: ["point", "fiscal_q", "fiscal_y", "ttm"] },
  "#/components/schemas/DiscoveryModelConfig.role": { type: "string", enum: ["planner", "scout", "analyst", "skeptic", "summary"] },
  "#/components/schemas/DiscoveryPreferenceList.items": { type: "string", minLength: 1, maxLength: 300 },
  "#/components/schemas/DiscoveryReadiness.missing.items": { type: "string", enum: ["model", "search", "reference"] },
  "#/components/schemas/DiscoveryRun.status": { type: "string", enum: RUN_STATUSES },
  "#/components/schemas/DiscoveryRun.stage": { type: "string", enum: RUN_STAGES },
  "#/components/schemas/DiscoveryRunView.status": { type: "string", enum: RUN_STATUSES },
  "#/components/schemas/DiscoveryRunView.stage": { type: "string", enum: RUN_STAGES },
  "#/components/schemas/DiscoverySeedQueryList.items": { type: "string", minLength: 1, maxLength: 200 },
};

type QuerySchemaExpectation = Readonly<{
  type: "string" | "integer";
  minimum?: number;
  maximum?: number;
  default?: number;
  enum?: readonly string[];
}>;

type PropertyKind = "array" | "boolean" | "integer" | "number" | "string" | `array:${string}` | `nullable:${"integer" | "string"}` | `nullable-ref:${string}` | `ref:${string}`;
type PropertyContract = readonly [component: string, property: string, kind: PropertyKind];

function fields(component: string, kind: PropertyKind, names: readonly string[]): readonly PropertyContract[] {
  return names.map((name) => [component, name, kind] as const);
}

const DISCOVERY_PROPERTY_KINDS: readonly PropertyContract[] = [
  ...fields("DiscoveryAuthenticationError", "string", ["error"]),
  ...fields("DiscoveryError", "string", ["error"]), ["DiscoveryError", "code", "ref:DiscoveryErrorCode"],
  ...fields("DiscoveryMetricOption", "string", ["metric_key", "display_name", "unit_class", "aggregation", "interpretation", "canonical_source_class"]),
  ...fields("DiscoveryCampaign", "string", ["campaign_id", "user_id", "name", "question", "created_at", "updated_at"]),
  ["DiscoveryCampaign", "current_brief_version", "integer"], ["DiscoveryCampaign", "archived_at", "nullable:string"],
  ["DiscoveryCampaignPage", "items", "array:DiscoveryCampaign"], ["DiscoveryCampaignPage", "next_cursor", "nullable:string"],
  ...fields("DiscoveryBrief", "integer", ["schema_version", "horizon_months", "lookback_months"]),
  ...fields("DiscoveryBrief", "string", ["question", "market"]),
  ["DiscoveryBrief", "mechanisms", "ref:DiscoveryMechanismList"], ["DiscoveryBrief", "criteria", "ref:DiscoveryCriterionList"],
  ["DiscoveryBrief", "seed_queries", "ref:DiscoverySeedQueryList"], ["DiscoveryBrief", "exclusions", "ref:DiscoveryExclusionList"],
  ["DiscoveryBrief", "preferences", "ref:DiscoveryPreferenceList"], ["DiscoveryBrief", "queries", "ref:DiscoveryBriefQueryList"],
  ...fields("DiscoveryMechanism", "string", ["mechanism_id", "label"]), ["DiscoveryMechanism", "chain", "array"],
  ...fields("DiscoveryMetricCheck", "string", ["metric_key", "unit", "period_kind", "operator"]),
  ["DiscoveryMetricCheck", "threshold", "number"], ["DiscoveryMetricCheck", "max_age_days", "integer"],
  ...fields("DiscoveryCriterion", "string", ["criterion_id", "importance", "statement", "falsifier"]), ["DiscoveryCriterion", "metric", "ref:DiscoveryMetricCheck"],
  ...fields("DiscoveryBriefQuery", "string", ["mechanism_id", "query"]),
  ...fields("DiscoverySavedBrief", "string", ["brief_id", "campaign_id", "hash", "created_at"]),
  ["DiscoverySavedBrief", "version", "integer"], ["DiscoverySavedBrief", "brief", "ref:DiscoveryBrief"], ["DiscoverySavedBrief", "approved_at", "nullable:string"],
  ...fields("DiscoveryModelConfig", "string", ["role", "provider", "model", "as_of"]), ["DiscoveryModelConfig", "max_output_tokens", "integer"],
  ...fields("DiscoveryLimits", "integer", ["candidates", "research", "shortlist", "input_chars", "output_tokens", "request_timeout_ms", "run_timeout_ms"]),
  ["DiscoveryLimits", "attempts", "ref:DiscoveryAttemptLimits"],
  ...fields("DiscoveryCoverageMechanism", "string", ["mechanism_id"]), ...fields("DiscoveryCoverageMechanism", "integer", ["discovered", "selected", "assessed"]),
  ...fields("DiscoveryCoverageGap", "string", ["code", "detail"]), ["DiscoveryCoverageGap", "candidate_id", "nullable:string"],
  ...fields("DiscoveryCoverage", "integer", ["searches_planned", "searches_completed", "hits_truncated", "leads_overflow", "extraction_batches_skipped", "unresolved", "discovered", "selected", "assessed", "not_selected"]),
  ["DiscoveryCoverage", "mechanisms", "array:DiscoveryCoverageMechanism"], ["DiscoveryCoverage", "gaps", "array:DiscoveryCoverageGap"],
  ...fields("DiscoveryRun", "string", ["run_id", "campaign_id", "brief_id", "user_id", "status", "stage", "policy_version", "request_key"]),
  ["DiscoveryRun", "model_config", "array:DiscoveryModelConfig"], ["DiscoveryRun", "limits", "ref:DiscoveryLimits"], ["DiscoveryRun", "usage", "ref:DiscoveryUsage"], ["DiscoveryRun", "coverage", "ref:DiscoveryCoverage"],
  ...fields("DiscoveryRun", "nullable:string", ["started_at", "finished_at", "cancel_requested_at"]),
  ["DiscoveryRunPage", "items", "array:DiscoveryRun"], ["DiscoveryRunPage", "next_cursor", "nullable:string"],
  ...fields("DiscoveryRunView", "string", ["run_id", "campaign_id", "brief_id", "user_id", "status", "stage", "policy_version", "request_key"]),
  ["DiscoveryRunView", "model_config", "array:DiscoveryModelConfig"], ["DiscoveryRunView", "limits", "ref:DiscoveryLimits"], ["DiscoveryRunView", "usage", "ref:DiscoveryUsage"], ["DiscoveryRunView", "coverage", "ref:DiscoveryCoverage"],
  ...fields("DiscoveryRunView", "nullable:string", ["started_at", "finished_at", "cancel_requested_at"]), ["DiscoveryRunView", "shortlist", "array:DiscoveryCandidate"], ["DiscoveryRunView", "cost", "ref:DiscoveryCost"], ["DiscoveryRunView", "worker_waiting", "boolean"],
  ["DiscoveryCost", "status", "string"], ["DiscoveryReadiness", "ready", "boolean"], ["DiscoveryReadiness", "missing", "array"],
  ["DiscoveryCampaignDetail", "campaign", "ref:DiscoveryCampaign"], ["DiscoveryCampaignDetail", "brief", "nullable-ref:DiscoverySavedBrief"], ["DiscoveryCampaignDetail", "latest_run", "nullable-ref:DiscoveryRun"], ["DiscoveryCampaignDetail", "readiness", "ref:DiscoveryReadiness"],
  ["DiscoveryDraft", "brief", "ref:DiscoveryBrief"], ["DiscoveryDraft", "base_version", "integer"],
  ...fields("DiscoveryCitation", "string", ["kind", "id"]),
  ["DiscoverySourceView", "citation", "ref:DiscoveryCitation"], ...fields("DiscoverySourceView", "string", ["title", "url", "retrieved_at"]), ["DiscoverySourceView", "published_at", "nullable:string"],
  ...fields("DiscoveryCandidate", "string", ["candidate_id", "name", "state"]), ["DiscoveryCandidate", "identity", "nullable-ref:DiscoveryCompanyIdentity"], ["DiscoveryCandidate", "rank", "nullable:integer"], ["DiscoveryCandidate", "snapshot_id", "nullable:string"], ["DiscoveryCandidate", "evidence_available", "boolean"], ["DiscoveryCandidate", "can_promote", "boolean"], ["DiscoveryCandidate", "assessment", "nullable-ref:DiscoveryCandidateDecision"], ["DiscoveryCandidate", "sources", "array:DiscoverySourceView"], ["DiscoveryCandidate", "origins", "array"], ["DiscoveryCandidate", "mechanism_ids", "array"], ["DiscoveryCandidate", "reason_codes", "array"],
  ...fields("DiscoveryCompanyIdentity", "string", ["issuer_id", "listing_id", "legal_name", "ticker", "mic", "currency", "asset_type"]), ["DiscoveryCompanyIdentity", "identity_source_ids", "array"],
  ...fields("DiscoveryDimension", "string", ["level", "explanation"]), ["DiscoveryDimension", "citations", "array:DiscoveryCitation"],
  ...fields("DiscoveryDimensions", "ref:DiscoveryDimension", ["theme_exposure", "evidence_strength", "business_quality", "valuation_context"]),
  ...fields("DiscoveryCriterionOutcome", "string", ["criterion_id", "outcome", "explanation"]), ["DiscoveryCriterionOutcome", "citations", "array:DiscoveryCitation"],
  ["DiscoveryCounterargument", "text", "string"], ["DiscoveryCounterargument", "citations", "array:DiscoveryCitation"],
  ["DiscoveryCandidateDecision", "candidate_id", "string"], ["DiscoveryCandidateDecision", "identity", "ref:DiscoveryCompanyIdentity"], ["DiscoveryCandidateDecision", "state", "string"], ["DiscoveryCandidateDecision", "dimensions", "ref:DiscoveryDimensions"], ["DiscoveryCandidateDecision", "criteria", "array:DiscoveryCriterionOutcome"], ["DiscoveryCandidateDecision", "counterarguments", "array:DiscoveryCounterargument"], ["DiscoveryCandidateDecision", "unresolved_questions", "array"], ["DiscoveryCandidateDecision", "next_action", "string"], ["DiscoveryCandidateDecision", "reason_codes", "array"],
  ["DiscoveryCandidatePage", "items", "array:DiscoveryCandidate"], ["DiscoveryCandidatePage", "next_cursor", "nullable:string"],
  ...fields("DiscoveryEvent", "string", ["run_id", "stage", "kind", "summary", "created_at"]), ["DiscoveryEvent", "sequence", "integer"], ["DiscoveryEvent", "candidate_id", "nullable:string"], ["DiscoveryEvent", "citations", "array:DiscoveryCitation"],
  ["DiscoveryEventPage", "items", "array:DiscoveryEvent"], ["DiscoveryEventPage", "next_sequence", "integer"], ["DiscoveryEventPage", "has_more", "boolean"],
];

const DISCOVERY_ARRAY_SCHEMA_KINDS: ReadonlyArray<readonly [component: string, itemDto: string | null]> = [
  ["DiscoveryMechanismList", "DiscoveryMechanism"], ["DiscoveryCriterionList", "DiscoveryCriterion"], ["DiscoveryBriefQueryList", "DiscoveryBriefQuery"],
  ["DiscoverySeedQueryList", null], ["DiscoveryExclusionList", null], ["DiscoveryPreferenceList", null],
];

function operationAt(document: OpenApiDocument, method: string, path: string): OpenApiSchema {
  return record(record(record(document.paths, "paths")[path], `paths.${path}`)[method], `${method.toUpperCase()} ${path}`);
}

function assertOperationResponses(document: OpenApiDocument, method: string, path: string, expected: Readonly<Record<string, string>>): void {
  const responses = record(operationAt(document, method, path).responses, `${method.toUpperCase()} ${path}.responses`);
  assert.deepEqual(Object.keys(responses).sort(), Object.keys(expected).sort(), `${method.toUpperCase()} ${path} documents every handler status`);
  for (const [status, response] of Object.entries(expected)) {
    assert.equal(record(responses[status], `${method.toUpperCase()} ${path} ${status}`).$ref, `#/components/responses/${response}`, `${method.toUpperCase()} ${path} ${status} has its status-specific response`);
  }
}

function assertQueryParameters(document: OpenApiDocument, method: string, path: string, expected: Readonly<Record<string, QuerySchemaExpectation>>): void {
  const pathItem = record(record(document.paths, "paths")[path], `paths.${path}`);
  const operation = operationAt(document, method, path);
  const parameters = [...parameterList(document, pathItem.parameters), ...parameterList(document, operation.parameters)];
  const queryParameters = new Map(parameters.filter((parameter) => parameter.in === "query").map((parameter) => [parameter.name, parameter]));
  assert.deepEqual([...queryParameters.keys()].sort(), Object.keys(expected).sort(), `${method.toUpperCase()} ${path} documents every query parser input`);
  for (const [name, contract] of Object.entries(expected)) {
    const schema = record(queryParameters.get(name)?.schema, `${method.toUpperCase()} ${path} ${name}.schema`);
    assert.equal(schema.type, contract.type, `${method.toUpperCase()} ${path} ${name} type`);
    for (const key of ["minimum", "maximum", "default"] as const) {
      if (contract[key] !== undefined) assert.equal(schema[key], contract[key], `${method.toUpperCase()} ${path} ${name} ${key}`);
    }
    if (contract.enum !== undefined) assertExactEnum(schema, contract.enum, `${method.toUpperCase()} ${path} ${name}`);
  }
}

function parameterList(document: OpenApiDocument, value: unknown): OpenApiSchema[] {
  if (value === undefined) return [];
  assert.ok(Array.isArray(value), "parameters are an array");
  return value.map((parameter, index) => {
    const raw = record(parameter, `parameters[${index}]`);
    return typeof raw.$ref === "string" ? resolveComponent(document, raw, "parameters") : raw;
  });
}

function responseContentSchema(document: OpenApiDocument, responseName: string): OpenApiSchema {
  const response = record(record(record(document.components, "components").responses, "components.responses")[responseName], `components.responses.${responseName}`);
  return record(record(record(response.content, `components.responses.${responseName}.content`)["application/json"], `components.responses.${responseName}.application/json`).schema, `components.responses.${responseName}.schema`);
}

function assertResponseSchemaReference(document: OpenApiDocument, responseName: string, schemaName: string): void {
  assert.equal(responseContentSchema(document, responseName).$ref, `#/components/schemas/${schemaName}`, `${responseName} has its browser-safe DTO reference`);
}

function assertNoContentResponse(document: OpenApiDocument, responseName: string): void {
  const response = record(record(record(document.components, "components").responses, "components.responses")[responseName], `components.responses.${responseName}`);
  assert.equal(response.content, undefined, `${responseName} has no response body`);
}

function assertMetricOptionsWrapper(document: OpenApiDocument): void {
  const schema = responseContentSchema(document, "DiscoveryMetricOptionsResponse");
  assert.equal(schema.type, "object", "metric options wrapper is an object");
  assert.equal(schema.additionalProperties, false, "metric options wrapper is closed");
  assert.deepEqual(schema.required, ["items"], "metric options wrapper requires items");
  const items = record(record(schema.properties, "DiscoveryMetricOptionsResponse.properties").items, "DiscoveryMetricOptionsResponse.items");
  assert.equal(items.type, "array", "metric options items is an array");
  assert.equal(record(items.items, "DiscoveryMetricOptionsResponse.items.items").$ref, "#/components/schemas/DiscoveryMetricOption", "metric options items reference the metric DTO");
}

function assertClosedRequiredObject(document: OpenApiDocument, component: string, required: readonly string[]): void {
  const schema = componentSchema(document, component);
  assert.equal(schema.type, "object", `${component} is an object`);
  assert.equal(schema.additionalProperties, false, `${component} is closed`);
  assert.deepEqual(schema.required, required, `${component} has exact required fields`);
}

function schemaProperty(document: OpenApiDocument, component: string, property: string): OpenApiSchema {
  return record(record(componentSchema(document, component).properties, `${component}.properties`)[property], `${component}.${property}`);
}

function assertPropertyKind(document: OpenApiDocument, component: string, property: string, kind: PropertyKind): void {
  const schema = schemaProperty(document, component, property);
  if (kind.startsWith("ref:")) {
    assert.equal(schema.$ref, `#/components/schemas/${kind.slice("ref:".length)}`, `${component}.${property} DTO reference`);
    return;
  }
  if (kind.startsWith("array:")) {
    assert.equal(schema.type, "array", `${component}.${property} is an array`);
    assert.equal(record(schema.items, `${component}.${property}.items`).$ref, `#/components/schemas/${kind.slice("array:".length)}`, `${component}.${property} array item DTO`);
    return;
  }
  if (kind.startsWith("nullable-ref:")) {
    assert.deepEqual(schema.anyOf, [{ $ref: `#/components/schemas/${kind.slice("nullable-ref:".length)}` }, { type: "null" }], `${component}.${property} is its nullable DTO union`);
    return;
  }
  if (kind.startsWith("nullable:")) {
    assert.deepEqual(schema.type, [kind.slice("nullable:".length), "null"], `${component}.${property} is nullable`);
    return;
  }
  assert.equal(schema.type, kind, `${component}.${property} primitive type`);
}

function assertArraySchemaKind(document: OpenApiDocument, component: string, target: string | null): void {
  const schema = componentSchema(document, component);
  assert.equal(schema.type, "array", `${component} is an array schema`);
  const items = record(schema.items, `${component}.items`);
  if (target === null) assert.equal(items.type, "string", `${component} has string items`);
  else assert.equal(items.$ref, `#/components/schemas/${target}`, `${component} item DTO`);
}

function assertPropertyReference(document: OpenApiDocument, component: string, property: string, target: string): void {
  assert.equal(schemaProperty(document, component, property).$ref, `#/components/schemas/${target}`, `${component}.${property} references ${target}`);
}

function assertPropertyEnum(document: OpenApiDocument, component: string, property: string, expected: readonly string[]): void {
  assertExactEnum(schemaProperty(document, component, property), expected, `${component}.${property}`);
}

function assertExactEnum(schema: OpenApiSchema, expected: readonly string[], label: string): void {
  assert.equal(schema.type, "string", `${label} is a string enum`);
  assert.deepEqual(schema.enum, expected, `${label} has its exact runtime values`);
}

function assertArrayPropertyReference(document: OpenApiDocument, component: string, property: string, target: string): void {
  const schema = schemaProperty(document, component, property);
  assert.equal(schema.type, "array", `${component}.${property} is an array`);
  assert.equal(record(schema.items, `${component}.${property}.items`).$ref, `#/components/schemas/${target}`, `${component}.${property} item DTO`);
}

function assertNullableType(document: OpenApiDocument, component: string, property: string, type: string): void {
  assert.deepEqual(schemaProperty(document, component, property).type, [type, "null"], `${component}.${property} is nullable ${type}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function openApiRouteMethods(spec: string, route: string): ReadonlySet<string> {
  return new Set(
    [...openApiRouteSection(spec, route).matchAll(/^    (get|post|patch|delete|put):$/gm)].map((match) => match[1]),
  );
}

function openApiRouteSection(spec: string, route: string): string {
  const routeHeader = `  ${route}:`;
  const start = spec.indexOf(routeHeader);
  if (start === -1) return "";

  const nextRoute = spec.slice(start + routeHeader.length).search(/\n  \/v1\//);
  return spec.slice(start, nextRoute === -1 ? spec.length : start + routeHeader.length + nextRoute);
}

function openApiOperationSection(spec: string, route: string, method: string): string {
  const routeSection = openApiRouteSection(spec, route);
  const start = routeSection.indexOf(`    ${method}:`);
  if (start === -1) return "";
  const following = routeSection.slice(start + `    ${method}:`.length);
  const next = following.search(/\n    (?:get|post|put|patch|delete):/);
  return routeSection.slice(start, next === -1 ? routeSection.length : start + `    ${method}:`.length + next);
}

function componentSchemaSection(spec: string, name: string): string {
  const start = spec.indexOf(`    ${name}:`);
  if (start === -1) return "";
  const following = spec.slice(start + name.length + 5);
  const next = following.search(/\n    [A-Za-z][A-Za-z0-9]+:/);
  return spec.slice(start, next === -1 ? spec.length : start + name.length + 5 + next);
}
