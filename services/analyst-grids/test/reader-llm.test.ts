import test from "node:test";
import assert from "node:assert/strict";
import { buildReaderMessages, parseReaderResponse, MAX_ANSWER_CHARS, MAX_CLAIMS_PER_CELL } from "../src/reader-llm.ts";

const DOC_A = "2b3c4d5e-6f7a-4b2c-8d3e-4f5a6b7c8d9e";

test("buildReaderMessages includes the question and per-document delimiters", () => {
  const messages = buildReaderMessages("Any China exposure?", [
    { document_id: DOC_A, doc_kind: "filing", text: "Item 1A. Risks. China tariffs ..." },
  ]);
  assert.equal(messages[0].role, "system");
  const user = messages[1].content;
  assert.match(user, /Any China exposure\?/);
  assert.match(user, new RegExp(DOC_A));
});

test("parseReaderResponse accepts a valid JSON answer with claims", () => {
  const parsed = parseReaderResponse(
    JSON.stringify({
      answer: "Yes — tariff exposure flagged in Item 1A.",
      claims: [
        {
          document_id: DOC_A,
          predicate: "risk_exposure",
          text_canonical: "The company flags China tariff exposure in Item 1A.",
          polarity: "negative",
          modality: "asserted",
          confidence: 0.85,
        },
      ],
      not_discussed: false,
    }),
    new Set([DOC_A]),
  );
  assert.equal(parsed.kind, "answered");
  if (parsed.kind === "answered") {
    assert.equal(parsed.claims.length, 1);
    assert.ok(parsed.answer.length <= MAX_ANSWER_CHARS);
  }
});

test("parseReaderResponse strips markdown code fences", () => {
  const body = JSON.stringify({ answer: "x".repeat(10), claims: [], not_discussed: true });
  const parsed = parseReaderResponse("```json\n" + body + "\n```", new Set([DOC_A]));
  assert.equal(parsed.kind, "not_discussed");
});

test("rejects claims citing unknown document ids", () => {
  const body = JSON.stringify({
    answer: "ok answer",
    claims: [{ document_id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", predicate: "p", text_canonical: "t", polarity: "neutral", modality: "asserted", confidence: 0.5 }],
    not_discussed: false,
  });
  assert.throws(() => parseReaderResponse(body, new Set([DOC_A])), /unknown document_id/);
});

test("rejects invalid polarity/modality/confidence and non-JSON", () => {
  assert.throws(() => parseReaderResponse("not json at all", new Set([DOC_A])));
  const bad = (patch: object) =>
    JSON.stringify({
      answer: "ok answer",
      not_discussed: false,
      claims: [{ document_id: DOC_A, predicate: "p", text_canonical: "t", polarity: "neutral", modality: "asserted", confidence: 0.5, ...patch }],
    });
  assert.throws(() => parseReaderResponse(bad({ polarity: "sideways" }), new Set([DOC_A])));
  assert.throws(() => parseReaderResponse(bad({ modality: "vibes" }), new Set([DOC_A])));
  assert.throws(() => parseReaderResponse(bad({ confidence: 1.5 }), new Set([DOC_A])));
});

test("answered with zero claims is treated as not_discussed", () => {
  const parsed = parseReaderResponse(
    JSON.stringify({ answer: "Nothing relevant.", claims: [], not_discussed: false }),
    new Set([DOC_A]),
  );
  assert.equal(parsed.kind, "not_discussed");
});

const VALID_CLAIM = {
  document_id: DOC_A,
  predicate: "risk_exposure",
  text_canonical: "The company flags China tariff exposure in Item 1A.",
  polarity: "negative" as const,
  modality: "asserted" as const,
  confidence: 0.85,
};

test("answer with embedded newlines/tabs/control chars is normalised to a single clean line", () => {
  // Include newline, tab, zero-width space (U+200B), and a C0 control char (\x01)
  const dirtyAnswer = "Line1\nLine2\t\x01extra​";
  const parsed = parseReaderResponse(
    JSON.stringify({
      answer: dirtyAnswer,
      claims: [VALID_CLAIM],
      not_discussed: false,
    }),
    new Set([DOC_A]),
  );
  assert.equal(parsed.kind, "answered");
  if (parsed.kind === "answered") {
    assert.doesNotMatch(parsed.answer, /[\n\t\r\x00-\x1f\x7f-\x9f​-‍﻿]/);
    assert.doesNotMatch(parsed.answer, /  /); // no double spaces
    assert.ok(parsed.answer.length > 0);
  }
});

test("whitespace-only answer throws /missing answer/", () => {
  assert.throws(
    () =>
      parseReaderResponse(
        JSON.stringify({ answer: "   \n\t  ", claims: [VALID_CLAIM], not_discussed: false }),
        new Set([DOC_A]),
      ),
    /missing answer/,
  );
});

test("21 claims throws /too many claims/; 20 claims passes", () => {
  const makeClaims = (n: number) =>
    Array.from({ length: n }, () => ({ ...VALID_CLAIM }));

  assert.throws(
    () =>
      parseReaderResponse(
        JSON.stringify({ answer: "ok", claims: makeClaims(MAX_CLAIMS_PER_CELL + 1), not_discussed: false }),
        new Set([DOC_A]),
      ),
    /too many claims/,
  );

  const parsed = parseReaderResponse(
    JSON.stringify({ answer: "ok", claims: makeClaims(MAX_CLAIMS_PER_CELL), not_discussed: false }),
    new Set([DOC_A]),
  );
  assert.equal(parsed.kind, "answered");
  if (parsed.kind === "answered") {
    assert.equal(parsed.claims.length, MAX_CLAIMS_PER_CELL);
  }
});

test("whitespace-only predicate throws", () => {
  assert.throws(
    () =>
      parseReaderResponse(
        JSON.stringify({
          answer: "ok answer",
          claims: [{ ...VALID_CLAIM, predicate: "   " }],
          not_discussed: false,
        }),
        new Set([DOC_A]),
      ),
    /predicate required/,
  );
});

test("parseReaderResponse tolerates raw newlines inside JSON strings", () => {
  // Models quoting filing text often emit literal line breaks inside
  // text_canonical — illegal JSON that must not cost the whole cell.
  const raw = `{"answer": "Buyback announced.", "claims": [{"document_id": "${DOC_A}", "predicate": "buyback", "text_canonical": "approved a\n$6B repurchase\nprogram", "polarity": "positive", "modality": "asserted", "confidence": 0.9}], "not_discussed": false}`;
  const parsed = parseReaderResponse(raw, new Set([DOC_A]));
  assert.equal(parsed.kind, "answered");
  if (parsed.kind === "answered") {
    assert.equal(parsed.claims[0].text_canonical, "approved a $6B repurchase program");
  }
});
