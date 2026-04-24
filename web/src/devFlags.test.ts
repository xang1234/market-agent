import assert from "node:assert/strict";
import test from "node:test";
import { readWebDevFlags } from "./devFlags.ts";

test("readWebDevFlags uses safe defaults when Vite env is unset", () => {
  const flags = readWebDevFlags({});

  assert.deepEqual(flags, {
    placeholderApiEnabled: true,
    showDevBanner: false,
  });
});

test("readWebDevFlags parses Vite-prefixed boolean-like env values", () => {
  const flags = readWebDevFlags({
    VITE_MA_FLAG_PLACEHOLDER_API: "0",
    VITE_MA_FLAG_SHOW_DEV_BANNER: "true",
  });

  assert.deepEqual(flags, {
    placeholderApiEnabled: false,
    showDevBanner: true,
  });
});
