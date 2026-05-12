import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  hasMasterKey,
  loadMasterKey,
} from "../src/credentials/crypto.ts";
import { LlmMasterKeyMissingError } from "../src/errors.ts";

const MASTER_KEY = randomBytes(32);
const MASTER_KEY_B64 = MASTER_KEY.toString("base64");

test("encrypt/decrypt round-trip recovers plaintext", () => {
  const encrypted = encryptSecret("sk-test-12345", MASTER_KEY);
  assert.equal(encrypted.iv.length, 12);
  assert.equal(encrypted.authTag.length, 16);
  assert.ok(encrypted.ciphertext.length > 0);
  assert.equal(decryptSecret(encrypted, MASTER_KEY), "sk-test-12345");
});

test("two encryptions of the same plaintext produce distinct ivs and ciphertexts", () => {
  const a = encryptSecret("sk-test", MASTER_KEY);
  const b = encryptSecret("sk-test", MASTER_KEY);
  assert.notDeepEqual(a.iv, b.iv);
  assert.notDeepEqual(a.ciphertext, b.ciphertext);
});

test("decrypt rejects tampered ciphertext", () => {
  const encrypted = encryptSecret("sk-test", MASTER_KEY);
  const tampered = {
    ...encrypted,
    ciphertext: Buffer.concat([encrypted.ciphertext.subarray(0, encrypted.ciphertext.length - 1), Buffer.from([0])]),
  };
  assert.throws(() => decryptSecret(tampered, MASTER_KEY));
});

test("decrypt rejects tampered auth tag", () => {
  const encrypted = encryptSecret("sk-test", MASTER_KEY);
  const flipped = Buffer.from(encrypted.authTag);
  flipped[0] = flipped[0] ^ 0xff;
  assert.throws(() => decryptSecret({ ...encrypted, authTag: flipped }, MASTER_KEY));
});

test("decrypt with wrong master key throws", () => {
  const encrypted = encryptSecret("sk-test", MASTER_KEY);
  const wrong = randomBytes(32);
  assert.throws(() => decryptSecret(encrypted, wrong));
});

test("encryptSecret rejects empty plaintext", () => {
  assert.throws(() => encryptSecret("", MASTER_KEY));
});

test("loadMasterKey reads from env and validates length", () => {
  assert.deepEqual(loadMasterKey({ LLM_MASTER_ENCRYPTION_KEY: MASTER_KEY_B64 }), MASTER_KEY);
});

test("loadMasterKey throws LlmMasterKeyMissingError when env var is absent", () => {
  assert.throws(
    () => loadMasterKey({}),
    (error: unknown) => error instanceof LlmMasterKeyMissingError,
  );
});

test("loadMasterKey throws when env var is empty", () => {
  assert.throws(
    () => loadMasterKey({ LLM_MASTER_ENCRYPTION_KEY: "  " }),
    (error: unknown) => error instanceof LlmMasterKeyMissingError,
  );
});

test("loadMasterKey throws on wrong key length", () => {
  const tooShort = randomBytes(16).toString("base64");
  assert.throws(() => loadMasterKey({ LLM_MASTER_ENCRYPTION_KEY: tooShort }));
});

test("loadMasterKey throws on non-base64 input", () => {
  assert.throws(() => loadMasterKey({ LLM_MASTER_ENCRYPTION_KEY: "not_base64_!!!" }));
});

test("hasMasterKey is true only for valid 32-byte base64", () => {
  assert.equal(hasMasterKey({}), false);
  assert.equal(hasMasterKey({ LLM_MASTER_ENCRYPTION_KEY: "" }), false);
  assert.equal(hasMasterKey({ LLM_MASTER_ENCRYPTION_KEY: randomBytes(16).toString("base64") }), false);
  assert.equal(hasMasterKey({ LLM_MASTER_ENCRYPTION_KEY: MASTER_KEY_B64 }), true);
});

test("fingerprintSecret returns the last 4 chars", () => {
  assert.equal(fingerprintSecret("sk-prod-XYZ1234"), "1234");
});

test("fingerprintSecret pads short secrets", () => {
  assert.equal(fingerprintSecret("ab"), "••ab");
});
