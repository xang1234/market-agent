import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

const REPO_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const OPENAPI_PATH = join(REPO_ROOT, "spec", "finance_research_openapi.yaml");

const FRONTEND_V1_ROUTES = [
  "/v1/agents",
  "/v1/agents/{agentId}",
  "/v1/agents/{agentId}/runs",
  "/v1/analyze/runs",
  "/v1/analyze/runs/{runId}/share-to-chat",
  "/v1/analyze/templates",
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
