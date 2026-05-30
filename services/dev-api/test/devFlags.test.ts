import assert from "node:assert/strict";
import test from "node:test";
import { readDevFlags } from "../../shared/src/devFlags.ts";

test("readDevFlags uses safe defaults when env is unset", () => {
  const flags = readDevFlags({});

  assert.deepEqual(flags, {
    llmSettingsEnabled: false,
    placeholderApiEnabled: true,
    showDevBanner: false,
  });
});

test("readDevFlags parses boolean-like env values", () => {
  const flags = readDevFlags({
    MA_FLAG_LLM_SETTINGS: "true",
    MA_FLAG_PLACEHOLDER_API: "off",
    MA_FLAG_SHOW_DEV_BANNER: "1",
  });

  assert.deepEqual(flags, {
    llmSettingsEnabled: true,
    placeholderApiEnabled: false,
    showDevBanner: true,
  });
});
