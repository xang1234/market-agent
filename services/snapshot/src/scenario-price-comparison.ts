// A comparison block's seal (#224), like a price chart's (#236): the seal
// loads the records the comparison names, in its transaction, generates the
// whole comparison again with the function chat generated it with, and
// requires exact equality. Read-back trusts the seal through the binding it
// writes (0079) of the whole block, in the message its seal saved it in, and
// checks on every read that the sealed scenario's
// certificate stands and the EPS's and the price's sources are still public
// (block-proof.ts).
//
// It reads only ledger and market tables: the scenario is the certificate a
// snapshot of this chat thread holds, its values the certified results, its
// EPS anchor the bound input's split adjustment.

import { isDeepStrictEqual } from "node:util";

import {
  compareScenarioToPrice,
  comparisonWindow,
  scenarioMultiple,
  SCENARIOS,
  type BoundFactInputV1,
  type ComparisonContent,
  type ComparisonTime,
  type FinancialPlan,
  type SealedScenario,
  type SourceClass,
} from "../../financial-core/src/index.ts";
import { loadScenarioCloseCandidates } from "../../market/src/price-observations.ts";
import { loadListingSplits } from "../../market/src/split-history.ts";
import { regularSessionCloseAt } from "../../market/src/ytd-window.ts";
import { comparisonBlockHash, comparisonProofKey } from "./block-proof.ts";
import { isRecord, type QueryExecutor } from "../../shared/src/http.ts";

export const SCENARIO_PRICE_COMPARISON_KIND = "scenario_price_comparison";

export type ComparisonRequest = Readonly<{
  /** The chat thread whose sealed scenario answer this compares. */
  thread_id: string;
  scenario_snapshot_id: string;
  requested: ComparisonTime;
  received_at: string;
}>;

export type GeneratedComparison = Readonly<{
  content: ComparisonContent;
  /** The sources the block cites: the scenario's EPS source, then the price's when it shows one. */
  source_ids: ReadonlyArray<string>;
  /** The listing the price is of, when the EPS names one. */
  listing_id: string | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * The comparison of the scenario a thread's snapshot certifies, or null when
 * no certificate of a P/E scenario answer in this thread is sealed with it.
 */
export async function generateScenarioPriceComparison(db: QueryExecutor, request: ComparisonRequest): Promise<GeneratedComparison | null> {
  const scenario = await loadSealedScenario(db, request);
  if (scenario === null) return null;
  const anchor = scenario.sealed.eps_anchor;
  const listing = anchor === null ? null : (await db.query<{ listing_id: string; ticker: string; timezone: string }>(
    `select listing_id::text as listing_id, ticker, timezone from listings where listing_id = $1::uuid`,
    [anchor.listing_id],
  )).rows[0] ?? null;
  const window = listing === null ? null : comparisonWindow(request.requested, request.received_at, listing.timezone);
  const closes = listing === null || window === null || window === "future"
    ? { candidates: [], unknown_publication: false }
    : await loadScenarioCloseCandidates(db, listing.listing_id, window);
  const history = listing === null ? null : await loadListingSplits(db, listing.listing_id);
  const content = compareScenarioToPrice({
    scenario: scenario.sealed,
    requested: request.requested,
    received_at: request.received_at,
    listing: listing === null ? null : { ...listing, session_close_at: (date) => regularSessionCloseAt(date, listing.timezone) },
    closes,
    splits: history === null || history.checked_at === null ? null : { checked_at: history.checked_at, splits: history.splits },
  });
  const priceSource = content.outcome.kind === "comparison" ? [content.outcome.price.source_id] : [];
  return { content, source_ids: [...new Set([scenario.eps_source_id, ...priceSource])], listing_id: listing?.listing_id ?? null };
}

type LoadedScenario = Readonly<{ sealed: SealedScenario; eps_source_id: string }>;

async function loadSealedScenario(db: QueryExecutor, request: ComparisonRequest): Promise<LoadedScenario | null> {
  if (!UUID.test(request.scenario_snapshot_id) || !UUID.test(request.thread_id)) return null;
  const certificates = (await db.query<{ run_id: string; unit_id: string; presentation_hash: string; result_ids: unknown; plan: FinancialPlan; allowed_source_classes: SourceClass[] }>(
    `select c.run_id::text as run_id, c.unit_id, c.presentation_hash, c.result_ids, p.plan, r.allowed_source_classes
       from snapshot_financial_runs c
       join financial_runs r on r.run_id = c.run_id
       join financial_plans p on p.plan_id = r.plan_id and p.user_id = r.user_id
      where c.snapshot_id = $1::uuid and r.parent_kind = 'chat_thread' and r.parent_id = $2::uuid`,
    [request.scenario_snapshot_id, request.thread_id],
  )).rows;
  if (certificates.length !== 1) return null;
  const [{ run_id, unit_id, presentation_hash, result_ids, plan, allowed_source_classes }] = certificates as [typeof certificates[number]];
  const nodes = plan.operations.flatMap((node) => node.operation === "scenario_eps_multiple" ? [node] : []);
  const earnings = new Set(nodes.map((node) => node.earnings));
  if (plan.schema_version !== "financial_plan.v2" || nodes.length !== SCENARIOS.length || earnings.size !== 1) return null;
  const outputs = new Map(plan.outputs.filter((output) => output.unit_id === unit_id).map((output) => [output.node_id, output.output_id]));
  const certified = new Set(Array.isArray(result_ids) ? result_ids : []);
  const results = new Map((await db.query<{ result_id: string; output_id: string; disposition: string; payload: unknown }>(
    `select result_id::text as result_id, output_id, disposition, payload from financial_results where run_id = $1 and unit_id = $2`,
    [run_id, unit_id],
  )).rows.filter((row) => certified.has(row.result_id)).map((row) => [row.output_id, row]));

  const multiples = nodes.map((node) => ({ node, ...scenarioMultiple(plan, node) }));
  const rows = SCENARIOS.map((name) => {
    const entry = multiples.find((multiple) => multiple.assumption.scenario === name);
    const result = entry && results.get(outputs.get(entry.node.node_id) ?? "");
    if (!entry || !result) return null;
    const payload = result.payload;
    const value = result.disposition === "verified" && isRecord(payload) && payload.kind === "value" && typeof payload.value === "string" &&
        isRecord(payload.unit) && payload.unit.kind === "currency_per_share" && typeof payload.unit.currency === "string"
      ? { value: payload.value, currency: payload.unit.currency }
      : null;
    return { scenario: name, result_id: result.result_id, multiple_text: entry.multiple_text, value };
  });
  if (rows.some((row) => row === null)) return null;

  const [slot] = earnings;
  const binding = (await db.query<{ bound_payload: BoundFactInputV1; available: boolean }>(
    `select i.bound_payload,
            (f.fact_id is not null and f.invalidated_at is null and s.source_id is not null and s.user_id is null) as available
       from financial_run_inputs i
       left join facts f on f.fact_id = i.fact_id
       left join sources s on s.source_id = f.source_id
      where i.run_id = $1 and i.input_slot = $2 and i.binding_status = 'bound' and i.fact_id is not null`,
    [run_id, slot],
  )).rows[0];
  if (binding === undefined) return null;
  const { bound_payload: eps } = binding;
  return {
    eps_source_id: eps.source.source_id,
    sealed: {
      ref: { snapshot_id: request.scenario_snapshot_id.toLowerCase(), run_id, unit_id, presentation_hash },
      rows: rows as SealedScenario["rows"],
      available: binding.available,
      eps_publication: {
        available_no_later_than: eps.publication.available_no_later_than,
        timing_precision: eps.publication.precision,
        source_timezone: eps.publication.source_timezone,
      },
      eps_anchor: eps.split_adjustment === undefined ? null : { listing_id: eps.split_adjustment.listing_id, reference_date: eps.split_adjustment.reference_date },
      allowed_source_classes,
    },
  };
}

export type ComparisonBlock = Readonly<{
  id: string;
  kind: typeof SCENARIO_PRICE_COMPARISON_KIND;
  snapshot_id: string;
  data_ref: Readonly<{ kind: typeof SCENARIO_PRICE_COMPARISON_KIND; id: string }>;
  source_refs: ReadonlyArray<string>;
  as_of: string;
  subject_refs: ReadonlyArray<Readonly<{ kind: "listing"; id: string }>>;
  comparison: ComparisonContent;
}>;

/** The block a generated comparison is shown in. Its as_of is the comparison's cutoff. */
export function scenarioPriceComparisonBlock(id: string, snapshotId: string, generated: GeneratedComparison): ComparisonBlock {
  const { content } = generated;
  return {
    id,
    kind: SCENARIO_PRICE_COMPARISON_KIND,
    snapshot_id: snapshotId,
    data_ref: { kind: SCENARIO_PRICE_COMPARISON_KIND, id },
    source_refs: generated.source_ids,
    as_of: new Date(Date.parse(content.cutoff?.at ?? content.received_at)).toISOString(),
    subject_refs: generated.listing_id === null ? [] : [{ kind: "listing", id: generated.listing_id }],
    comparison: content,
  };
}

/**
 * Binds a sealed comparison's snapshot to the scenario it compares and the
 * block its seal generated (0079), in the seal's transaction: a read links
 * only a block so bound, and erasing the scenario's certificate erases it.
 */
export async function recordScenarioPriceComparison(db: QueryExecutor, block: ComparisonBlock): Promise<void> {
  const { scenario } = block.comparison;
  await db.query(
    `insert into scenario_price_comparisons (snapshot_id, scenario_snapshot_id, scenario_run_id, scenario_unit_id, content_hash)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5)`,
    [block.snapshot_id, scenario.snapshot_id, scenario.run_id, scenario.unit_id, comparisonBlockHash(block)],
  );
}

export type ComparisonSealFailure = Readonly<{ block_id: string; reason: "unverifiable" | "request" | "scenario" | "content" | "sources" | "subject" | "block" }>;

/**
 * Each comparison block, generated again from the records it names through
 * the seal's transaction client, and rebuilt whole under its id and snapshot:
 * every field must be what generation gives. Without a client, or outside a
 * chat thread, nothing can be checked and the seal fails.
 */
export async function verifyScenarioPriceComparisons(
  blocks: ReadonlyArray<{ id: string; snapshot_id: string; source_refs: ReadonlyArray<string>; subject_refs?: ReadonlyArray<unknown>; comparison?: unknown }>,
  threadId: string | null,
  db: QueryExecutor | undefined,
): Promise<ComparisonSealFailure[]> {
  const failures: ComparisonSealFailure[] = [];
  for (const block of blocks) {
    const fail = (reason: ComparisonSealFailure["reason"]) => failures.push({ block_id: block.id, reason });
    if (db === undefined || threadId === null) {
      fail("unverifiable");
      continue;
    }
    const request = comparisonRequest(block.comparison, threadId);
    if (request === null) {
      fail("request");
      continue;
    }
    const generated = await generateScenarioPriceComparison(db, request);
    if (generated === null) {
      fail("scenario");
      continue;
    }
    const expected = scenarioPriceComparisonBlock(block.id, block.snapshot_id, generated);
    if (!isDeepStrictEqual(expected.comparison, block.comparison)) fail("content");
    else if (!isDeepStrictEqual(expected.source_refs, [...block.source_refs])) fail("sources");
    else if (!isDeepStrictEqual(expected.subject_refs, [...(block.subject_refs ?? [])])) fail("subject");
    else if (!isDeepStrictEqual(expected, plain(block))) fail("block");
  }
  return failures;
}

// The block's own fields, as plain data: normalization freezes them and leaves unset ones undefined.
function plain(block: object): unknown {
  return JSON.parse(JSON.stringify(block));
}

// What a sealed comparison says it was asked: the scenario's snapshot, the time, and when the question arrived.
function comparisonRequest(comparison: unknown, threadId: string): ComparisonRequest | null {
  if (!isRecord(comparison) || !isRecord(comparison.scenario) || !isRecord(comparison.requested)) return null;
  const { scenario, requested, received_at } = comparison;
  const time: ComparisonTime | null =
    requested.kind === "latest" && Object.keys(requested).length === 1 ? { kind: "latest" }
    : requested.kind === "instant" && validInstant(requested.at) ? { kind: "instant", at: requested.at as string }
    : requested.kind === "session_date" && typeof requested.date === "string" && ISO_DATE.test(requested.date) && validInstant(`${requested.date}T00:00:00Z`)
      ? { kind: "session_date", date: requested.date }
    : null;
  if (time === null || typeof scenario.snapshot_id !== "string" || !validInstant(received_at)) return null;
  return { thread_id: threadId, scenario_snapshot_id: scenario.snapshot_id, requested: time, received_at: received_at as string };
}

function validInstant(value: unknown): boolean {
  return typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * The comparison blocks among `blocks` that a seal bound, whole as stored, whose
 * sealed scenario still has its certificate, by proof key: what a read checks
 * besides the manifest. Each says whether every source its snapshot sealed,
 * the EPS's and the price's, is still public, with the price's close still
 * of that source. Erasing the scenario's evidence erases the comparison with
 * its certificate (0079); a source made private is no longer public evidence.
 */
export async function liveScenarioComparisons(db: QueryExecutor, blocks: ReadonlyArray<unknown>): Promise<Array<{ snapshot_id: string; key: string; sources_public: boolean }>> {
  const shown = blocks.flatMap((block) => {
    if (!isRecord(block) || block.kind !== SCENARIO_PRICE_COMPARISON_KIND) return [];
    const key = comparisonProofKey(block);
    if (key === null) return [];
    const { price } = (block.comparison as ComparisonContent & { outcome: { kind: "comparison" } }).outcome;
    const ids = [block.snapshot_id, price.observation_id, price.source_id];
    return ids.every((id) => typeof id === "string" && UUID.test(id))
      ? [{ key, snapshot_id: block.snapshot_id as string, content_hash: comparisonBlockHash(block)!, price }]
      : [];
  });
  if (shown.length === 0) return [];
  const { rows } = await db.query<{ snapshot_id: string; key: string; sources_public: boolean }>(
    `select k.snapshot_id::text as snapshot_id, k.key,
            exists (select 1 from price_observations o join sources s on s.source_id = o.source_id and s.user_id is null
                     where o.observation_id = k.observation_id and o.source_id = k.source_id)
            and not exists (select 1 from snapshots n cross join jsonb_array_elements_text(n.source_ids) as sealed(source_id)
                              left join sources s on s.source_id::text = sealed.source_id and s.user_id is null
                             where n.snapshot_id = k.snapshot_id and s.source_id is null) as sources_public
       from unnest($1::text[], $2::uuid[], $3::text[], $4::uuid[], $5::uuid[]) as k(key, snapshot_id, content_hash, observation_id, source_id)
       join scenario_price_comparisons b on b.snapshot_id = k.snapshot_id and b.content_hash = k.content_hash
       join snapshot_financial_runs c on c.snapshot_id = b.scenario_snapshot_id and c.run_id = b.scenario_run_id and c.unit_id = b.scenario_unit_id`,
    [
      shown.map((entry) => entry.key),
      shown.map((entry) => entry.snapshot_id),
      shown.map((entry) => entry.content_hash),
      shown.map((entry) => entry.price.observation_id),
      shown.map((entry) => entry.price.source_id),
    ],
  );
  return rows;
}
