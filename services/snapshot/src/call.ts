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
  assembleCall,
  balanceComponents,
  CALL_FIGURE_NODES,
  callInputOperations,
  canonicalDecimalString,
  hashCanonical,
  parseCallSettings,
  parseFinancialDecimal,
  type CallContent,
  type CallEngineFigure,
  type CallEvidence,
  type CallFactId,
  type CallSettings,
  type CallSource,
  type FinancialPlan,
  type UUID,
} from "../../financial-core/src/index.ts";
import { isRecord, type QueryExecutor } from "../../shared/src/http.ts";

export const CALL_KIND = "call";

export type CallRequest = Readonly<{
  /** The chat thread whose certified run the Call's inputs come from. */
  thread_id: string;
  inputs_snapshot_id: string;
  settings: CallSettings;
}>;

export type GeneratedCall = Readonly<{ content: CallContent; as_of: string; source_ids: ReadonlyArray<string> }>;

export type CallBlock = Readonly<{
  id: string;
  kind: typeof CALL_KIND;
  snapshot_id: string;
  data_ref: Readonly<{ kind: typeof CALL_KIND; id: string }>;
  source_refs: ReadonlyArray<string>;
  as_of: string;
  subject_refs: ReadonlyArray<Readonly<{ kind: "issuer"; id: string }>>;
  call: CallContent;
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
 * certificate of a Call inputs plan in this thread is sealed with it.
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
  if (plan.subjects.members.length !== 1 || member?.subject_ref.kind !== "issuer" || !isCallPlan(plan, member.slot_id)) return null;

  const certified = new Set(Array.isArray(result_ids) ? result_ids : []);
  const results = new Map((await db.query<{ result_id: string; node_id: string; disposition: string; payload: unknown }>(
    `select result_id::text as result_id, node_id, disposition, payload from financial_results where run_id = $1 and unit_id = $2`,
    [run_id, unit_id],
  )).rows.filter((row) => certified.has(row.result_id)).map((row) => [row.node_id, row]));
  const figures = Object.fromEntries(Object.entries(CALL_FIGURE_NODES).map(([id, node]) => [id, engineFigure(results.get(node))]));
  if (Object.values(figures).some((figure) => figure === null)) return null;

  const bindings = (await db.query<Binding>(
    `select i.input_slot, i.binding_status, i.gap_reason, i.payload_hash, i.bound_payload, s.canonical_url
       from financial_run_inputs i
       left join sources s on s.source_id::text = i.bound_payload->'source'->>'source_id'
      where i.run_id = $1
      order by i.input_slot`,
    [run_id],
  )).rows;
  const bound = new Map(bindings.flatMap((row) => row.binding_status === "bound" && row.bound_payload !== null ? [[row.input_slot, row] as const] : []));
  const citations = Object.fromEntries(Object.entries(CITED_SLOTS).map(([id, slots]) => [id, distinctSources(slots.flatMap((slot) => {
    const row = bound.get(slot);
    return row === undefined ? [] : [citation(row)];
  }))])) as Record<CallFactId, CallSource[]>;
  const period = (slot: string) => {
    const payload = bound.get(slot)?.bound_payload;
    return isRecord(payload?.period) && typeof payload.period.end === "string" ? payload.period.end : null;
  };
  const observed = bound.get("market_cap_px")?.bound_payload?.observed_at;

  const issuer = member.subject_ref.id;
  const callDate = new Date(plan.time.knowledge_cutoff).toISOString().slice(0, 10);
  const evidence: CallEvidence = {
    call_date: callDate,
    subject: { issuer_id: issuer, label: await subjectLabel(db, issuer) },
    settings: request.settings,
    inputs: {
      snapshot_id: request.inputs_snapshot_id.toLowerCase(),
      run_id,
      unit_id,
      fingerprint: hashCanonical("call_inputs", bindings.map((row) => ({ slot: row.input_slot, status: row.binding_status, payload_hash: row.payload_hash, gap_reason: row.gap_reason }))),
    },
    figures: figures as CallEvidence["figures"],
    citations,
    fiscal_year_end: period("operating_cash_flow"),
    price_date: typeof observed === "string" ? new Date(observed).toISOString().slice(0, 10) : null,
    consensus: await consensusCaptures(db, issuer, callDate),
  };
  const content = assembleCall(evidence);
  const cited = [...content.facts, ...content.requires].flatMap((row) => row.citations.map((entry) => entry.source_id));
  return { content, as_of: new Date(plan.time.knowledge_cutoff).toISOString(), source_ids: [...new Set(cited)] };
}

function isCallPlan(plan: FinancialPlan, slot: string): boolean {
  const expected = callInputOperations(slot);
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

// A bound fact cites its filing, the period it is for and the date it was public by; a bound price its observation's day.
function citation(row: Binding): CallSource {
  const payload = row.bound_payload!;
  const source = payload.source as { source_id: UUID };
  if (typeof payload.observation_id === "string") {
    return { source_id: source.source_id, accession: null, period_end: null, date: new Date(payload.observed_at as string).toISOString().slice(0, 10) };
  }
  const period = payload.period as { end: string };
  const publication = payload.publication as { available_no_later_than: string };
  return {
    source_id: source.source_id,
    accession: ACCESSION.exec(row.canonical_url ?? "")?.[1] ?? null,
    period_end: period.end,
    // The filing day in its own timezone, as the attestation states it.
    date: publication.available_no_later_than.slice(0, 10),
  };
}

function distinctSources(sources: ReadonlyArray<CallSource>): CallSource[] {
  return [...new Map(sources.map((source) => [`${source.source_id}|${source.period_end}`, source])).values()];
}

// The ticker of the issuer's one common-stock listing; its legal name otherwise.
async function subjectLabel(db: QueryExecutor, issuerId: string): Promise<string> {
  const { rows } = await db.query<{ ticker: string | null; legal_name: string }>(
    `select l.ticker, i.legal_name
       from issuers i
       left join instruments n on n.issuer_id = i.issuer_id and n.asset_type = 'common_stock'
       left join listings l on l.instrument_id = n.instrument_id
      where i.issuer_id = $1::uuid`,
    [issuerId],
  );
  return rows.length === 1 && rows[0]!.ticker !== null ? rows[0]!.ticker : rows[0]?.legal_name ?? issuerId;
}

// The issuer's Finviz five-year EPS growth captures in the 7 days up to the Call date.
async function consensusCaptures(db: QueryExecutor, issuerId: string, callDate: string): Promise<CallEvidence["consensus"]> {
  const { rows } = await db.query<{ source_id: string; captured_on: string; value: string | null }>(
    `select source_id::text as source_id, captured_on::text as captured_on, value::text as value
       from consensus_captures
      where issuer_id = $1::uuid and field_key = 'eps_growth_next_5y' and captured_on <= $2::date and captured_on >= $2::date - 7
      order by captured_on, source_id`,
    [issuerId, callDate],
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
