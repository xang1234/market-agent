import assert from "node:assert/strict";
import test from "node:test";

import type { HydratedSubjectHandoff } from "../../resolver/src/flow.ts";
import { loadPriorScope, loadPriorSubjects, loadRecentConversation } from "../src/thread-context.ts";
import { fakeQuery } from "./fake-query.ts";

const THREAD_ID = "11111111-1111-4111-a111-111111111111";
const NVDA = { kind: "listing" as const, id: "62000000-0000-4000-8000-000000000001" };
const AMD = { kind: "listing" as const, id: "62000000-0000-4000-8000-000000000002" };

function handoffFor(ref: { kind: "listing"; id: string }, ticker: string): HydratedSubjectHandoff {
  return {
    subject_ref: ref,
    identity_level: "listing",
    display_label: `${ticker} · XNAS`,
    display_labels: { primary: `${ticker} · XNAS`, ticker },
    normalized_input: ticker,
    resolution_path: "direct_ref",
    confidence: 1,
    context: {},
  };
}

test("prior subjects are the previous answer's companies, re-hydrated, in order", async () => {
  const queries: string[] = [];
  const db = {
    query: fakeQuery((text) => {
      queries.push(text);
      return { rows: [{ subject_refs: [NVDA, { kind: "screen", id: THREAD_ID }, AMD] }] };
    }),
  };
  const hydrate = async (_db: unknown, ref: { kind: string; id: string }) =>
    handoffFor(ref as typeof NVDA, ref.id === NVDA.id ? "NVDA" : "AMD");

  const subjects = await loadPriorSubjects(db, { threadId: THREAD_ID }, hydrate);

  assert.deepEqual(subjects.map((subject) => subject.input_text), ["NVDA", "AMD"]);
  assert.equal(subjects[0].status, "resolved");
  assert.deepEqual(subjects[0].subject_ref, NVDA);
  assert.match(queries[0], /role = 'assistant'/);
});

test("a thread with no previous answer has no prior subjects", async () => {
  const db = { query: fakeQuery(() => ({ rows: [] })) };
  assert.deepEqual(await loadPriorSubjects(db, { threadId: THREAD_ID }, async () => { throw new Error("unused"); }), []);
});

test("a company that no longer hydrates is dropped rather than failing the turn", async () => {
  const db = { query: fakeQuery(() => ({ rows: [{ subject_refs: [NVDA, AMD] }] })) };
  const hydrate = async (_db: unknown, ref: { kind: string; id: string }) => {
    if (ref.id === AMD.id) throw new Error("subject not found");
    return handoffFor(NVDA, "NVDA");
  };
  const subjects = await loadPriorSubjects(db, { threadId: THREAD_ID }, hydrate);
  assert.deepEqual(subjects.map((subject) => subject.input_text), ["NVDA"]);
});

test("the prior scope is the previous answer's saved research scope; none when it saved none", async () => {
  const saved = {
    route: "comparison",
    companies: [{ issuer_id: NVDA.id, label: "NVDA" }],
    peers: false,
    segments: false,
    margin_trend: false,
    fiscal_year: null,
    price_window: { kind: "ytd", cutoff: "2026-09-01T00:00:00.000Z" },
    inherited: ["price_window"],
  };
  const queries: string[] = [];
  const db = (scope: unknown) => ({
    query: fakeQuery((text) => {
      queries.push(text);
      return { rows: scope === undefined ? [] : [{ research_scope: scope }] };
    }),
  });
  // What it inherited is that answer's business, not the next one's.
  assert.deepEqual(await loadPriorScope(db(saved), { threadId: THREAD_ID }), { ...saved, inherited: [] });
  assert.match(queries[0], /role = 'assistant'/);
  // An answer that saved no scope is skipped, not read as an empty one.
  assert.match(queries[0], /research_scope is not null/);
  assert.equal(await loadPriorScope(db(null), { threadId: THREAD_ID }), null);
  assert.equal(await loadPriorScope(db(undefined), { threadId: THREAD_ID }), null);
});

test("recent conversation is the last messages' text, oldest first", async () => {
  const text = (value: string) => [{ kind: "rich_text", segments: [{ type: "text", text: value }] }];
  const db = {
    query: fakeQuery(() => ({
      rows: [
        { role: "assistant", blocks: [...text("NVIDIA revenue rose."), { kind: "revenue_bars", bars: [] }] },
        { role: "user", blocks: text("Analyze NVDA") },
      ],
    })),
  };
  assert.deepEqual(await loadRecentConversation(db, { threadId: THREAD_ID, limit: 6 }), [
    { role: "user", text: "Analyze NVDA" },
    { role: "assistant", text: "NVIDIA revenue rose." },
  ]);
});
