// One repair round for analyst inferences. An inference a check rejected
// (assertions.ts), or the judge found contradicted or stating an amount in
// words (verdicts.ts sentToRepair), goes back to the answer model once, with
// why; what it writes in its place goes through the same checks and the judge,
// and shows by the same rules. A repair that fails again, or never comes,
// leaves it as its first verdict showed it (answer-trace.ts). Never a second
// round.

import type { LlmChatClient, LlmChatMessage, LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import { isRecord } from "../../shared/src/http.ts";
import { assertionList, checkAssertions, SUPPORT_KINDS, type AssertionReport, type RejectionCheck } from "./assertions.ts";
import type { EvidencePacket } from "./evidence-packet.ts";
import { judgeCases, modelCall, type JudgeCase, type ModelRecord } from "./inference-judge.ts";
import type { ModelDeadlines } from "./llm-runtime.ts";
import { sentToRepair, type InferenceVerdict, type Verdict } from "./verdicts.ts";

// Why an inference goes to repair, as the repair call is told: the check it failed,
// or the judge's verdict. limit and rendering are not the inference's words,
// so no rewrite passes them. rejected_supports: the supports it listed that
// the check did not accept as one, so the rewrite does not cite them again.
export type RepairRequest = { index: number; text: string; rejected_supports?: number[] } & (
  | { check: Exclude<RejectionCheck, "limit" | "rendering" | "judge">; reason: string }
  | { check: "judge"; verdict: Verdict; worded_amount: boolean; reason?: string }
);

// What a turn's repair round did: what it asked, the call, and the judge's
// call for each repaired inference that passed the checks, in index order.
export type RepairTrace = { requests: RepairRequest[]; record: ModelRecord; judge: ModelRecord[] };

// Validated live (2026-10-22): 6 of 6 repairs on the recorded traces and 20 of
// 21 on the hide-tier judge mutations end shown or unverified.
export const REPAIR_INSTRUCTIONS = "You already answered this question; your_assertions is the list you wrote. Some analyst_inference entries in it are not shown to the reader. Each is listed below with why: the check it failed and its reason, or the judge's verdict and reason (worded_amount: its words state an amount, fraction, multiple or span of time). Write each one again so it passes, under every rule above: words only, no digit anywhere, no amount in words, nothing its supports do not show; or leave it out if it cannot be said that way. Its supports carry the periods, so its text names no period at all (no year, quarter, \"latest\", \"earlier\" or \"prior\") and leaves which period is which to its supports. Reply with only a fenced block that opens with ```assertions on its own line: a JSON array of the corrected entries, each an analyst_inference object in the same shape as in your list (supports, and a subject only as the rules allow), with \"index\" added: the index of the entry it replaces. At most one per index listed below.";

// Repair latency measured 1.5-2.5 s over 18 live calls: one attempt of about
// six times the slowest. A late repair leaves its inference as it was.
export const REPAIR_DEADLINES: ModelDeadlines = { attemptMs: 15_000, totalMs: 16_000 };

const UNREPAIRABLE: ReadonlySet<RejectionCheck> = new Set(["limit", "rendering", "judge"]);

// The inferences to repair, in index order: list is the answer's list as
// written, report its check's, verdicts the judge's.
export function repairRequests(list: ReadonlyArray<unknown>, report: Pick<AssertionReport, "accepted" | "rejected">, verdicts: ReadonlyArray<InferenceVerdict>): RepairRequest[] {
  const of = (index: number) => {
    const item = list[index];
    const supports = isRecord(item) && Array.isArray(item.supports) ? item.supports : [];
    const rejected = supports.filter((n): n is number =>
      typeof n === "number" && !report.accepted.some((entry) => entry.index === n && SUPPORT_KINDS.has(entry.kind))
    );
    return { index, text: isRecord(item) && typeof item.text === "string" ? item.text : "", ...(rejected.length > 0 ? { rejected_supports: rejected } : {}) };
  };
  const isInference = (index: number) => isRecord(list[index]) && list[index].kind === "analyst_inference";
  const checks = report.rejected.flatMap((rejection): RepairRequest[] =>
    UNREPAIRABLE.has(rejection.check) || !isInference(rejection.index)
      ? []
      : [{ ...of(rejection.index), check: rejection.check as Exclude<RejectionCheck, "limit" | "rendering" | "judge">, reason: rejection.reason }]
  );
  const judged = verdicts.flatMap((verdict): RepairRequest[] =>
    verdict.verdict === "error" || !sentToRepair(verdict)
      ? []
      : [{ ...of(verdict.index), check: "judge", verdict: verdict.verdict, worded_amount: verdict.worded_amount, ...(verdict.reason ? { reason: verdict.reason } : {}) }]
  );
  return [...checks, ...judged].sort((a, b) => a.index - b.index);
}

// The answer request, unchanged but for its last message, which asks for the
// repair: the adapter carries no assistant turn (pi-adapter.ts), so the list
// the model wrote goes back inside it.
export function repairMessages(answerMessages: ReadonlyArray<{ role: string; content: string }>, list: ReadonlyArray<unknown>, requests: ReadonlyArray<RepairRequest>): LlmChatMessage[] {
  const [system, user] = answerMessages;
  return [
    { role: "system", content: system!.content },
    { role: "user", content: `${user!.content}\n\n${REPAIR_INSTRUCTIONS}\n${JSON.stringify({ your_assertions: list, rejected: requests })}` },
  ];
}

export function requestRepair(input: {
  messages: ReadonlyArray<LlmChatMessage>;
  env: LlmSettingsLoaderEnv;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  deadlines?: ModelDeadlines;
}): Promise<ModelRecord> {
  return modelCall({
    what: "repair",
    env: input.env,
    ...(input.createClient ? { createClient: input.createClient } : {}),
    request: { messages: input.messages, temperature: 0.2, reasoning: "low", maxTokens: 2048 },
    deadlines: input.deadlines ?? REPAIR_DEADLINES,
  });
}

// The list with each repaired inference in its entry's place: the entry as
// written, under the fields the repair gives it (its supports, subject and
// evidence stay unless it lists its own). Only the first analyst_inference per
// requested index counts; a reply that failed, was cut off or holds no list
// repairs nothing.
export function repairedList(list: ReadonlyArray<unknown>, requests: ReadonlyArray<RepairRequest>, record: ModelRecord): { list: unknown[]; repaired: number[] } {
  const entries = record.outcome === "replied" && !record.exchange.truncated ? assertionList(record.exchange.text) ?? [] : [];
  const merged = [...list];
  const repaired: number[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || entry.kind !== "analyst_inference" || typeof entry.index !== "number") continue;
    const { index, ...fields } = entry;
    if (repaired.includes(index) || !requests.some((request) => request.index === index)) continue;
    merged[index] = { ...(isRecord(list[index]) ? list[index] : {}), ...fields };
    repaired.push(index);
  }
  return { list: merged, repaired: repaired.sort((a, b) => a - b) };
}

// The round itself: the call, the merged list's check, and the judge on each
// repaired inference that passed it. checked hears the merged check before its
// inferences are judged, so a caller can render from it as verdicts land.
export async function repairRound(input: {
  messages: ReadonlyArray<{ role: string; content: string }>;
  list: ReadonlyArray<unknown>;
  requests: ReadonlyArray<RepairRequest>;
  packet: EvidencePacket;
  factBlocks: ReadonlyArray<Record<string, unknown>>;
  repair: (messages: LlmChatMessage[]) => Promise<ModelRecord>;
  judge: (inference: JudgeCase, i: number) => Promise<ModelRecord>;
  checked?: (report: AssertionReport) => void;
}): Promise<{ record: ModelRecord; list: unknown[]; repaired: number[]; report: AssertionReport; cases: JudgeCase[]; records: ModelRecord[] }> {
  const record = await input.repair(repairMessages(input.messages, input.list, input.requests));
  const { list, repaired } = repairedList(input.list, input.requests, record);
  const report = checkAssertions(list, input.packet);
  if (repaired.length === 0) return { record, list, repaired, report, cases: [], records: [] };
  input.checked?.(report);
  const cases = judgeCases(report.accepted, input.packet, input.factBlocks).filter((inference) => repaired.includes(inference.index));
  return { record, list, repaired, report, cases, records: await Promise.all(cases.map(input.judge)) };
}
