import type { QueryExecutor } from "./queries.ts";
import { isSubjectRef, type SubjectRef } from "./subject-ref.ts";

export type DynamicWatchlistMode = "manual" | "screen" | "agent" | "theme" | "portfolio";

export type DynamicMembershipSource = {
  mode: DynamicWatchlistMode;
  id?: string;
};

export type DynamicWatchlistMember = {
  subject_ref: SubjectRef;
  source: DynamicMembershipSource;
};

export type DynamicWatchlistMembership = {
  watchlist_id: string;
  user_id: string;
  source: DynamicMembershipSource;
  freshness: {
    derived_at: string;
    strategy: "stored" | "replay" | "mirror";
    cost_hint: "low" | "medium" | "high";
  };
  members: ReadonlyArray<DynamicWatchlistMember>;
};

export type DynamicWatchlistDeps = {
  db: QueryExecutor;
  screens?: {
    find(screenId: string, userId: string): Promise<unknown> | unknown;
  };
  executeScreen?: (screen: unknown) => Promise<{ rows: ReadonlyArray<ScreenRow> }> | { rows: ReadonlyArray<ScreenRow> };
  agents?: {
    get(agentId: string, userId: string): Promise<AgentLike | undefined> | AgentLike | undefined;
  };
  now?: () => Date;
};

export type ResolveDynamicWatchlistMembersRequest = {
  user_id: string;
  watchlist_id: string;
};

type WatchlistRow = {
  watchlist_id: string;
  user_id: string;
  mode: DynamicWatchlistMode;
  membership_spec: unknown;
};

type ScreenRow = {
  subject_ref: SubjectRef;
};

type AgentLike = {
  agent_id: string;
  user_id?: string;
  universe: AgentUniverseLike;
};

type AgentUniverseLike =
  | { mode: "static"; subject_refs: ReadonlyArray<SubjectRef> }
  | { mode: "screen"; screen_id: string }
  | { mode: "theme"; theme_id: string }
  | { mode: "portfolio"; portfolio_id: string }
  | { mode: "agent"; agent_id: string };

export class DynamicWatchlistNotFoundError extends Error {
  constructor(watchlistId: string) {
    super(`dynamic watchlist '${watchlistId}' not found`);
    this.name = "DynamicWatchlistNotFoundError";
  }
}

export async function resolveDynamicWatchlistMembers(
  deps: DynamicWatchlistDeps,
  request: ResolveDynamicWatchlistMembersRequest,
): Promise<DynamicWatchlistMembership> {
  const watchlist = await getWatchlist(deps.db, request);
  const source = sourceFor(watchlist.mode, watchlist.membership_spec);
  const derivedAt = (deps.now?.() ?? new Date()).toISOString();
  const members = await resolveMembersForSource(deps, source, request, derivedAt, new Set());

  return Object.freeze({
    watchlist_id: watchlist.watchlist_id,
    user_id: watchlist.user_id,
    source,
    freshness: Object.freeze({
      derived_at: derivedAt,
      strategy: freshnessStrategy(source.mode),
      cost_hint: costHint(source.mode),
    }),
    members: Object.freeze(sortMembers(dedupeMembers(members))),
  });
}

async function getWatchlist(
  db: QueryExecutor,
  request: ResolveDynamicWatchlistMembersRequest,
): Promise<WatchlistRow> {
  const result = await db.query<WatchlistRow>(
    `select watchlist_id, user_id, mode, membership_spec
       from watchlists
      where watchlist_id = $1 and user_id = $2
      limit 1`,
    [request.watchlist_id, request.user_id],
  );
  const row = result.rows[0];
  if (!row) throw new DynamicWatchlistNotFoundError(request.watchlist_id);
  return row;
}

async function resolveMembersForSource(
  deps: DynamicWatchlistDeps,
  source: DynamicMembershipSource,
  request: ResolveDynamicWatchlistMembersRequest,
  asOf: string,
  visitedAgents: Set<string>,
): Promise<DynamicWatchlistMember[]> {
  if (source.mode === "manual") {
    return rowsToMembers(
      source,
      await selectSubjectRows(
        deps.db,
        `select subject_kind, subject_id
           from watchlist_members
          where watchlist_id = $1`,
        [request.watchlist_id],
      ),
    );
  }
  if (source.mode === "theme") {
    return rowsToMembers(
      source,
      await selectSubjectRows(
        deps.db,
        `select subject_kind, subject_id, subject_ref
           from theme_memberships
          where theme_id = $1
            and effective_at <= $2::timestamptz
            and (expires_at is null or expires_at > $2::timestamptz)`,
        [requiredSourceId(source, "theme_id"), asOf],
      ),
    );
  }
  if (source.mode === "portfolio") {
    return rowsToMembers(
      source,
      await selectSubjectRows(
        deps.db,
        `select ph.subject_kind, ph.subject_id
           from portfolio_holdings ph
           join portfolios p
             on p.portfolio_id = ph.portfolio_id
          where ph.portfolio_id = $1 and p.user_id = $2`,
        [requiredSourceId(source, "portfolio_id"), request.user_id],
      ),
    );
  }
  if (source.mode === "screen") {
    if (!deps.screens || !deps.executeScreen) {
      throw new Error("dynamic watchlist screen mode requires screens and executeScreen deps");
    }
    const screenId = requiredSourceId(source, "screen_id");
    const screen = await deps.screens.find(screenId, request.user_id);
    if (!screen) throw new Error(`screen '${screenId}' not found`);
    const response = await deps.executeScreen(screen);
    return rowsToMembers(
      source,
      response.rows.map((row) => row.subject_ref),
    );
  }
  if (source.mode === "agent") {
    if (!deps.agents) {
      throw new Error("dynamic watchlist agent mode requires agents dep");
    }
    const agentId = requiredSourceId(source, "agent_id");
    if (visitedAgents.has(agentId)) {
      throw new Error(`agent universe cycle detected at '${agentId}'`);
    }
    visitedAgents.add(agentId);
    const agent = await deps.agents.get(agentId, request.user_id);
    if (!agent) throw new Error(`agent '${agentId}' not found`);
    if (agent.user_id !== undefined && agent.user_id !== request.user_id) {
      throw new Error(`agent '${agentId}' does not belong to user '${request.user_id}'`);
    }
    const subjectRefs = await resolveAgentUniverse(deps, agent.universe, request, asOf, visitedAgents);
    return rowsToMembers(source, subjectRefs);
  }
  source.mode satisfies never;
  return [];
}

async function resolveAgentUniverse(
  deps: DynamicWatchlistDeps,
  universe: AgentUniverseLike,
  request: ResolveDynamicWatchlistMembersRequest,
  asOf: string,
  visitedAgents: Set<string>,
): Promise<SubjectRef[]> {
  if (universe.mode === "static") return [...universe.subject_refs];
  const nestedSource = sourceFor(universe.mode, universe);
  const nestedMembers = await resolveMembersForSource(deps, nestedSource, request, asOf, visitedAgents);
  return nestedMembers.map((member) => member.subject_ref);
}

async function selectSubjectRows(
  db: QueryExecutor,
  text: string,
  values: unknown[],
): Promise<SubjectRef[]> {
  const result = await db.query<Record<string, unknown>>(text, values);
  return result.rows.map(subjectRefFromRow);
}

function subjectRefFromRow(row: Record<string, unknown>): SubjectRef {
  if (isSubjectRef(row.subject_ref)) return row.subject_ref;
  const candidate = { kind: row.subject_kind, id: row.subject_id };
  if (!isSubjectRef(candidate)) {
    throw new Error("dynamic membership row does not contain a valid subject_ref");
  }
  return candidate;
}

function rowsToMembers(
  source: DynamicMembershipSource,
  subjectRefs: ReadonlyArray<SubjectRef>,
): DynamicWatchlistMember[] {
  return subjectRefs.map((subject_ref) => ({
    subject_ref,
    source,
  }));
}

function dedupeMembers(
  members: ReadonlyArray<DynamicWatchlistMember>,
): DynamicWatchlistMember[] {
  const bySubject = new Map<string, DynamicWatchlistMember>();
  for (const member of members) {
    bySubject.set(subjectKey(member.subject_ref), member);
  }
  return [...bySubject.values()];
}

function sortMembers(
  members: ReadonlyArray<DynamicWatchlistMember>,
): DynamicWatchlistMember[] {
  return [...members].sort((a, b) => {
    if (a.subject_ref.kind < b.subject_ref.kind) return -1;
    if (a.subject_ref.kind > b.subject_ref.kind) return 1;
    if (a.subject_ref.id < b.subject_ref.id) return -1;
    if (a.subject_ref.id > b.subject_ref.id) return 1;
    return 0;
  });
}

function sourceFor(mode: string, spec: unknown): DynamicMembershipSource {
  if (!isDynamicWatchlistMode(mode)) {
    throw new Error(`unsupported watchlist mode '${mode}'`);
  }
  const parsed = parseSpec(spec);
  if (mode === "manual") return { mode };
  const id = requiredSpecId(parsed, `${mode}_id`);
  return { mode, id };
}

function parseSpec(spec: unknown): Record<string, unknown> {
  if (typeof spec === "string") {
    const parsed: unknown = JSON.parse(spec);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("watchlist membership_spec must be an object");
  }
  if (spec !== null && typeof spec === "object" && !Array.isArray(spec)) {
    return spec as Record<string, unknown>;
  }
  return {};
}

function requiredSpecId(spec: Record<string, unknown>, key: string): string {
  const value = spec[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`watchlist membership_spec.${key} must be a non-empty string`);
  }
  return value;
}

function requiredSourceId(source: DynamicMembershipSource, label: string): string {
  if (!source.id) throw new Error(`dynamic membership source missing ${label}`);
  return source.id;
}

function isDynamicWatchlistMode(value: string): value is DynamicWatchlistMode {
  return value === "manual" || value === "screen" || value === "agent" || value === "theme" || value === "portfolio";
}

function freshnessStrategy(mode: DynamicWatchlistMode): DynamicWatchlistMembership["freshness"]["strategy"] {
  if (mode === "manual") return "stored";
  if (mode === "screen") return "replay";
  return "mirror";
}

function costHint(mode: DynamicWatchlistMode): DynamicWatchlistMembership["freshness"]["cost_hint"] {
  if (mode === "screen") return "high";
  if (mode === "agent") return "medium";
  return "low";
}

function subjectKey(subjectRef: SubjectRef): string {
  return `${subjectRef.kind}:${subjectRef.id}`;
}
