// How a financial turn reaches the stream. Before commit, the stream carries
// only the turn's start: no tool previews, values, titles, or error detail
// that could expose an unverified number. A certified answer is announced only
// after the transaction that wrote its snapshot, certificate, and message has
// committed; clients then read the committed message. Clarifications and gaps
// are ordinary narrative messages with no numbers.

import type {
  ChatAssistantMessagePersistence,
  ChatTurnRunContext,
  ChatTurnRunner,
} from "./coordinator.ts";
import { contentHashForText, stableUuid } from "./chat-ids.ts";
import type { ChatFinancialRuntime, ChatFinancialTurn, ChatFinancialTurnContext } from "./financial-runtime.ts";

export const FINANCIAL_BUNDLE_ID = "financial_answer";

/** Routes financial turns to the financial lane; every other turn goes to `runner` unchanged. */
export function financialAwareRunner(
  runner: ChatTurnRunner,
  options: { financialRuntime?: ChatFinancialRuntime; persistAssistantMessage?: ChatAssistantMessagePersistence },
): ChatTurnRunner {
  const runtime = options.financialRuntime;
  if (!runtime) return runner;
  return async (context) => {
    if (!runtime.answers(context)) return runner(context);
    if (runtime.mode === "shadow") {
      await runtime.run(context).catch(() => null);
      return runner(context);
    }
    context.emit("turn.started", { bundle_id: FINANCIAL_BUNDLE_ID });
    let turn: ChatFinancialTurn | null;
    try {
      turn = await runtime.run(context);
    } catch {
      // Nothing about an unfinished calculation leaves the server.
      context.emit("turn.error", { error_code: "financial_answer_failed", message: "The calculation could not be completed." });
      return;
    }
    if (!turn) return runner(context);
    await emitFinancialTurn(context, turn, options.persistAssistantMessage);
  };
}

async function emitFinancialTurn(
  context: ChatFinancialTurnContext,
  turn: ChatFinancialTurn,
  persistAssistantMessage: ChatAssistantMessagePersistence | undefined,
): Promise<void> {
  const { emit } = context;
  if (turn.kind === "published") {
    const blockId = turn.block?.id ?? `financial-answer-${turn.message_id}`;
    emit("snapshot.sealed", { snapshot_id: turn.snapshot_id, status: "sealed", verification: { ok: true } });
    emit("block.began", { block_id: blockId, kind: "financial_answer" });
    emit("block.completed", { block_id: blockId });
    emit("turn.completed", { message_id: turn.message_id, bundle_id: FINANCIAL_BUNDLE_ID, financial: { run_id: turn.run_id } });
    return;
  }

  const text = turn.kind === "clarification" ? clarificationText(turn) : turn.text;
  const turnId = context.turnId ?? context.runId;
  const blockId = stableUuid(`financial-${turn.kind}-block:${context.threadId}:${turnId}`);
  const snapshotId = stableUuid(`financial-${turn.kind}-snapshot:${context.threadId}:${turnId}`);
  const blocks = [{
    id: blockId,
    kind: "rich_text",
    snapshot_id: snapshotId,
    data_ref: { kind: "rich_text", id: blockId },
    source_refs: [],
    as_of: new Date().toISOString(),
    segments: [{ type: "text", text }],
  }];
  const contentHash = contentHashForText(JSON.stringify(blocks));
  let messageId = stableUuid(`financial-${turn.kind}-message:${context.threadId}:${turnId}`);
  if (persistAssistantMessage) {
    const persisted = await persistAssistantMessage({ threadId: context.threadId, runId: context.runId, turnId, role: "assistant", blocks, content_hash: contentHash });
    messageId = persisted.message_id;
    emit("snapshot.sealed", { snapshot_id: persisted.snapshot_id, status: "sealed" });
  }
  emit("block.began", { block_id: blockId, kind: "rich_text" });
  emit("block.delta", { block_id: blockId, delta: { segment: { type: "text", text } } });
  emit("block.completed", { block_id: blockId, content_hash: contentHash });
  emit("turn.completed", {
    message_id: messageId,
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
