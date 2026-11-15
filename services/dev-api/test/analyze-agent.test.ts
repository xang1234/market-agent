import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { dockerAvailable, registerLifoCleanup } from "../../../db/test/docker-pg.ts";
import { memoDatabase, playbook } from "../../analyze/test/financial-fixtures.ts";
import { meteredModels } from "../../chat/src/analyst-agent.ts";
import { databaseUrl, IDS } from "../../financial-engine/test/db-fixtures.ts";
import { LlmClientError, type LlmChatClient, type LlmChatRequest, type LlmToolCall } from "../../llm/src/router.ts";
import { analyzeAgentWorkflow } from "../src/analyze-agent.ts";
import { createServiceDevApiAdapters } from "../src/http.ts";
import { analyzeAgentDeps, buildAnalyzeRunSeals, closeLocalRuntimePoolForTests, sealAnalyzeSnapshot } from "../src/local-runtime.ts";

const LLM_ENV = {
  LLM_CHANNELS: "openai",
  LLM_OPENAI_PROTOCOL: "openai",
  LLM_OPENAI_MODELS: "gpt-4.1,o3",
  LITELLM_MODEL: "openai/gpt-4.1",
  AGENT_LITELLM_MODEL: "openai/o3",
};

const AGENT_SECTIONS = ["investment_thesis", "growth_drivers", "competitive_position", "downside_risks"];
const LISTING = "4f000000-0000-4000-8000-0000000000e1";
const FILING_SOURCE = "4f000000-0000-4000-8000-0000000000e2";
const FILING = "4f000000-0000-4000-8000-0000000000e3";

type Section = { kind: string; title?: string; data_ref: { params?: { playbook_section_id?: string } }; claim_refs: string[]; children: Array<Record<string, unknown>> };

// What the scripted model reads for each section's goal, and what it answers with: every id the packet offers.
function scriptedModel(calls: string[]): () => LlmChatClient {
  const issuerRef = (request: LlmChatRequest) => (JSON.parse(String(request.messages[1]!.content)) as { companies: Array<{ subject_ref: unknown }> }).companies[0]!.subject_ref;
  const goalOf = (request: LlmChatRequest) => String((JSON.parse(String(request.messages[1]!.content)) as { question: string }).question);
  const call = (name: string, args: Record<string, unknown>): LlmToolCall => ({ id: `call-${randomUUID()}`, name, arguments: args as never });
  return () => async (_deployment, request) => {
    if (request.tools?.length) {
      const goal = goalOf(request);
      calls.push(`read:${goal.slice(0, 20)}`);
      if (request.messages.some((message) => (message.role as string) === "toolResult")) return { text: "DONE" };
      const subject_ref = issuerRef(request);
      if (goal.includes("investment case")) {
        return { text: "", toolCalls: [
          call("certified_financials", { subject_refs: [subject_ref], metrics: ["revenue"], period: { kind: "fiscal_year", fiscal_year: 2023 }, question: "Revenue in fiscal 2023" }),
          call("get_company_profile", { subject_ref }),
        ] };
      }
      if (goal.includes("compete")) return { text: "", toolCalls: [call("get_claims", { subject_refs: [subject_ref], predicates: ["business.competition"] })] };
      if (goal.includes("downside risks")) return { text: "", toolCalls: [call("get_claims", { subject_refs: [subject_ref], predicates: ["risk.factor"] })] };
      return { text: "", toolCalls: [call("get_company_profile", { subject_ref })] };
    }
    calls.push("answer");
    const answer = request.messages.find((message) => message.role === "user" && message.content.startsWith("{"))!.content;
    const { evidence_packet: packet } = JSON.parse(answer) as { evidence_packet: { figures: Array<{ id: string; gap?: string }>; claims: Array<{ id: string }> } };
    const figures = packet.figures.filter((figure) => figure.gap === undefined).map((figure) => figure.id);
    const assertions = [
      ...(figures.length > 0 ? [{ kind: "observation", text: "Revenue was reported.", evidence: figures }] : []),
      ...packet.claims.map((claim) => ({ kind: "management_attribution", text: "The 10-K says so.", evidence: [claim.id] })),
    ];
    return { text: `\`\`\`assertions\n${JSON.stringify(assertions)}\n\`\`\`` };
  };
}

test("the agent's models for a memo meter every attempt where the client is built, one attempt each", async () => {
  let attempts = 0;
  const models = meteredModels(LLM_ENV, () => async () => {
    attempts += 1;
    return { text: "```assertions\n[]\n```" };
  });
  const id = randomUUID();
  const made: Array<[string, () => Promise<unknown>]> = [
    ["router", async () => (await models.router(meter))!.complete({ messages: [] })],
    ["planner", async () => models.planner!(meter)({ messages: [{ role: "user", content: "AAA revenue" }] })],
    ["answer", async () => models.compose({
      context: { userIntent: "AAA revenue", bundleId: "analyst_agent" },
      blocks: [{ id, kind: "rich_text", snapshot_id: randomUUID(), data_ref: { kind: "rich_text", id }, source_refs: [], as_of: "2026-11-01T00:00:00.000Z", analyst_commentary: true, segments: [] }],
      toolCalls: [],
      packet: {
        route: "financial_engine", cutoff: "2026-11-01T00:00:00.000Z", companies: ["AAA"], coverage: [{ company: "AAA", status: "shown" }],
        figures: [{ id: "F1", metric: "Revenue", period: "FY2025", value: "$1.0B", result_id: randomUUID(), source_ids: [] }],
        gaps: [], query_bounds: {}, claims: [], disagreements: [], claims_status: "none", claims_truncated: false, periods_shown: true,
      },
    }, { thread_id: randomUUID(), run_id: randomUUID(), question: "AAA revenue" }, () => {}, meter)],
  ];
  let metered = 0;
  let refuse = false;
  function meter() {
    if (refuse) throw new LlmClientError("spent");
    metered += 1;
  }
  for (const [name, attempt] of made) {
    await attempt().catch(() => undefined);
    assert.deepEqual([metered, attempts], [1, 1], `${name}: one metered attempt`);
    refuse = true;
    await attempt().catch(() => undefined);
    assert.equal(attempts, 1, `${name}: a refused attempt reaches no model`);
    [metered, attempts, refuse] = [0, 0, false];
  }
});

test("a playbook with no agent section, or a memo about no company, gets one typed note and no model call", async () => {
  const workflow = analyzeAgentWorkflow({
    db: { query: async () => ({ rows: [] }), connect: async () => assert.fail("no transaction") },
    env: LLM_ENV,
    logToolCalls: async () => {},
    client: () => async () => assert.fail("no model call"),
  });
  const input = (playbookId: string) => ({
    userId: IDS.owner, template: { template_id: randomUUID(), version: 1 } as never, body: {}, runId: randomUUID(), snapshotId: randomUUID(), instructions: "",
    playbook: { playbook_id: playbookId, sections: playbookId === "investment_memo" ? [{ section_id: "investment_thesis", title: "Investment thesis", required: true, block_hint: "rich_text" }] : [] } as never,
    sourceCategories: [], bundleIds: [], subjectRefs: [{ kind: "theme" as const, id: randomUUID() }],
  });
  const text = (result: Awaited<ReturnType<typeof workflow>>) => result.blocks.map((block) => (block.segments as Array<{ text: string }>)[0]!.text);
  assert.deepEqual(text(await workflow(input("earnings_quality"))), ["The analyst agent writes no section of this playbook yet; it writes the Investment memo's narrative sections."]);
  assert.deepEqual(text(await workflow(input("investment_memo"))), ["The memo's subject names no company on file, so no section is written from stored sources."]);
});

test("the analyst agent writes an investment memo's sections from stored sources, sealed and shared like the memo", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker is not available");
    return;
  }
  const { db, pool, templateId } = await memoDatabase(t, "dev-api-analyze-agent");
  const previous = process.env.DEV_API_DATABASE_URL;
  process.env.DEV_API_DATABASE_URL = databaseUrl(db);
  registerLifoCleanup(t, async () => {
    await closeLocalRuntimePoolForTests();
    if (previous === undefined) delete process.env.DEV_API_DATABASE_URL;
    else process.env.DEV_API_DATABASE_URL = previous;
  });
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [IDS.issuerA]);
  await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', 'AAA', 'USD', 'America/New_York')`, [LISTING, IDS.issuerA]);
  await db.query(`insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at, content_hash) values ($1, 'sec_edgar', 'filing', 'https://www.sec.gov/aaa-10k', 'primary', 'public', '2026-02-25', 'sha256:${"7".repeat(64)}')`, [FILING_SOURCE]);
  await db.query(
    `insert into documents (document_id, source_id, kind, title, provider_doc_id, published_at, content_hash, raw_blob_id, parse_status, created_at, read_state)
     values ($1, $2, 'filing', '10-K', '0000000001-26-000001', '2026-02-25', 'h-aaa-10k', 'h-aaa-10k', 'parsed', '2026-02-25', '{"1":{"state":"read"},"1A":{"state":"read"}}')`,
    [FILING, FILING_SOURCE],
  );
  await db.query(`insert into mentions (document_id, subject_kind, subject_id, prominence, confidence) values ($1, 'issuer', $2, 'headline', 1)`, [FILING, IDS.issuerA]);
  const claimOf: Record<string, string> = {};
  for (const [predicate, item, text] of [
    ["business.products", "1", "We sell widgets to industrial customers."],
    ["business.competition", "1", "We compete with other widget makers on price and reliability."],
    ["risk.factor", "1A", "A downturn in industrial demand could reduce our sales."],
  ] as const) {
    const { rows: [claim] } = await db.query<{ claim_id: string }>(
      `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, attributed_to_type, attributed_to_id, confidence, status, created_at)
       values ($1, $2, $3, 'neutral', 'quoted', $4, 'issuer', $5, 0.9, 'extracted', '2026-02-26') returning claim_id::text`,
      [FILING, predicate, text, FILING_SOURCE, IDS.issuerA],
    );
    await db.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [claim!.claim_id, IDS.issuerA]);
    await db.query(`insert into claim_evidence (claim_id, document_id, locator, confidence) values ($1, $2, $3, 1)`, [claim!.claim_id, FILING, JSON.stringify({ item, start: 1, end: 5 })]);
    claimOf[predicate] = claim!.claim_id;
  }

  const calls: string[] = [];
  const adapters = createServiceDevApiAdapters({
    db: pool,
    runAnalyzeWorkflow: analyzeAgentWorkflow(analyzeAgentDeps(LLM_ENV, scriptedModel(calls))),
    sealAnalyzeSnapshot,
    buildAnalyzeRunSeals,
  });
  const sectionsOf = (blocks: ReadonlyArray<Record<string, unknown>>) => blocks.filter((block) => block.kind === "section") as unknown as Section[];

  await t.test("each section cites F or C ids, and the thesis's figure keeps its own certified snapshot", async () => {
    const run = await adapters.analyze.createRun({
      userId: IDS.owner,
      body: { template_id: templateId, playbook_id: "investment_memo", subject_ref: { kind: "listing", id: LISTING } },
    });
    const sections = sectionsOf(run.blocks);
    assert.deepEqual(sections.map((section) => section.data_ref.params?.playbook_section_id), AGENT_SECTIONS);
    assert.deepEqual(sections.map((section) => section.title), ["Investment thesis", "Growth drivers", "Competitive position", "Downside risks"]);
    assert.deepEqual(sections.map((section) => [...section.claim_refs].sort()), [
      [claimOf["business.products"]!, claimOf["business.competition"]!].sort(),
      [claimOf["business.products"]!, claimOf["business.competition"]!].sort(),
      [claimOf["business.competition"]],
      [claimOf["risk.factor"]],
    ], "the competition section quotes its competition claim, the risks section its risk factor");

    const certified = run.blocks.filter((block) => block.kind === "financial_answer");
    assert.equal(certified.length, 1, "the thesis's one certified call");
    assert.equal(run.blocks[run.blocks.indexOf(certified[0]!) - 1], run.blocks.find((block) => block.kind === "section"), "the figure follows its section");
    assert.notEqual(certified[0]!.snapshot_id, run.snapshot_id, "the figure keeps its engine snapshot");
    const results = (certified[0] as { financial: { results: Array<{ result_id: string }> } }).financial.results.map((result) => result.result_id);
    const cited = sections[0]!.children.flatMap((child) => child.segments as Array<{ ref_kind?: string; ref_id?: string }>).filter((segment) => segment.ref_kind === "result");
    assert.ok(cited.length > 0 && cited.every((segment) => results.includes(segment.ref_id!)), "the thesis cites the figure's results, and only them");

    const keys = (await db.query(`select request_key, parent_kind, parent_id::text from financial_runs where parent_id = $1`, [run.run_id])).rows;
    assert.deepEqual(keys.map((row) => [row.parent_kind, row.request_key.split(":").slice(0, 2).join(":")]), [["analyze_memo_run", "agent:investment_thesis"]]);
    const sealed = (await db.query(`select claim_refs from snapshots where snapshot_id = $1`, [run.snapshot_id])).rows[0];
    assert.deepEqual([...sealed.claim_refs].sort(), Object.values(claimOf).sort(), "the memo's seal binds every quoted claim");
    assert.ok(calls.filter((entry) => entry === "answer").length === 4 && calls.length <= 28, `four answers within the memo's calls: ${calls.join(", ")}`);

    const shared = await adapters.analyze.shareRunToChat({ userId: IDS.owner, runId: run.run_id, body: { title: "AAA memo" } });
    assert.deepEqual(shared.origin_snapshot_ids, [run.snapshot_id, certified[0]!.snapshot_id], "the figure is shared under its own snapshot");
  });

  const workflowInput = (subjectRefs: ReadonlyArray<{ kind: "issuer" | "listing"; id: string }>, knowledgeCutoff?: string) => ({
    userId: IDS.owner, template: { template_id: templateId, version: 1 } as never, body: {}, runId: randomUUID(), snapshotId: randomUUID(), instructions: "",
    playbook: playbook("investment_memo"), sourceCategories: [], bundleIds: [], subjectRefs, ...(knowledgeCutoff ? { knowledgeCutoff } : {}),
  });

  await t.test("the memo's sections read at its frozen cutoff, about the issuer its financial sections compute for", async () => {
    const cutoff = "2026-11-01T00:00:00.000Z";
    const workflow = analyzeAgentWorkflow(analyzeAgentDeps(LLM_ENV, scriptedModel([])));
    const input = workflowInput([{ kind: "listing", id: LISTING }, { kind: "issuer", id: IDS.issuerB }], cutoff);
    const { blocks } = await workflow(input);
    const sections = sectionsOf(blocks);
    assert.deepEqual(sections.map((section) => (section as unknown as { as_of: string }).as_of), AGENT_SECTIONS.map(() => cutoff));
    const runs = (await db.query(`select knowledge_cutoff from financial_runs where parent_id = $1`, [input.runId])).rows;
    assert.ok(runs.length > 0 && runs.every((row) => new Date(row.knowledge_cutoff).toISOString() === cutoff), "the agent's figures are planned at the memo's cutoff");
    assert.ok(sections.every((section) => JSON.stringify(section.children).includes("Beta Holdings Corp.")), "issuer B, as the engine's sections, not listing A");
  });

  await t.test("a section that fails fails the memo only once every other section has settled", async () => {
    let settledSections = 0;
    const workflow = analyzeAgentWorkflow({
      ...analyzeAgentDeps(LLM_ENV, scriptedModel([])),
      logToolCalls: async (logged) => {
        if (logged.some((call) => JSON.stringify(call.arguments).includes("risk.factor"))) throw new TypeError("the tool call log is broken");
        await new Promise((resolve) => setTimeout(resolve, 300));
        settledSections += 1;
      },
    });
    await assert.rejects(workflow(workflowInput([{ kind: "listing", id: LISTING }])), TypeError);
    assert.equal(settledSections, 3, "no section runs on after the memo fails");
  });

  await t.test("a company with no stored sources gets a typed empty section for each", async () => {
    calls.length = 0;
    const run = await adapters.analyze.createRun({
      userId: IDS.owner,
      body: { template_id: templateId, playbook_id: "investment_memo", subject_ref: { kind: "issuer", id: IDS.issuerB } },
    });
    const sections = sectionsOf(run.blocks);
    assert.deepEqual(sections.map((section) => section.data_ref.params?.playbook_section_id), AGENT_SECTIONS);
    for (const section of sections) {
      const [note] = section.children as Array<{ segments: Array<{ text: string }> }>;
      assert.match(note!.segments[0]!.text, /^No stored source covers this section\. Beta Holdings Corp\. has no 10-K on file/, JSON.stringify(section.children));
    }
    assert.equal(calls.includes("answer"), false, "no answer is written from nothing");
    assert.equal(run.blocks.some((block) => block.kind === "financial_answer"), false);
  });
});
