import assert from "node:assert/strict";
import test from "node:test";
import { readWebDevFlags } from "./devFlags.ts";

test("readWebDevFlags uses safe defaults when Vite env is unset", () => {
  const flags = readWebDevFlags({});

  assert.deepEqual(flags, {
    llmSettingsEnabled: false,
    placeholderApiEnabled: true,
    showDevBanner: false,
    demo: false,
    devAutoLogin: false,
  });
});

test("readWebDevFlags parses Vite-prefixed boolean-like env values", () => {
  const flags = readWebDevFlags({
    VITE_MA_FLAG_LLM_SETTINGS: "yes",
    VITE_MA_FLAG_PLACEHOLDER_API: "0",
    VITE_MA_FLAG_SHOW_DEV_BANNER: "true",
    VITE_MA_FLAG_DEV_AUTO_LOGIN: "on",
    DEV: true,
  });

  assert.deepEqual(flags, {
    llmSettingsEnabled: true,
    placeholderApiEnabled: false,
    showDevBanner: true,
    demo: false,
    devAutoLogin: true,
  });
});

test("readWebDevFlags auto-logs-in only under the Vite dev server, whatever the build mode", () => {
  const on = { VITE_MA_FLAG_DEV_AUTO_LOGIN: "true" };
  // `vite build --mode staging` is a production build with a custom MODE name.
  assert.equal(readWebDevFlags({ ...on, MODE: "staging", DEV: false, PROD: true }).devAutoLogin, false);
  assert.equal(readWebDevFlags({ ...on, MODE: "production", DEV: false, PROD: true }).devAutoLogin, false);
  assert.equal(readWebDevFlags(on).devAutoLogin, false, "no DEV signal at all means off");
  assert.equal(readWebDevFlags({ ...on, MODE: "development", DEV: true }).devAutoLogin, true);
});

test("readWebDevFlags starts the demo build signed in, since it has no backend to sign in to", () => {
  const demo = readWebDevFlags({ MODE: "demo", DEV: false, PROD: true });
  assert.equal(demo.demo, true);
  assert.equal(demo.devAutoLogin, true);
  // A plain `vite build`, even with the dev flag set, still never skips sign-in.
  const production = readWebDevFlags({ VITE_MA_FLAG_DEV_AUTO_LOGIN: "true", MODE: "production", DEV: false, PROD: true });
  assert.equal(production.demo, false);
  assert.equal(production.devAutoLogin, false);
});
