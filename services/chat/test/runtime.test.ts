import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { loadChatServerOptionsFromEnv } from "../src/runtime.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("runtime config returns empty chat options when no database or modules are configured", async () => {
  assert.deepEqual(await loadChatServerOptionsFromEnv({}), {});
});

test("runtime config wires in-repo analyst runtime and persistence when DATABASE_URL is configured", async () => {
  const options = await loadChatServerOptionsFromEnv({
    DATABASE_URL: "postgres://example.invalid/market_agent",
  });

  assert.equal(typeof options.analystToolRuntime, "function");
  assert.equal(typeof options.persistAssistantMessage, "function");
  assert.equal(typeof options.generateThreadTitle, "function");
});

test("runtime config resolves in-repo default runtime when loader cwd is the repo root", async () => {
  const options = await loadChatServerOptionsFromEnv({
    DATABASE_URL: "postgres://example.invalid/market_agent",
  }, repoRoot);

  assert.equal(typeof options.analystToolRuntime, "function");
  assert.equal(typeof options.persistAssistantMessage, "function");
});

test("in-repo chat runtime runs without the local stub tool executor mode", async () => {
  const previous = process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  delete process.env.CHAT_LOCAL_TOOL_EXECUTOR;
  try {
    const options = await loadChatServerOptionsFromEnv({
      DATABASE_URL: "postgres://example.invalid/market_agent",
    }, repoRoot);

    await assert.rejects(
      () =>
        options.analystToolRuntime!({
          threadId: "11111111-1111-4111-a111-111111111111",
          runId: "22222222-2222-4222-a222-222222222222",
          turnId: "33333333-3333-4333-a333-333333333333",
          bundleId: "single_subject_analysis",
          userIntent: "Summarize the latest filing",
          emit() {},
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

test("runtime config loads assistant persistence from configured module", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-runtime-"));
  const modulePath = join(dir, "persistence.mjs");
  await writeFile(
    modulePath,
    "export async function persistAssistantMessage() { return { snapshot_id: 'snapshot-1', message_id: 'message-1' }; }",
  );

  const options = await loadChatServerOptionsFromEnv({
    CHAT_PERSISTENCE_MODULE: pathToFileURL(modulePath).href,
  });

  assert.equal(typeof options.persistAssistantMessage, "function");
  assert.deepEqual(await options.persistAssistantMessage!({
    threadId: "thread-1",
    runId: "run-1",
    turnId: "turn-1",
    role: "assistant",
    blocks: [],
    content_hash: "sha256:test",
  }), {
    snapshot_id: "snapshot-1",
    message_id: "message-1",
  });
});

test("runtime config resolves relative persistence modules from the process cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-runtime-relative-"));
  await writeFile(
    join(dir, "persistence.mjs"),
    "export async function persistAssistantMessage() { return { snapshot_id: 'relative-snapshot', message_id: 'relative-message' }; }",
  );

  const options = await loadChatServerOptionsFromEnv({
    CHAT_PERSISTENCE_MODULE: "./persistence.mjs",
  }, dir);

  assert.equal(typeof options.persistAssistantMessage, "function");
  assert.deepEqual(await options.persistAssistantMessage!({
    threadId: "thread-1",
    runId: "run-1",
    turnId: "turn-1",
    role: "assistant",
    blocks: [],
    content_hash: "sha256:test",
  }), {
    snapshot_id: "relative-snapshot",
    message_id: "relative-message",
  });
});

test("runtime config loads subject pre-resolver from configured module", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-runtime-subject-"));
  const modulePath = join(dir, "subjects.mjs");
  await writeFile(
    modulePath,
    `export async function preResolveSubject({ text }) {
      return {
        status: 'needs_clarification',
        input_text: text,
        normalized_input: text,
        candidates: [],
        message: 'Which subject did you mean?'
      };
    }
    export function renderSubjectClarification({ preResolution }) {
      return {
        blocks: [{ type: 'text', text: preResolution.message }],
        content_hash: 'sha256:clarification',
        text: preResolution.message
      };
    }`,
  );

  const options = await loadChatServerOptionsFromEnv({
    CHAT_SUBJECT_RESOLVER_MODULE: pathToFileURL(modulePath).href,
  });

  assert.equal(typeof options.preResolveSubject, "function");
  assert.deepEqual(await options.preResolveSubject!({ text: "GOOG" }), {
    status: "needs_clarification",
    input_text: "GOOG",
    normalized_input: "GOOG",
    candidates: [],
    message: "Which subject did you mean?",
  });
  assert.equal(typeof options.renderSubjectClarification, "function");
  assert.deepEqual(await options.renderSubjectClarification!({
    threadId: "thread-1",
    runId: "run-1",
    turnId: "turn-1",
    preResolution: {
      status: "needs_clarification",
      input_text: "GOOG",
      normalized_input: "GOOG",
      candidates: [],
      message: "Which subject did you mean?",
    },
  }), {
    blocks: [{ type: "text", text: "Which subject did you mean?" }],
    content_hash: "sha256:clarification",
    text: "Which subject did you mean?",
  });
});

test("runtime config loads thread title generator from configured module", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-runtime-title-"));
  const modulePath = join(dir, "title.mjs");
  await writeFile(
    modulePath,
    "export async function generateThreadTitle(input) { globalThis.__titleInput = input; }",
  );

  const options = await loadChatServerOptionsFromEnv({
    CHAT_THREAD_TITLE_MODULE: pathToFileURL(modulePath).href,
  });

  assert.equal(typeof options.generateThreadTitle, "function");
  await options.generateThreadTitle!({
    threadId: "thread-1",
    runId: "run-1",
    turnId: "turn-1",
    assistantText: "Assistant text",
  });
  assert.deepEqual((globalThis as { __titleInput?: unknown }).__titleInput, {
    threadId: "thread-1",
    runId: "run-1",
    turnId: "turn-1",
    assistantText: "Assistant text",
  });
  delete (globalThis as { __titleInput?: unknown }).__titleInput;
});
