import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  createSource,
  getSource,
} from "../src/source-repo.ts";
import type { QueryExecutor } from "../src/types.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

test("createSource inserts trust tier and license class metadata", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const sourceId = "00000000-0000-4000-8000-000000000001";
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: [
          {
            source_id: sourceId,
            provider: "sec_edgar",
            kind: "filing",
            canonical_url: "https://www.sec.gov/example",
            trust_tier: "primary",
            license_class: "public",
            retrieved_at: new Date("2026-04-29T00:00:00.000Z"),
            content_hash: "sha256:abc123",
            created_at: new Date("2026-04-29T00:00:01.000Z"),
          },
        ] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };

  const row = await createSource(db, {
    provider: "sec_edgar",
    kind: "filing",
    canonical_url: "https://www.sec.gov/example",
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: "2026-04-29T00:00:00Z",
    content_hash: "sha256:abc123",
  });

  assert.match(queries[0].text, /insert into sources/);
  assert.deepEqual(queries[0].values, [
    "sec_edgar",
    "filing",
    "https://www.sec.gov/example",
    "primary",
    "public",
    "2026-04-29T00:00:00Z",
    "sha256:abc123",
  ]);
  assert.deepEqual(row, {
    source_id: sourceId,
    provider: "sec_edgar",
    kind: "filing",
    canonical_url: "https://www.sec.gov/example",
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: "2026-04-29T00:00:00.000Z",
    content_hash: "sha256:abc123",
    created_at: "2026-04-29T00:00:01.000Z",
  });
});

test("createSource rejects malformed source metadata before querying", async () => {
  let queryCalls = 0;
  const db: QueryExecutor = {
    async query() {
      queryCalls += 1;
      throw new Error("query should not run");
    },
  };

  await assert.rejects(
    createSource(db, {
      provider: "sec_edgar",
      kind: "not-a-kind" as never,
      trust_tier: "primary",
      license_class: "public",
      retrieved_at: "2026-04-29T00:00:00Z",
    }),
    /kind: must be one of/,
  );

  await assert.rejects(
    createSource(db, {
      provider: "sec_edgar",
      kind: "filing",
      trust_tier: "primary",
      license_class: "",
      retrieved_at: "2026-04-29T00:00:00Z",
    }),
    /license_class: must be a non-empty string/,
  );

  await assert.rejects(
    createSource(db, {
      provider: "   ",
      kind: "filing",
      trust_tier: "primary",
      license_class: "public",
      retrieved_at: "2026-04-29T00:00:00Z",
    }),
    /provider: must be a non-empty string/,
  );

  assert.equal(queryCalls, 0);
});

test("source rows persist and documents cannot reference a missing source", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for evidence repository integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-5gb-source-repo");
  const client = await connectedClient(t, databaseUrl);
  const created = await createSource(client, {
    provider: "sec_edgar",
    kind: "filing",
    canonical_url: "https://www.sec.gov/example",
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: "2026-04-29T00:00:00Z",
    content_hash: "sha256:source-content",
  });

  const found = await getSource(client, created.source_id);
  assert.equal(found?.source_id, created.source_id);
  assert.equal(found?.trust_tier, "primary");
  assert.equal(found?.license_class, "public");

  await assert.rejects(
    client.query(
      `insert into documents
         (source_id, provider_doc_id, kind, content_hash, raw_blob_id)
       values ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        "orphan-doc",
        "filing",
        "sha256:orphan-doc",
        "blob:orphan-doc",
      ],
    ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23503",
  );
});
