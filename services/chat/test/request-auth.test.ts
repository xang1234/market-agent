import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuthMode } from "../../shared/src/request-auth.ts";

test("resolveAuthMode rejects unrecognized explicit MA_AUTH_MODE values", () => {
  assert.throws(
    () => resolveAuthMode({ env: { MA_AUTH_MODE: "trusted-proxy", NODE_ENV: "development" } }),
    /unrecognized MA_AUTH_MODE 'trusted-proxy'/,
  );
});

test("resolveAuthMode falls back to NODE_ENV only when MA_AUTH_MODE is unset or empty", () => {
  assert.equal(resolveAuthMode({ env: { NODE_ENV: "production" } }), "trusted_proxy");
  assert.equal(resolveAuthMode({ env: { MA_AUTH_MODE: "   ", NODE_ENV: "production" } }), "trusted_proxy");
  assert.equal(resolveAuthMode({ env: { NODE_ENV: "development" } }), "dev_user_header");
});
