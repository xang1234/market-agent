import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GDELT_ARTICLE_DISCOVERY_PROVIDER,
  GDELT_DISCOVERY_DEFAULT_MAX_RECORDS_ENV,
  GDELT_DISCOVERY_DISCLOSURE,
  GDELT_DISCOVERY_ENABLED_ENV,
  GDELT_DISCOVERY_LICENSE_CLASS,
  GDELT_DISCOVERY_RATE_LIMIT_PER_SECOND_ENV,
  GDELT_DISCOVERY_SOURCE_KIND,
  GDELT_DISCOVERY_STORE_POLICY,
  GDELT_DISCOVERY_STORE_POLICY_ENV,
  GDELT_DISCOVERY_TRUST_TIER,
  GDELT_DOC_API_CANONICAL_URL,
} from "../src/gdelt-source.ts";
import { createSource } from "../src/source-repo.ts";
import { decideStoragePolicy } from "../src/license-policy.ts";
import type { QueryExecutor } from "../src/types.ts";

test("GDELT discovery constants encode metadata-only article provenance", () => {
  assert.equal(GDELT_ARTICLE_DISCOVERY_PROVIDER, "gdelt_article_discovery");
  assert.equal(GDELT_DISCOVERY_SOURCE_KIND, "article");
  assert.equal(GDELT_DISCOVERY_TRUST_TIER, "tertiary");
  assert.equal(GDELT_DISCOVERY_LICENSE_CLASS, "ephemeral");
  assert.equal(GDELT_DISCOVERY_STORE_POLICY, "metadata_only");
  assert.match(GDELT_DISCOVERY_DISCLOSURE, /not a canonical fact source/i);
  assert.equal(GDELT_DOC_API_CANONICAL_URL, "https://api.gdeltproject.org/api/v2/doc/doc");
});

test("GDELT discovery license routes through the non-storing ephemeral policy", () => {
  assert.deepEqual(decideStoragePolicy(GDELT_DISCOVERY_LICENSE_CLASS), {
    store_blob: false,
    reason: "ephemeral_license",
  });
});

test("createSource accepts GDELT discovery as tertiary ephemeral article metadata", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: [
          {
            source_id: "00000000-0000-4000-a000-00000000000d",
            provider: values?.[0],
            kind: values?.[1],
            canonical_url: values?.[2],
            trust_tier: values?.[3],
            license_class: values?.[4],
            retrieved_at: new Date(values?.[5] as string),
            content_hash: values?.[6],
            user_id: values?.[7],
            created_at: new Date("2026-05-30T00:00:00.000Z"),
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
    provider: GDELT_ARTICLE_DISCOVERY_PROVIDER,
    kind: GDELT_DISCOVERY_SOURCE_KIND,
    canonical_url: GDELT_DOC_API_CANONICAL_URL,
    trust_tier: GDELT_DISCOVERY_TRUST_TIER,
    license_class: GDELT_DISCOVERY_LICENSE_CLASS,
    retrieved_at: "2026-05-30T00:00:00Z",
    content_hash: "sha256:gdelt-metadata",
  });

  assert.deepEqual(queries[0].values, [
    GDELT_ARTICLE_DISCOVERY_PROVIDER,
    GDELT_DISCOVERY_SOURCE_KIND,
    GDELT_DOC_API_CANONICAL_URL,
    GDELT_DISCOVERY_TRUST_TIER,
    GDELT_DISCOVERY_LICENSE_CLASS,
    "2026-05-30T00:00:00Z",
    "sha256:gdelt-metadata",
    null,
  ]);
  assert.equal(row.provider, GDELT_ARTICLE_DISCOVERY_PROVIDER);
  assert.equal(row.kind, GDELT_DISCOVERY_SOURCE_KIND);
  assert.equal(row.license_class, GDELT_DISCOVERY_LICENSE_CLASS);
});

test("environment example documents GDELT discovery enablement, storage policy, and rate knobs", () => {
  const envExample = readFileSync(new URL("../../../.env.dev.example", import.meta.url), "utf8");

  for (const name of [
    GDELT_DISCOVERY_ENABLED_ENV,
    "GDELT_DOC_API_BASE_URL",
    GDELT_DISCOVERY_STORE_POLICY_ENV,
    GDELT_DISCOVERY_DEFAULT_MAX_RECORDS_ENV,
    GDELT_DISCOVERY_RATE_LIMIT_PER_SECOND_ENV,
  ]) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"), `${name} must be present in .env.dev.example`);
  }

  assert.match(envExample, /metadata-only/i);
  assert.match(envExample, /snippets may be passed transiently/i);
  assert.match(envExample, /full article bodies\s+# are not stored/i);
});

test("evidence README documents GDELT as discovery metadata, not a truth source", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /GDELT Public News Discovery/);
  assert.match(readme, /discovery source, not a truth source/i);
  assert.match(readme, /metadata-only/i);
  assert.match(readme, /snippets\s+may be passed transiently/i);
  assert.match(readme, /full article bodies are not stored by\s+default/i);
  assert.match(readme, /public news\s+discovery metadata, not canonical facts/i);
  assert.match(readme, /test\/document-research\.test\.ts/);
});
