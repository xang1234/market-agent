// Analyst commentary on a company overview (#398 step 4). It is written after
// the engine's answer is committed and shown, from that answer's published
// results alone (enginePacket), so the numbers never wait on it. Every figure
// in it is a result ref the server checks against the answer before saving
// it beside the answer, in the same message. The seal admits no prose and no
// model may run inside finalization, so it is appended after the commit.

import type { FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import type { SqlExecutor } from "../../financial-engine/src/ports.ts";
import { findPlanForRequest } from "../../financial-engine/src/run-repo.ts";
import { LlmProviderError, LlmRouterError } from "../../llm/src/index.ts";
import type { FinancialAnswerBlock } from "../../snapshot/src/financial-verifier.ts";
import type { AnsweredTurn, AnswerTraceInput, TurnTrace } from "./answer-trace.ts";
import { contentHashForText } from "./chat-ids.ts";
import { enginePacket } from "./evidence-packet.ts";
import type { ChatReadMessage } from "./messages.ts";
import { resultRefProblem } from "./prose-refs.ts";

type Block = Record<string, unknown>;

/** The analyst answer and its judge (answer-trace.ts answerTurn), as the server configures them. */
export type CommentaryComposer = (input: AnswerTraceInput, turn: Pick<TurnTrace, "thread_id" | "run_id" | "turn_id" | "question">) => Promise<AnsweredTurn>;

export const COMMENTARY_UNAVAILABLE = "Commentary is unavailable for this answer.";

/**
 * Writes the commentary on a saved engine answer and appends it to the
 * message, or the note that it is unavailable when the model fails. Anything
 * else throws, and the caller keeps the answer as saved.
 */
export async function saveCommentary(
  db: SqlExecutor,
  compose: CommentaryComposer,
  input: Readonly<{
    message: ChatReadMessage;
    request: { authority: FinancialRuntimeAuthority; request_key: string };
    // By issuer, the ticker the turn named each company by.
    labels: ReadonlyMap<string, string>;
    turn: Pick<TurnTrace, "thread_id" | "run_id" | "turn_id" | "question">;
  }>,
): Promise<void> {
  // Another attempt of the turn wrote it: no second model call, no second block.
  if ((input.message.blocks as Block[]).some((block) => block.analyst_commentary === true)) return;
  const plan = await findPlanForRequest(db, input.request);
  const tickers = new Map((plan?.subjects.members ?? []).flatMap((member) => {
    const label = input.labels.get(member.subject_ref.id.toLowerCase());
    return label === undefined ? [] : [[member.slot_id, label] as const];
  }));
  await append(db, input.message, await commentary(compose, input.message, tickers, input.turn));
}

async function commentary(
  compose: CommentaryComposer,
  message: ChatReadMessage,
  tickers: ReadonlyMap<string, string>,
  turn: Pick<TurnTrace, "thread_id" | "run_id" | "turn_id" | "question">,
): Promise<Block> {
  const [answer] = message.blocks as unknown as [FinancialAnswerBlock];
  const id = `commentary-${message.message_id}`;
  const skeleton = { id, kind: "rich_text", snapshot_id: message.snapshot_id, data_ref: { kind: "rich_text", id }, source_refs: [], as_of: answer.as_of, analyst_commentary: true, segments: [] };
  const unavailable = (cause: unknown) => {
    console.warn(`[chat] analyst commentary unavailable for message ${message.message_id}`, cause);
    return { ...skeleton, segments: [{ type: "text", text: COMMENTARY_UNAVAILABLE }] };
  };
  const packet = enginePacket(answer.financial, tickers);
  let written: Pick<AnsweredTurn, "assertions" | "blocks">;
  try {
    const answered = await compose({
      context: { userIntent: turn.question, bundleId: "financial_answer" },
      blocks: [skeleton],
      toolCalls: [],
      packet,
    }, turn);
    written = answered.judging ? await answered.judging.done : answered;
  } catch (reason) {
    // A failed, timed-out or unmatched model call reaches here as the router's error.
    if (!(reason instanceof LlmRouterError || reason instanceof LlmProviderError)) throw reason;
    return unavailable(reason);
  }
  if (written.assertions?.rendered !== true) return unavailable(`no assertion rendered (list ${written.assertions?.status ?? "not written"})`);
  const [prose] = written.blocks as [Block];
  const problem = resultRefProblem(prose, answer);
  return problem === null ? prose : unavailable(problem);
}

async function append(db: SqlExecutor, message: ChatReadMessage, block: Block): Promise<void> {
  const blocks = JSON.stringify([...(message.blocks as Block[]), block]);
  const { rows } = await db.query(
    `update chat_messages set blocks = $2::jsonb, content_hash = $3
      where message_id = $1::uuid and content_hash = $4
      returning message_id`,
    [message.message_id, blocks, contentHashForText(blocks), message.content_hash],
  );
  if (rows.length === 0) console.warn(`[chat] the analyst commentary for message ${message.message_id} was not saved: the message changed since it was read`);
}
