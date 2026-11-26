import assert from "node:assert/strict";
import test from "node:test";
import * as localRuntime from "../src/local-runtime.ts";
import { loadChatServerOptionsFromEnv } from "../src/runtime.ts";

test("runtime config returns empty chat options when no database is configured", async () => {
  assert.deepEqual(await loadChatServerOptionsFromEnv({}), {});
});

for (const variable of ["CHAT_DATABASE_URL", "DATABASE_URL"]) {
  test(`with ${variable} set, the server does not start until it has checked verified finance on that database`, async () => {
    const previous = { CHAT_DATABASE_URL: process.env.CHAT_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL };
    delete process.env.CHAT_DATABASE_URL;
    delete process.env.DATABASE_URL;
    // Nothing listens on port 1, so the readiness check is refused at once.
    process.env[variable] = "postgres://127.0.0.1:1/market_agent";
    try {
      await assert.rejects(() => loadChatServerOptionsFromEnv(), /ECONNREFUSED/u);
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await localRuntime.closeLocalRuntimePoolForTests();
    }
  });
}

test("with a database set, the server takes each piece of the in-repo runtime once verified finance is ready (#425)", async () => {
  const piece = (name: string) => Object.assign(() => assert.fail(`${name} is not called while the options load`), { piece: name });
  let ready: () => Promise<void> = async () => {};
  const runtime = {
    persistAssistantMessage: piece("persistAssistantMessage"),
    saveWorkSummary: piece("saveWorkSummary"),
    preResolveSubject: piece("preResolveSubject"),
    loadPriorSubjects: piece("loadPriorSubjects"),
    readQuestion: piece("readQuestion"),
    generateThreadTitle: piece("generateThreadTitle"),
    analystToolRuntime: piece("analystToolRuntime"),
    financialRuntime: { assertReady: () => ready() },
    financialResearchScope: piece("financialResearchScope"),
  };
  const load = async () => runtime as never;
  assert.deepEqual(await loadChatServerOptionsFromEnv({ DATABASE_URL: "postgres://golden.invalid/market_agent" }, load), {
    persistAssistantMessage: runtime.persistAssistantMessage,
    saveWorkSummary: runtime.saveWorkSummary,
    preResolveSubject: runtime.preResolveSubject,
    loadPriorSubjects: runtime.loadPriorSubjects,
    readQuestion: runtime.readQuestion,
    generateThreadTitle: runtime.generateThreadTitle,
    analystToolRuntime: runtime.analystToolRuntime,
    financialRuntime: runtime.financialRuntime,
  });
  ready = async () => { throw new Error("verified finance is not ready for chat"); };
  await assert.rejects(() => loadChatServerOptionsFromEnv({ CHAT_DATABASE_URL: "postgres://golden.invalid/market_agent" }, load), /not ready/u);
});

test("only CHAT_ANALYST_AGENT=1 hands the server the analyst agent", async () => {
  const runtime = { financialRuntime: { assertReady: async () => {} }, analystAgent: Object.assign(() => assert.fail("not called"), { piece: "analystAgent" }) };
  const load = async () => runtime as never;
  const agentOf = async (flag: string | undefined) => (await loadChatServerOptionsFromEnv({ DATABASE_URL: "postgres://golden.invalid/market_agent", ...(flag === undefined ? {} : { CHAT_ANALYST_AGENT: flag }) }, load)).analystAgent;
  assert.deepEqual(await Promise.all([undefined, "0", "true", "1"].map(agentOf)), [undefined, undefined, undefined, runtime.analystAgent]);
});

test("CHAT_CHECKED_PROSE=1 without CHAT_ANALYST_AGENT=1 refuses to start, since the lane writes from the agent's packet (#800)", async () => {
  let loaded = false;
  const load = async () => {
    loaded = true;
    return { financialRuntime: { assertReady: async () => {} } } as never;
  };
  await assert.rejects(() => loadChatServerOptionsFromEnv({ CHAT_CHECKED_PROSE: "1" }, load), /CHAT_CHECKED_PROSE=1 needs CHAT_ANALYST_AGENT=1/u);
  await assert.rejects(() => loadChatServerOptionsFromEnv({ DATABASE_URL: "postgres://golden.invalid/market_agent", CHAT_CHECKED_PROSE: "1", CHAT_ANALYST_AGENT: "0" }, load), /CHAT_CHECKED_PROSE=1 needs CHAT_ANALYST_AGENT=1/u);
  assert.equal(loaded, false, "refused before the runtime loads");
  await loadChatServerOptionsFromEnv({ DATABASE_URL: "postgres://golden.invalid/market_agent", CHAT_CHECKED_PROSE: "1", CHAT_ANALYST_AGENT: "1" }, load);
});

test("in-repo chat runtime runs without the local stub tool executor mode", async () => {
  const previous = process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  delete process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  try {
    await assert.rejects(
      async () =>
        localRuntime.analystToolRuntime({
          threadId: "11111111-1111-4111-a111-111111111111",
          runId: "22222222-2222-4222-a222-222222222222",
          turnId: "33333333-3333-4333-a333-333333333333",
          bundleId: "single_subject_analysis",
          userIntent: "Summarize the latest filing",
          emit: () => ({}) as never,
        }),
      /DATABASE_URL|ENOTFOUND|getaddrinfo|connect/i,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.CHAT_LOCAL_TOOL_EXECUTOR;
    } else {
      process.env.CHAT_LOCAL_TOOL_EXECUTOR = previous;
    }
  }
});
