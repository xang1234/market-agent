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
    preResolveSubject: piece("preResolveSubject"),
    loadPriorSubjects: piece("loadPriorSubjects"),
    generateThreadTitle: piece("generateThreadTitle"),
    analystToolRuntime: piece("analystToolRuntime"),
    financialRuntime: { assertReady: () => ready() },
    financialResearchScope: piece("financialResearchScope"),
  };
  const load = async () => runtime as never;
  assert.deepEqual(await loadChatServerOptionsFromEnv({ DATABASE_URL: "postgres://golden.invalid/market_agent" }, load), {
    persistAssistantMessage: runtime.persistAssistantMessage,
    preResolveSubject: runtime.preResolveSubject,
    loadPriorSubjects: runtime.loadPriorSubjects,
    generateThreadTitle: runtime.generateThreadTitle,
    analystToolRuntime: runtime.analystToolRuntime,
    financialRuntime: runtime.financialRuntime,
  });
  ready = async () => { throw new Error("verified finance is not ready for chat"); };
  await assert.rejects(() => loadChatServerOptionsFromEnv({ CHAT_DATABASE_URL: "postgres://golden.invalid/market_agent" }, load), /not ready/u);
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
