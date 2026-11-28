// Figure and struck segments in prose (#800). A figure shows as verified and links its
// sources, so the seal reads each source's value from what it verifies itself and
// recomputes the figure's verdict (financial-core/src/figure-check.ts): a chat bug cannot
// show a wrong number behind a verified link. A struck figure states a number the sources
// contradict, so only its sources are checked, as refs.

import { CanonicalJsonError } from "../../financial-core/src/canonical.ts";
import { linkedVerdict, linksAs, presentedQuantity, statedFigures, statedQuantity, type LinkedFigure, type Quantity } from "../../financial-core/src/figure-check.ts";
import type { FinancialAnswerContent, PresentedPayload } from "../../financial-core/src/index.ts";
import { isRecord, type QueryExecutor } from "../../shared/src/http.ts";
import type { JsonObject } from "./manifest-staging.ts";

type Source = Record<string, unknown>;
type Block = Readonly<{ id: string; kind: string; segments?: ReadonlyArray<unknown> }>;

const isLinked = (segment: Source) => segment.type === "figure" || segment.type === "struck";
const sourcesOf = (segment: Source): Source[] => (Array.isArray(segment.sources) ? segment.sources.filter(isRecord) : []);
const linkedSegments = (blocks: ReadonlyArray<Block>) =>
  blocks.flatMap((block) => (block.kind === "rich_text" ? (block.segments ?? []).filter(isRecord).filter(isLinked).map((segment) => ({ block, segment })) : []));
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// The refs a prose segment cites: a ref itself, or each source of a figure or a struck one.
export function segmentRefs(segment: unknown): ReadonlyArray<Source> {
  if (!isRecord(segment)) return [];
  if (segment.type === "ref") return [segment];
  return isLinked(segment) ? sourcesOf(segment) : [];
}

type ShownResult = Readonly<{ presented: PresentedPayload; period: string | null }>;

// What the ledger holds for the result and claim sources a message's figures cite.
export type LedgerSources = Readonly<{
  // Each cited result an answer of the message shows, when a certificate of this thread's
  // run holds that answer's presentation hash and lists the result.
  results: ReadonlyMap<string, ShownResult>;
  // Each cited claim's stored text.
  claims: ReadonlyMap<string, string>;
  // Whether there was a client to read them with.
  client: boolean;
}>;

export type SealedValues = LedgerSources & Readonly<{
  // Each sealed series' values by the label its chart or spec shows for it.
  series: ReadonlyMap<string, ReadonlyMap<string, Quantity>>;
}>;

// Loads what a figure's result and claim sources read, through the seal's transaction, so
// no value comes from the caller (#812). The caller names the answers its message shows;
// each counts only as its certificate in this thread, which the financial verifier wrote
// from recomputed results, and the presentation hash binds every value it shows. Reads
// nothing when no figure cites a result or a claim.
export async function loadLedgerSources(
  blocks: ReadonlyArray<Block>,
  input: Readonly<{ thread_id: string | null; answers: ReadonlyArray<unknown> }>,
  db: QueryExecutor | undefined,
): Promise<LedgerSources> {
  const cited = (kind: string) => new Set(linkedSegments(blocks).flatMap(({ segment }) =>
    sourcesOf(segment).flatMap((source) => (source.ref_kind === kind && typeof source.ref_id === "string" && UUID_TEXT.test(source.ref_id) ? [source.ref_id.toLowerCase()] : []))
  ));
  const resultIds = cited("result");
  const claimIds = cited("claim");
  if (db === undefined) return { results: new Map(), claims: new Map(), client: false };
  return {
    results: resultIds.size === 0 || input.thread_id === null ? new Map() : await certifiedResults(db, input.thread_id, input.answers, resultIds),
    claims: claimIds.size === 0 ? new Map() : await storedClaims(db, [...claimIds]),
    client: true,
  };
}

async function certifiedResults(db: QueryExecutor, threadId: string, supplied: ReadonlyArray<unknown>, cited: ReadonlySet<string>): Promise<Map<string, ShownResult>> {
  const answers = supplied.filter((answer): answer is FinancialAnswerContent =>
    isRecord(answer) && typeof answer.run_id === "string" && UUID_TEXT.test(answer.run_id) && Array.isArray(answer.results) && isRecord(answer.labels)
  );
  if (answers.length === 0) return new Map();
  const { rows } = await db.query<{ run_id: string; unit_id: string; presentation_hash: string; result_ids: unknown }>(
    `select c.run_id::text as run_id, c.unit_id, c.presentation_hash, c.result_ids
       from snapshot_financial_runs c
       join financial_runs r on r.run_id = c.run_id
      where r.parent_kind = 'chat_thread' and r.parent_id = $1::uuid and c.run_id = any($2::uuid[])`,
    [threadId, [...new Set(answers.map((answer) => answer.run_id))]],
  );
  // The financial core's presentation loads only for a seal that has such a figure.
  const { presentationHash } = await import("../../financial-core/src/presentation.ts");
  const results = new Map<string, ShownResult>();
  for (const answer of answers) {
    let hash: string;
    try {
      hash = presentationHash(answer);
    } catch (error) {
      if (error instanceof CanonicalJsonError) continue;
      throw error;
    }
    const certificate = rows.find((row) => row.run_id === answer.run_id && row.unit_id === answer.unit_id && row.presentation_hash === hash);
    const listed = new Set(certificate !== undefined && Array.isArray(certificate.result_ids) ? certificate.result_ids : []);
    for (const result of answer.results) {
      if (!listed.has(result.result_id) || !cited.has(result.result_id.toLowerCase())) continue;
      results.set(result.result_id.toLowerCase(), { presented: result.presented, period: answer.labels[result.period_label_id]?.text ?? null });
    }
  }
  return results;
}

async function storedClaims(db: QueryExecutor, claimIds: ReadonlyArray<string>): Promise<Map<string, string>> {
  const { rows } = await db.query<{ claim_id: string; text: string }>(
    `select claim_id::text as claim_id, text_canonical as text from claims where claim_id = any($1::uuid[])`,
    [claimIds],
  );
  return new Map(rows.map((row) => [row.claim_id.toLowerCase(), row.text]));
}

export type FigureSegmentFailure = Readonly<{ reason_code: "result_ref_format_mismatch" | "figure_text_mismatch" | "figure_source_unverified"; details: JsonObject }>;

// ponytail: a fact source has no value here, since the seal loads no fact's value, so a
// figure on one fails. No packet figure with a fact id carries a quantity (#810), so chat
// links none; load facts' values when one does.
export function figureSegmentFailures(blocks: ReadonlyArray<Block>, sealed: SealedValues): FigureSegmentFailure[] {
  const valueOf = (source: Source | undefined): Quantity | undefined => {
    const id = String(source?.ref_id).toLowerCase();
    switch (source?.ref_kind) {
      case "result": {
        const result = sealed.results.get(id);
        return result?.presented.kind === "value" ? presentedQuantity(result.presented) : undefined;
      }
      case "series":
        return sealed.series.get(id)?.get(String(source.format));
      case "claim": {
        const numeral = typeof source.numeral === "number" ? statedFigures(sealed.claims.get(id) ?? "")[source.numeral - 1] : undefined;
        return numeral && statedQuantity(numeral);
      }
      default:
        return undefined;
    }
  };

  // A result or claim source the ledger did not give a value for fails closed (#812).
  const unverified = (source: Source) =>
    source.ref_kind === "result" ? !sealed.results.has(String(source.ref_id).toLowerCase())
    : source.ref_kind === "claim" ? !sealed.claims.has(String(source.ref_id).toLowerCase())
    : false;

  const failures: FigureSegmentFailure[] = [];
  for (const { block, segment } of linkedSegments(blocks)) {
    const sources = sourcesOf(segment);
    const checked = segment.type === "struck" ? sources.filter((source) => source.ref_kind === "result") : sources;
    const missing = checked.filter(unverified);
    for (const source of missing) {
      failures.push({
        reason_code: "figure_source_unverified",
        details: {
          block_id: block.id,
          ref_kind: String(source.ref_kind),
          ref_id: String(source.ref_id),
          reason: !sealed.client ? "no_transaction_client" : source.ref_kind === "result" ? "not_certified" : "not_stored",
        },
      });
    }
    if (missing.length > 0) continue;
    for (const source of sources.filter((entry) => entry.ref_kind === "result")) {
      const shown = sealed.results.get(String(source.ref_id).toLowerCase())!;
      if (source.format === shown.presented.text && source.period === shown.period) continue;
      failures.push({
        reason_code: "result_ref_format_mismatch",
        details: {
          block_id: block.id,
          result_id: String(source.ref_id),
          format: typeof source.format === "string" ? source.format : null,
          period: typeof source.period === "string" ? source.period : null,
          shown: shown.presented.text,
          shown_period: shown.period,
        },
      });
    }
    if (segment.type === "struck") continue;
    const figure = { ...segment, text: typeof segment.text === "string" ? segment.text : "", sources } as LinkedFigure;
    const verdict = linkedVerdict(figure, (index) => valueOf(sources[index]));
    if (linksAs(figure, verdict)) continue;
    failures.push({
      reason_code: "figure_text_mismatch",
      details: {
        block_id: block.id,
        text: figure.text,
        verdict: verdict.kind,
        ...("expected" in verdict ? { expected: verdict.expected } : {}),
        ...("reason" in verdict ? { reason: verdict.reason } : {}),
      },
    });
  }
  return failures;
}
