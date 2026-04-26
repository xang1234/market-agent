import { createServer, type Server, type ServerResponse } from "node:http";
import {
  isAvailable,
  unavailable,
  type FundamentalsOutcome,
  type UnavailableEnvelope,
} from "./availability.ts";
import { buildKeyStats, type KeyStatsEnvelope } from "./key-stats.ts";
import type { IssuerProfile } from "./profile.ts";
import type { IssuerProfileRepository } from "./issuer-repository.ts";
import type { StatsRepository } from "./stats-repository.ts";
import type { IssuerSubjectRef, UUID } from "./subject-ref.ts";
import { isUuidV4 } from "./validators.ts";

export type FundamentalsServerDeps = {
  profiles: IssuerProfileRepository;
  stats: StatsRepository;
  source_id: UUID;
  clock?: () => Date;
};

export type GetProfileResponse = {
  profile: IssuerProfile;
};

export type GetStatsResponse = {
  stats: KeyStatsEnvelope;
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
          const outcome = await fetchProfileOutcome(deps, clock, route.subject_id);
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
        case "get_stats": {
          const outcome = await fetchStatsOutcome(deps, clock, route.subject_id);
          if (!isAvailable(outcome)) {
            respond(res, statusForUnavailable(outcome), {
              error: "fundamentals stats unavailable",
              unavailable: outcome,
            });
            return;
          }
          const response: GetStatsResponse = { stats: outcome.data };
          respond(res, 200, response);
          return;
        }
        default: {
          const _exhaustive: never = route;
          void _exhaustive;
          respond(res, 500, { error: "unhandled route" });
          return;
        }
      }
    } catch (error) {
      console.error("fundamentals request failed", error);
      if (!res.headersSent) {
        respond(res, 502, { error: "upstream fundamentals data unavailable" });
      }
    }
  });
}

type Route =
  | { action: "healthz" }
  | { action: "get_profile"; subject_id: string }
  | { action: "get_stats"; subject_id: string };

function matchRoute(method: string, rawUrl: string): Route | null {
  const url = new URL(rawUrl, "http://localhost");
  const { pathname, searchParams } = url;

  if (method === "GET" && pathname === "/healthz") return { action: "healthz" };

  if (method === "GET" && pathname === "/v1/fundamentals/profile") {
    const subjectId = issuerSubjectIdFromQuery(searchParams);
    return subjectId === null ? null : { action: "get_profile", subject_id: subjectId };
  }

  if (method === "GET" && pathname === "/v1/fundamentals/stats") {
    const subjectId = issuerSubjectIdFromQuery(searchParams);
    return subjectId === null ? null : { action: "get_stats", subject_id: subjectId };
  }

  return null;
}

function issuerSubjectIdFromQuery(searchParams: URLSearchParams): string | null {
  const subjectKind = searchParams.get("subject_kind");
  const subjectId = searchParams.get("subject_id");
  if (subjectKind !== "issuer") return null;
  if (!isUuidV4(subjectId)) return null;
  return subjectId;
}

async function fetchProfileOutcome(
  deps: FundamentalsServerDeps,
  clock: () => Date,
  subject_id: UUID,
): Promise<FundamentalsOutcome<IssuerProfile>> {
  const record = await deps.profiles.find(subject_id);
  const as_of = clock().toISOString();
  if (!record) {
    return missingCoverage(deps, subject_id, as_of, `issuer not found: ${subject_id}`);
  }
  const profile: IssuerProfile = Object.freeze({
    ...record,
    as_of,
    source_id: deps.source_id,
  });
  return { outcome: "available", data: profile };
}

async function fetchStatsOutcome(
  deps: FundamentalsServerDeps,
  clock: () => Date,
  subject_id: UUID,
): Promise<FundamentalsOutcome<KeyStatsEnvelope>> {
  const inputs = await deps.stats.findStatsInputs(subject_id);
  if (!inputs) {
    return missingCoverage(
      deps,
      subject_id,
      clock().toISOString(),
      `stats inputs not found for issuer: ${subject_id}`,
    );
  }
  // buildKeyStats freezes the envelope and threads coverage_warnings on
  // sparse inputs — the handler passes the result through as-is to keep
  // the derivation transparent (per the bead's contract).
  return { outcome: "available", data: buildKeyStats(inputs) };
}

function missingCoverage(
  deps: FundamentalsServerDeps,
  subject_id: UUID,
  as_of: string,
  detail: string,
): UnavailableEnvelope {
  const subject: IssuerSubjectRef = { kind: "issuer", id: subject_id };
  return unavailable({
    reason: "missing_coverage",
    subject,
    source_id: deps.source_id,
    as_of,
    retryable: false,
    detail,
  });
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
