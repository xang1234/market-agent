// Shared harness for the chat financial lane tests: a stub resolver, a scripted
// planning model, and a coordinator wired to a real engine database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { connectedPool } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { databaseUrl, engineDatabase, IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createChatCoordinator, type ChatAnalystToolRuntime, type ChatTurnInput } from "../src/coordinator.ts";
import { createChatFinancialRuntime, type ChatFinancialMode } from "../src/financial-runtime.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";

export const MISSING_ISSUER = "4f000000-0000-4000-8000-0000000000a9";

/** AAA and BBB resolve to the seeded issuers; AMB is ambiguous between them; CCC has no name or data; anything else is unknown. */
export function resolveMention(mention: string): Promise<ChatSubjectPreResolution> {
  const resolved = (id: string, label: string) => ({ status: "resolved", subject_ref: { kind: "issuer", id }, display_label: label }) as unknown as ChatSubjectPreResolution;
  const table: Record<string, ChatSubjectPreResolution> = {
    AAA: resolved(IDS.issuerA, "Alpha Industries Inc."),
    BBB: resolved(IDS.issuerB, "Beta Holdings Corp."),
    CCC: resolved(MISSING_ISSUER, "Gamma Unlisted"),
    AMB: {
      status: "needs_clarification", input_text: mention, normalized_input: mention, message: "ambiguous",
      candidates: [
        { subject_ref: { kind: "issuer", id: IDS.issuerA }, display_name: "Alpha Industries Inc.", confidence: 0.5 },
        { subject_ref: { kind: "issuer", id: IDS.issuerB }, display_name: "Beta Holdings Corp.", confidence: 0.5 },
      ],
    } as ChatSubjectPreResolution,
  };
  return Promise.resolve(table[mention] ?? ({ status: "not_found", input_text: mention, normalized_input: mention, message: "not found" } as ChatSubjectPreResolution));
}

/** A planning model that answers every call with a revenue draft for the given slots, and counts calls. */
export function revenueModel(mentions: ReadonlyArray<string>): PlanningModel & { calls: number } {
  const slots = mentions.map((mention, index) => ({ slot: String.fromCharCode(97 + index), mention }));
  const model = (async () => {
    model.calls += 1;
    return {
      model: "stub-model",
      text: JSON.stringify({
        outcome: "ready",
        subjects: slots.map(({ slot, mention }) => ({ slot_id: slot, mention })),
        operations: slots.map(({ slot }) => ({ node_id: `${slot}_rev`, operation: "reported_metric", subject_slot: slot, metric_key: "revenue", period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "FY" } })),
        outputs: slots.map(({ slot }) => ({ output_id: `${slot}_out`, node_id: `${slot}_rev` })),
        thresholds: [],
      }),
    };
  }) as unknown as PlanningModel & { calls: number };
  model.calls = 0;
  return model;
}

/** A narrative analyst that must not be reached. */
export const forbiddenAnalyst: ChatAnalystToolRuntime = () => {
  throw new Error("the narrative composer was invoked for a financial turn");
};

export function chatHarness(pool: Pool, options: { model: PlanningModel | null; mode?: ChatFinancialMode; analyst?: ChatAnalystToolRuntime }) {
  const persisted: string[] = [];
  const coordinator = createChatCoordinator({
    analystToolRuntime: options.analyst ?? forbiddenAnalyst,
    persistAssistantMessage: async (message) => {
      persisted.push(message.turnId);
      return { snapshot_id: randomUUID(), message_id: randomUUID() };
    },
    financialRuntime: createChatFinancialRuntime({
      mode: options.mode ?? "enforce",
      pool,
      planningModel: options.model,
      resolveMention,
      evidence: createEvidenceFinancialPort,
    }),
  });
  const run = async (input: Omit<ChatTurnInput, "runId" | "turnId"> & { turnId?: string }) => {
    const turnId = input.turnId ?? randomUUID();
    const handle = coordinator.getOrCreateTurn({ ...input, runId: turnId, turnId });
    await handle.completed;
    return { turnId, events: handle.events };
  };
  return { run, persisted };
}

export async function chatDatabase(t: Parameters<typeof engineDatabase>[0], prefix: string): Promise<{ db: Client; pool: Pool; threadId: string }> {
  const db = await engineDatabase(t, prefix);
  const pool = await connectedPool(t, databaseUrl(db));
  const threadId = randomUUID();
  await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [threadId, IDS.owner]);
  return { db, pool, threadId };
}

export function completed(events: ReadonlyArray<{ type: string } & Record<string, unknown>>) {
  const last = events.at(-1)!;
  assert.equal(last.type, "turn.completed", JSON.stringify(events.map((event) => [event.type, event.error_code])));
  return last;
}
