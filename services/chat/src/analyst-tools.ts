import { factKnownAtSql } from "../../evidence/src/fact-activity.ts";
import { issuerLabels, issuerLabelSql, loadLatestFilingClaims, type FilingClaim, type FilingClaimRead } from "../../evidence/src/local-runtime-evidence.ts";
import { loadNonGaapHistory, type NonGaapHistory } from "../../evidence/src/non-gaap-history.ts";
import type { RowQueryExecutor } from "../../evidence/src/types.ts";
import { DEFAULT_PEER_LIMIT } from "../../fundamentals/src/peer-set-resolver.ts";
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

type Reads = Omit<FilingClaimRead, "claims">;

// Every peer has a visible industry source known at the cutoff; one without
// is no peer. Its market cap source is null when no cap fact ranks it.
export type PeerEntry = { issuer_id: string; label: string; industry_source_id: string; market_cap_source_id: string | null };

// "no_business_claims" and "no_claims" mean every 10-K item read for them was
// read in full and holds none; "no_filing" means no issuer read as the subject
// has a 10-K on file; "incomplete_read" means no claim came back and an item
// was cut, unread, not found, or has an unread newer 10-K, an issuer has no
// 10-K, or a limit left filers out. `reads` and `no_filing` say what was read.
export type AnalystToolResult =
  | ({ tool: "get_company_profile" | "get_claims"; status: "ok"; claims: ReadonlyArray<FilingClaim> } & Reads)
  | ({ tool: "get_company_profile"; status: "no_business_claims" } & Reads)
  | ({ tool: "get_claims"; status: "no_claims" } & Reads)
  | ({ tool: "get_company_profile" | "get_claims"; status: "no_filing" | "incomplete_read" } & Reads)
  | { tool: "get_peer_set"; status: "ok"; company: string; industry: string; industry_source_id: string; peers: ReadonlyArray<PeerEntry> }
  | { tool: "get_peer_set"; status: "no_peers"; reason: "no_industry" | "no_same_industry_issuer" }
  | { tool: "get_analyst_consensus"; status: "ok"; company: string; captured_on: string; values: ReadonlyArray<ConsensusValue> }
  | { tool: "get_analyst_consensus"; status: "no_consensus" }
  | ({ tool: "get_non_gaap_history"; status: "ok"; company: string } & NonGaapHistory)
  | { tool: "get_non_gaap_history"; status: "no_releases" }
  | { tool: AnalystToolName; status: "no_subject" | "invalid_arguments" | "unavailable"; reason: string };

export const ANALYST_TOOL_NAMES = ["get_company_profile", "get_claims", "get_peer_set", "get_analyst_consensus", "get_non_gaap_history"] as const;
export type AnalystToolName = (typeof ANALYST_TOOL_NAMES)[number];

type Executor = (db: RowQueryExecutor, input: AnalystToolInput) => Promise<AnalystToolResult>;

const EXECUTORS: Readonly<Record<AnalystToolName, Executor>> = {
  get_company_profile: async (db, input) => {
    const { claims, ...read } = await loadLatestFilingClaims(db, { ...input, role: "subject", predicates: BUSINESS_PREDICATES });
    if (claims.length > 0) return { tool: "get_company_profile", status: "ok", claims, ...read };
    return { tool: "get_company_profile", status: emptyStatus(read) ?? "no_business_claims", ...read };
  },
  get_claims: async (db, input) => {
    const predicates = input.predicates ?? CLAIM_PREDICATES;
    const { claims, ...read } = await loadLatestFilingClaims(db, { ...input, role: input.role ?? "subject", predicates });
    if (claims.length > 0) return { tool: "get_claims", status: "ok", claims, ...read };
    return { tool: "get_claims", status: emptyStatus(read) ?? "no_claims", ...read };
  },
  get_peer_set: async (db, input) => {
    const issuerId = input.issuer_ids[0]!;
    const [primary, ...peers] = await sameIndustry(db, issuerId, input);
    if (primary?.issuer_id !== issuerId) return { tool: "get_peer_set", status: "no_peers", reason: "no_industry" };
    if (peers.length === 0) return { tool: "get_peer_set", status: "no_peers", reason: "no_same_industry_issuer" };
    return {
      tool: "get_peer_set",
      status: "ok",
      company: primary.label,
      industry: primary.industry,
      industry_source_id: primary.industry_source_id,
      peers: peers.map(({ industry: _industry, ...peer }) => peer),
    };
  },
  get_analyst_consensus: async (db, input) => {
    const issuerId = input.issuer_ids[0]!;
    const { rows } = await db.query<Omit<ConsensusValue, "label" | "provider"> & { provider: string; captured_on: string }>(
      `with cutoff as (select ($2::timestamptz at time zone 'UTC')::date as day),
            visible as (
              select cc.* from consensus_captures cc join sources s on s.source_id = cc.source_id
               where cc.issuer_id = $1::uuid and cc.retrieved_at <= $2::timestamptz and (s.user_id is null or s.user_id = $5::uuid)
            ),
            newest as (
              select max(captured_on) as day from visible, cutoff where captured_on <= cutoff.day
            )
       select cc.capture_id::text as capture_id, cc.source_id::text as source_id, s.provider,
              cc.captured_on::text as captured_on, cc.field_key, cc.raw_value, cc.unit, cc.fiscal_period
         from visible cc
         join sources s on s.source_id = cc.source_id
         join newest on cc.captured_on = newest.day
         cross join cutoff
        where cc.value is not null and newest.day >= cutoff.day - $4::int
        order by array_position($3::text[], cc.field_key), cc.source_id`,
      [issuerId, input.as_of, Object.keys(CONSENSUS_FIELDS), CONSENSUS_MAX_AGE_DAYS, input.user_id ?? null],
    );
    if (rows.length === 0) return { tool: "get_analyst_consensus", status: "no_consensus" };
    const [company] = await issuerLabels(db, [issuerId], input.as_of);
    return {
      tool: "get_analyst_consensus",
      status: "ok",
      company: company!.label,
      captured_on: rows[0]!.captured_on,
      values: rows.map(({ captured_on: _day, provider, ...value }) => ({
        ...value,
        provider: PROVIDERS[provider] ?? provider,
        label: CONSENSUS_FIELDS[value.field_key as keyof typeof CONSENSUS_FIELDS] ?? value.field_key,
      })),
    };
  },
  get_non_gaap_history: async (db, input) => {
    const issuerId = input.issuer_ids[0]!;
    const history = await loadNonGaapHistory(db, { issuer_id: issuerId, as_of: input.as_of, user_id: input.user_id ?? null });
    // Releases read that none could date are on file, which statusNote says.
    if (history.quarters.length === 0 && history.undated === 0) return { tool: "get_non_gaap_history", status: "no_releases" };
    const [company] = await issuerLabels(db, [issuerId], input.as_of);
    return { tool: "get_non_gaap_history", status: "ok", company: company!.label, ...history };
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
  get_non_gaap_history: new Set(["query", "subject_ref"]),
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

// Null when every item was read in full and nothing was left out.
function emptyStatus(read: Reads): "no_filing" | "incomplete_read" | null {
  if (read.reads.length === 0 && read.no_filing.length > 0) return "no_filing";
  const full = !read.truncated && read.no_filing.length === 0 && read.reads.every((item) => item.state === "read" && item.newer_unread === null);
  return full ? null : "incomplete_read";
}

// The issuer first, then its peers in the resolver's order (peer-set-resolver.ts),
// each of the same stored industry and evidenced by an enrichment holding that
// value, retrieved by the cutoff from a source the user may see; ranked by the
// latest such market cap fact known at the cutoff. Empty, or without the
// issuer first, when the issuer's own industry has no such evidence.
async function sameIndustry(db: RowQueryExecutor, issuerId: string, input: AnalystToolInput): Promise<Array<PeerEntry & { industry: string }>> {
  const { rows } = await db.query<PeerEntry & { industry: string }>(
    `with evidenced as (
       select i.issuer_id, i.industry,
              (select e.source_id from issuer_profile_enrichments e join sources s on s.source_id = e.source_id
                where e.issuer_id = i.issuer_id and e.field_name = 'industry' and e.field_value = i.industry
                  and e.retrieved_at <= $2::timestamptz and (s.user_id is null or s.user_id = $3::uuid)
                order by e.retrieved_at desc, e.source_id limit 1) as industry_source_id
         from issuers i
        where i.industry = (select industry from issuers where issuer_id = $1::uuid)
     )
     select ev.issuer_id::text as issuer_id, ${issuerLabelSql("i", "$2::timestamptz")} as label, ev.industry,
            ev.industry_source_id::text as industry_source_id, cap.source_id::text as market_cap_source_id
       from evidenced ev
       join issuers i on i.issuer_id = ev.issuer_id
       left join lateral (
         select f.value_num, f.source_id from facts f
           join metrics m on m.metric_id = f.metric_id
           join sources s on s.source_id = f.source_id
          where f.subject_kind = 'issuer' and f.subject_id = ev.issuer_id and m.metric_key = 'market_cap' and f.method = 'reported'
            and ${factKnownAtSql("f", "$2::timestamptz")} and (s.user_id is null or s.user_id = $3::uuid)
          order by f.as_of desc, f.created_at desc limit 1
       ) cap on true
      where ev.industry_source_id is not null
      order by ev.issuer_id = $1::uuid desc, cap.value_num desc nulls last, ev.issuer_id
      limit $4::int + 1`,
    [issuerId, input.as_of, input.user_id ?? null, input.peer_limit ?? DEFAULT_PEER_LIMIT],
  );
  return rows;
}
