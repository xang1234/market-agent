// URL routing for the one-process chat-profile dev app (#122). Mirrors the prefixes of
// web/vite.config.ts's dev proxy (test/routes.test.ts keeps them in step): chat-profile
// services are served in-process; the rest are parked (#117) and answer 503 rather than
// falling through to the SPA's index.html.

export type DevService = "chat" | "resolver" | "dev-api" | "market" | "fundamentals";

export type Route =
  | { kind: "service"; service: DevService }
  | { kind: "parked"; prefix: string }
  | { kind: "web" };

const SERVED: Record<string, DevService> = {
  "/v1/subjects": "resolver",
  "/v1/chat": "chat",
  "/v1/run-activities": "chat",
  "/v1/analyze": "dev-api",
  "/v1/agents": "dev-api",
  "/v1/dev": "dev-api",
  "/v1/themes": "dev-api",
  "/v1/evidence/inspect": "dev-api",
  "/v1/market": "market",
  "/v1/fundamentals": "fundamentals",
};

const PARKED = [
  "/v1/watchlists",
  "/v1/screener",
  "/v1/portfolios",
  "/v1/home",
  "/v1/evidence",
  "/v1/analyst-grids",
];

// Longest prefix first, so /v1/evidence/inspect (served) beats /v1/evidence (parked).
const PREFIXES = [...Object.keys(SERVED), ...PARKED].sort((a, b) => b.length - a.length);

export function routeFor(pathname: string): Route {
  // Whole path segments only: /v1/chatter is not /v1/chat.
  const prefix = PREFIXES.find((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (prefix === undefined) return { kind: "web" };
  const service = SERVED[prefix];
  return service ? { kind: "service", service } : { kind: "parked", prefix };
}
