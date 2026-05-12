import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  decryptSecret,
  deleteLlmCredential,
  getActiveLlmCredential,
  listLlmCredentials,
  loadLlmProviderCatalog,
  resetLlmProviderCatalogCacheForTests,
  upsertLlmCredential,
  type LlmCredentialsQueryExecutor,
} from "../src/index.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const MASTER_KEY = randomBytes(32);

type CredentialRow = {
  user_id: string;
  role: string;
  provider_id: string;
  model: string;
  base_url: string | null;
  reasoning_effort: string | null;
  key_ciphertext: Buffer | null;
  key_iv: Buffer | null;
  key_auth_tag: Buffer | null;
  key_fingerprint: string | null;
  created_at: string;
  updated_at: string;
};

function fakeDb(): {
  db: LlmCredentialsQueryExecutor;
  rows: Map<string, CredentialRow>;
  queries: string[];
} {
  const rows = new Map<string, CredentialRow>();
  const queries: string[] = [];
  const key = (userId: string, role: string) => `${userId}::${role}`;
  const db: LlmCredentialsQueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push(text);
      const sql = text.trim();
      if (sql.startsWith("select")) {
        if (sql.includes("order by role asc")) {
          const userId = String(values?.[0]);
          const matched = [...rows.values()]
            .filter((row) => row.user_id === userId)
            .sort((a, b) => a.role.localeCompare(b.role));
          return { rows: matched as unknown as R[], rowCount: matched.length };
        }
        const userId = String(values?.[0]);
        const role = String(values?.[1]);
        const row = rows.get(key(userId, role));
        return { rows: (row ? [row] : []) as unknown as R[], rowCount: row ? 1 : 0 };
      }
      if (sql.startsWith("insert")) {
        const [
          userId,
          role,
          providerId,
          model,
          baseUrl,
          reasoningEffort,
          ciphertext,
          iv,
          authTag,
          fingerprint,
          apiKeyProvided,
        ] = values as [
          string,
          string,
          string,
          string,
          string | null,
          string | null,
          Buffer | null,
          Buffer | null,
          Buffer | null,
          string | null,
          boolean,
        ];
        const existing = rows.get(key(userId, role));
        const next: CredentialRow = {
          user_id: userId,
          role,
          provider_id: providerId,
          model,
          base_url: baseUrl,
          reasoning_effort: reasoningEffort,
          key_ciphertext: apiKeyProvided ? ciphertext : existing?.key_ciphertext ?? null,
          key_iv: apiKeyProvided ? iv : existing?.key_iv ?? null,
          key_auth_tag: apiKeyProvided ? authTag : existing?.key_auth_tag ?? null,
          key_fingerprint: apiKeyProvided ? fingerprint : existing?.key_fingerprint ?? null,
          created_at: existing?.created_at ?? "2026-05-12T00:00:00.000Z",
          updated_at: "2026-05-12T00:00:01.000Z",
        };
        rows.set(key(userId, role), next);
        return { rows: [next] as unknown as R[], rowCount: 1 };
      }
      if (sql.startsWith("delete")) {
        const userId = String(values?.[0]);
        const role = String(values?.[1]);
        const existed = rows.delete(key(userId, role));
        return { rows: [] as R[], rowCount: existed ? 1 : 0 };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  return { db, rows, queries };
}

async function loadCatalog() {
  resetLlmProviderCatalogCacheForTests();
  return loadLlmProviderCatalog();
}

test("upsertLlmCredential persists, encrypts, and returns no plaintext", async () => {
  const catalog = await loadCatalog();
  const { db, rows } = fakeDb();

  const saved = await upsertLlmCredential(
    db,
    {
      user_id: USER_ID,
      role: "summary",
      provider_id: "openai",
      model: "gpt-4o-mini",
      reasoning_effort: "low",
      api_key: "sk-secret-1234",
    },
    { catalog, masterKey: MASTER_KEY },
  );

  assert.equal(saved.provider_id, "openai");
  assert.equal(saved.role, "summary");
  assert.equal(saved.model, "gpt-4o-mini");
  assert.equal(saved.base_url, "https://api.openai.com/v1");
  assert.equal(saved.reasoning_effort, "low");
  assert.equal(saved.key_fingerprint, "1234");
  assert.ok(!("api_key" in saved));

  const persisted = rows.get(`${USER_ID}::summary`)!;
  assert.ok(Buffer.isBuffer(persisted.key_ciphertext));
  const decrypted = decryptSecret(
    {
      ciphertext: persisted.key_ciphertext!,
      iv: persisted.key_iv!,
      authTag: persisted.key_auth_tag!,
    },
    MASTER_KEY,
  );
  assert.equal(decrypted, "sk-secret-1234");
});

test("upsertLlmCredential without api_key preserves the existing encrypted key", async () => {
  const catalog = await loadCatalog();
  const { db } = fakeDb();

  await upsertLlmCredential(
    db,
    { user_id: USER_ID, role: "summary", provider_id: "openai", model: "gpt-4o-mini", api_key: "sk-first" },
    { catalog, masterKey: MASTER_KEY },
  );

  const updated = await upsertLlmCredential(
    db,
    { user_id: USER_ID, role: "summary", provider_id: "openai", model: "gpt-4o" },
    { catalog, masterKey: MASTER_KEY },
  );
  assert.equal(updated.model, "gpt-4o");
  assert.equal(updated.key_fingerprint, "irst");

  const active = await getActiveLlmCredential(
    db,
    { user_id: USER_ID, role: "summary" },
    { masterKey: MASTER_KEY },
  );
  assert.equal(active?.api_key, "sk-first");
});

test("upsertLlmCredential with empty api_key wipes the key", async () => {
  const catalog = await loadCatalog();
  const { db } = fakeDb();

  await upsertLlmCredential(
    db,
    { user_id: USER_ID, role: "summary", provider_id: "openai", model: "gpt-4o-mini", api_key: "sk-first" },
    { catalog, masterKey: MASTER_KEY },
  );

  const cleared = await upsertLlmCredential(
    db,
    {
      user_id: USER_ID,
      role: "summary",
      provider_id: "openai",
      model: "gpt-4o-mini",
      api_key: "",
    },
    { catalog, masterKey: MASTER_KEY },
  );
  assert.equal(cleared.key_fingerprint, null);

  const active = await getActiveLlmCredential(
    db,
    { user_id: USER_ID, role: "summary" },
    { masterKey: MASTER_KEY },
  );
  assert.equal(active?.api_key, null);
});

test("upsertLlmCredential rejects reasoning_effort for providers that do not support it", async () => {
  const catalog = await loadCatalog();
  const { db } = fakeDb();
  await assert.rejects(
    () =>
      upsertLlmCredential(
        db,
        {
          user_id: USER_ID,
          role: "analyst",
          provider_id: "openai_compatible",
          model: "llama3",
          base_url: "http://localhost:11434/v1",
          reasoning_effort: "high",
        },
        { catalog, masterKey: MASTER_KEY },
      ),
    /does not support reasoning_effort/,
  );
});

test("upsertLlmCredential rejects base_url overrides on providers with fixed urls", async () => {
  const catalog = await loadCatalog();
  const { db } = fakeDb();
  await assert.rejects(
    () =>
      upsertLlmCredential(
        db,
        {
          user_id: USER_ID,
          role: "summary",
          provider_id: "openai",
          model: "gpt-4o-mini",
          base_url: "https://evil.example.com/v1",
        },
        { catalog, masterKey: MASTER_KEY },
      ),
    /does not allow overriding base_url/,
  );
});

test("upsertLlmCredential rejects unknown providers", async () => {
  const catalog = await loadCatalog();
  const { db } = fakeDb();
  await assert.rejects(() =>
    upsertLlmCredential(
      db,
      { user_id: USER_ID, role: "summary", provider_id: "anthropic", model: "claude" },
      { catalog, masterKey: MASTER_KEY },
    ),
  );
});

test("listLlmCredentials never returns plaintext key fields", async () => {
  const catalog = await loadCatalog();
  const { db } = fakeDb();
  await upsertLlmCredential(
    db,
    { user_id: USER_ID, role: "summary", provider_id: "openai", model: "gpt-4o-mini", api_key: "sk-secret" },
    { catalog, masterKey: MASTER_KEY },
  );
  const credentials = await listLlmCredentials(db, USER_ID);
  assert.equal(credentials.length, 1);
  const credential = credentials[0]!;
  assert.equal(credential.key_fingerprint, "cret");
  for (const value of Object.values(credential)) {
    if (typeof value !== "string") continue;
    assert.ok(!value.includes("sk-secret"), `value leaks plaintext: ${value}`);
  }
});

test("getActiveLlmCredential decrypts the stored key for the active role", async () => {
  const catalog = await loadCatalog();
  const { db } = fakeDb();
  await upsertLlmCredential(
    db,
    {
      user_id: USER_ID,
      role: "analyst",
      provider_id: "openai",
      model: "gpt-4o",
      reasoning_effort: "medium",
      api_key: "sk-analyst-9876",
    },
    { catalog, masterKey: MASTER_KEY },
  );

  const active = await getActiveLlmCredential(
    db,
    { user_id: USER_ID, role: "analyst" },
    { masterKey: MASTER_KEY },
  );

  assert.ok(active !== null);
  assert.equal(active.role, "analyst");
  assert.equal(active.provider_id, "openai");
  assert.equal(active.model, "gpt-4o");
  assert.equal(active.base_url, "https://api.openai.com/v1");
  assert.equal(active.reasoning_effort, "medium");
  assert.equal(active.key_fingerprint, "9876");
  assert.equal(active.api_key, "sk-analyst-9876");
});

test("getActiveLlmCredential returns null when missing", async () => {
  const { db } = fakeDb();
  const credential = await getActiveLlmCredential(
    db,
    { user_id: USER_ID, role: "summary" },
    { masterKey: MASTER_KEY },
  );
  assert.equal(credential, null);
});

test("deleteLlmCredential reports whether a row was removed", async () => {
  const catalog = await loadCatalog();
  const { db } = fakeDb();
  await upsertLlmCredential(
    db,
    { user_id: USER_ID, role: "summary", provider_id: "openai", model: "gpt-4o-mini", api_key: "sk-x" },
    { catalog, masterKey: MASTER_KEY },
  );
  assert.equal(await deleteLlmCredential(db, { user_id: USER_ID, role: "summary" }), true);
  assert.equal(await deleteLlmCredential(db, { user_id: USER_ID, role: "summary" }), false);
});

test("upsertLlmCredential rejects malformed user ids", async () => {
  const catalog = await loadCatalog();
  const { db } = fakeDb();
  await assert.rejects(() =>
    upsertLlmCredential(
      db,
      { user_id: "not-a-uuid", role: "summary", provider_id: "openai", model: "gpt-4o-mini" },
      { catalog, masterKey: MASTER_KEY },
    ),
  );
});
