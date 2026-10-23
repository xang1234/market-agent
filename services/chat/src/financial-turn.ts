// How a financial turn reaches the stream. Before commit, the stream carries
// only the turn's start: no tool previews, values, titles, or error detail
// that could expose an unverified number. A certified answer is announced only
// after the transaction that wrote its snapshot, certificate, and message has
// committed, and its turn.completed carries that committed message. A company
// overview's answer is shown (answer.shown) before its analyst commentary is
// written and saved beside it, so the numbers never wait on it. Clarifications
// and gaps are ordinary narrative messages with no numbers.

import { randomUUID } from "node:crypto";

import type {
  ChatAssistantMessageCommit,
  ChatTurnRunContext,
  ChatTurnRunner,
} from "./coordinator.ts";
import { contentHashForText, stableUuid } from "./chat-ids.ts";
import { blockHeads, sealedCompletion } from "./messages.ts";
import type { ChatFinancialRuntime, ChatFinancialTurn, ChatFinancialTurnContext } from "./financial-runtime.ts";

export const FINANCIAL_BUNDLE_ID = "financial_answer";

/** Routes a turn the financial lane takes to it; every other turn goes to `runner` unchanged. */
export function financialAwareRunner(
  runner: ChatTurnRunner,
  options: { financialRuntime?: ChatFinancialRuntime; persistAssistantMessage?: ChatAssistantMessageCommit },
): ChatTurnRunner {
  const runtime = options.financialRuntime;
  if (!runtime) return runner;
  return async (context) => {
    // Nothing about an unfinished turn's companies or calculation leaves the server.
    const failed = () => {
      context.emit("turn.error", { error_code: "financial_answer_failed", message: "The calculation could not be completed." });
    };
    let taken: (() => Promise<ChatFinancialTurn>) | null;
    try {
      taken = await runtime.take(context);
    } catch (error) {
      console.error("[chat] the financial lane could not decide whether it takes the turn", error);
      return failed();
    }
    if (!taken) return runner(context);
    context.emit("turn.started", { bundle_id: FINANCIAL_BUNDLE_ID });
    let turn: ChatFinancialTurn;
    try {
      turn = await taken();
    } catch (error) {
      console.error("[chat] the financial turn failed", error);
      return failed();
    }
    await emitFinancialTurn(context, turn, options.persistAssistantMessage);
  };
}

async function emitFinancialTurn(
  context: ChatFinancialTurnContext,
  turn: ChatFinancialTurn,
  persistAssistantMessage: ChatAssistantMessageCommit | undefined,
): Promise<void> {
  const { emit } = context;
  if (turn.kind === "published" || turn.kind === "saved") {
    let { message } = turn;
    if (message) emit("snapshot.sealed", { snapshot_id: message.snapshot_id, status: "sealed", verification: { ok: true } });
    if (turn.kind === "published" && turn.commentary && message) {
      const { message_id, snapshot_id, blocks, block_proofs } = message;
      emit("answer.shown", { message_id, snapshot_id, blocks, block_proofs });
      message = await turn.commentary();
    }
    const heads = message ? blockHeads(message) : [];
    const unread = turn.kind === "published"
      ? { id: `financial-answer-${turn.message_id}`, kind: "financial_answer" }
      : { id: `financial-gap-${turn.message_id}`, kind: "rich_text" };
    for (const head of heads.length > 0 ? heads : [unread]) {
      emit("block.began", { block_id: head.id, kind: head.kind });
      emit("block.completed", { block_id: head.id });
    }
    emit("turn.completed", {
      ...sealedCompletion({ message_id: turn.message_id, message }, turn.message_id),
      bundle_id: FINANCIAL_BUNDLE_ID,
      // The deployment that wrote the commentary, as an analyst turn names its own (#183).
      ...(message?.answered_by ? { answered_by: message.answered_by } : {}),
      ...(turn.kind === "published" ? { financial: { run_id: turn.run_id } } : {}),
    });
    return;
  }

  const text = turn.kind === "clarification" ? clarificationText(turn) : turn.text;
  const turnId = context.turnId ?? context.runId;
  // Each attempt seals its own snapshot: a retry that saves nothing new (its
  // message is saved) must not seal one id twice.
  const blockId = randomUUID();
  const snapshotId = randomUUID();
  const blocks = [{
    id: blockId,
    kind: "rich_text",
    snapshot_id: snapshotId,
    data_ref: { kind: "rich_text", id: blockId },
    source_refs: [],
    as_of: new Date().toISOString(),
    segments: [{ type: "text", text }],
    // A gap names the companies it was asked about, and saves its scope, so a
    // follow-up continues them (thread-context.ts).
    ...(turn.kind === "gap" && turn.subject_refs?.length ? { subject_refs: turn.subject_refs } : {}),
  }];
  const contentHash = contentHashForText(JSON.stringify(blocks));
  const persisted = persistAssistantMessage
    ? await persistAssistantMessage({
      threadId: context.threadId,
      runId: context.runId,
      turnId,
      role: "assistant",
      blocks,
      content_hash: contentHash,
      ...(turn.kind === "gap" && turn.message_id ? { message_id: turn.message_id } : {}),
      ...(turn.kind === "gap" && turn.research_scope ? { research_scope: turn.research_scope } : {}),
    })
    : null;
  if (persisted) emit("snapshot.sealed", { snapshot_id: persisted.snapshot_id, status: "sealed" });
  emit("block.began", { block_id: blockId, kind: "rich_text" });
  emit("block.delta", { block_id: blockId, delta: { segment: { type: "text", text } } });
  emit("block.completed", { block_id: blockId, content_hash: contentHash });
  emit("turn.completed", {
    ...sealedCompletion(persisted, stableUuid(`financial-${turn.kind}-message:${context.threadId}:${turnId}`)),
    bundle_id: FINANCIAL_BUNDLE_ID,
    ...(turn.kind === "clarification"
      ? {
          clarification: true,
          financial_clarification: {
            clarification_id: turn.clarification.clarification_id,
            kind: turn.clarification.kind,
            question: turn.clarification.question,
            choices: turn.clarification.choices.map((choice) => ({ choice_id: choice.choice_id, label: choice.label })),
          },
        }
      : { financial_gap: { reason_code: turn.reason_code } }),
  });
}

function clarificationText(turn: Extract<ChatFinancialTurn, { kind: "clarification" }>): string {
  const { question, choices } = turn.clarification;
  return choices.length === 0 ? question : `${question} ${choices.map((choice) => choice.label).join("; ")}`;
}
