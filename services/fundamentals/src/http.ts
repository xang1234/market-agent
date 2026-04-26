import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AnalystConsensusEnvelope } from "./analyst-consensus.ts";
import {
  isAvailable,
  unavailable,
  type FundamentalsOutcome,
  type UnavailableEnvelope,
} from "./availability.ts";
import type { ConsensusRepository } from "./consensus-repository.ts";
import type { EarningsEventsEnvelope } from "./earnings.ts";
import type { EarningsRepository } from "./earnings-repository.ts";
import type { KeyStatsEnvelope } from "./key-stats.ts";
import type { IssuerProfile } from "./profile.ts";
import type { IssuerProfileRepository } from "./issuer-repository.ts";
import {
  SEGMENT_AXES,
  type SegmentAxis,
  type SegmentFactsEnvelope,
} from "./segment-facts.ts";
import type { SegmentsRepository } from "./segments-repository.ts";
import {
  parsePeriod,
  type ParsedPeriod,
  type StatementRepository,
} from "./statement-repository.ts";
import {
  STATEMENT_BASES,
  STATEMENT_FAMILIES,
  type NormalizedStatement,
  type StatementBasis,
  type StatementFamily,
} from "./statement.ts";
import type { StatsRepository } from "./stats-repository.ts";
import type { IssuerSubjectRef, UUID } from "./subject-ref.ts";
import { isUuidV4 } from "./validators.ts";

export type FundamentalsServerDeps = {
  profiles: IssuerProfileRepository;
  stats: StatsRepository;
  statements: StatementRepository;
  segments: SegmentsRepository;
  consensus: ConsensusRepository;
  earnings: EarningsRepository;
  source_id: UUID;
  clock?: () => Date;
};

export type GetProfileResponse = {
  profile: IssuerProfile;
};

export type GetStatsResponse = {
  stats: KeyStatsEnvelope;
};

export type GetStatementsRequest = {
  subject_ref: IssuerSubjectRef;
  statement: StatementFamily;
  periods: string[];
  basis: StatementBasis;
};

export type StatementResultEntry = {
  period: string;
  outcome: FundamentalsOutcome<NormalizedStatement>;
};

export type GetStatementsResponse = {
  query: GetStatementsRequest;
  results: ReadonlyArray<StatementResultEntry>;
};

export type GetSegmentsRequest = {
  subject_ref: IssuerSubjectRef;
  axis: SegmentAxis;
  period: string;
  basis: StatementBasis;
};

export type GetSegmentsResponse = {
  segments: SegmentFactsEnvelope;
};

export type GetConsensusResponse = {
  consensus: AnalystConsensusEnvelope;
};

export type GetEarningsResponse = {
  earnings: EarningsEventsEnvelope;
};

const MAX_REQUEST_BODY_BYTES = 64 * 1024;

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
        case "get_statements": {
          const body = await readJsonBody(req, MAX_REQUEST_BODY_BYTES);
          if (body.kind === "error") {
            respond(res, body.status, { error: body.error });
            return;
          }
          const validated = validateStatementsRequest(body.value);
          if (validated.kind === "error") {
            respond(res, 400, { error: validated.error });
            return;
          }
          const response = await fetchStatementsResponse(deps, clock, validated.request, validated.parsedPeriods);
          respond(res, 200, response);
          return;
        }
        case "get_consensus": {
          const outcome = await fetchConsensusOutcome(deps, clock, route.subject_id);
          if (!isAvailable(outcome)) {
            respond(res, statusForUnavailable(outcome), {
              error: "fundamentals consensus unavailable",
              unavailable: outcome,
            });
            return;
          }
          const response: GetConsensusResponse = { consensus: outcome.data };
          respond(res, 200, response);
          return;
        }
        case "get_earnings": {
          const outcome = await fetchEarningsOutcome(deps, clock, route.subject_id);
          if (!isAvailable(outcome)) {
            respond(res, statusForUnavailable(outcome), {
              error: "fundamentals earnings unavailable",
              unavailable: outcome,
            });
            return;
          }
          const response: GetEarningsResponse = { earnings: outcome.data };
          respond(res, 200, response);
          return;
        }
        case "get_segments": {
          const body = await readJsonBody(req, MAX_REQUEST_BODY_BYTES);
          if (body.kind === "error") {
            respond(res, body.status, { error: body.error });
            return;
          }
          const validated = validateSegmentsRequest(body.value);
          if (validated.kind === "error") {
            respond(res, 400, { error: validated.error });
            return;
          }
          const outcome = await fetchSegmentsOutcome(deps, clock, validated.request, validated.parsedPeriod);
          if (!isAvailable(outcome)) {
            respond(res, statusForUnavailable(outcome), {
              error: "fundamentals segments unavailable",
              unavailable: outcome,
            });
            return;
          }
          const response: GetSegmentsResponse = { segments: outcome.data };
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
  | { action: "get_stats"; subject_id: string }
  | { action: "get_consensus"; subject_id: string }
  | { action: "get_earnings"; subject_id: string }
  | { action: "get_statements" }
  | { action: "get_segments" };

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

  if (method === "GET" && pathname === "/v1/fundamentals/consensus") {
    const subjectId = issuerSubjectIdFromQuery(searchParams);
    return subjectId === null ? null : { action: "get_consensus", subject_id: subjectId };
  }

  if (method === "GET" && pathname === "/v1/fundamentals/earnings") {
    const subjectId = issuerSubjectIdFromQuery(searchParams);
    return subjectId === null ? null : { action: "get_earnings", subject_id: subjectId };
  }

  if (method === "POST" && pathname === "/v1/fundamentals/statements") {
    return { action: "get_statements" };
  }

  if (method === "POST" && pathname === "/v1/fundamentals/segments") {
    return { action: "get_segments" };
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
  const envelope = await deps.stats.find(subject_id);
  if (!envelope) {
    return missingCoverage(
      deps,
      subject_id,
      clock().toISOString(),
      `stats not found for issuer: ${subject_id}`,
    );
  }
  return { outcome: "available", data: envelope };
}

async function fetchConsensusOutcome(
  deps: FundamentalsServerDeps,
  clock: () => Date,
  subject_id: UUID,
): Promise<FundamentalsOutcome<AnalystConsensusEnvelope>> {
  const envelope = await deps.consensus.find(subject_id);
  if (!envelope) {
    return missingCoverage(
      deps,
      subject_id,
      clock().toISOString(),
      `consensus not found for issuer: ${subject_id}`,
    );
  }
  return { outcome: "available", data: envelope };
}

async function fetchEarningsOutcome(
  deps: FundamentalsServerDeps,
  clock: () => Date,
  subject_id: UUID,
): Promise<FundamentalsOutcome<EarningsEventsEnvelope>> {
  const envelope = await deps.earnings.find(subject_id);
  if (!envelope) {
    return missingCoverage(
      deps,
      subject_id,
      clock().toISOString(),
      `earnings not found for issuer: ${subject_id}`,
    );
  }
  return { outcome: "available", data: envelope };
}

type ValidatedStatementsRequest =
  | {
      kind: "ok";
      request: GetStatementsRequest;
      parsedPeriods: ReadonlyArray<ParsedPeriod>;
    }
  | { kind: "error"; error: string };

function validateStatementsRequest(value: unknown): ValidatedStatementsRequest {
  const objectResult = validateRequestObject(value);
  if (objectResult.kind === "error") return objectResult;
  const body = objectResult.body;

  const subjectResult = validateIssuerSubjectRef(body.subject_ref);
  if (subjectResult.kind === "error") return subjectResult;

  const statement = body.statement;
  if (typeof statement !== "string" || !(STATEMENT_FAMILIES as ReadonlyArray<string>).includes(statement)) {
    return {
      kind: "error",
      error: `statement must be one of ${STATEMENT_FAMILIES.join(", ")}`,
    };
  }

  const basisResult = validateBasis(body.basis);
  if (basisResult.kind === "error") return basisResult;

  if (!Array.isArray(body.periods) || body.periods.length === 0) {
    return { kind: "error", error: "periods must be a non-empty array of strings" };
  }
  const parsedPeriods: ParsedPeriod[] = [];
  const seen = new Set<string>();
  for (const raw of body.periods) {
    const parsed = parsePeriod(raw);
    if (parsed.kind === "error") {
      return { kind: "error", error: parsed.reason };
    }
    if (seen.has(parsed.period.raw)) {
      return { kind: "error", error: `duplicate period "${parsed.period.raw}"` };
    }
    seen.add(parsed.period.raw);
    parsedPeriods.push(parsed.period);
  }

  return {
    kind: "ok",
    request: {
      subject_ref: { kind: "issuer", id: subjectResult.id },
      statement: statement as StatementFamily,
      periods: body.periods as string[],
      basis: basisResult.basis,
    },
    parsedPeriods,
  };
}

type ValidatedSegmentsRequest =
  | {
      kind: "ok";
      request: GetSegmentsRequest;
      parsedPeriod: ParsedPeriod;
    }
  | { kind: "error"; error: string };

function validateSegmentsRequest(value: unknown): ValidatedSegmentsRequest {
  const objectResult = validateRequestObject(value);
  if (objectResult.kind === "error") return objectResult;
  const body = objectResult.body;

  const subjectResult = validateIssuerSubjectRef(body.subject_ref);
  if (subjectResult.kind === "error") return subjectResult;

  const axis = body.axis;
  if (typeof axis !== "string" || !(SEGMENT_AXES as ReadonlyArray<string>).includes(axis)) {
    return { kind: "error", error: `axis must be one of ${SEGMENT_AXES.join(", ")}` };
  }

  const basisResult = validateBasis(body.basis);
  if (basisResult.kind === "error") return basisResult;

  const parsed = parsePeriod(body.period);
  if (parsed.kind === "error") {
    return { kind: "error", error: parsed.reason };
  }

  return {
    kind: "ok",
    request: {
      subject_ref: { kind: "issuer", id: subjectResult.id },
      axis: axis as SegmentAxis,
      period: parsed.period.raw,
      basis: basisResult.basis,
    },
    parsedPeriod: parsed.period,
  };
}

type RequestObjectResult =
  | { kind: "ok"; body: Record<string, unknown> }
  | { kind: "error"; error: string };

function validateRequestObject(value: unknown): RequestObjectResult {
  if (value === null || typeof value !== "object") {
    return { kind: "error", error: "request body must be a JSON object" };
  }
  return { kind: "ok", body: value as Record<string, unknown> };
}

type IssuerSubjectRefResult =
  | { kind: "ok"; id: UUID }
  | { kind: "error"; error: string };

function validateIssuerSubjectRef(value: unknown): IssuerSubjectRefResult {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { kind?: unknown }).kind !== "issuer"
  ) {
    return { kind: "error", error: "subject_ref must be an issuer SubjectRef" };
  }
  const id = (value as { id?: unknown }).id;
  if (!isUuidV4(id)) {
    return { kind: "error", error: "subject_ref.id must be a UUID v4" };
  }
  return { kind: "ok", id };
}

type BasisResult =
  | { kind: "ok"; basis: StatementBasis }
  | { kind: "error"; error: string };

function validateBasis(value: unknown): BasisResult {
  if (typeof value !== "string" || !(STATEMENT_BASES as ReadonlyArray<string>).includes(value)) {
    return {
      kind: "error",
      error: `basis must be one of ${STATEMENT_BASES.join(", ")}`,
    };
  }
  return { kind: "ok", basis: value as StatementBasis };
}

async function fetchSegmentsOutcome(
  deps: FundamentalsServerDeps,
  clock: () => Date,
  request: GetSegmentsRequest,
  parsedPeriod: ParsedPeriod,
): Promise<FundamentalsOutcome<SegmentFactsEnvelope>> {
  const issuer_id = request.subject_ref.id;
  const envelope = await deps.segments.find({
    issuer_id,
    axis: request.axis,
    basis: request.basis,
    fiscal_year: parsedPeriod.fiscal_year,
    fiscal_period: parsedPeriod.fiscal_period,
  });
  if (!envelope) {
    return missingCoverage(
      deps,
      issuer_id,
      clock().toISOString(),
      `${request.axis} segments not found for ${issuer_id} at ${parsedPeriod.raw} (basis ${request.basis})`,
    );
  }
  return { outcome: "available", data: envelope };
}

async function fetchStatementsResponse(
  deps: FundamentalsServerDeps,
  clock: () => Date,
  request: GetStatementsRequest,
  parsedPeriods: ReadonlyArray<ParsedPeriod>,
): Promise<GetStatementsResponse> {
  const issuer_id = request.subject_ref.id;
  const results = await Promise.all(
    parsedPeriods.map(async (period): Promise<StatementResultEntry> => {
      const statement = await deps.statements.find({
        issuer_id,
        family: request.statement,
        basis: request.basis,
        fiscal_year: period.fiscal_year,
        fiscal_period: period.fiscal_period,
      });
      if (!statement) {
        return {
          period: period.raw,
          outcome: missingCoverage(
            deps,
            issuer_id,
            clock().toISOString(),
            `${request.statement} statement not found for ${issuer_id} at ${period.raw} (basis ${request.basis})`,
          ),
        };
      }
      return { period: period.raw, outcome: { outcome: "available", data: statement } };
    }),
  );
  return { query: request, results };
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

type JsonBodyResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; status: number; error: string };

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<JsonBodyResult> {
  const contentType = (req.headers["content-type"] ?? "").toString().toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return { kind: "error", status: 415, error: "content-type must be application/json" };
  }

  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.byteLength;
    if (total > maxBytes) {
      return { kind: "error", status: 413, error: `request body exceeds ${maxBytes} bytes` };
    }
    chunks.push(buf);
  }

  if (total === 0) {
    return { kind: "error", status: 400, error: "request body is empty" };
  }

  const text = Buffer.concat(chunks, total).toString("utf8");
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch (err) {
    return {
      kind: "error",
      status: 400,
      error: `invalid JSON: ${err instanceof Error ? err.message : "parse failed"}`,
    };
  }
}
