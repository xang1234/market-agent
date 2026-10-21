import assert from "node:assert/strict";
import test from "node:test";
import { buildChatDevServer } from "../src/dev-server.ts";

test("the chat server warns at build time when the removed CHAT_FINANCIAL_MODE is still set", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const built = await buildChatDevServer({ CHAT_FINANCIAL_MODE: "off" });
  await built.close();
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ["chat: CHAT_FINANCIAL_MODE is set but no longer read: the financial engine is always on"],
  ]);
});
