import { createServer, type Server, type ServerResponse } from "node:http";
import {
  isAvailable,
  unavailable,
  type FundamentalsOutcome,
  type UnavailableEnvelope,
} from "./availability.ts";
import { issuerProfile, type IssuerProfile } from "./profile.ts";
import {
  IssuerNotFoundError,
  type IssuerProfileRepository,
} from "./issuer-repository.ts";
import type { IssuerSubjectRef, UUID } from "./subject-ref.ts";
import { isUuidV4 } from "./validators.ts";

export type FundamentalsServerDeps = {
  profiles: IssuerProfileRepository;
  // Source UUID attributed to profile envelopes the repository hands back.
  // The repo stores `IssuerProfileRecord` (no source_id); the HTTP layer
  // tags each envelope with this dependency so swapping data sources
  // (operator-curated DB now, eventual provider-fed sources table later)
  // doesn't require changing the wire shape.
  source_id: UUID;
  // Optional clock used for envelope `as_of`. Defaults to wall-clock; tests
  // pin a fixed clock for deterministic envelopes.
  clock?: () => Date;
};

// Wire shape for /v1/fundamentals/profile. Wrapping in `{ profile: ... }`
// (rather than spreading IssuerProfile flat) leaves room to add envelope-
// level fields (warnings, partial-coverage notes) without breaking clients.
export type GetProfileResponse = {
  profile: IssuerProfile;
};

export function createFundamentalsServer(deps: FundamentalsServerDeps): Server {
  const clock = deps.clock ?? (() => new Date());

  return createServer(async (req, res) => {
    try {
      const route = matchRoute(req.method ?? "GET", req.url ?? "/");
      if (!route) {
        respond(res, 404, { error: "not found" });
        return;
      }

      switch (route.action) {
        case "healthz":
          respond(res, 200, { status: "ok", service: "fundamentals" });
          return;
        case "get_profile": {
          const subject: IssuerSubjectRef = { kind: "issuer", id: route.subject_id };
          const outcome = await fetchProfileOutcome(deps, clock, subject);
          if (!isAvailable(outcome)) {
            respond(res, statusForUnavailable(outcome), {
              error: "fundamentals profile unavailable",
              unavailable: outcome,
            });
            return;
          }
          const response: GetProfileResponse = { profile: outcome.data };
          respond(res, 200, response);
          return;
        }
        default: {
          // Exhaustiveness: adding a Route variant without a handler is a
          // compile-time error here, not a silent hang at runtime.
          const _exhaustive: never = route;
          void _exhaustive;
          respond(res, 500, { error: "unhandled route" });
          return;
        }
      }
    } catch (error) {
      if (error instanceof IssuerNotFoundError) {
        if (!res.headersSent) respond(res, 404, { error: error.message });
        return;
      }
      console.error("fundamentals request failed", error);
      if (!res.headersSent) {
        respond(res, 502, { error: "upstream fundamentals data unavailable" });
      }
    }
  });
}

type Route =
  | { action: "healthz" }
  | { action: "get_profile"; subject_id: string };

function matchRoute(method: string, rawUrl: string): Route | null {
  const url = new URL(rawUrl, "http://localhost");
  const { pathname, searchParams } = url;

  if (method === "GET" && pathname === "/healthz") return { action: "healthz" };

  if (method === "GET" && pathname === "/v1/fundamentals/profile") {
    const subjectKind = searchParams.get("subject_kind");
    const subjectId = searchParams.get("subject_id");
    if (subjectKind !== "issuer") return null;
    if (!isUuidV4(subjectId)) return null;
    return { action: "get_profile", subject_id: subjectId };
  }

  return null;
}

// Promotes a repository lookup into a FundamentalsOutcome. A missing record
// becomes a missing_coverage envelope (mirror of services/market's
// listing-not-found path) so consumers see the same shape whether the
// failure is "no row in DB" or "provider gave up".
async function fetchProfileOutcome(
  deps: FundamentalsServerDeps,
  clock: () => Date,
  subject: IssuerSubjectRef,
): Promise<FundamentalsOutcome<IssuerProfile>> {
  const record = await deps.profiles.find(subject.id);
  const as_of = clock().toISOString();
  if (!record) {
    return unavailable({
      reason: "missing_coverage",
      subject,
      source_id: deps.source_id,
      as_of,
      retryable: false,
      detail: `issuer not found: ${subject.id}`,
    });
  }
  // record.subject already matches `subject` (we found it by subject.id), but
  // explicit override keeps the wire `subject` field bound to the request,
  // not whatever shape the storage record happened to carry.
  const profile = issuerProfile({
    ...record,
    subject,
    as_of,
    source_id: deps.source_id,
  });
  return { outcome: "available", data: profile };
}

function statusForUnavailable(unavailable: UnavailableEnvelope): number {
  switch (unavailable.reason) {
    case "missing_coverage":
      return 404;
    case "rate_limited":
      return 429;
    case "provider_error":
      return 502;
    case "stale_data":
      return 503;
  }
}

function respond(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
