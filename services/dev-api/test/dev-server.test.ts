import assert from "node:assert/strict";
import test from "node:test";
import { buildDevApiDevServer } from "../src/dev-server.ts";

test("the dev-api server warns at build time for each removed mode flag it used to read", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const built = await buildDevApiDevServer({
    MA_DEV_API_FIXTURE_ADAPTER: "true",
    ANALYZE_FINANCIAL_MODE: "off",
    THESIS_FINANCIAL_MODE: "off",
    CHAT_FINANCIAL_MODE: "off",
  });
  await built.close();
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ["dev-api: ANALYZE_FINANCIAL_MODE is set but no longer read: the financial engine is always on"],
    ["dev-api: THESIS_FINANCIAL_MODE is set but no longer read: the financial engine is always on"],
  ]);
});
