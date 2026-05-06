import test from "node:test";
import assert from "node:assert/strict";

import {
  readAuthenticatedUserId,
  resolveAuthMode,
  signTrustedUserId,
} from "../../shared/src/request-auth.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const SECRET = "trusted-proxy-secret";
const NOW = new Date("2026-05-06T00:00:00.000Z");

function request(headers: Record<string, string>) {
  return { headers } as never;
}

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

test("trusted-proxy auth accepts a fresh timestamp-bound signature", () => {
  const signature = signTrustedUserId(USER_ID, SECRET, { issuedAt: NOW });

  const userId = readAuthenticatedUserId(
    request({
      "x-authenticated-user-id": USER_ID,
      "x-authenticated-user-signature": signature,
    }),
    {
      mode: "trusted_proxy",
      trustedProxySecret: SECRET,
      trustedProxyClock: () => new Date("2026-05-06T00:04:59.000Z"),
    },
  );

  assert.equal(userId, USER_ID);
});

test("trusted-proxy auth rejects missing, tampered, and expired freshness data", () => {
  const fresh = signTrustedUserId(USER_ID, SECRET, { issuedAt: NOW });
  const expired = signTrustedUserId(USER_ID, SECRET, {
    issuedAt: new Date("2026-05-05T23:54:59.000Z"),
  });
  const tamperedTimestamp = fresh.replace(":1778025600000:", ":1778022000000:");

  const config = {
    mode: "trusted_proxy" as const,
    trustedProxySecret: SECRET,
    trustedProxyClock: () => NOW,
  };

  assert.equal(
    readAuthenticatedUserId(request({ "x-authenticated-user-id": USER_ID }), config),
    null,
  );
  assert.equal(
    readAuthenticatedUserId(
      request({
        "x-authenticated-user-id": USER_ID,
        "x-authenticated-user-signature": tamperedTimestamp,
      }),
      config,
    ),
    null,
  );
  assert.equal(
    readAuthenticatedUserId(
      request({
        "x-authenticated-user-id": USER_ID,
        "x-authenticated-user-signature": expired,
      }),
      config,
    ),
    null,
  );
});

test("trusted-proxy auth only accepts legacy user-id-only HMACs when rollout compatibility is explicit", () => {
  const legacy = signTrustedUserId(USER_ID, SECRET, { legacy: true });
  const headers = {
    "x-authenticated-user-id": USER_ID,
    "x-authenticated-user-signature": legacy,
  };

  assert.equal(
    readAuthenticatedUserId(request(headers), {
      mode: "trusted_proxy",
      trustedProxySecret: SECRET,
      trustedProxyClock: () => NOW,
    }),
    null,
  );
  assert.equal(
    readAuthenticatedUserId(request(headers), {
      mode: "trusted_proxy",
      trustedProxySecret: SECRET,
      trustedProxyClock: () => NOW,
      trustedProxyAllowLegacySignatures: true,
    }),
    USER_ID,
  );
});
