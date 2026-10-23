import type { TurnTrace } from "../../src/answer-trace.ts";
import { answerContext, turnPacket } from "../../src/llm-runtime.ts";

// The trace with its repair round asked from the answer prompt sent today:
// the recorded prompts carried quote and fact staleness the analyst no longer
// sends (#398), so only what a test changes differs.
export function repairUnderTodaysPrompt(trace: TurnTrace): TurnTrace {
  const recorded = trace.exchange!.messages[1]!.content;
  const today = JSON.stringify(answerContext({ ...trace.input, packet: trace.input.packet ?? turnPacket(trace.input) }));
  const record = trace.repair!.record as Extract<NonNullable<TurnTrace["repair"]>["record"], { outcome: "replied" }>;
  const messages = record.exchange.messages.map((message) => ({ ...message, content: message.content.replace(recorded, today) }));
  return { ...trace, repair: { ...trace.repair!, record: { ...record, exchange: { ...record.exchange, messages } } } };
}

// A recorded analyst turn read as the commentary on an engine answer, which
// shows a worded amount as unverified (#509) where an analyst answer hides it
// (#398).
export function asCommentary(trace: TurnTrace): TurnTrace {
  return { ...trace, input: { ...trace.input, packet: { ...(trace.input.packet ?? turnPacket(trace.input)), route: "financial_engine" } } };
}
