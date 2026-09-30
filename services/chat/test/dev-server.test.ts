import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import { buildChatDevServer } from "../src/dev-server.ts";

test("buildChatDevServer resolves relative module settings from services/chat, whatever the process cwd", async () => {
  // Under DEV_PROFILE=chat the one-process app (services/app) builds chat, so cwd is not
  // services/chat; relative settings must still resolve as they do standalone.
  const originalCwd = process.cwd();
  process.chdir(tmpdir());
  try {
    const { close } = await buildChatDevServer({
      CHAT_PERSISTENCE_MODULE: "./test/fixtures/relative-persistence.mjs",
    });
    await close();
  } finally {
    process.chdir(originalCwd);
  }
});

test("buildChatDevServer still honours an explicit absolute module setting", async () => {
  const modulePath = new URL("./fixtures/relative-persistence.mjs", import.meta.url).href;
  const { close } = await buildChatDevServer({ CHAT_PERSISTENCE_MODULE: modulePath });
  await close();
  assert.ok(true);
});
