// The cause a company filed for the figures an engine answer shows (#542):
// management's own explanations (management.explanation.*, verbatim from its
// earnings release) bound to the fiscal period of those figures, quoted in the
// attribution template beside them and sealed in a snapshot of its own under
// the answer's. What a cause would explain comes from the plan and the periods
// its inputs bound to, never from the question's words or a date window.

import { boundPeriodText, dependencyClosure, type BoundPeriod, type FinancialPlanV1, type LocalId, type OperationNode } from "../../financial-core/src/index.ts";
import type { ClaimPeriod } from "../../evidence/src/claim-repo.ts";
import { loadPeriodClaimEvidence, lockCitableClaims, type LocalRuntimeEvidence } from "../../evidence/src/local-runtime-evidence.ts";
import type { ParentPublication } from "../../financial-engine/src/finalize.ts";
import type { FencedTx } from "../../financial-engine/src/lease.ts";
import { readClosureInputs } from "../../financial-engine/src/read-model.ts";
import { writeToolCallLog } from "../../observability/src/tool-call.ts";
import { writeVerifierFailLog } from "../../observability/src/verifier-fail.ts";
import { isRecord, type QueryExecutor } from "../../shared/src/http.ts";
import { buildClaimBackedSealInput } from "../../snapshot/src/seal-input.ts";
import { sealSnapshotInTransaction, snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { stableUuid } from "./chat-ids.ts";
import { createSealer } from "./prose-refs.ts";
import { attributionSegments } from "./render-assertions.ts";
import { INCOME_ITEM_FIGURE, SCOPE_METRICS } from "./scope-figures.ts";
import { RE_READ_ANSWER_SQL } from "./thread-context.ts";
import { FISCAL_PERIODS, isOneOf, readingAsks, type ResearchScope, type ScopeProposal } from "./research-scope.ts";

/** Whether a turn asked for a cause and, when it did, whose its answer quotes, by the name it gives each company. */
export type FiledCause =
  | Readonly<{ asked: false }>
  | Readonly<{ asked: true; quoted: ReadonlySet<string>; names: ReadonlyMap<string, string>; block: Readonly<Record<string, unknown>> | null }>;

export const NOT_ASKED: FiledCause = { asked: false };

// A fiscal period as a claim keys it, with the label the answer gives it.
export type FiscalPeriod = ClaimPeriod & BoundPeriod;

/** Per company: the figures a filed cause would explain and the one period they end at, or none. */
export type Explained = Readonly<{ issuer: string } & ({ kind: "none" } | { kind: "figures"; period: FiscalPeriod; metrics: ReadonlyArray<string> })>;

// Each figure a release explains, by the release metric of its own
// explanations (sec-earnings-release-extraction.ts RELEASE_METRICS). A release
// explains a margin by the income it divides, and files gross profit as gross
// margin. A figure not listed (a balance item, a share count, a valuation, a
// ratio other than a margin) has no filed cause.
const OWN_EXPLANATION: Readonly<Record<string, string>> = {
  revenue: "revenue",
  gross_profit: "gross_margin",
  gross_margin: "gross_margin",
  operating_income: "operating_income",
  operating_margin: "operating_income",
  net_income: "net_income",
  net_margin: "net_income",
  operating_cash_flow: "operating_cash_flow",
  capex: "capex",
  free_cash_flow: "free_cash_flow",
  eps_basic: "eps",
  eps_diluted: "eps",
};
const MARGINS: ReadonlySet<string> = new Set(["gross_margin", "operating_margin", "net_margin"]);
// What a release metric is computed from, beyond a margin's revenue.
const COMPUTED_FROM: Readonly<Record<string, ReadonlyArray<string>>> = {
  operating_income: ["gross_margin", "operating_expenses"],
  net_income: ["operating_income"],
  eps: ["net_income"],
  free_cash_flow: ["operating_cash_flow", "capex"],
};
// Outputs no one period's explanation covers.
const OPAQUE: ReadonlySet<OperationNode["operation"]> = new Set(["trailing_sum", "threshold", "peer_compare", "spread", "period_rank"]);

type Shown =
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "opaque"; slots: ReadonlySet<LocalId> }>
  | Readonly<{ kind: "figure"; slot: LocalId; figure: string; period: FiscalPeriod }>;
const IGNORED: Shown = { kind: "ignored" };

/**
 * What a filed cause explains for each company: the figures it shows at the
 * period with the latest end, which `named` accepts. Its earlier figures must
 * be the trend of one shown there. A company with an output no one period
 * explains, with a figure it shows no verified value for (a gap binds no
 * period, so its own may be the latest), with two periods ending that day (a
 * Q4 beside its fiscal year), or with an earlier figure not shown at the
 * latest, has none.
 */
export function explainedFigures(input: Readonly<{
  plan: FinancialPlanV1;
  // The outputs the answer shows a verified value for.
  verified: ReadonlySet<LocalId>;
  // Each reported node's bound fiscal period; an instant or a price has none.
  periods: ReadonlyMap<LocalId, FiscalPeriod>;
  named: (figure: string) => boolean;
}>): Explained[] {
  const { plan, periods } = input;
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const reported = (node: OperationNode) =>
    [...dependencyClosure(plan, [node.node_id])].map((id) => nodes.get(id)!).flatMap((read) => read.operation === "reported_metric" ? [read] : []);
  const opaque = (node: OperationNode): Shown => ({ kind: "opaque", slots: new Set(reported(node).map((read) => read.subject_slot)) });
  const shown = (node: OperationNode): Shown => {
    if (OPAQUE.has(node.operation)) return opaque(node);
    if (node.operation === "absolute_change" || node.operation === "percent_change_positive_base") {
      const [current, prior] = [shown(nodes.get(node.current)!), shown(nodes.get(node.prior)!)];
      if (current.kind === "ignored" && prior.kind === "ignored") return IGNORED;
      const same = current.kind === "figure" && prior.kind === "figure" && current.figure === prior.figure && current.slot === prior.slot;
      return same ? current : opaque(node);
    }
    const figure = node.operation === "reported_metric" ? node.metric_key : node.operation;
    if (!Object.hasOwn(OWN_EXPLANATION, figure)) return IGNORED;
    const reads = reported(node);
    const bound = reads.map((read) => periods.get(read.node_id));
    const [first] = bound;
    const onePeriod = first !== undefined && bound.every((period) => period !== undefined && samePeriod(period, first));
    const slots = new Set(reads.map((read) => read.subject_slot));
    return onePeriod && slots.size === 1 ? { kind: "figure", slot: reads[0]!.subject_slot, figure, period: first } : opaque(node);
  };
  const outputs = plan.outputs.map((output) => {
    const node = nodes.get(output.node_id)!;
    const figure = shown(node);
    return input.verified.has(output.output_id) || figure.kind === "ignored" ? figure : opaque(node);
  });
  return plan.subjects.members.map((member): Explained => {
    const issuer = member.subject_ref.id.toLowerCase();
    const none: Explained = { issuer, kind: "none" };
    const own = outputs.filter((output) => output.kind === "opaque" ? output.slots.has(member.slot_id) : output.kind === "figure" && output.slot === member.slot_id);
    const figures = own.flatMap((output) => output.kind === "figure" ? [output] : []);
    if (figures.length === 0 || own.some((output) => output.kind === "opaque")) return none;
    const end = figures.reduce((latest, { period }) => (period.end > latest ? period.end : latest), "");
    const latest = figures.filter(({ period }) => period.end === end);
    const period = latest[0]!.period;
    if (latest.some((figure) => figure.period.kind !== period.kind)) return none;
    const atLatest = new Set(latest.map(({ figure }) => figure));
    if (figures.some(({ figure }) => !atLatest.has(figure))) return none;
    const metrics = [...atLatest].filter(input.named);
    return metrics.length === 0 ? none : { issuer, kind: "figures", period, metrics };
  });
}

const samePeriod = (left: ClaimPeriod, right: ClaimPeriod) => left.kind === right.kind && left.end === right.end;

/**
 * The predicate prefixes of the explanations that are a cause of these
 * figures, in priority tiers: their own, then what they are computed from,
 * nearest first, and a margin's revenue last, so revenue's explanations never
 * crowd out its income's. Revenue is computed from nothing here: a gross
 * margin's explanation is no cause of it, and "other" is no cause of any.
 */
export function causeFamilies(metrics: ReadonlyArray<string>): string[][] {
  const tiers: string[][] = [];
  const seen = new Set<string>();
  let next = metrics.map((metric) => OWN_EXPLANATION[metric]!);
  while (next.length > 0) {
    const tier = [...new Set(next)].filter((metric) => !seen.has(metric));
    tier.forEach((metric) => seen.add(metric));
    if (tier.length > 0) tiers.push(tier);
    next = tier.flatMap((metric) => COMPUTED_FROM[metric] ?? []);
  }
  if (metrics.some((metric) => MARGINS.has(metric)) && !seen.has("revenue")) tiers.push(["revenue"]);
  return tiers.map((tier) => tier.map((metric) => `management.explanation.${metric}`));
}

/** Whether a turn asks for a cause: its scope keeps one (asked now or carried, until turned off), else its reading asks. */
export function asksCause(reading: ScopeProposal, scope: Pick<ResearchScope, "explains"> | null): boolean {
  return scope === null ? readingAsks(reading).asks.has("explains") : scope.explains === true;
}

/**
 * The engine figures this turn's reading names: its income items, which name
 * them more closely than the whole statement, and each other metric's
 * figures. Asked about margins, the whole statement names its margins alone
 * (the reading keeps no margin qualifier on the statement; another metric's
 * margin is that metric's). A reading that names none names every figure.
 */
export function namedFigures(reading: ScopeProposal): (figure: string) => boolean {
  const { asks, offMetrics } = readingAsks(reading);
  const margins = asks.has("margins");
  const items = new Set(reading.income_items.map((item) => INCOME_ITEM_FIGURE[item]));
  const metrics = new Set(reading.metrics
    .filter((metric) => !offMetrics.has(metric.metric_key) && !(metric.metric_key === "income_statement" && (margins || reading.income_items.length > 0)))
    .map((metric) => metric.base ?? metric.metric_key));
  if (items.size === 0 && metrics.size === 0 && !margins) return () => true;
  return (figure) => items.has(figure) || metrics.has(SCOPE_METRICS[figure] ?? "") || (margins && MARGINS.has(figure));
}

// ponytail: each company's first three explanations, by tier then recency;
// the rest of a long release goes unquoted. Raise it if one falls past them.
const CLAIMS_PER_COMPANY = 3;

/**
 * Each company's filed cause for the figures its answer shows, quoted and
 * sealed under the answer's snapshot, inside the finalization transaction. An
 * operational fault reading or sealing it rolls back to its savepoint, so the
 * answer still publishes, its cause named as not covered; any other error
 * fails the turn.
 */
export async function filedCauses(
  tx: Pick<FencedTx, "client" | "run">,
  input: Readonly<{
    threadId: string;
    plan: FinancialPlanV1;
    named: (figure: string) => boolean;
    // By issuer (lowercase), the name the answer gives each company.
    names: ReadonlyMap<string, string>;
    answer: Pick<ParentPublication, "run_id" | "snapshot_id" | "block">;
  }>,
): Promise<FiledCause> {
  const { plan, answer } = input;
  const uncaused: FiledCause = { asked: true, quoted: new Set(), names: input.names, block: null };
  await tx.client.query("savepoint filed_cause");
  try {
    const explained = explainedFigures({
      plan,
      verified: new Set(answer.block.financial.results.flatMap((result) => result.disposition === "verified" ? [result.output_id] : [])),
      periods: await boundPeriods(tx.client, tx.run.user_id, answer.run_id, plan),
      named: input.named,
    });
    const read: Array<{ issuer: string; period: string; evidence: LocalRuntimeEvidence }> = [];
    for (const company of explained) {
      if (company.kind === "none") continue;
      read.push({
        issuer: company.issuer,
        // Named as its figures name it.
        period: boundPeriodText(company.period),
        evidence: await loadPeriodClaimEvidence(tx.client, {
          issuer_id: company.issuer,
          period: company.period,
          predicate_prefixes: causeFamilies(company.metrics),
          user_id: tx.run.user_id,
          as_of: plan.time.knowledge_cutoff,
          limit: CLAIMS_PER_COMPANY,
          // A claim two companies share is quoted once, for the first.
          exclude_claim_ids: read.flatMap(({ evidence }) => evidence.claim_refs),
        }),
      });
    }
    // A claim read may have been revoked since: each is locked and checked again, and one no longer citable is dropped.
    const { citable } = await lockCitableClaims(tx.client, { claim_ids: read.flatMap(({ evidence }) => evidence.claim_refs), user_id: tx.run.user_id, as_of: plan.time.knowledge_cutoff });
    const quoted = read.flatMap(({ issuer, period, evidence }) => {
      const claims = evidence.claims.filter((claim) => citable.has(claim.claim_id));
      return claims.length === 0 ? [] : [{ issuer, period, claims, documents: evidence.verifier_documents.filter((document) => claims.some((claim) => claim.document_id === document.document_id)) }];
    });
    const claims = quoted.flatMap((company) => company.claims);
    if (claims.length === 0) {
      await tx.client.query("release savepoint filed_cause");
      return uncaused;
    }
    const snapshotId = stableUuid(`filed-cause:${answer.snapshot_id}`);
    const sealer = createSealer([]);
    const segments = attributionSegments(quoted.flatMap(({ period, claims: own }) => own.map((claim) => ({
      text: claim.text_canonical,
      claim_id: claim.claim_id,
      source_id: claim.source_id,
      ...(claim.subject_id && input.names.has(claim.subject_id) ? { company: input.names.get(claim.subject_id)! } : {}),
      ...(claim.published_at ? { published_at: claim.published_at } : {}),
      ...(claim.effective_time ? { effective_time: claim.effective_time } : {}),
      period,
    }))), sealer.quote);
    const id = stableUuid(`block:${snapshotId}:cause`);
    const block = { id, kind: "rich_text", snapshot_id: snapshotId, data_ref: { kind: "rich_text", id }, source_refs: sealer.sealed().source_refs, as_of: answer.block.as_of, segments };
    // A claim-bearing snapshot is provenanced by the logged read that chose its claims.
    const log = await writeToolCallLog(tx.client, {
      thread_id: input.threadId,
      tool_name: "filed_cause",
      args: { explained, cutoff: plan.time.knowledge_cutoff },
      result: { claim_refs: claims.map((claim) => claim.claim_id) },
      status: "ok",
    });
    const sealed = await sealSnapshotInTransaction(snapshotTransactionClient(tx.client), {
      ...buildClaimBackedSealInput({
        block,
        claims: claims.map(({ claim_id, source_id }) => ({ claim_id, source_id })),
        documents: [...new Map(quoted.flatMap((company) => company.documents).map((document) => [document.document_id, document])).values()],
        subjectRefs: quoted.map(({ issuer }) => ({ kind: "issuer" as const, id: issuer })),
        toolCalls: [{ tool_call_id: log.tool_call_id, result_hash: log.result_hash! }],
        parentSnapshot: answer.snapshot_id,
      }),
      thread_id: input.threadId,
    });
    if (!sealed.ok) {
      // A refused seal keeps only its audit, as the engine's own refusal
      // does (snapshot-verifier.ts logs every one): not the read that chose
      // its claims. The answer goes without the cause.
      await tx.client.query("rollback to savepoint filed_cause");
      for (const { reason_code, details } of sealed.verification.failures) {
        await writeVerifierFailLog(tx.client, { thread_id: input.threadId, snapshot_id: snapshotId, reason_code, details });
      }
      await tx.client.query("release savepoint filed_cause");
      console.warn(`[chat] the filed cause for thread ${input.threadId} failed its seal; the answer names it as not covered`, sealed.verification.failures);
      return uncaused;
    }
    await tx.client.query("release savepoint filed_cause");
    return { ...uncaused, quoted: new Set(quoted.map(({ issuer }) => issuer)), block };
  } catch (reason) {
    if (!isOperational(reason)) throw reason;
    // A lost connection fails the rollback too: the turn fails with the read's own error.
    await tx.client.query("rollback to savepoint filed_cause").catch(() => {
      throw reason;
    });
    console.warn(`[chat] the filed cause for thread ${input.threadId} could not be read; the answer names it as not covered`, reason);
    return uncaused;
  }
}

/**
 * What the engine answer an evidence follow-up re-reads explains (#558),
 * derived again from its plan, its verified results and the periods its inputs
 * bound to: every figure it shows, so the follow-up never depends on a reading
 * of either question. Null when that answer is not the engine's.
 */
export async function reReadExplained(db: QueryExecutor, threadId: string): Promise<Explained[] | null> {
  const { rows: [answer] } = await db.query<{ run_id: string; user_id: string; plan: FinancialPlanV1; blocks: unknown }>(
    `select r.run_id::text as run_id, r.user_id::text as user_id, p.plan, answer.blocks
       from (${RE_READ_ANSWER_SQL}) answer
       join snapshot_financial_runs sfr on sfr.snapshot_id = answer.snapshot_id
       join financial_runs r on r.run_id = sfr.run_id
       join financial_plans p on p.plan_id = r.plan_id and p.user_id = r.user_id
      order by sfr.run_id
      limit 1`,
    [threadId],
  );
  if (answer === undefined) return null;
  const block = (Array.isArray(answer.blocks) ? answer.blocks : []).find((candidate) => isRecord(candidate) && candidate.kind === "financial_answer");
  const results = isRecord(block) && isRecord(block.financial) && Array.isArray(block.financial.results) ? block.financial.results : [];
  return explainedFigures({
    plan: answer.plan,
    verified: new Set(results.flatMap((result) => isRecord(result) && result.disposition === "verified" && typeof result.output_id === "string" ? [result.output_id] : [])),
    periods: await boundPeriods(db, answer.user_id, answer.run_id, answer.plan),
    named: () => true,
  });
}

// Each reported node's fiscal period, as its certified input bound it.
async function boundPeriods(db: QueryExecutor, ownerUserId: string, runId: string, plan: FinancialPlanV1): Promise<Map<LocalId, FiscalPeriod>> {
  const slots = plan.operations.flatMap((node) => node.operation === "reported_metric" ? [node.node_id] : []);
  const inputs = await readClosureInputs(db, ownerUserId, runId, slots);
  return new Map(inputs.flatMap((input) => {
    const period = claimPeriod(input.bound_payload);
    return period === null ? [] : [[input.input_slot, period] as const];
  }));
}

// A bound fact's fiscal quarter or year, as a claim keys one, with its fiscal
// label; an instant or a price has none.
function claimPeriod(payload: unknown): FiscalPeriod | null {
  const period = isRecord(payload) && isRecord(payload.period) ? payload.period : null;
  if (period?.kind !== "duration" || typeof period.end !== "string" || typeof period.fiscal_year !== "number") return null;
  const fiscal = { fiscal_year: period.fiscal_year, end: period.end };
  if (period.fiscal_period === "FY") return { kind: "fiscal_y", fiscal_period: "FY", ...fiscal };
  return isOneOf(period.fiscal_period, FISCAL_PERIODS) ? { kind: "fiscal_q", fiscal_period: period.fiscal_period, ...fiscal } : null;
}

// A fault of the database's state, not of the read: a lost connection (class
// 08, or the driver's), a rolled-back transaction (40), exhausted resources
// (53), an operator's intervention (57: pg_cancel_backend or a shutdown), a
// lock not available (55P03: lockCitableClaims locks nowait). Nothing here
// sets statement_timeout, so none raises one. A schema or SQL defect is none of
// them.
function isOperational(error: unknown): boolean {
  const code = isRecord(error) && "code" in error ? String(error.code) : "";
  return /^(08|40|53|57)[0-9A-Z]{3}$/u.test(code) || code === "55P03" || code.startsWith("ECONN") || code === "ETIMEDOUT" || code === "EPIPE";
}
