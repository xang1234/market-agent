import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import * as localRuntime from "../src/local-runtime.ts";
import { loadChatServerOptionsFromEnv } from "../src/runtime.ts";

test("runtime config returns empty chat options when no database is configured", async () => {
  assert.deepEqual(await loadChatServerOptionsFromEnv({}), {});
});

test("runtime config without a database never loads the local runtime", async () => {
  // local-runtime throws on an unknown CHAT_FINANCIAL_MODE as it loads.
  const script = `const { loadChatServerOptionsFromEnv } = await import(${JSON.stringify(import.meta.resolve("../src/runtime.ts"))});
    process.stdout.write(JSON.stringify(await loadChatServerOptionsFromEnv({})));`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", script],
    { env: { ...process.env, CHAT_FINANCIAL_MODE: "unknown" } },
  );
  assert.equal(stdout, "{}");
});

for (const variable of ["CHAT_DATABASE_URL", "DATABASE_URL"]) {
  test(`runtime config wires the in-repo local runtime when ${variable} is configured`, async () => {
    const options = await loadChatServerOptionsFromEnv({
      [variable]: "postgres://example.invalid/market_agent",
    });

    assert.deepEqual(options, {
      persistAssistantMessage: localRuntime.persistAssistantMessage,
      preResolveSubject: localRuntime.preResolveSubject,
      loadPriorSubjects: localRuntime.loadPriorSubjects,
      generateThreadTitle: localRuntime.generateThreadTitle,
      analystToolRuntime: localRuntime.analystToolRuntime,
      financialRuntime: localRuntime.financialRuntime,
    });
  });
}

test("in-repo chat runtime runs without the local stub tool executor mode", async () => {
  const previous = process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  delete process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  try {
    const options = await loadChatServerOptionsFromEnv({
      DATABASE_URL: "postgres://example.invalid/market_agent",
    });

    await assert.rejects(
      async () =>
        options.analystToolRuntime!({
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
