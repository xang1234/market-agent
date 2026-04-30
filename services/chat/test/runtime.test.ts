import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { loadChatServerOptionsFromEnv } from "../src/runtime.ts";

test("runtime config returns stub chat options when persistence module is not configured", async () => {
  assert.deepEqual(await loadChatServerOptionsFromEnv({}), {});
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
