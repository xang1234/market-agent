// Shared harness for the chat financial lane tests: a stub resolver, a scripted
// planning model, and a coordinator wired to a real engine database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { connectedPool } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { databaseUrl, engineDatabase, IDS } from "../../financial-engine/test/db-fixtures.ts";
import {
  createChatCoordinator,
  type ChatAnalystToolRuntime,
  type ChatAssistantMessageCommit,
  type ChatAssistantMessagePersistence,
  type ChatCoordinatorOptions,
  type ChatTurnInput,
} from "../src/coordinator.ts";
import { createChatFinancialRuntime } from "../src/financial-runtime.ts";
import { proposedMetric, resolveResearchScope, type CompanyChange, type ScopeProposal } from "../src/research-scope.ts";
import { extractSubjectMentions } from "../src/subject-extraction.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";
import { readMessage } from "./read-message-fixture.ts";

export const MISSING_ISSUER = "4f000000-0000-4000-8000-0000000000a9";
// A listing of issuer A, as the resolver offers for a ticker (seeded by the tests that use AMBL).
export const LISTING_A = "4f000000-0000-4000-8000-0000000000b1";
export const INSTRUMENT_A = "4f000000-0000-4000-8000-0000000000c1";
// A listing with no row.
export const GONE_LISTING = "4f000000-0000-4000-8000-0000000000b9";
// An issuer whose facts only SEC ingestion writes (seeded by the tests that use OPM).
export const SEC_ISSUER = "4f000000-0000-4000-8000-0000000000d1";
export const SEC_ISSUER_B = "4f000000-0000-4000-8000-0000000000d2";
export const SEC_ISSUER_C = "4f000000-0000-4000-8000-0000000000d3";
export const SEC_ISSUER_D = "4f000000-0000-4000-8000-0000000000d4";

/**
 * AAA and BBB resolve to the seeded issuers; AMB is ambiguous between them, and AMBL
 * between a listing of A, A itself and issuer B, AMBX between a listing of A and A itself, AMBG
 * between a listing that no longer exists and issuer B; CCC
 * has no name or data; anything else is unknown.
 */
export function resolveMention(mention: string): Promise<ChatSubjectPreResolution> {
  const resolved = (id: string, label: string) =>
    ({ status: "resolved", subject_ref: { kind: "issuer", id }, display_label: label, handoff: { display_labels: { ticker: mention } } }) as unknown as ChatSubjectPreResolution;
  const table: Record<string, ChatSubjectPreResolution> = {
    AAA: resolved(IDS.issuerA, "Alpha Industries Inc."),
    // Another name for the same company as AAA.
    ALPHA: resolved(IDS.issuerA, "Alpha Industries Inc."),
    BBB: resolved(IDS.issuerB, "Beta Holdings Corp."),
    CCC: resolved(MISSING_ISSUER, "Gamma Unlisted"),
    OPM: resolved(SEC_ISSUER, "Operating Example Corp"),
    PAX: resolved(SEC_ISSUER_B, "Productive Assets Corp"),
    COX: resolved(SEC_ISSUER_C, "Continuing Operations Corp"),
    QTR: resolved(SEC_ISSUER_D, "Quarterly Filer Corp"),
    AMB: {
      status: "needs_clarification", input_text: mention, normalized_input: mention, message: "ambiguous",
      candidates: [
        { subject_ref: { kind: "issuer", id: IDS.issuerA }, display_name: "Alpha Industries Inc.", confidence: 0.5 },
        { subject_ref: { kind: "issuer", id: IDS.issuerB }, display_name: "Beta Holdings Corp.", confidence: 0.5 },
      ],
    } as ChatSubjectPreResolution,
    AMBG: {
      status: "needs_clarification", input_text: mention, normalized_input: mention, message: "ambiguous",
      candidates: [
        { subject_ref: { kind: "listing", id: GONE_LISTING }, display_name: "Gone Corp. (XNAS)", confidence: 0.5 },
        { subject_ref: { kind: "issuer", id: IDS.issuerB }, display_name: "Beta Holdings Corp.", confidence: 0.5 },
      ],
    } as ChatSubjectPreResolution,
    AMBX: {
      status: "needs_clarification", input_text: mention, normalized_input: mention, message: "ambiguous",
      candidates: [
        { subject_ref: { kind: "listing", id: LISTING_A }, display_name: "Alpha Industries Inc. (XNAS)", display_labels: { primary: "ALPX · XNAS", ticker: "ALPX" }, confidence: 0.5 },
        { subject_ref: { kind: "issuer", id: IDS.issuerA }, display_name: "Alpha Industries Inc.", confidence: 0.5 },
      ],
    } as ChatSubjectPreResolution,
    AMBL: {
      status: "needs_clarification", input_text: mention, normalized_input: mention, message: "ambiguous",
      candidates: [
        { subject_ref: { kind: "listing", id: LISTING_A }, display_name: "Alpha Industries Inc. (XNAS)", confidence: 0.5 },
        { subject_ref: { kind: "issuer", id: IDS.issuerA }, display_name: "Alpha Industries Inc.", confidence: 0.4 },
        { subject_ref: { kind: "issuer", id: IDS.issuerB }, display_name: "Beta Holdings Corp.", confidence: 0.5 },
      ],
    } as ChatSubjectPreResolution,
  };
  return Promise.resolve(table[mention] ?? ({ status: "not_found", input_text: mention, normalized_input: mention, message: "not found" } as ChatSubjectPreResolution));
}

export const NO_ASKS: ScopeProposal = { metrics: [], asks: new Set(), turns_off: { facets: new Set(), metrics: new Set() }, income_items: [], period: { kind: "none" }, companies: { kind: "as_named", names: [] } };
export const METRIC_READING: ScopeProposal = { ...NO_ASKS, metrics: [proposedMetric("income_statement", null, null)!] };
/** A recorded reading that, like the model's, names the tickers its question writes when it names no company. */
export const readingOf = (proposal: ScopeProposal | null) => async (question: string): Promise<ScopeProposal | null> =>
  proposal !== null && proposal.companies.kind === "as_named" && proposal.companies.names.length === 0
    ? { ...proposal, companies: { kind: "as_named", names: extractSubjectMentions(question) } }
    : proposal;
export const changing = (companies: CompanyChange) => async (): Promise<ScopeProposal> => ({ ...METRIC_READING, companies });
export const comparing = (...add: string[]) => changing({ kind: "compare", add });

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

export function chatHarness(
  pool: Pool,
  options: {
    model: PlanningModel | null;
    analyst?: ChatAnalystToolRuntime;
    // null: the runtime is given no scope.
    researchScope?: Parameters<typeof createChatFinancialRuntime>[0]["researchScope"] | null;
    readQuestion?: ChatCoordinatorOptions["readQuestion"];
    priorSubjects?: Parameters<typeof createChatFinancialRuntime>[0]["priorSubjects"];
    resolveMention?: typeof resolveMention;
    clock?: () => Date;
    persistAssistantMessage?: ChatAssistantMessagePersistence;
    evidence?: Parameters<typeof createChatFinancialRuntime>[0]["evidence"];
    commentary?: Parameters<typeof createChatFinancialRuntime>[0]["commentary"];
  },
) {
  // The narrative messages the turns saved: clarifications and gaps.
  const persisted: Array<Parameters<ChatAssistantMessageCommit>[0]> = [];
  const coordinator = createChatCoordinator({
    analystToolRuntime: options.analyst ?? forbiddenAnalyst,
    // By default the reading names the tickers the question writes, with no change asked.
    readQuestion: options.readQuestion ?? (async (question) => ({ ...METRIC_READING, companies: { kind: "as_named", names: extractSubjectMentions(question) } })),
    persistAssistantMessage: async (message) => {
      persisted.push(message);
      return options.persistAssistantMessage?.(message) ?? readMessage({ snapshot_id: randomUUID(), message_id: randomUUID(), thread_id: message.threadId });
    },
    financialRuntime: createChatFinancialRuntime({
      pool,
      planningModel: options.model,
      resolveMention: options.resolveMention ?? resolveMention,
      evidence: options.evidence ?? createEvidenceFinancialPort,
      // As wired in production, every turn has a scope; this one has no prior answer.
      ...(options.researchScope === null ? {} : {
        researchScope: options.researchScope ?? (async (context, read) =>
          resolveResearchScope({ question: context.userIntent ?? "", companies: [], prior: null, asOf: (options.clock?.() ?? new Date()).toISOString(), proposal: await read })),
      }),
      ...(options.priorSubjects ? { priorSubjects: options.priorSubjects } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.commentary ? { commentary: options.commentary } : {}),
    }),
  });
  const run = async (input: Omit<ChatTurnInput, "runId" | "turnId"> & { turnId?: string; runId?: string }) => {
    const turnId = input.turnId ?? randomUUID();
    const handle = coordinator.getOrCreateTurn({ ...input, runId: input.runId ?? turnId, turnId });
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
