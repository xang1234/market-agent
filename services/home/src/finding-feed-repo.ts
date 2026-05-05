import {
  HOME_ANALYZE_INTENTS,
  HOME_FINDING_SEVERITIES,
  HOME_SYMBOL_TABS,
  type FindingCardBlock,
  type HomeAnalyzeIntent,
  type HomeCardDestination,
  type HomeFinding,
  type HomeFindingCard,
  type HomeFindingSeverity,
  type HomeSymbolTab,
  type QueryExecutor,
  type SubjectRef,
} from "./types.ts";

export const DEFAULT_HOME_FINDING_LIMIT = 100;
export const MAX_HOME_FINDING_LIMIT = 500;
export const DEFAULT_HOME_FINDING_CANDIDATE_LIMIT = 500;
export const MAX_HOME_FINDING_CANDIDATE_LIMIT = 2_000;

export type ListHomeFindingCardsRequest = {
  user_id: string;
  limit?: number;
  candidate_limit?: number;
};

type FindingFeedRow = {
  finding_id: string;
  agent_id: string;
  snapshot_id: string;
  subject_refs: unknown;
  claim_cluster_ids: unknown;
  severity: HomeFindingSeverity;
  headline: string;
  summary_blocks: unknown;
  created_at: Date | string;
  cluster_support_count: number | string | null;
  preferred_surface: unknown;
};

type Group = {
  dedupe_key: string;
  findings: HomeFinding[];
  support_counts: number[];
  destinations: HomeCardDestination[];
};

const SUBJECT_KINDS = new Set([
  "issuer",
  "instrument",
  "listing",
  "theme",
  "macro_topic",
  "portfolio",
  "screen",
]);

const SEVERITY_RANK: Record<HomeFindingSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export class HomeFindingFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HomeFindingFeedError";
  }
}

export async function listHomeFindingCards(
  db: QueryExecutor,
  request: ListHomeFindingCardsRequest,
): Promise<ReadonlyArray<HomeFindingCard>> {
  assertUuid(request.user_id, "user_id");
  const limit = resolveLimit(request.limit);
  const candidateLimit = resolveCandidateLimit(request.candidate_limit, limit);
  const result = await db.query<FindingFeedRow>(
    `select f.finding_id::text as finding_id,
            f.agent_id::text as agent_id,
            f.snapshot_id::text as snapshot_id,
            f.subject_refs,
            f.claim_cluster_ids,
            f.severity,
            f.headline,
            f.summary_blocks,
            f.created_at,
            cc.support_count as cluster_support_count,
            null::jsonb as preferred_surface
       from findings f
       join agents a
         on a.agent_id = f.agent_id
       left join claim_clusters cc
         on cc.cluster_id = (
           select cluster_id::uuid
             from jsonb_array_elements_text(f.claim_cluster_ids) as cluster_id
            order by cluster_id asc
            limit 1
         )
      where a.user_id = $1::uuid
        and a.enabled = true
      order by f.created_at desc, f.finding_id asc
      limit $2`,
    [request.user_id, candidateLimit],
  );

  return Object.freeze(cardsFromRows(result.rows).slice(0, limit));
}

function cardsFromRows(rows: ReadonlyArray<FindingFeedRow>): HomeFindingCard[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const finding = findingFromRow(row);
    const dedupe_key = dedupeKey(finding);
    let group = groups.get(dedupe_key);
    if (!group) {
      group = { dedupe_key, findings: [], support_counts: [], destinations: [] };
      groups.set(dedupe_key, group);
    }
    group.findings.push(finding);
    const supportCount = nullableCount(row.cluster_support_count);
    if (supportCount !== null) group.support_counts.push(supportCount);
    group.destinations.push(parseHomeCardDestination(row.preferred_surface));
  }

  return [...groups.values()]
    .map(cardFromGroup)
    .sort((a, b) => {
      const created = Date.parse(b.created_at) - Date.parse(a.created_at);
      if (created !== 0) return created;
      return a.home_card_id < b.home_card_id ? -1 : a.home_card_id > b.home_card_id ? 1 : 0;
    });
}

function cardFromGroup(group: Group): HomeFindingCard {
  const findings = [...group.findings].sort(comparePrimaryFinding);
  const primary = findings[0];
  const agentIds = sortedUnique(findings.map((finding) => finding.agent_id));
  const findingIds = sortedUnique(findings.map((finding) => finding.finding_id));
  const claimClusterIds = sortedUnique(findings.flatMap((finding) => finding.claim_cluster_ids));
  if (claimClusterIds.length > 0 && group.support_counts.length === 0) {
    throw new HomeFindingFeedError(`missing claim cluster aggregate for ${group.dedupe_key}`);
  }
  const supportCount = group.support_counts.length === 0 ? findings.length : Math.max(...group.support_counts);

  return deepFreeze({
    home_card_id: group.dedupe_key,
    dedupe_key: group.dedupe_key,
    primary_finding: primary,
    support_count: supportCount,
    contributing_finding_count: findings.length,
    severity: primary.severity,
    headline: primary.headline,
    subject_refs: primary.subject_refs.map((ref) => ({ ...ref })),
    summary_blocks: primary.summary_blocks.map((block) => cloneJsonObject(block)),
    created_at: primary.created_at,
    agent_ids: agentIds,
    finding_ids: findingIds,
    claim_cluster_ids: claimClusterIds,
    user_affinity: 0,
    destination: group.destinations.find((destination) => destination.kind !== "none") ?? {
      kind: "none",
      reason: "missing_destination",
    },
  });
}

function findingFromRow(row: FindingFeedRow): HomeFinding {
  const severity = assertSeverity(row.severity);
  return deepFreeze({
    finding_id: assertUuid(row.finding_id, "finding_id"),
    agent_id: assertUuid(row.agent_id, "agent_id"),
    snapshot_id: assertUuid(row.snapshot_id, "snapshot_id"),
    subject_refs: parseSubjectRefs(row.subject_refs),
    claim_cluster_ids: parseUuidArray(row.claim_cluster_ids, "claim_cluster_ids"),
    severity,
    headline: assertNonEmptyString(row.headline, "headline").trim(),
    summary_blocks: parseSummaryBlocks(row.summary_blocks),
    created_at: toIso(row.created_at),
  });
}

function dedupeKey(finding: HomeFinding): string {
  if (finding.claim_cluster_ids.length > 0) {
    return `claim_cluster:${[...finding.claim_cluster_ids].sort()[0]}`;
  }
  return `finding:${finding.finding_id}`;
}

function comparePrimaryFinding(a: HomeFinding, b: HomeFinding): number {
  const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (severity !== 0) return severity;
  const created = Date.parse(b.created_at) - Date.parse(a.created_at);
  if (created !== 0) return created;
  return a.finding_id < b.finding_id ? -1 : a.finding_id > b.finding_id ? 1 : 0;
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_HOME_FINDING_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new HomeFindingFeedError("limit must be a positive integer");
  }
  return Math.min(limit, MAX_HOME_FINDING_LIMIT);
}

function resolveCandidateLimit(candidateLimit: number | undefined, finalLimit: number): number {
  if (candidateLimit !== undefined) {
    if (!Number.isInteger(candidateLimit) || candidateLimit <= 0) {
      throw new HomeFindingFeedError("candidate_limit must be a positive integer");
    }
    if (candidateLimit < finalLimit) {
      throw new HomeFindingFeedError("candidate_limit must be >= limit");
    }
    return Math.min(candidateLimit, MAX_HOME_FINDING_CANDIDATE_LIMIT);
  }
  return Math.min(
    Math.max(DEFAULT_HOME_FINDING_CANDIDATE_LIMIT, finalLimit * 10),
    MAX_HOME_FINDING_CANDIDATE_LIMIT,
  );
}

function parseSubjectRefs(value: unknown): ReadonlyArray<SubjectRef> {
  if (!Array.isArray(value)) throw new HomeFindingFeedError("subject_refs must be an array");
  return Object.freeze(value.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new HomeFindingFeedError(`subject_refs[${index}] must be an object`);
    }
    const ref = item as Record<string, unknown>;
    if (typeof ref.kind !== "string" || typeof ref.id !== "string") {
      throw new HomeFindingFeedError(`subject_refs[${index}] must contain kind and id`);
    }
    if (!SUBJECT_KINDS.has(ref.kind)) {
      throw new HomeFindingFeedError(`subject_refs[${index}].kind must be a supported subject kind`);
    }
    assertUuid(ref.id, `subject_refs[${index}].id`);
    return Object.freeze({ kind: ref.kind as SubjectRef["kind"], id: ref.id });
  }));
}

function parseSubjectRef(value: unknown, field: string): SubjectRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HomeFindingFeedError(`${field} must be an object`);
  }
  const ref = value as Record<string, unknown>;
  if (typeof ref.kind !== "string" || typeof ref.id !== "string") {
    throw new HomeFindingFeedError(`${field} must contain kind and id`);
  }
  if (!SUBJECT_KINDS.has(ref.kind)) {
    throw new HomeFindingFeedError(`${field}.kind must be a supported subject kind`);
  }
  assertUuid(ref.id, `${field}.id`);
  return Object.freeze({ kind: ref.kind as SubjectRef["kind"], id: ref.id });
}

function parseHomeCardDestination(value: unknown): HomeCardDestination {
  if (value === null || value === undefined) {
    return { kind: "none", reason: "missing_destination" };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HomeFindingFeedError("preferred_surface must be an object");
  }
  const destination = value as Record<string, unknown>;
  if (destination.kind === "symbol") {
    const tab = parseSymbolTab(destination.tab);
    const subject_ref = parseSubjectRef(destination.subject_ref, "preferred_surface.subject_ref");
    return { kind: "symbol", subject_ref, tab };
  }
  if (destination.kind === "theme") {
    const subject_ref = parseSubjectRef(destination.subject_ref, "preferred_surface.subject_ref");
    if (subject_ref.kind !== "theme") {
      throw new HomeFindingFeedError("preferred_surface.subject_ref.kind must be theme");
    }
    return { kind: "theme", subject_ref };
  }
  if (destination.kind === "analyze") {
    const intent = parseAnalyzeIntent(destination.intent);
    const subject_ref = parseSubjectRef(destination.subject_ref, "preferred_surface.subject_ref");
    return { kind: "analyze", subject_ref, intent };
  }
  if (destination.kind === "none") {
    return {
      kind: "none",
      reason: assertNonEmptyString(destination.reason, "preferred_surface.reason").trim(),
    };
  }
  throw new HomeFindingFeedError("preferred_surface.kind must be symbol, theme, analyze, or none");
}

function parseSymbolTab(value: unknown): HomeSymbolTab {
  if (!HOME_SYMBOL_TABS.includes(value as HomeSymbolTab)) {
    throw new HomeFindingFeedError("preferred_surface.tab must be a supported symbol tab");
  }
  return value as HomeSymbolTab;
}

function parseAnalyzeIntent(value: unknown): HomeAnalyzeIntent {
  if (!HOME_ANALYZE_INTENTS.includes(value as HomeAnalyzeIntent)) {
    throw new HomeFindingFeedError("preferred_surface.intent must be a supported Analyze intent");
  }
  return value as HomeAnalyzeIntent;
}

function parseSummaryBlocks(value: unknown): ReadonlyArray<FindingCardBlock> {
  if (!Array.isArray(value)) throw new HomeFindingFeedError("summary_blocks must be an array");
  return Object.freeze(value.map((block, index) => {
    assertFindingCardBlock(block, index);
    return cloneJsonObject(block) as FindingCardBlock;
  }));
}

function assertFindingCardBlock(value: unknown, index: number): asserts value is FindingCardBlock {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HomeFindingFeedError(`summary_blocks[${index}] must be an object`);
  }
  const block = value as Record<string, unknown>;
  assertNonEmptyString(block.id, `summary_blocks[${index}].id`);
  if (block.kind !== "finding_card") {
    throw new HomeFindingFeedError(`summary_blocks[${index}].kind must be finding_card`);
  }
  assertUuid(block.snapshot_id, `summary_blocks[${index}].snapshot_id`);
  if (typeof block.data_ref !== "object" || block.data_ref === null || Array.isArray(block.data_ref)) {
    throw new HomeFindingFeedError(`summary_blocks[${index}].data_ref must be an object`);
  }
  const dataRef = block.data_ref as Record<string, unknown>;
  if (dataRef.kind !== "finding_card") {
    throw new HomeFindingFeedError(`summary_blocks[${index}].data_ref.kind must be finding_card`);
  }
  assertUuid(dataRef.id, `summary_blocks[${index}].data_ref.id`);
  if (!Array.isArray(block.source_refs)) {
    throw new HomeFindingFeedError(`summary_blocks[${index}].source_refs must be an array`);
  }
  block.source_refs.forEach((sourceRef, sourceIndex) =>
    assertUuid(sourceRef, `summary_blocks[${index}].source_refs[${sourceIndex}]`),
  );
  toIso(assertNonEmptyString(block.as_of, `summary_blocks[${index}].as_of`));
  assertUuid(block.finding_id, `summary_blocks[${index}].finding_id`);
  assertNonEmptyString(block.headline, `summary_blocks[${index}].headline`);
  assertSeverity(block.severity);
  if (block.subject_refs !== undefined) parseSubjectRefs(block.subject_refs);
}

function parseUuidArray(value: unknown, field: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) throw new HomeFindingFeedError(`${field} must be an array`);
  return Object.freeze(value.map((item, index) => assertUuid(item, `${field}[${index}]`)));
}

function assertSeverity(value: unknown): HomeFindingSeverity {
  if (!HOME_FINDING_SEVERITIES.includes(value as HomeFindingSeverity)) {
    throw new HomeFindingFeedError("severity must be low, medium, high, or critical");
  }
  return value as HomeFindingSeverity;
}

function assertUuid(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
  ) {
    throw new HomeFindingFeedError(`${field} must be a UUID`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HomeFindingFeedError(`${field} must be a non-empty string`);
  }
  return value;
}

function toIso(value: Date | string): string {
  const iso = value instanceof Date ? value.toISOString() : value;
  if (Number.isNaN(Date.parse(iso))) {
    throw new HomeFindingFeedError("created_at must be an ISO date-time string");
  }
  return iso;
}

function nullableCount(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HomeFindingFeedError("cluster support count must be a non-negative integer");
  }
  return parsed;
}

function sortedUnique(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return Object.freeze([...new Set(values)].sort());
}

function cloneJsonObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((item) => deepFreeze(item));
    return Object.freeze(value) as T;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}
