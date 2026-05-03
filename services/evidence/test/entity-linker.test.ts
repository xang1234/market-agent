import test from "node:test";
import assert from "node:assert/strict";

import { ambiguous, notFound, resolved } from "../../resolver/src/envelope.ts";
import type { ResolverEnvelope } from "../../resolver/src/envelope.ts";

import {
  linkDocumentMentions,
  type DetectedMentionCandidate,
} from "../src/reader/entity-linker.ts";
import type { QueryExecutor } from "../src/types.ts";

const DOCUMENT_ID = "11111111-1111-4111-a111-111111111111";
const ISSUER_ID = "22222222-2222-4222-a222-222222222222";
const LISTING_ID = "33333333-3333-4333-a333-333333333333";

function recordingDb() {
  const inserts: unknown[][] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(_text: string, values?: unknown[]) {
      inserts.push(values ?? []);
      return {
        rows: [
          {
            mention_id: `44444444-4444-4444-a444-44444444444${inserts.length}`,
            document_id: values?.[0],
            subject_kind: values?.[1],
            subject_id: values?.[2],
            prominence: values?.[3],
            mention_count: values?.[4],
            confidence: values?.[5],
            created_at: new Date("2026-05-03T00:00:00.000Z"),
          },
        ] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, inserts };
}

test("linkDocumentMentions resolves candidates and writes canonical mention rows", async () => {
  const { db, inserts } = recordingDb();
  const resolverCalls: string[] = [];
  const candidates: DetectedMentionCandidate[] = [
    {
      text: "Apple",
      prominence: "headline",
      mention_count: 3,
      confidence: 0.8,
    },
    {
      text: "AAPL",
      prominence: "body",
      mention_count: 1,
      confidence: 0.9,
    },
  ];

  const result = await linkDocumentMentions({
    db,
    document_id: DOCUMENT_ID,
    candidates,
    resolveMention: async (text) => {
      resolverCalls.push(text);
      return text === "Apple"
        ? resolved({
            subject_ref: { kind: "issuer", id: ISSUER_ID },
            display_name: "Apple Inc.",
            confidence: 0.95,
          })
        : resolved({
            subject_ref: { kind: "listing", id: LISTING_ID },
            display_name: "Apple Inc. (NASDAQ:AAPL)",
            confidence: 0.7,
          });
    },
  });

  assert.deepEqual(resolverCalls, ["Apple", "AAPL"]);
  assert.equal(result.mentions.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.deepEqual(inserts[0], [DOCUMENT_ID, "issuer", ISSUER_ID, "headline", 3, 0.8]);
  assert.deepEqual(inserts[1], [DOCUMENT_ID, "listing", LISTING_ID, "body", 1, 0.7]);
});

test("linkDocumentMentions preserves resolver ambiguity by skipping unresolved candidates", async () => {
  const { db, inserts } = recordingDb();
  const envelopes = new Map<string, ResolverEnvelope>([
    [
      "Apple",
      ambiguous({
        candidates: [
          {
            subject_ref: { kind: "issuer", id: ISSUER_ID },
            display_name: "Apple Inc.",
            confidence: 0.7,
          },
          {
            subject_ref: { kind: "listing", id: LISTING_ID },
            display_name: "AAPL",
            confidence: 0.65,
          },
        ],
        ambiguity_axis: "issuer_vs_listing",
      }),
    ],
    ["UnknownCo", notFound({ normalized_input: "unknownco", reason: "no_candidates" })],
  ]);

  const result = await linkDocumentMentions({
    db,
    document_id: DOCUMENT_ID,
    candidates: [
      { text: "Apple", prominence: "lead", mention_count: 2, confidence: 0.9 },
      { text: "UnknownCo", prominence: "body", mention_count: 1, confidence: 0.6 },
    ],
    resolveMention: async (text) => envelopes.get(text)!,
  });

  assert.equal(result.mentions.length, 0);
  assert.deepEqual(
    result.skipped.map((skipped) => [skipped.text, skipped.reason]),
    [
      ["Apple", "ambiguous"],
      ["UnknownCo", "not_found"],
    ],
  );
  assert.equal(inserts.length, 0);
});

test("linkDocumentMentions aggregates duplicate canonical mentions before writing", async () => {
  const { db, inserts } = recordingDb();

  const result = await linkDocumentMentions({
    db,
    document_id: DOCUMENT_ID,
    candidates: [
      { text: "Apple", prominence: "headline", mention_count: 2, confidence: 0.8 },
      { text: "AAPL", prominence: "headline", mention_count: 5, confidence: 0.9 },
    ],
    resolveMention: async (text) =>
      resolved({
        subject_ref: { kind: "issuer", id: ISSUER_ID },
        display_name: text,
        confidence: text === "Apple" ? 0.95 : 0.7,
      }),
  });

  assert.equal(result.mentions.length, 1);
  assert.deepEqual(inserts, [[DOCUMENT_ID, "issuer", ISSUER_ID, "headline", 7, 0.8]]);
});
