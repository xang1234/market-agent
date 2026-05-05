import { assertUuid } from "../../market/src/validators.ts";

import { HomeFindingFeedError } from "./finding-feed-repo.ts";
import type {
  HomeAgentLastRun,
  HomeAgentLatestFinding,
  HomeAgentSummaries,
  HomeAgentSummaryRow,
} from "./secondary-types.ts";
import type { QueryExecutor } from "./types.ts";

export const DEFAULT_HOME_AGENT_SUMMARIES_WINDOW_HOURS = 24;
export const MAX_HOME_AGENT_SUMMARIES_WINDOW_HOURS = 168;

const AGENT_RUN_STATUSES: ReadonlySet<HomeAgentLastRun["status"]> = new Set([
  "running",
  "completed",
  "failed",
]);
const HC_SEVERITIES: ReadonlySet<HomeAgentLatestFinding["severity"]> = new Set([
  "high",
  "critical",
]);

export type GetHomeAgentSummariesRequest = {
  user_id: string;
  window_hours?: number;
  now: string | Date;
};

type AgentSummaryRow = {
  agent_id: string;
  name: string;
  agent_created_at: Date | string;
  last_run_id: string | null;
  last_run_status: "running" | "completed" | "failed" | null;
  last_run_started_at: Date | string | null;
  last_run_ended_at: Date | string | null;
  last_run_duration_ms: number | null;
  last_run_error: string | null;
  finding_total: number | string;
  finding_hc: number | string;
  finding_critical: number | string;
  latest_hc_finding_id: string | null;
  latest_hc_headline: string | null;
  latest_hc_severity: "high" | "critical" | null;
  latest_hc_created_at: Date | string | null;
};

type RankedAgent = {
  row: HomeAgentSummaryRow;
  agent_created_at: string;
};

export async function getHomeAgentSummaries(
  db: QueryExecutor,
  request: GetHomeAgentSummariesRequest,
): Promise<HomeAgentSummaries> {
  assertUuid(request.user_id, "user_id");
  const windowHours = resolveWindowHours(request.window_hours);
  const now = resolveNow(request.now);
  const cutoff = new Date(now.getTime() - windowHours * 3_600_000).toISOString();

  const result = await db.query<AgentSummaryRow>(
    `select a.agent_id::text as agent_id,
            a.name as name,
            a.created_at as agent_created_at,
            lr.agent_run_log_id::text as last_run_id,
            lr.status as last_run_status,
            lr.started_at as last_run_started_at,
            lr.ended_at as last_run_ended_at,
            lr.duration_ms as last_run_duration_ms,
            lr.error as last_run_error,
            coalesce(fc.total, 0) as finding_total,
            coalesce(fc.high_or_critical, 0) as finding_hc,
            coalesce(fc.critical_only, 0) as finding_critical,
            lhf.finding_id::text as latest_hc_finding_id,
            lhf.headline as latest_hc_headline,
            lhf.severity as latest_hc_severity,
            lhf.created_at as latest_hc_created_at
       from agents a
  left join lateral (
            select agent_run_log_id, status, started_at, ended_at, duration_ms, error
              from agent_run_logs
             where agent_id = a.agent_id
             order by started_at desc, agent_run_log_id desc
             limit 1
       ) lr on true
  left join lateral (
            select count(*)::int as total,
                   count(*) filter (where severity in ('high','critical'))::int as high_or_critical,
                   count(*) filter (where severity = 'critical')::int as critical_only
              from findings
             where agent_id = a.agent_id
               and created_at >= $2::timestamptz
       ) fc on true
  left join lateral (
            select finding_id, headline, severity, created_at
              from findings
             where agent_id = a.agent_id
               and severity in ('high','critical')
               and created_at >= $2::timestamptz
             order by created_at desc, finding_id asc
             limit 1
       ) lhf on true
      where a.user_id = $1::uuid
        and a.enabled = true`,
    [request.user_id, cutoff],
  );

  const ranked = result.rows.map(toRanked);
  ranked.sort(orderAgentSummaries);

  return Object.freeze({
    window_hours: windowHours,
    rows: Object.freeze(ranked.map((r) => r.row)),
  });
}

function toRanked(row: AgentSummaryRow): RankedAgent {
  return {
    row: toRow(row),
    agent_created_at: toIso(row.agent_created_at, "agents.created_at"),
  };
}

function toRow(row: AgentSummaryRow): HomeAgentSummaryRow {
  const lastRun = mapLastRun(row);
  const counts = {
    total: assertNonNegativeInt(row.finding_total, "finding_total"),
    high_or_critical: assertNonNegativeInt(row.finding_hc, "finding_hc"),
    critical: assertNonNegativeInt(row.finding_critical, "finding_critical"),
  };
  if (typeof row.name !== "string" || row.name.trim() === "") {
    throw new HomeFindingFeedError("agents.name must be a non-empty string");
  }
  assertUuid(row.agent_id, "agent_id");
  return Object.freeze({
    agent_id: row.agent_id,
    name: row.name.trim(),
    enabled: true,
    last_run: lastRun,
    finding_counts: Object.freeze(counts),
    latest_high_or_critical_finding: mapLatestFinding(row),
  });
}

function mapLastRun(row: AgentSummaryRow): HomeAgentLastRun | null {
  if (row.last_run_id === null) return null;
  if (row.last_run_status === null || !AGENT_RUN_STATUSES.has(row.last_run_status)) {
    throw new HomeFindingFeedError("agent_run_logs.status must be running, completed, or failed");
  }
  const startedAt = row.last_run_started_at;
  if (startedAt === null) {
    throw new HomeFindingFeedError("agent_run_logs.started_at must not be null when last_run_id is set");
  }
  assertUuid(row.last_run_id, "agent_run_log_id");
  return Object.freeze({
    agent_run_log_id: row.last_run_id,
    status: row.last_run_status,
    started_at: toIso(startedAt, "agent_run_logs.started_at"),
    ended_at: row.last_run_ended_at === null ? null : toIso(row.last_run_ended_at, "agent_run_logs.ended_at"),
    duration_ms: row.last_run_duration_ms,
    error: row.last_run_error,
  });
}

function mapLatestFinding(row: AgentSummaryRow): HomeAgentLatestFinding | null {
  if (row.latest_hc_finding_id === null) return null;
  if (row.latest_hc_severity === null || !HC_SEVERITIES.has(row.latest_hc_severity)) {
    throw new HomeFindingFeedError("latest high_or_critical finding severity must be high or critical");
  }
  if (row.latest_hc_headline === null) {
    throw new HomeFindingFeedError("latest high_or_critical finding headline must not be null");
  }
  if (row.latest_hc_created_at === null) {
    throw new HomeFindingFeedError("latest high_or_critical finding created_at must not be null");
  }
  assertUuid(row.latest_hc_finding_id, "latest_hc_finding_id");
  return Object.freeze({
    finding_id: row.latest_hc_finding_id,
    headline: row.latest_hc_headline,
    severity: row.latest_hc_severity,
    created_at: toIso(row.latest_hc_created_at, "latest_hc_finding.created_at"),
  });
}

function orderAgentSummaries(a: RankedAgent, b: RankedAgent): number {
  const aCritical = a.row.finding_counts.critical > 0 ? 1 : 0;
  const bCritical = b.row.finding_counts.critical > 0 ? 1 : 0;
  if (aCritical !== bCritical) return bCritical - aCritical;

  const aEnded = a.row.last_run?.ended_at ?? null;
  const bEnded = b.row.last_run?.ended_at ?? null;
  if (aEnded !== bEnded) {
    if (aEnded === null) return 1;
    if (bEnded === null) return -1;
    const diff = Date.parse(bEnded) - Date.parse(aEnded);
    if (diff !== 0) return diff;
  }

  const created = Date.parse(b.agent_created_at) - Date.parse(a.agent_created_at);
  if (created !== 0) return created;

  return a.row.agent_id < b.row.agent_id ? -1 : a.row.agent_id > b.row.agent_id ? 1 : 0;
}

function resolveWindowHours(value: number | undefined): number {
  if (value === undefined) return DEFAULT_HOME_AGENT_SUMMARIES_WINDOW_HOURS;
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_HOME_AGENT_SUMMARIES_WINDOW_HOURS
  ) {
    throw new HomeFindingFeedError(
      `window_hours must be a positive integer <= ${MAX_HOME_AGENT_SUMMARIES_WINDOW_HOURS}`,
    );
  }
  return value;
}

function resolveNow(value: string | Date): Date {
  const resolved = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(resolved.getTime())) {
    throw new HomeFindingFeedError("now must be a valid date");
  }
  return resolved;
}

function assertNonNegativeInt(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HomeFindingFeedError(`${field} must be a non-negative integer`);
  }
  return parsed;
}

function toIso(value: Date | string, field: string): string {
  const iso = value instanceof Date ? value.toISOString() : value;
  if (Number.isNaN(Date.parse(iso))) {
    throw new HomeFindingFeedError(`${field} must be an ISO date-time string`);
  }
  return iso;
}
