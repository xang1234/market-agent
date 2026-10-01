import assert from "node:assert/strict";
import test from "node:test";

import viteConfig from "../../../web/vite.config.ts";
import { isApiPath, routeFor } from "../src/routes.ts";

test("every /v1 path is an API path, registered prefix or not (never the SPA's HTML)", () => {
  assert.equal(isApiPath("/v1/chat/threads"), true);
  assert.equal(isApiPath("/v1/settings"), true, "a prefix not in the route table yet");
  assert.equal(isApiPath("/v1"), true);
  assert.equal(isApiPath("/chat"), false);
  assert.equal(isApiPath("/v1x/thing"), false);
  assert.equal(isApiPath("/src/main.tsx"), false);
});

test("every prefix the Vite dev proxy knows is either served in-process or parked", () => {
  const prefixes = Object.keys(viteConfig.server?.proxy ?? {});
  assert.ok(prefixes.length > 0);
  for (const prefix of prefixes) {
    assert.notEqual(routeFor(`${prefix}/x`).kind, "web", `${prefix} would fall through to the SPA`);
  }
});

test("routeFor sends chat-profile prefixes to their service", () => {
  assert.deepEqual(routeFor("/v1/chat/threads"), { kind: "service", service: "chat" });
  assert.deepEqual(routeFor("/v1/run-activities/stream"), { kind: "service", service: "chat" });
  assert.deepEqual(routeFor("/v1/subjects/search"), { kind: "service", service: "resolver" });
  assert.deepEqual(routeFor("/v1/dev/llm-settings"), { kind: "service", service: "dev-api" });
  assert.deepEqual(routeFor("/v1/market/quotes"), { kind: "service", service: "market" });
  assert.deepEqual(routeFor("/v1/fundamentals/profile"), { kind: "service", service: "fundamentals" });
});

test("routeFor prefers the longest prefix: evidence inspect is dev-api, the rest is parked", () => {
  assert.deepEqual(routeFor("/v1/evidence/inspect"), { kind: "service", service: "dev-api" });
  assert.deepEqual(routeFor("/v1/evidence/fact-review-queue"), { kind: "parked", prefix: "/v1/evidence" });
});

test("routeFor parks services outside the chat profile and leaves the rest to the web app", () => {
  assert.deepEqual(routeFor("/v1/watchlists/default/members"), { kind: "parked", prefix: "/v1/watchlists" });
  assert.deepEqual(routeFor("/chat"), { kind: "web" });
  assert.deepEqual(routeFor("/src/main.tsx"), { kind: "web" });
  // Whole path segments only: /v1/chatter is not /v1/chat.
  assert.deepEqual(routeFor("/v1/chatter"), { kind: "web" });
});
