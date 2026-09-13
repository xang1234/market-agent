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

function resolveComponent(document: OpenApiDocument, value: OpenApiSchema, collection: "responses" | "schemas"): OpenApiSchema {
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
