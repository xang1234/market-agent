// A P/E scenario answer compared with a stored closing price, as a follow-up
// (#224). The ask is one closed sentence, read from the message only, like the
// scenario ask (eps-scenarios.ts): "compare with the price", optionally "as of"
// a date or an ISO timestamp with its offset. It compares the immediately
// previous answer's sealed scenario, never planned again; everything shown is
// generated and sealed by the snapshot service (scenario-price-comparison.ts).

import { randomUUID } from "node:crypto";

import type { ComparisonTime } from "../../financial-core/src/index.ts";
import type { FinancialPool, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { isTransientDatabaseError } from "../../financial-engine/src/transaction.ts";
import { generateScenarioPriceComparison, recordScenarioPriceComparison, scenarioPriceComparisonBlock } from "../../snapshot/src/scenario-price-comparison.ts";
import { buildScenarioPriceComparisonSealInput } from "../../snapshot/src/seal-input.ts";
import { sealSnapshotInTransaction, snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { destroyAfterFailedRollback, withPoolClient } from "../../shared/src/pool-client.ts";
import { contentHashForText } from "./chat-ids.ts";
import type { ChatFinancialTurn } from "./financial-runtime.ts";
import { previousAnswer } from "./thread-context.ts";

/** Why a comparison ask is declined: no scenario answer before it, or an ask outside the closed sentence. */
export type ComparisonDecline = "no_scenario" | "currency" | "advice" | "form";

const ASK_THAT_WORKS =
  "The ask that works, right after a P/E scenario answer, is “compare with the price” or “compare with the price as of 2026-10-30” (a date, or a time with its UTC offset). Nothing was calculated.";

/** What each declined comparison says: its reason, then the ask that works. */
export const COMPARISON_DECLINES: Readonly<Record<ComparisonDecline, string>> = {
  no_scenario: `There is no P/E scenario answer right before this to set against a price. ${ASK_THAT_WORKS}`,
  currency: `A comparison uses a stored close in the scenario values' own currency and converts nothing, so the ask names no currency. ${ASK_THAT_WORKS}`,
  advice: `A comparison sets the scenario values against a stored price and nothing more. ${ASK_THAT_WORKS}`,
  form: `That ask has words, numbers or a time the comparison cannot read. ${ASK_THAT_WORKS}`,
};

/** What a comparison turn whose seal failed says: nothing is shown. */
export const COMPARISON_REFUSED = "The price comparison did not pass verification, so nothing is shown.";

/** A message's price comparison ask: the time it names, or invalid, for its reason, when it asks for a comparison outside the closed sentence. */
export type PriceComparisonAsk =
  | Readonly<{ invalid: false; requested: ComparisonTime }>
  | Readonly<{ invalid: true; reason: Exclude<ComparisonDecline, "no_scenario"> }>;

const HEAD = String.raw`^compare(?: (?:it|them|these|the scenarios|these scenarios))? (?:with|to|against)`;
const ASK = new RegExp(String.raw`${HEAD} (?:the )?(?:(?:share|stock|closing) )?price(?: as of (?<when>\S+))?$`, "iu");
// A message that starts as the sentence does, and names a price, but leaves it: only that is a comparison ask outside the sentence.
const STARTS_AS_ASK = new RegExp(String.raw`${HEAD}\b`, "iu");
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
// At most milliseconds: a finer time could not be asked for exactly.
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/iu;
const PRICE = /\bprices?\b/iu;
/** Advice and valuation words: an ask with one is declined for advice, and no comparison text says one. */
export const ADVICE_WORDS = /\b(?:upside|downside|targets?|expected|returns?|undervalued|overvalued|fair|worth|buy|sell|forecasts?|recommend\w*|cheap|expensive|potential)\b/iu;
// The time part of an ask outside the sentence, up to the next clause.
const TIME_PART = /\b(?:as of|on) (?<when>[^,;?!]+)/iu;
// ponytail: a closed list of common codes, names and symbols; any other currency word reads as a form it cannot read.
const CURRENCY = /\b(?:usd|eur|gbp|jpy|chf|cad|aud|cny|hkd|inr|krw|dollars?|euros?|pounds?|yen|yuan|currenc(?:y|ies)|fx|exchange rate)\b|[$€£¥]/iu;

/**
 * The comparison a message asks for, or null when it asks for none. A message
 * that starts as the sentence does ("compare them with ...") and names a
 * price is invalid with any word, number, or form of time outside it: a
 * changed multiple, a currency, "target", or a timestamp with no offset. Any
 * other message, one comparing two companies' prices included, asks none.
 */
export function readPriceComparisonAsk(text: string): PriceComparisonAsk | null {
  const sentence = text.trim().replace(/[.?!]$/u, "").replace(/\s+/gu, " ");
  const match = ASK.exec(sentence);
  if (match === null) return STARTS_AS_ASK.test(sentence) && PRICE.test(sentence) ? invalid(sentence) : null;
  const when = match.groups?.when;
  if (when === undefined) return { invalid: false, requested: { kind: "latest" } };
  const requested = readTime(when);
  return requested === null ? invalid(sentence) : { invalid: false, requested };
}

function readTime(when: string): ComparisonTime | null {
  const date = DATE.exec(when);
  if (date) return calendarDate(date) ? { kind: "session_date", date: when } : null;
  const instant = INSTANT.exec(when);
  if (!instant || !calendarDate(instant) || Number(instant[4]) > 23 || Number(instant[5]) > 59 || Number(instant[6] ?? 0) > 59 ||
    Number(instant[7] ?? 0) > 23 || Number(instant[8] ?? 0) > 59) {
    return null;
  }
  return { kind: "instant", at: new Date(Date.parse(when)).toISOString() };
}

// An ask outside the sentence, by what leaves it: a time it cannot read, then advice wording, then a currency, else a form it cannot read.
function invalid(sentence: string): PriceComparisonAsk {
  const when = TIME_PART.exec(sentence)?.groups?.when?.trim();
  if (when !== undefined && readTime(when) === null) return { invalid: true, reason: "form" };
  return { invalid: true, reason: ADVICE_WORDS.test(sentence) ? "advice" : CURRENCY.test(sentence) ? "currency" : "form" };
}

function calendarDate(match: RegExpExecArray): boolean {
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Each is marked a comparison gap in the block it is saved as, so the next turn looks past it by that mark (previousAnswer).
const declined = (reason: ComparisonDecline) =>
  Object.freeze({ kind: "gap", reason_code: "unsupported", text: COMPARISON_DECLINES[reason], comparison_gap: "declined" } as const);
const REFUSED = Object.freeze({ kind: "gap", reason_code: "verification_failed", text: COMPARISON_REFUSED, comparison_gap: "refused" } as const);

/**
 * The turn a message is when it asks for a price comparison (#224), or null
 * to route it as any other: it asks none, or it leaves the sentence with no
 * scenario answer before it. An ask outside the sentence after one is
 * declined; the sentence compares that answer's sealed scenario, and the
 * saved comparison is the turn's answer (`saved`).
 */
export async function priceComparisonTurn(
  pool: FinancialPool,
  turn: Readonly<{ text: string; thread_id: string; user_id: string; message_id: string; now: () => Date }>,
  saved: () => Promise<ChatFinancialTurn>,
): Promise<(() => Promise<ChatFinancialTurn>) | null> {
  const ask = readPriceComparisonAsk(turn.text);
  if (ask === null) return null;
  const scenario = await previousScenarioSnapshot(pool, turn.thread_id, turn.user_id);
  if (ask.invalid && scenario === null) return null;
  return async () => {
    if (ask.invalid) return declined(ask.reason);
    if (scenario === null) return declined("no_scenario");
    const outcome = await publishScenarioPriceComparison(pool, {
      thread_id: turn.thread_id,
      user_id: turn.user_id,
      message_id: turn.message_id,
      scenario_snapshot_id: scenario,
      requested: ask.requested,
      received_at: turn.now().toISOString(),
    });
    return outcome.kind === "saved" ? saved() : outcome.kind === "declined" ? declined("no_scenario") : REFUSED;
  };
}

export type ComparisonTurn =
  | Readonly<{ kind: "declined" }>
  | Readonly<{ kind: "saved"; message_id: string }>
  | Readonly<{ kind: "refused" }>;

/** The snapshot of the sealed P/E scenario the thread's previous answer is, or compares. The snapshot service checks its certificate before anything is compared. */
export async function previousScenarioSnapshot(db: SqlExecutor, threadId: string, userId: string): Promise<string | null> {
  const previous = await previousAnswer(db, threadId, userId);
  return previous?.scenarios ? previous.snapshot_id : null;
}

type ComparisonPublication = Readonly<{ thread_id: string; user_id: string; message_id: string; scenario_snapshot_id: string; requested: ComparisonTime; received_at: string }>;

const PUBLISH_ATTEMPTS = 3;

/**
 * Generates, seals, binds, and saves the comparison of a sealed scenario in
 * one transaction, under the turn's message id: a retry finds it saved. Declined
 * when the snapshot is no sealed scenario of this thread's; refused when its
 * seal fails, which keeps only the seal's audit. A transient database error
 * (a serialization failure among them) runs the whole transaction again, a
 * bounded number of times, with the same request, receipt time and message id.
 */
export async function publishScenarioPriceComparison(pool: FinancialPool, turn: ComparisonPublication): Promise<ComparisonTurn> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await publishOnce(pool, turn);
    } catch (error) {
      if (attempt >= PUBLISH_ATTEMPTS || !isTransientDatabaseError(error)) throw error;
      console.warn(`[chat] price comparison publish attempt ${attempt} of ${PUBLISH_ATTEMPTS} failed with SQLSTATE ${(error as { code?: string }).code}; retrying`);
    }
  }
}

async function publishOnce(pool: FinancialPool, turn: ComparisonPublication): Promise<ComparisonTurn> {
  return withPoolClient(pool, async (client) => {
    // One snapshot for generation and the seal's regeneration: a close or a
    // split history committed between them would otherwise refuse the turn.
    // A write committed since that conflicts with this one, as a title edit
    // of the thread or another attempt's message, fails it with 40001, and
    // the next attempt reads a fresh snapshot.
    await client.query("begin isolation level repeatable read");
    try {
      const generated = await generateScenarioPriceComparison(client, {
        thread_id: turn.thread_id, scenario_snapshot_id: turn.scenario_snapshot_id, requested: turn.requested, received_at: turn.received_at,
      });
      if (generated === null) {
        await client.query("rollback");
        return { kind: "declined" };
      }
      const block = scenarioPriceComparisonBlock(`price-comparison-${turn.message_id}`, randomUUID(), generated);
      const sealed = await sealSnapshotInTransaction(snapshotTransactionClient(client), buildScenarioPriceComparisonSealInput({ block, thread_id: turn.thread_id }));
      if (!sealed.ok) {
        await client.query("commit");
        console.warn(`[chat] the price comparison for thread ${turn.thread_id} failed its seal`, sealed.verification.failures);
        return { kind: "refused" };
      }
      await recordScenarioPriceComparison(client, block);
      const blocks = JSON.stringify([block]);
      const inserted = await client.query(
        `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash)
         select $1::uuid, t.thread_id, 'assistant'::chat_role, $3::uuid, $4::jsonb, $5
           from chat_threads t where t.thread_id = $2::uuid and t.user_id = $6::uuid
         on conflict (message_id) do nothing
         returning message_id`,
        [turn.message_id, turn.thread_id, block.snapshot_id, blocks, contentHashForText(blocks), turn.user_id],
      );
      // An attempt that committed before this snapshot saved the turn's message, or the thread is no longer the owner's: this one saves nothing.
      if (inserted.rows.length === 0) {
        await client.query("rollback");
        return { kind: "saved", message_id: turn.message_id };
      }
      await client.query(`update chat_threads set latest_snapshot_id = $2::uuid, updated_at = now() where thread_id = $1::uuid`, [turn.thread_id, block.snapshot_id]);
      await client.query("commit");
      return { kind: "saved", message_id: turn.message_id };
    } catch (error) {
      await client.query("rollback").catch((rollbackError: unknown) => {
        (error as { rollback_error?: unknown }).rollback_error = rollbackError;
      });
      throw error;
    }
  }, destroyAfterFailedRollback);
}
