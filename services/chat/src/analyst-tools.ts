import { issuerLabelSql, loadLatestFilingClaims, type FilingClaim, type FilingItemRead } from "../../evidence/src/local-runtime-evidence.ts";
import type { RowQueryExecutor } from "../../evidence/src/types.ts";
import { createSqlPeerSetResolver, DEFAULT_PEER_LIMIT } from "../../fundamentals/src/peer-set-resolver.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import { isRecord } from "../../shared/src/http.ts";

export const BUSINESS_PREDICATES = ["business.description", "business.products", "business.customers", "business.competition"] as const;
export const CLAIM_PREDICATES = [...BUSINESS_PREDICATES, "risk.factor"] as const;
export const CLAIM_ROLES = ["subject", "competitor"] as const;

export type AnalystToolInput = {
  issuer_ids: ReadonlyArray<string>;
  as_of: string;
  user_id?: string | null;
  role?: (typeof CLAIM_ROLES)[number];
  predicates?: ReadonlyArray<string>;
  peer_limit?: number;
};

export type ConsensusValue = {
  capture_id: string;
  source_id: string;
  provider: string;
  field_key: string;
  label: string;
  raw_value: string;
  unit: "usd_per_share" | "percent" | "usd" | "recommendation_1_to_5";
  fiscal_period: string | null;
};

type Reads = { reads: ReadonlyArray<FilingItemRead> };

export type PeerEntry = { issuer_id: string; label: string; industry_source_id: string | null; market_cap_source_id: string | null };

// "no_business_claims" and "no_claims" mean every 10-K item read for them was
// read in full and holds none; "incomplete_read" means no claim came back and
// an item was cut, unread, not found, or has an unread newer 10-K. Either way
// `reads` says which filing was read and how far.
export type AnalystToolResult =
  | ({ tool: "get_company_profile" | "get_claims"; status: "ok"; claims: ReadonlyArray<FilingClaim>; truncated: boolean } & Reads)
  | ({ tool: "get_company_profile"; status: "no_business_claims" } & Reads)
  | ({ tool: "get_claims"; status: "no_claims" } & Reads)
  | ({ tool: "get_company_profile" | "get_claims"; status: "incomplete_read" } & Reads)
  | { tool: "get_peer_set"; status: "ok"; company: string; industry: string; industry_source_id: string | null; peers: ReadonlyArray<PeerEntry> }
  | { tool: "get_peer_set"; status: "no_peers"; reason: "no_industry" | "no_same_industry_issuer" }
  | { tool: "get_analyst_consensus"; status: "ok"; company: string; captured_on: string; values: ReadonlyArray<ConsensusValue> }
  | { tool: "get_analyst_consensus"; status: "no_consensus" }
  | { tool: AnalystToolName; status: "no_subject" | "invalid_arguments" | "unavailable"; reason: string };

export const ANALYST_TOOL_NAMES = ["get_company_profile", "get_claims", "get_peer_set", "get_analyst_consensus"] as const;
export type AnalystToolName = (typeof ANALYST_TOOL_NAMES)[number];

type Executor = (db: RowQueryExecutor, input: AnalystToolInput) => Promise<AnalystToolResult>;

const EXECUTORS: Readonly<Record<AnalystToolName, Executor>> = {
  get_company_profile: async (db, input) => {
    const read = await loadLatestFilingClaims(db, { ...input, role: "subject", predicates: BUSINESS_PREDICATES });
    if (read.claims.length > 0) return { tool: "get_company_profile", status: "ok", ...read };
    return { tool: "get_company_profile", status: fullyRead(read.reads) ? "no_business_claims" : "incomplete_read", reads: read.reads };
  },
  get_claims: async (db, input) => {
    const predicates = input.predicates ?? CLAIM_PREDICATES;
    const read = await loadLatestFilingClaims(db, { ...input, role: input.role ?? "subject", predicates });
    if (read.claims.length > 0) return { tool: "get_claims", status: "ok", ...read };
    return { tool: "get_claims", status: fullyRead(read.reads) ? "no_claims" : "incomplete_read", reads: read.reads };
  },
  get_peer_set: async (db, input) => {
    const issuerId = input.issuer_ids[0]!;
    const { rows: [issuer] } = await db.query<{ industry: string | null }>(`select industry from issuers where issuer_id = $1::uuid`, [issuerId]);
    if (!issuer?.industry) return { tool: "get_peer_set", status: "no_peers", reason: "no_industry" };
    const peers = await createSqlPeerSetResolver(db).resolvePeers(issuerId, { limit: input.peer_limit ?? DEFAULT_PEER_LIMIT });
    if (peers.length === 0) return { tool: "get_peer_set", status: "no_peers", reason: "no_same_industry_issuer" };
    const named = await peerSources(db, [issuerId, ...peers.map((peer) => peer.id)], input.as_of);
    const primary = named.get(issuerId)!;
    return {
      tool: "get_peer_set",
      status: "ok",
      company: primary.label,
      industry: issuer.industry,
      industry_source_id: primary.industry_source_id,
      peers: peers.map((peer) => named.get(peer.id)!),
    };
  },
  get_analyst_consensus: async (db, input) => {
    const issuerId = input.issuer_ids[0]!;
    const { rows } = await db.query<Omit<ConsensusValue, "label" | "provider"> & { provider: string; captured_on: string }>(
      `with cutoff as (select ($2::timestamptz at time zone 'UTC')::date as day),
            newest as (
              select max(captured_on) as day from consensus_captures, cutoff
               where issuer_id = $1::uuid and captured_on <= cutoff.day and retrieved_at <= $2::timestamptz
            )
       select cc.capture_id::text as capture_id, cc.source_id::text as source_id, s.provider,
              cc.captured_on::text as captured_on, cc.field_key, cc.raw_value, cc.unit, cc.fiscal_period
         from consensus_captures cc
         join sources s on s.source_id = cc.source_id
         join newest on cc.captured_on = newest.day
         cross join cutoff
        where cc.issuer_id = $1::uuid and cc.value is not null and cc.retrieved_at <= $2::timestamptz and newest.day >= cutoff.day - $4::int
        order by array_position($3::text[], cc.field_key), cc.source_id`,
      [issuerId, input.as_of, Object.keys(CONSENSUS_FIELDS), CONSENSUS_MAX_AGE_DAYS],
    );
    if (rows.length === 0) return { tool: "get_analyst_consensus", status: "no_consensus" };
    const labels = await issuerLabels(db, [issuerId], input.as_of);
    return {
      tool: "get_analyst_consensus",
      status: "ok",
      company: labels.get(issuerId)!,
      captured_on: rows[0]!.captured_on,
      values: rows.map(({ captured_on: _day, provider, ...value }) => ({
        ...value,
        provider: PROVIDERS[provider] ?? provider,
        label: CONSENSUS_FIELDS[value.field_key as keyof typeof CONSENSUS_FIELDS] ?? value.field_key,
      })),
    };
  },
};

export function isAnalystToolName(name: string): name is AnalystToolName {
  return (ANALYST_TOOL_NAMES as ReadonlyArray<string>).includes(name);
}

// ADR 0006: a capture older than this is no consensus.
const CONSENSUS_MAX_AGE_DAYS = 7;

const PROVIDERS: Readonly<Record<string, string>> = { finviz_dev_consensus: "Finviz" };

const CONSENSUS_FIELDS = {
  eps_next_q: "EPS next quarter",
  eps_next_y: "EPS next year",
  eps_growth_this_y: "EPS growth this year",
  eps_growth_next_y: "EPS growth next year",
  eps_growth_next_5y: "EPS growth, next 5 years",
  target_price: "target price",
  recommendation_mean: "mean recommendation score (recommendation_mean, on a 1 to 5 scale)",
} as const;

export async function runAnalystTool(db: RowQueryExecutor, name: AnalystToolName, input: AnalystToolInput): Promise<AnalystToolResult> {
  if (input.issuer_ids.length === 0) return { tool: name, status: "no_subject", reason: "no issuer" };
  return EXECUTORS[name](db, input);
}

export async function runRegisteredAnalystTool(
  db: RowQueryExecutor,
  name: AnalystToolName,
  args: Readonly<Record<string, JsonValue>>,
  turn: { as_of: string; user_id?: string | null },
): Promise<AnalystToolResult> {
  const refs = name === "get_claims" && Array.isArray(args.subject_refs) ? args.subject_refs : [args.subject_ref];
  if (!refs.every(isSubjectRef) || refs.length === 0) return { tool: name, status: "invalid_arguments", reason: "a subject_ref needs a kind and an id" };
  const predicates = args.predicates;
  if (predicates !== undefined && !(Array.isArray(predicates) && predicates.length > 0 && predicates.every((p) => typeof p === "string" && (CLAIM_PREDICATES as ReadonlyArray<string>).includes(p)))) {
    return { tool: name, status: "invalid_arguments", reason: `predicates are among ${CLAIM_PREDICATES.join(", ")}` };
  }
  const role = args.role;
  if (role !== undefined && !(CLAIM_ROLES as ReadonlyArray<JsonValue>).includes(role)) {
    return { tool: name, status: "invalid_arguments", reason: `role is ${CLAIM_ROLES.join(" or ")}` };
  }
  if (args.criteria !== undefined && args.criteria !== "industry") {
    return { tool: name, status: "invalid_arguments", reason: "peers are chosen by industry only" };
  }
  const unread = Object.keys(args).filter((key) => !READ_ARGUMENTS[name].has(key));
  if (unread.length > 0) return { tool: name, status: "invalid_arguments", reason: `${unread.join(", ")} not supported` };
  const n = args.n;
  if (n !== undefined && !(typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 20)) {
    return { tool: name, status: "invalid_arguments", reason: "n is a whole number from 1 to 20" };
  }
  const issuerIds = await issuersOfSubjects(db, refs);
  if (issuerIds.includes(null)) return { tool: name, status: "no_subject", reason: "a subject_ref names no stored issuer" };
  return runAnalystTool(db, name, {
    issuer_ids: [...new Set(issuerIds as string[])],
    as_of: turn.as_of,
    user_id: turn.user_id ?? null,
    ...(predicates === undefined ? {} : { predicates: predicates as string[] }),
    ...(role === undefined ? {} : { role: role as AnalystToolInput["role"] }),
    ...(n === undefined ? {} : { peer_limit: n as number }),
  });
}

// Each tool's arguments, beside the query the coordinator always sends.
const READ_ARGUMENTS: Readonly<Record<AnalystToolName, ReadonlySet<string>>> = {
  get_company_profile: new Set(["query", "subject_ref"]),
  get_claims: new Set(["query", "subject_ref", "subject_refs", "predicates", "role"]),
  get_peer_set: new Set(["query", "subject_ref", "criteria", "n"]),
  get_analyst_consensus: new Set(["query", "subject_ref"]),
};

// The database out of reach: SQLSTATE connection, resource, operator and
// system classes, and the socket errors. pg ends a dropped connection with an
// uncoded Error, so one counts too; any other code is a bug and throws.
const OUTAGE_SQLSTATE_CLASSES = ["08", "53", "57", "58"];
const OUTAGE_SOCKET_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE"]);

export function isUnavailableRead(reason: unknown): boolean {
  if (!(reason instanceof Error) || reason instanceof TypeError || reason instanceof ReferenceError || reason instanceof RangeError || reason instanceof SyntaxError) return false;
  if (!("code" in reason)) return true;
  const code = String(reason.code);
  return OUTAGE_SOCKET_CODES.has(code) || (/^[0-9A-Z]{5}$/.test(code) && OUTAGE_SQLSTATE_CLASSES.includes(code.slice(0, 2)));
}

type SubjectRef = { kind: string; id: string };

function isSubjectRef(value: JsonValue | undefined): value is SubjectRef {
  return isRecord(value) && typeof value.kind === "string" && typeof value.id === "string";
}

// One per ref, null where it names no stored issuer.
async function issuersOfSubjects(db: RowQueryExecutor, refs: ReadonlyArray<SubjectRef>): Promise<Array<string | null>> {
  const { rows } = await db.query<{ ord: number; issuer_id: string | null }>(
    `with refs as (
       select r.ord, r.ref->>'kind' as kind,
              case when r.ref->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (r.ref->>'id')::uuid end as id
         from jsonb_array_elements($1::jsonb) with ordinality as r(ref, ord)
     )
     select r.ord::int as ord, coalesce(i.issuer_id, n.issuer_id, ln.issuer_id)::text as issuer_id
       from refs r
       left join issuers i on r.kind = 'issuer' and i.issuer_id = r.id
       left join instruments n on r.kind = 'instrument' and n.instrument_id = r.id
       left join listings l on r.kind = 'listing' and l.listing_id = r.id
       left join instruments ln on ln.instrument_id = l.instrument_id
      order by r.ord`,
    [JSON.stringify(refs)],
  );
  return rows.map((row) => row.issuer_id);
}

function fullyRead(reads: ReadonlyArray<FilingItemRead>): boolean {
  return reads.every((read) => read.state === "read" && read.newer_unread === null);
}

// Each issuer's label, the source of its stored industry, and the source of
// the market cap fact the peer resolver ranks it by (the same fact it reads).
async function peerSources(db: RowQueryExecutor, issuerIds: ReadonlyArray<string>, asOf: string): Promise<Map<string, PeerEntry>> {
  const { rows } = await db.query<PeerEntry>(
    `select i.issuer_id::text as issuer_id,
            ${issuerLabelSql("i", "$2::timestamptz")} as label,
            (select e.source_id::text from issuer_profile_enrichments e
              where e.issuer_id = i.issuer_id and e.field_name = 'industry' and e.field_value = i.industry
              order by e.retrieved_at desc, e.source_id limit 1) as industry_source_id,
            (select f.source_id::text from facts f join metrics m on m.metric_id = f.metric_id
              where f.subject_kind = 'issuer' and f.subject_id = i.issuer_id and m.metric_key = 'market_cap'
                and f.method = 'reported' and f.invalidated_at is null and f.superseded_by is null
              order by f.as_of desc, f.created_at desc limit 1) as market_cap_source_id
       from issuers i where i.issuer_id = any($1::uuid[])`,
    [issuerIds, asOf],
  );
  return new Map(rows.map((row) => [row.issuer_id, row]));
}

async function issuerLabels(db: RowQueryExecutor, issuerIds: ReadonlyArray<string>, asOf: string): Promise<Map<string, string>> {
  const { rows } = await db.query<{ issuer_id: string; label: string }>(
    `select i.issuer_id::text as issuer_id,
            ${issuerLabelSql("i", "$2::timestamptz")} as label
       from issuers i where i.issuer_id = any($1::uuid[])`,
    [issuerIds, asOf],
  );
  return new Map(rows.map((row) => [row.issuer_id, row.label]));
}
