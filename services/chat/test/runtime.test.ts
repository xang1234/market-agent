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
    process.env[variable] = "postgres://example.invalid/market_agent";
    try {
      await assert.rejects(() => loadChatServerOptionsFromEnv(), /getaddrinfo ENOTFOUND example\.invalid/u);
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await localRuntime.closeLocalRuntimePoolForTests();
    }
  });
}

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
