import test from "node:test";
import assert from "node:assert/strict";
import {
  ambiguous,
  isAmbiguous,
  isNotFound,
  isResolved,
  notFound,
  resolved,
  type ResolverCandidate,
  type ResolverEnvelope,
} from "../src/envelope.ts";
import type { SubjectRef } from "../src/subject-ref.ts";

const aaplListing: SubjectRef = {
  kind: "listing",
  id: "11111111-1111-4111-a111-111111111111",
};
const alphabetIssuer: SubjectRef = {
  kind: "issuer",
  id: "22222222-2222-4222-a222-222222222222",
};
const googlListing: SubjectRef = {
  kind: "listing",
  id: "33333333-3333-4333-a333-333333333333",
};
const googListing: SubjectRef = {
  kind: "listing",
  id: "44444444-4444-4444-a444-444444444444",
};

test("resolved envelope carries the canonical ref and defaults canonical_kind to subject_ref.kind", () => {
  const envelope = resolved({
    subject_ref: aaplListing,
    display_name: "AAPL",
    confidence: 0.99,
  });

  assert.equal(envelope.outcome, "resolved");
  assert.equal(envelope.canonical_kind, "listing");
  assert.equal(envelope.subject_ref.kind, "listing");
  assert.equal(isResolved(envelope), true);
  assert.equal(isAmbiguous(envelope), false);
  assert.equal(isNotFound(envelope), false);
});

test("resolved envelope rejects canonical_kind that differs from subject_ref.kind", () => {
  assert.throws(
    () =>
      resolved({
        subject_ref: aaplListing,
        display_name: "Apple Inc.",
        confidence: 0.95,
        canonical_kind: "issuer",
      }),
    /canonical_kind must match subject_ref.kind/,
  );
});

test("resolved envelope can carry lower-confidence alternatives without demoting to ambiguous", () => {
  const alternatives: ResolverCandidate[] = [
    {
      subject_ref: googlListing,
      display_name: "GOOGL (Class A)",
      confidence: 0.4,
      match_reason: "alias",
    },
  ];
  const envelope = resolved({
    subject_ref: googListing,
    display_name: "GOOG (Class C)",
    confidence: 0.85,
    alternatives,
  });

  assert.equal(envelope.outcome, "resolved");
  assert.deepEqual(envelope.alternatives, alternatives);
});

test("resolved rejects an alternative with higher confidence than the chosen target", () => {
  assert.throws(
    () =>
      resolved({
        subject_ref: googListing,
        display_name: "GOOG",
        confidence: 0.5,
        alternatives: [
          {
            subject_ref: googlListing,
            display_name: "GOOGL",
            confidence: 0.9,
          },
        ],
      }),
    /must not exceed the chosen candidate/,
  );
});

test("resolved rejects out-of-range confidence", () => {
  for (const confidence of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => resolved({ subject_ref: aaplListing, display_name: "AAPL", confidence }),
      /confidence must be a finite number in \[0, 1\]/,
      `expected confidence=${confidence} to be rejected`,
    );
  }
});

test("ambiguous envelope requires >= 2 candidates ranked by confidence descending", () => {
  const envelope = ambiguous({
    candidates: [
      { subject_ref: googlListing, display_name: "GOOGL", confidence: 0.7 },
      { subject_ref: googListing, display_name: "GOOG", confidence: 0.6 },
      { subject_ref: alphabetIssuer, display_name: "Alphabet Inc.", confidence: 0.5 },
    ],
    ambiguity_axis: "multiple_listings",
  });

  assert.equal(envelope.outcome, "ambiguous");
  assert.equal(envelope.candidates.length, 3);
  assert.equal(envelope.ambiguity_axis, "multiple_listings");
  assert.equal(isAmbiguous(envelope), true);
});

test("ambiguous rejects a single-candidate list (callers must use resolved)", () => {
  assert.throws(
    () =>
      ambiguous({
        candidates: [
          { subject_ref: googListing, display_name: "GOOG", confidence: 0.9 },
        ],
      }),
    /requires >= 2 candidates/,
  );
});

test("ambiguous rejects candidates not ranked by confidence descending", () => {
  assert.throws(
    () =>
      ambiguous({
        candidates: [
          { subject_ref: googlListing, display_name: "GOOGL", confidence: 0.3 },
          { subject_ref: googListing, display_name: "GOOG", confidence: 0.9 },
        ],
      }),
    /ranked by confidence descending/,
  );
});

test("ambiguous rejects candidate confidence outside [0, 1]", () => {
  assert.throws(
    () =>
      ambiguous({
        candidates: [
          { subject_ref: googlListing, display_name: "GOOGL", confidence: 1.5 },
          { subject_ref: googListing, display_name: "GOOG", confidence: 0.9 },
        ],
      }),
    /must be a finite number in \[0, 1\]/,
  );
});

test("not_found envelope preserves the normalized input", () => {
  const envelope = notFound({ normalized_input: "NOTREAL", reason: "unknown_ticker" });

  assert.equal(envelope.outcome, "not_found");
  assert.equal(envelope.normalized_input, "NOTREAL");
  assert.equal(envelope.reason, "unknown_ticker");
  assert.equal(isNotFound(envelope), true);
});

test("type guards discriminate each outcome exclusively", () => {
  const envelopes: ResolverEnvelope[] = [
    resolved({ subject_ref: aaplListing, display_name: "AAPL", confidence: 0.99 }),
    ambiguous({
      candidates: [
        { subject_ref: googlListing, display_name: "GOOGL", confidence: 0.7 },
        { subject_ref: googListing, display_name: "GOOG", confidence: 0.6 },
      ],
    }),
    notFound({ normalized_input: "NOTREAL" }),
  ];

  const flags = envelopes.map((envelope) => [
    isResolved(envelope),
    isAmbiguous(envelope),
    isNotFound(envelope),
  ]);

  assert.deepEqual(flags, [
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ]);
});

test("spec §6.1 examples: GOOG → ambiguous, AAPL → resolved-listing, NOTREAL → not_found", () => {
  ambiguous({
    candidates: [
      { subject_ref: googListing, display_name: "GOOG (Class C)", confidence: 0.55 },
      { subject_ref: googlListing, display_name: "GOOGL (Class A)", confidence: 0.45 },
    ],
    ambiguity_axis: "multiple_listings",
  });
  resolved({
    subject_ref: aaplListing,
    display_name: "AAPL",
    confidence: 0.98,
    canonical_kind: "listing",
  });
  notFound({ normalized_input: "NOTREAL", reason: "no_candidates" });
});
