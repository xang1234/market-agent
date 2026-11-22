// A Call's seal (ADR 0005, #604), like a scenario price comparison's (#224):
// the seal loads the certified run a Call's inputs come from, in its
// transaction, generates the whole Call again with the function chat
// generated it with, and requires exact equality. A row in `calls` (0082)
// binds the sealed block's hash, the Call date, the settings it used and a
// fingerprint of its bound inputs.
//
// A Call is an opinion, never evidence: no read awards it a proof
// (block-proof.ts), and nothing here writes a fact or a source.

import { isDeepStrictEqual } from "node:util";

import {
  ANCHOR_FISCAL_YEARS,
  assembleCall,
  assembleCallV1,
  balanceComponents,
  CALL_FIGURE_NODES,
  callHistoryNodes,
  callInputOperations,
  callModelOperations,
  canonicalDecimalString,
  hashCanonical,
  localDateOf,
  parseCallSettings,
  parseFinancialDecimal,
  type CallCloses,
  type CallContent,
  type CallContentV1,
  type CallEngineFigure,
  type CallEvidence,
  type CallEvidenceV1,
  type CallFactId,
  type CallSettings,
  type CallSource,
  type FinancialPlan,
  type UUID,
} from "../../financial-core/src/index.ts";
import { loadSubjectSplitHistory } from "../../market/src/split-history.ts";
import { isRecord, type QueryExecutor } from "../../shared/src/http.ts";

export const CALL_KIND = "call";

export type CallRequest = Readonly<{
  /** The chat thread whose certified run the Call's inputs come from. */
  thread_id: string;
  inputs_snapshot_id: string;
  settings: CallSettings;
}>;

export type GeneratedCall = Readonly<{ content: CallContent | CallContentV1; as_of: string; source_ids: ReadonlyArray<string> }>;

export type CallBlock = Readonly<{
  id: string;
  kind: typeof CALL_KIND;
  snapshot_id: string;
  data_ref: Readonly<{ kind: typeof CALL_KIND; id: string }>;
  source_refs: ReadonlyArray<string>;
  as_of: string;
  subject_refs: ReadonlyArray<Readonly<{ kind: "issuer"; id: string }>>;
  call: CallContent | CallContentV1;
}>;

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ACCESSION = /(\d{10}-\d{2}-\d{6})-index\.htm$/u;
// The engine nodes whose bound inputs each fact cites.
const CITED_SLOTS: Readonly<Record<CallFactId, ReadonlyArray<string>>> = {
  free_cash_flow: ["operating_cash_flow", "capex"],
  net_cash: balanceComponents("net_cash").map((component) => component.metric_key),
  stock_based_compensation: ["stock_based_compensation"],
  shares_outstanding: ["market_cap_shares"],
  share_price: ["market_cap_px"],
};

type Binding = Readonly<{ input_slot: string; binding_status: string; gap_reason: string | null; payload_hash: string | null; bound_payload: Record<string, unknown> | null; canonical_url: string | null }>;

/**
 * The Call on the certified run a thread's snapshot holds, or null when no
 * certificate of a Call inputs plan in this thread is sealed with it. A run
 * of the plan Calls had before the anchor (#605) regenerates as call.v1.
 */
export async function generateCall(db: QueryExecutor, request: CallRequest): Promise<GeneratedCall | null> {
  if (!UUID_TEXT.test(request.inputs_snapshot_id) || !UUID_TEXT.test(request.thread_id)) return null;
  const certificates = (await db.query<{ run_id: string; unit_id: string; result_ids: unknown; plan: FinancialPlan }>(
    `select c.run_id::text as run_id, c.unit_id, c.result_ids, p.plan
       from snapshot_financial_runs c
       join financial_runs r on r.run_id = c.run_id
       join financial_plans p on p.plan_id = r.plan_id and p.user_id = r.user_id
      where c.snapshot_id = $1::uuid and r.parent_kind = 'chat_thread' and r.parent_id = $2::uuid`,
    [request.inputs_snapshot_id, request.thread_id],
  )).rows;
  if (certificates.length !== 1) return null;
  const [{ run_id, unit_id, result_ids, plan }] = certificates as [typeof certificates[number]];
  const [member] = plan.subjects.members;
  if (plan.subjects.members.length !== 1 || member?.subject_ref.kind !== "issuer") return null;
  const anchored = isPlan(plan, callInputOperations(member.slot_id));
  if (!anchored && !isPlan(plan, callModelOperations(member.slot_id))) return null;
  const issuer = member.subject_ref.id;
  const listing = await subjectListing(db, issuer, plan.time.knowledge_cutoff);
  // The Call and its price are dated on the listing's calendar (#614), in the plan's own zone when the issuer's listings share none.
  const zone = listing.timezone ?? plan.time.cutoff_timezone;
  const localDate = (instant: string) => localDateOf(Date.parse(instant), zone);

  const certified = new Set(Array.isArray(result_ids) ? result_ids : []);
  const results = new Map((await db.query<{ result_id: string; node_id: string; disposition: string; payload: unknown }>(
    `select result_id::text as result_id, node_id, disposition, payload from financial_results where run_id = $1 and unit_id = $2`,
    [run_id, unit_id],
  )).rows.filter((row) => certified.has(row.result_id)).map((row) => [row.node_id, row]));
  const figures = Object.fromEntries(Object.entries(CALL_FIGURE_NODES).map(([id, node]) => [id, engineFigure(results.get(node))]));
  if (Object.values(figures).some((figure) => figure === null)) return null;
  const yearFigures = Array.from({ length: ANCHOR_FISCAL_YEARS }, (_, offset) => {
    const nodes = callHistoryNodes(offset);
    return { free_cash_flow: engineFigure(results.get(nodes.free_cash_flow)), net_cash: engineFigure(results.get(nodes.net_cash)), shares: engineFigure(results.get(nodes.shares)) };
  });
  if (anchored && yearFigures.some((year) => Object.values(year).some((figure) => figure === null))) return null;

  const bindings = (await db.query<Binding>(
    `select i.input_slot, i.binding_status, i.gap_reason, i.payload_hash, i.bound_payload, s.canonical_url
       from financial_run_inputs i
       left join sources s on s.source_id::text = i.bound_payload->'source'->>'source_id'
      where i.run_id = $1
      order by i.input_slot`,
    [run_id],
  )).rows;
  const bound = new Map(bindings.flatMap((row) => row.binding_status === "bound" && row.bound_payload !== null ? [[row.input_slot, row] as const] : []));
  const cited = (slots: ReadonlyArray<string>) => distinctSources(slots.flatMap((slot) => {
    const row = bound.get(slot);
    return row === undefined ? [] : [citation(row, localDate)];
  }));
  const citations = Object.fromEntries(Object.entries(CITED_SLOTS).map(([id, slots]) => [id, cited(slots)])) as Record<CallFactId, CallSource[]>;
  const period = (slot: string) => {
    const payload = bound.get(slot)?.bound_payload;
    return isRecord(payload?.period) && typeof payload.period.end === "string" ? payload.period.end : null;
  };
  const observed = bound.get("market_cap_px")?.bound_payload?.observed_at;
  const capexInference = bound.get("capex")?.bound_payload?.inference;
  const ocfScope = (slot: string): CallEvidence["ocf_scope"] => {
    const inference = bound.get(slot)?.bound_payload?.inference;
    return isRecord(inference) && inference.kind === "continuing_operations_ocf"
      ? { kind: "continuing_operations_ocf", concept: "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations" }
      : null;
  };

  const callDate = localDate(plan.time.knowledge_cutoff);
  const bindingsHashed = bindings.map((row) => ({ slot: row.input_slot, status: row.binding_status, payload_hash: row.payload_hash, gap_reason: row.gap_reason }));
  // A call.v1 Call is assembled from these alone, its fingerprint over the bindings alone.
  const evidenceV1: CallEvidenceV1 = {
    call_date: callDate,
    listing_timezone: zone,
    subject: { issuer_id: issuer, label: listing.label },
    settings: request.settings,
    inputs: { snapshot_id: request.inputs_snapshot_id.toLowerCase(), run_id, unit_id, fingerprint: hashCanonical("call_inputs", bindingsHashed) },
    figures: figures as CallEvidence["figures"],
    citations,
    fiscal_year_end: period("operating_cash_flow"),
    price_date: typeof observed === "string" ? localDate(observed) : null,
    capex_scope: isRecord(capexInference) && capexInference.kind === "productive_assets_capex"
      ? { kind: "productive_assets_capex", concept: "PaymentsToAcquireProductiveAssets" }
      : null,
    ocf_scope: ocfScope("operating_cash_flow"),
    consensus: await consensusCaptures(db, issuer, callDate, plan.time.knowledge_cutoff),
  };
  const generated = (content: CallContent | CallContentV1): GeneratedCall => {
    const sources = [...content.facts, ...content.assumptions, ...content.requires].flatMap((row) => row.citations.map((entry) => entry.source_id));
    return { content, as_of: new Date(plan.time.knowledge_cutoff).toISOString(), source_ids: [...new Set(sources)] };
  };
  if (!anchored) return generated(assembleCallV1(evidenceV1));
  // The anchor's years count back from the latest year's: a latest offset k is that fiscal year less k.
  const latestPayload = bound.get("operating_cash_flow")?.bound_payload;
  const latestYear = isRecord(latestPayload?.period) && typeof latestPayload.period.fiscal_year === "number" ? latestPayload.period.fiscal_year : null;
  const history: CallEvidence["history"] = latestYear === null ? [] : yearFigures.map((year, offset) => {
    const nodes = callHistoryNodes(offset);
    return {
      fiscal_year: latestYear - offset,
      period_end: period(nodes.cited.free_cash_flow[0]!),
      figures: year as CallEvidence["history"][number]["figures"],
      citations: { free_cash_flow: cited(nodes.cited.free_cash_flow), net_cash: cited(nodes.cited.net_cash), shares: cited(nodes.cited.shares) },
      ocf_scope: ocfScope(nodes.cited.free_cash_flow[0]!),
    };
  });
  // The listing whose splits the engine restated the counts with, and whose closes the anchor prices them at.
  // A split after the Call date is not one the Call could know, so it never enters the Call or its fingerprint.
  const splitHistory = await loadSubjectSplitHistory(db, { kind: "issuer", id: issuer }, plan.time.knowledge_cutoff);
  const splits = splitHistory.status === "ok"
    ? splitHistory.splits.filter((split) => split.execution_date <= callDate).map(({ execution_date, split_from, split_to }) => ({ execution_date, split_from, split_to }))
    : null;
  const closes = splitHistory.status === "ok" ? await closeCapture(db, splitHistory.listing_id, plan.time.knowledge_cutoff) : null;

  return generated(assembleCall({
    ...evidenceV1,
    inputs: { ...evidenceV1.inputs, fingerprint: hashCanonical("call_inputs", { bindings: bindingsHashed, closes, splits }) },
    history,
    closes,
    splits,
  }));
}

// Whether a plan's operations are exactly these.
function isPlan(plan: FinancialPlan, expected: ReadonlyArray<Readonly<Record<string, unknown> & { node_id: string }>>): boolean {
  if (plan.operations.length !== expected.length) return false;
  return expected.every((node) => {
    const planned = plan.operations.find((candidate) => candidate.node_id === node.node_id) as Record<string, unknown> | undefined;
    return planned !== undefined && Object.entries(node).every(([key, value]) => isDeepStrictEqual(planned[key], value));
  });
}

function engineFigure(result: { disposition: string; payload: unknown } | undefined): CallEngineFigure | null {
  const payload = result?.payload;
  if (!isRecord(payload)) return null;
  if (result!.disposition === "verified" && payload.kind === "value" && typeof payload.value === "string") {
    const currency = isRecord(payload.unit) && typeof payload.unit.currency === "string" ? payload.unit.currency : null;
    return { kind: "value", value: payload.value, currency };
  }
  if (payload.kind === "gap" && typeof payload.reason_code === "string") {
    return { kind: "gap", disposition: result!.disposition as Extract<CallEngineFigure, { kind: "gap" }>["disposition"], reason_code: payload.reason_code as Extract<CallEngineFigure, { kind: "gap" }>["reason_code"] };
  }
  return null;
}

// A bound fact cites its filing, the period it is for and the date it was public by; a bound price its observation's day on the listing's calendar.
function citation(row: Binding, localDate: (instant: string) => string): CallSource {
  const payload = row.bound_payload!;
  const source = payload.source as { source_id: UUID };
  if (typeof payload.observation_id === "string") {
    return { source_id: source.source_id, accession: null, period_end: null, date: localDate(payload.observed_at as string) };
  }
  const period = payload.period as { end: string };
  const publication = payload.publication as { available_no_later_than: string };
  return {
    source_id: source.source_id,
    accession: ACCESSION.exec(row.canonical_url ?? "")?.[1] ?? null,
    period_end: period.end,
    // The filing day on the Call's calendar, so it is never after the Call date (#614).
    date: localDate(publication.available_no_later_than),
  };
}

function distinctSources(sources: ReadonlyArray<CallSource>): CallSource[] {
  return [...new Map(sources.map((source) => [`${source.source_id}|${source.period_end}`, source])).values()];
}

// The ticker of the issuer's one common-stock listing active at the cutoff, its legal name otherwise, and the
// time zone all those listings share. Active as price selection reads it (loadSubjectSplitHistory), so a former
// listing in another zone does not move the Call off its price's calendar.
async function subjectListing(db: QueryExecutor, issuerId: string, cutoff: string): Promise<Readonly<{ label: string; timezone: string | null }>> {
  const { rows } = await db.query<{ ticker: string | null; legal_name: string; timezone: string | null }>(
    `select l.ticker, i.legal_name, l.timezone
       from issuers i
       left join instruments n on n.issuer_id = i.issuer_id and n.asset_type = 'common_stock'
       left join listings l on l.instrument_id = n.instrument_id
        and (l.active_from is null or l.active_from <= $2::timestamptz)
        and (l.active_to is null or l.active_to > $2::timestamptz)
      where i.issuer_id = current_issuer_id($1::uuid)`,
    [issuerId, cutoff],
  );
  // An instrument with no active listing joins as an empty row: it is no listing.
  const listings = rows.filter((row) => row.timezone !== null);
  const zones = new Set(listings.map((row) => row.timezone));
  return {
    label: listings.length === 1 && listings[0]!.ticker !== null ? listings[0]!.ticker : rows[0]?.legal_name ?? issuerId,
    timezone: zones.size === 1 ? [...zones][0] ?? null : null,
  };
}

/**
 * The listing's newest close capture retrieved by the cutoff, whole: a later
 * split restates every earlier close, so a capture is one basis (0081).
 */
async function closeCapture(db: QueryExecutor, listingId: string, cutoff: string): Promise<CallCloses | null> {
  const { rows } = await db.query<{ source_id: string; retrieved_at: Date; currency: string; trade_date: string; close_text: string }>(
    `with newest as (
       select source_id, captured_on from daily_close_captures
        where listing_id = $1::uuid and retrieved_at <= $2::timestamptz
        order by captured_on desc, retrieved_at desc, source_id
        limit 1)
     select d.source_id::text as source_id, d.retrieved_at, d.currency, d.trade_date::text as trade_date, d.close_text
       from daily_close_captures d join newest using (source_id, captured_on)
      where d.listing_id = $1::uuid
      order by d.trade_date`,
    [listingId, cutoff],
  );
  const [first] = rows;
  if (first === undefined) return null;
  return { source_id: first.source_id, retrieved_at: first.retrieved_at.toISOString(), currency: first.currency, closes: rows.map(({ trade_date, close_text }) => ({ trade_date, close_text })) };
}

// The issuer's Finviz five-year EPS growth captures in the 7 days up to the Call date, retrieved by its cutoff.
async function consensusCaptures(db: QueryExecutor, issuerId: string, callDate: string, cutoff: string): Promise<CallEvidence["consensus"]> {
  const { rows } = await db.query<{ source_id: string; captured_on: string; value: string | null }>(
    `select source_id::text as source_id, captured_on::text as captured_on, value::text as value
       from consensus_captures
      where issuer_id = current_issuer_id($1::uuid) and field_key = 'eps_growth_next_5y' and captured_on <= $2::date and captured_on >= $2::date - 7
        and retrieved_at <= $3::timestamptz
      order by captured_on, source_id`,
    [issuerId, callDate, cutoff],
  );
  return rows.map((row) => {
    const parsed = row.value === null ? null : parseFinancialDecimal(row.value);
    return { source_id: row.source_id, captured_on: row.captured_on, eps_growth_next_5y: parsed?.ok ? canonicalDecimalString(parsed.value) : null };
  });
}

/** The block a generated Call is shown in. Its as_of is the inputs' knowledge cutoff. */
export function callBlock(id: string, snapshotId: string, generated: GeneratedCall): CallBlock {
  return {
    id,
    kind: CALL_KIND,
    snapshot_id: snapshotId,
    data_ref: { kind: CALL_KIND, id },
    source_refs: generated.source_ids,
    as_of: generated.as_of,
    subject_refs: [{ kind: "issuer", id: generated.content.subject.issuer_id }],
    call: generated.content,
  };
}

/** The hash a Call's seal binds its whole block by (0082); canonical, so the block read back from jsonb hashes the same. */
export function callBlockHash(block: CallBlock): string {
  return hashCanonical("call", block);
}

/** Binds a sealed Call's snapshot to its inputs' certificate, its date, settings, inputs fingerprint and block hash (0082), in the seal's transaction. */
export async function recordCall(db: QueryExecutor, block: CallBlock): Promise<void> {
  const { inputs, call_date, settings } = block.call;
  await db.query(
    `insert into calls (snapshot_id, inputs_snapshot_id, inputs_run_id, inputs_unit_id, call_date, settings, inputs_fingerprint, content_hash)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5::date, $6::jsonb, $7, $8)`,
    [block.snapshot_id, inputs.snapshot_id, inputs.run_id, inputs.unit_id, call_date, JSON.stringify(settings), inputs.fingerprint, callBlockHash(block)],
  );
}

export type CallSealFailure = Readonly<{ block_id: string; reason: "unverifiable" | "request" | "inputs" | "block" }>;

/**
 * Each Call block, generated again from the certificate and settings it names
 * through the seal's transaction client, and rebuilt whole under its id and
 * snapshot: every field must be what generation gives.
 */
export async function verifyCalls(
  blocks: ReadonlyArray<{ id: string; snapshot_id: string; call?: unknown }>,
  threadId: string | null,
  db: QueryExecutor | undefined,
): Promise<CallSealFailure[]> {
  const failures: CallSealFailure[] = [];
  for (const block of blocks) {
    const fail = (reason: CallSealFailure["reason"]) => failures.push({ block_id: block.id, reason });
    if (db === undefined || threadId === null) {
      fail("unverifiable");
      continue;
    }
    const call = block.call;
    const settings = isRecord(call) ? parseCallSettings(call.settings) : null;
    const inputs = isRecord(call) && isRecord(call.inputs) ? call.inputs.snapshot_id : null;
    if (settings === null || typeof inputs !== "string") {
      fail("request");
      continue;
    }
    const generated = await generateCall(db, { thread_id: threadId, inputs_snapshot_id: inputs, settings });
    if (generated === null) {
      fail("inputs");
      continue;
    }
    if (!isDeepStrictEqual(callBlock(block.id, block.snapshot_id, generated), JSON.parse(JSON.stringify(block)))) fail("block");
  }
  return failures;
}
