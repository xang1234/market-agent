// The Call (ADR 0005, #604): the agent's opinion on one company, produced only
// when the owner asks for it in one of a few fixed sentences. Nothing else a
// message says produces, offers or prompts for one.
//
// A Call turn runs in two steps, as a price comparison (#224) builds on its
// scenario. The engine certifies the inputs in their own run under the turn's
// request key; its parent writes no message. Then one transaction generates
// the Call from that certificate, seals it, binds it (0082) and saves it as
// the turn's message.

import { randomUUID } from "node:crypto";

import { callInputOperations, DEFAULT_CALL_SETTINGS, type CallSettings, type FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import { buildDeterministicPlan, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, FinancialPool, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { publishRequest } from "../../financial-engine/src/request.ts";
import { isTransientDatabaseError } from "../../financial-engine/src/transaction.ts";
import { callBlock, generateCall, recordCall } from "../../snapshot/src/call.ts";
import { buildCallSealInput } from "../../snapshot/src/seal-input.ts";
import { sealSnapshotInTransaction, snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { destroyAfterFailedRollback, withPoolClient } from "../../shared/src/pool-client.ts";
import { contentHashForText } from "./chat-ids.ts";
import type { ChatFinancialTurn } from "./financial-runtime.ts";

// "Make a Call on AAPL", "What's your call on AAPL?", "Give me your opinion on AAPL": one company, by one word, and nothing else.
const ASK = /^(?:make a call on|what(?:['’]s| is) your call on|give me your opinion on) (?<subject>[a-z][a-z0-9.-]{0,9})$/iu;

/** The company a message asks a Call on, or null when it asks for none. */
export function readCallAsk(text: string): Readonly<{ subject: string }> | null {
  const sentence = text.trim().replace(/[.?!]$/u, "").replace(/\s+/gu, " ");
  const subject = ASK.exec(sentence)?.groups?.subject;
  return subject === undefined ? null : { subject };
}

export const CALL_NO_COMPANY = "A Call is made on one company I can resolve, as in “Make a Call on AAPL”. Nothing was calculated.";
export const CALL_REFUSED = "The Call did not pass verification, so nothing is shown.";
export const CALL_INPUTS_FAILED = "The Call's inputs could not be certified, so no Call is shown.";

export type CallTurnDeps = Readonly<{
  pool: FinancialPool;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  /** The issuer a mention names, as the financial lane resolves it. */
  resolveSubject: (mention: string) => Promise<RequestedSubject["resolution"]>;
  settings?: CallSettings;
}>;

export type CallTurnRequest = Readonly<{
  subject: string;
  thread_id: string;
  user_id: string;
  message_id: string;
  request_key: string;
  authority: FinancialRuntimeAuthority;
  now: () => Date;
}>;

/**
 * The turn of a Call ask: certify the inputs, then generate, seal and save the
 * Call under the turn's message id (`saved` reads it back). A company that
 * does not resolve, inputs the engine could not run, or a seal that fails is
 * a gap; an input outcome is a declined Call, never a gap.
 */
export async function callTurn(deps: CallTurnDeps, request: CallTurnRequest, saved: () => Promise<ChatFinancialTurn>): Promise<ChatFinancialTurn> {
  const resolution = await deps.resolveSubject(request.subject);
  if (resolution.status !== "resolved") return { kind: "gap", reason_code: "configuration_needed", text: CALL_NO_COMPANY };
  const subject: RequestedSubject = { mention: request.subject, resolution };
  const outcome = await publishRequest(deps.pool, {
    authority: request.authority,
    request_key: request.request_key,
    plan: async () => buildDeterministicPlan({
      plan_id: randomUUID(),
      origin: { kind: "chat_request", ref: `chat:${request.thread_id}:${request.request_key}` },
      knowledge_cutoff: request.now().toISOString(),
      cutoff_timezone: "UTC",
      reporting_basis: "as_restated",
      freshness_max_age_days: null,
      authority: request.authority,
      parent_limits: {},
      max_model_calls: 0,
      requested_subjects: [subject],
      publication_unit_kind: "chat_section",
    }, {
      subjects: [{ slot_id: "a", mention: subject.mention }],
      operations: callInputOperations("a"),
      outputs: CALL_OUTPUTS.map((node) => ({ output_id: `out_${node}`, node_id: node })),
      thresholds: [],
    }),
    evidence: deps.evidence,
    // The inputs' certificate is a fact-layer record the Call refers to; no message shows it.
    persistParent: async () => {},
  });
  // A commit that failed is an error of this turn, not an answer; the retry publishes it.
  if (outcome.status === "gap" && outcome.reason === "publication_failed") throw new Error("the Call's inputs could not be committed");
  if (outcome.status !== "driven") return { kind: "gap", reason_code: outcome.status === "gap" ? outcome.reason : "configuration_needed", text: CALL_INPUTS_FAILED };
  const { rows: [unit] } = await deps.pool.query<{ snapshot_id: string }>(
    `select snapshot_id::text as snapshot_id from financial_run_units where run_id = $1::uuid and state = 'sealed'`,
    [outcome.run_id],
  );
  if (unit === undefined) return { kind: "gap", reason_code: "verification_failed", text: CALL_INPUTS_FAILED };
  const published = await publishCall(deps.pool, {
    thread_id: request.thread_id,
    user_id: request.user_id,
    message_id: request.message_id,
    inputs_snapshot_id: unit.snapshot_id,
    settings: deps.settings ?? DEFAULT_CALL_SETTINGS,
  });
  return published === "saved" ? saved() : { kind: "gap", reason_code: "verification_failed", text: CALL_REFUSED };
}

const CALL_OUTPUTS = ["free_cash_flow", "net_cash", "stock_based_compensation", "market_cap", "market_cap_px", "market_cap_shares"];

type CallPublication = Readonly<{ thread_id: string; user_id: string; message_id: string; inputs_snapshot_id: string; settings: CallSettings }>;

const PUBLISH_ATTEMPTS = 3;

/**
 * Generates, seals, binds and saves a Call in one repeatable-read
 * transaction, under the turn's message id, as a price comparison is
 * published: a retry finds it saved, and a transient database error runs the
 * whole transaction again, a bounded number of times.
 */
export async function publishCall(pool: FinancialPool, turn: CallPublication): Promise<"saved" | "refused"> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await publishOnce(pool, turn);
    } catch (error) {
      if (attempt >= PUBLISH_ATTEMPTS || !isTransientDatabaseError(error)) throw error;
      console.warn(`[chat] Call publish attempt ${attempt} of ${PUBLISH_ATTEMPTS} failed with SQLSTATE ${(error as { code?: string }).code}; retrying`);
    }
  }
}

async function publishOnce(pool: FinancialPool, turn: CallPublication): Promise<"saved" | "refused"> {
  return withPoolClient(pool, async (client) => {
    await client.query("begin isolation level repeatable read");
    try {
      const generated = await generateCall(client, { thread_id: turn.thread_id, inputs_snapshot_id: turn.inputs_snapshot_id, settings: turn.settings });
      if (generated === null) {
        await client.query("rollback");
        return "refused";
      }
      const block = callBlock(`call-${turn.message_id}`, randomUUID(), generated);
      const sealed = await sealSnapshotInTransaction(snapshotTransactionClient(client), buildCallSealInput({ block, thread_id: turn.thread_id }));
      if (!sealed.ok) {
        // The seal's audit is kept; nothing is shown.
        await client.query("commit");
        console.warn(`[chat] the Call for thread ${turn.thread_id} failed its seal`, sealed.verification.failures);
        return "refused";
      }
      await recordCall(client, block);
      const blocks = JSON.stringify([block]);
      const inserted = await client.query(
        `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash)
         select $1::uuid, t.thread_id, 'assistant'::chat_role, $3::uuid, $4::jsonb, $5
           from chat_threads t where t.thread_id = $2::uuid and t.user_id = $6::uuid
         on conflict (message_id) do nothing
         returning message_id`,
        [turn.message_id, turn.thread_id, block.snapshot_id, blocks, contentHashForText(blocks), turn.user_id],
      );
      // An attempt that committed first saved the turn's message, or the thread is no longer the owner's: this one saves nothing.
      if (inserted.rows.length === 0) {
        await client.query("rollback");
        return "saved";
      }
      await client.query(`update chat_threads set latest_snapshot_id = $2::uuid, updated_at = now() where thread_id = $1::uuid`, [turn.thread_id, block.snapshot_id]);
      await client.query("commit");
      return "saved";
    } catch (error) {
      await client.query("rollback").catch((rollbackError: unknown) => {
        (error as { rollback_error?: unknown }).rollback_error = rollbackError;
      });
      throw error;
    }
  }, destroyAfterFailedRollback);
}
