// Held-out research traps (#221): each case in holdout/cases.ts runs as normal
// chat turns on the frozen golden dataset with a recorded answer, and is checked
// against the persisted answer, its research scope and the turn's assertion
// report, never report prose. Each mutation reruns the case with one change to
// the known-good answer and must fail its named check or never reach the
// page. No model or provider is called.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Client } from "pg";

import { bootstrapDatabase, connectedClient, dockerAvailable, registerLifoCleanup } from "../../../db/test/docker-pg.ts";
import { createFact } from "../../evidence/src/fact-repo.ts";
import { checkAssertions, type Rejection } from "../src/assertions.ts";
import type { EvidencePacket } from "../src/evidence-packet.ts";
import { closeLocalRuntimePoolForTests } from "../src/local-runtime.ts";
import { proposalQuestion } from "../src/scope-proposal.ts";
import {
  GOLDEN_AS_OF,
  GOLDEN_COMPANIES,
  GOLDEN_SOURCE_ID,
  seedGoldenDataset,
} from "./golden/dataset.ts";
import {
  api,
  completedTurn,
  GOLDEN_ENV,
  latestAssistantMessage,
  requireRecordedScopes,
  runTurn,
  startChatServer,
  USER_ID,
  withEnv,
  type ChatMessage,
} from "./golden/harness.ts";
import { HOLDOUT_CASES, HOLDOUT_VERSION, SYNTHETIC_CASES, SYNTHETIC_FIGURES, type HoldoutCase } from "./holdout/cases.ts";

// The suite's identity: its version and the digest of every case, pinned so a
// changed case is a new version, not a quiet edit (#221).
const HOLDOUT_DIGEST = "sha256:3dcbfdbba7affe45db13e0093f4510608cee4fde1cd1b00da9fdd43f99966b10";

test("the held-out suite is a fixed, versioned set of 10-12 cases (#221)", () => {
  assert.ok(HOLDOUT_CASES.length + 1 >= 10 && HOLDOUT_CASES.length + 1 <= 12, "10-12 cases, the synthetic set counted as one");
  for (const holdout of HOLDOUT_CASES) assert.equal(holdout.scopes.length, holdout.turns.length, `${holdout.id}: one recorded scope per turn`);
  const digest = `sha256:${createHash("sha256").update(JSON.stringify({ HOLDOUT_VERSION, HOLDOUT_CASES, SYNTHETIC_FIGURES, SYNTHETIC_CASES })).digest("hex")}`;
  assert.equal(digest, HOLDOUT_DIGEST, `the held-out cases changed: bump HOLDOUT_VERSION and pin ${digest}`);
});

test("synthetic comparative traps: ties, negatives, rounding and missing intervals have their expected outcomes (#221)", () => {
  const packet: EvidencePacket = {
    route: "comparison",
    cutoff: GOLDEN_AS_OF,
    companies: ["NVDA", "AMD", "AAPL"],
    figures: SYNTHETIC_FIGURES.map((figure) => ({ ...figure, source_ids: [] })),
    coverage: [],
    gaps: [],
    query_bounds: {},
    claims: [],
    disagreements: [],
    claims_status: "none",
    claims_truncated: false,
  };
  for (const { name, assertion, outcome } of SYNTHETIC_CASES) {
    const report = checkAssertions([assertion], packet);
    const got = report.accepted.length === 1 ? "accepted" : report.rejected[0]!.check;
    assert.equal(got, outcome, `${name}: ${JSON.stringify(report.rejected)}`);
  }
});

test("held-out research traps on the frozen dataset (#221)", { skip: !dockerAvailable(), timeout: 600_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-holdout");
  // The judge answers from the replay file too: no model is called.
  withEnv(t, { ...GOLDEN_ENV, JUDGE_LITELLM_MODEL: "fixture/recorded", CHAT_DATABASE_URL: databaseUrl });
  requireRecordedScopes(t);
  registerLifoCleanup(t, () => closeLocalRuntimePoolForTests());
  const client = await connectedClient(t, databaseUrl);
  await client.query(`insert into users (user_id, email) values ($1::uuid, 'holdout@chat.example.test')`, [USER_ID]);
  await seedGoldenDataset(client);
  await seedRestatement(client);
  await seedObsoleteSegment(client);
  const base = await startChatServer(t, databaseUrl);
  const replies = mkdtempSync(join(tmpdir(), "holdout-replies-"));

  // Runs a case's turns in a new thread, the checked turn answered with `reply`
  // and its inferences judged as `list` says: entailed, unless `judged` records
  // another verdict.
  let run = 0;
  const converse = async (holdout: HoldoutCase, reply: string, list: ReadonlyArray<Record<string, unknown>> = [], judged: Readonly<Record<number, string>> = {}) => {
    const file = join(replies, `${holdout.id}-${++run}.json`);
    const verdicts = list.flatMap((assertion, index) =>
      assertion.kind === "analyst_inference" ? [{ id: index, verdict: judged[index] ?? "entailed", ...(judged[index] ? { reason: "recorded verdict" } : {}) }] : []
    );
    // Each turn's scope first, matched by its quoted question alone. Then the
    // judge's reply: its request quotes the inferences, not the question. Then
    // the checked turn's: a later turn's request holds the earlier questions
    // too, and the first match answers.
    const recorded = [
      ...holdout.turns.map((turn, index) => ({ match: proposalQuestion(turn), text: JSON.stringify(holdout.scopes[index]) })),
      { match: "You check the analyst inferences", text: JSON.stringify({ verdicts }) },
      { match: holdout.turns.at(-1)!, text: reply },
      ...holdout.turns.slice(0, -1).reverse().map((turn) => ({ match: turn, text: "Noted." })),
      { match: "Create a short, specific research chat title", text: "Held-out case" },
    ];
    writeFileSync(file, JSON.stringify({ replies: recorded }));
    process.env.LLM_REPLAY_FILE = file;
    const thread = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: holdout.id });
    let events: Awaited<ReturnType<typeof runTurn>> = [];
    for (const turn of holdout.turns) events = await runTurn(base, thread.thread_id, turn);
    const completed = completedTurn(events);
    const answer = await latestAssistantMessage(base, thread.thread_id);
    const { rows } = await client.query<{ research_scope: Record<string, unknown> | null }>(
      `select research_scope from chat_messages where message_id = $1::uuid`, [answer.message_id],
    );
    return { completed, answer, scope: rows[0]?.research_scope ?? null };
  };
  const withList = (prose: string, list: ReadonlyArray<unknown> | undefined) =>
    list === undefined ? prose : `${prose}\n\n\`\`\`assertions\n${JSON.stringify(list)}\n\`\`\``;

  for (const holdout of HOLDOUT_CASES) {
    await t.test(`${holdout.id}: ${holdout.trap}`, async () => {
      const { completed, answer, scope } = await converse(holdout, withList(holdout.prose, holdout.good), holdout.good);
      checkExpectations(holdout, completed.data, answer, scope);
      if (holdout.good) {
        const report = completed.data.assertion_report as { status: string; accepted: unknown[]; rejected: Array<{ reason: string }> };
        assert.deepEqual(report.rejected, [], "the known-good answer passes in full");
        assert.equal(report.accepted.length, holdout.good.length);
      }
      for (const mutation of holdout.mutations ?? []) {
        if ("fails" in mutation) {
          const { completed: mutated } = await converse(holdout, withList(holdout.prose, mutation.list), mutation.list, mutation.judged);
          const report = mutated.data.assertion_report as { rejected: Rejection[] };
          const failed = report.rejected.find((entry) => entry.index === mutation.fails.index);
          assert.ok(failed, `${mutation.name}: not rejected (${JSON.stringify(mutated.data.assertion_report)})`);
          assert.equal(failed.check, mutation.fails.check, `${mutation.name}: ${failed.reason}`);
        } else {
          const { completed: mutated, answer } = await converse(holdout, "list" in mutation ? withList(holdout.prose, mutation.list) : mutation.prose, "list" in mutation ? mutation.list : []);
          if ("list" in mutation) {
            const report = mutated.data.assertion_report as { rendered?: boolean; rejected: unknown[]; repeated?: unknown[] };
            assert.deepEqual([report.rendered, report.rejected, report.repeated ?? []], [true, [], []], `${mutation.name}: rendered in full from its assertions`);
          }
          assert.doesNotMatch(JSON.stringify(answer.blocks), new RegExp(mutation.never_shown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), mutation.name);
        }
      }
    });
  }
});

function checkExpectations(holdout: HoldoutCase, completed: Record<string, unknown>, answer: ChatMessage, scope: Record<string, unknown> | null) {
  const { expect } = holdout;
  if (expect.clarification) {
    assert.equal(completed.clarification, true, "the turn asks instead of answering");
    // ...and binds no company: no scope saved, or one covering none.
    const bound = (scope?.companies as unknown[] | undefined) ?? [];
    assert.deepEqual(bound, expect.companies, "a clarification binds no company");
  } else {
    assert.ok(scope, "the answer saves its research scope");
    const labels = (scope.companies as Array<{ label?: string; issuer_id: string }>).map((company) =>
      company.label ?? GOLDEN_COMPANIES.find((golden) => golden.issuer_id === company.issuer_id)?.ticker);
    assert.deepEqual(labels, expect.companies);
    if (expect.route) assert.equal(scope.route, expect.route);
    if (expect.fiscal_year !== undefined) assert.equal(scope.fiscal_year, expect.fiscal_year);
  }
  for (const wanted of expect.blocks ?? []) {
    assert.ok(answer.blocks.some((block) => block.kind === wanted.kind && (wanted.title === undefined || block.title === wanted.title)),
      `expected ${wanted.kind} ${wanted.title ?? ""}; got [${answer.blocks.map((b) => `${b.kind}:${b.title}`).join(", ")}]`);
  }
  for (const kind of expect.absent_kinds ?? []) assert.equal(answer.blocks.some((block) => block.kind === kind), false, `no ${kind} is shown`);
  if (expect.gap) assert.ok(JSON.stringify(answer.blocks).includes(expect.gap), `the named gap: ${expect.gap}`);
  if (expect.ytd_range) {
    const chart = answer.blocks.find((block) => block.kind === "perf_comparison");
    assert.equal(chart?.default_range, expect.ytd_range);
    // The window keeps the cutoff it was first charted at: the frozen dataset's.
    assert.deepEqual(scope?.price_window, { kind: "ytd", cutoff: GOLDEN_AS_OF });
  }
  if (expect.shows) {
    const block = answer.blocks.find((candidate) => candidate.title === expect.shows!.block_title);
    const item = (block?.items as Array<{ label: string; format: string }> | undefined)?.find((candidate) => candidate.label === expect.shows!.label);
    assert.equal(item?.format, expect.shows.format, `${expect.shows.block_title} ${expect.shows.label}`);
  }
}

// AAPL's Q3 FY2026 revenue, restated from $97.1B to $97.4B by the cutoff in a
// later filing (another source), superseding the original as supersedeFact does.
async function seedRestatement(client: Client): Promise<void> {
  const aapl = GOLDEN_COMPANIES.find((company) => company.ticker === "AAPL")!;
  const { rows: [original] } = await client.query<{ fact_id: string; metric_id: string; period_start: string; period_end: string }>(
    `select f.fact_id::text, f.metric_id::text, f.period_start::text, f.period_end::text
       from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1::uuid and m.metric_key = 'revenue' and f.period_kind = 'fiscal_q'
        and f.fiscal_year = 2026 and f.fiscal_period = 'Q3'`,
    [aapl.issuer_id],
  );
  await createFact(client, {
    subject_kind: "issuer",
    subject_id: aapl.issuer_id,
    metric_id: original!.metric_id,
    period_kind: "fiscal_q",
    period_start: original!.period_start,
    period_end: original!.period_end,
    fiscal_year: 2026,
    fiscal_period: "Q3",
    value_num: 97_400e6,
    unit: "currency",
    currency: "USD",
    as_of: GOLDEN_AS_OF,
    reported_at: GOLDEN_AS_OF,
    observed_at: GOLDEN_AS_OF,
    source_id: SEC_RELEASE_SOURCE_ID,
    method: "reported",
    verification_status: "authoritative",
    freshness_class: "filing_time",
    coverage_level: "full",
    entitlement_channels: ["app"],
    confidence: 1,
  }, { supersedes: original!.fact_id }).then((restated) =>
    client.query(`update facts set superseded_by = $2::uuid where fact_id = $1::uuid`, [original!.fact_id, restated.fact_id]));
}

// The SEC press-release source (db/seed/sources.sql).
const SEC_RELEASE_SOURCE_ID = "00000000-0000-4000-a000-000000000002";

// An earlier definition of NVDA's Data Center segment, with a different Q4
// FY2026 revenue; the current definition ($55.2B) is the one shown.
async function seedObsoleteSegment(client: Client): Promise<void> {
  const nvda = GOLDEN_COMPANIES.find((company) => company.ticker === "NVDA")!;
  const quarter = nvda.quarters.find((q) => q.fiscal_year === 2026 && q.fiscal_period === "Q4")!;
  const { rows: [segment] } = await client.query<{ segment_id: string }>(
    `insert into segments (issuer_id, axis, name, definition_as_of)
     values ($1::uuid, 'business', 'Data Center', '2024-01-01T00:00:00Z') returning segment_id::text as segment_id`,
    [nvda.issuer_id],
  );
  const { rows: [metric] } = await client.query<{ metric_id: string }>(`select metric_id::text from metrics where metric_key = 'revenue'`);
  await createFact(client, {
    subject_kind: "segment",
    subject_id: segment!.segment_id,
    metric_id: metric!.metric_id,
    period_kind: "fiscal_q",
    period_start: quarter.period_start,
    period_end: quarter.period_end,
    fiscal_year: 2026,
    fiscal_period: "Q4",
    value_num: 50_000e6,
    unit: "currency",
    currency: "USD",
    as_of: GOLDEN_AS_OF,
    reported_at: GOLDEN_AS_OF,
    observed_at: GOLDEN_AS_OF,
    source_id: GOLDEN_SOURCE_ID,
    method: "reported",
    verification_status: "authoritative",
    freshness_class: "filing_time",
    coverage_level: "full",
    entitlement_channels: ["app"],
    confidence: 1,
  });
}

