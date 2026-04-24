import test from "node:test";
import assert from "node:assert/strict";
import type { QueryExecutor } from "../src/lookup.ts";
import type { SubjectRef } from "../src/subject-ref.ts";
import { runSearchToSubjectFlow } from "../src/flow.ts";

const aaplXnas: SubjectRef = {
  kind: "listing",
  id: "11111111-1111-4111-a111-111111111111",
};

const aaplXfra: SubjectRef = {
  kind: "listing",
  id: "22222222-2222-4222-a222-222222222222",
};

const appleIssuer = "33333333-3333-4333-a333-333333333333";
const appleInstrument = "44444444-4444-4444-a444-444444444444";

function singleListingDb(): QueryExecutor {
  return scriptedDb({
    listings: [
      {
        listing_id: aaplXnas.id,
        instrument_id: appleInstrument,
        issuer_id: appleIssuer,
        mic: "XNAS",
        ticker: "AAPL",
        share_class: null,
        legal_name: "Apple Inc.",
      },
    ],
    aliases: [],
  });
}

function ambiguousListingDb(): QueryExecutor {
  return scriptedDb({
    listings: [
      {
        listing_id: aaplXnas.id,
        instrument_id: appleInstrument,
        issuer_id: appleIssuer,
        mic: "XNAS",
        ticker: "AAPL",
        share_class: null,
        legal_name: "Apple Inc.",
      },
      {
        listing_id: aaplXfra.id,
        instrument_id: appleInstrument,
        issuer_id: appleIssuer,
        mic: "XFRA",
        ticker: "AAPL",
        share_class: null,
        legal_name: "Apple Inc.",
      },
    ],
    aliases: [],
  });
}

function emptyDb(): QueryExecutor {
  return scriptedDb({ listings: [], aliases: [] });
}

test("search-to-subject flow auto-advances a unique deterministic hit into hydrated handoff", async () => {
  const result = await runSearchToSubjectFlow(singleListingDb(), { text: "AAPL" });

  assert.equal(result.status, "hydrated");
  assert.equal(result.stage, "hydrated_handoff");
  assert.equal(result.canonical_selection.outcome, "resolved");
  assert.equal(result.handoff.resolution_path, "auto_advanced");
  assert.deepEqual(result.handoff.subject_ref, aaplXnas);
  assert.equal(result.handoff.identity_level, "listing");
  assert.equal(result.handoff.display_label, "AAPL · XNAS — Apple Inc.");
  assert.equal(result.handoff.normalized_input, "AAPL");
});

test("search-to-subject flow pauses at ambiguity without producing handoff", async () => {
  const result = await runSearchToSubjectFlow(ambiguousListingDb(), { text: "AAPL" });

  assert.equal(result.status, "needs_choice");
  assert.equal(result.stage, "canonical_selection");
  assert.equal(result.ambiguity_axis, "multiple_listings");
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.subject_ref),
    [aaplXnas, aaplXfra],
  );
  assert.equal("handoff" in result, false);
});

test("search-to-subject flow hydrates the explicitly chosen ambiguous candidate", async () => {
  const result = await runSearchToSubjectFlow(ambiguousListingDb(), {
    text: "AAPL",
    choice: { subject_ref: aaplXfra },
  });

  assert.equal(result.status, "hydrated");
  assert.equal(result.stage, "hydrated_handoff");
  assert.equal(result.canonical_selection.outcome, "resolved");
  assert.deepEqual(result.canonical_selection.subject_ref, aaplXfra);
  assert.equal(result.handoff.resolution_path, "explicit_choice");
  assert.deepEqual(result.handoff.subject_ref, aaplXfra);
  assert.equal(result.handoff.display_label, "AAPL · XFRA — Apple Inc.");
});

test("search-to-subject flow ends not_found without subject hydration", async () => {
  const result = await runSearchToSubjectFlow(emptyDb(), { text: "NOTREAL" });

  assert.equal(result.status, "not_found");
  assert.equal(result.stage, "candidate_search");
  assert.equal(result.normalized_input, "NOTREAL");
  assert.equal(result.reason, "no_candidates");
  assert.equal("handoff" in result, false);
});

type ScriptRows = {
  listings: Array<Record<string, unknown>>;
  aliases: Array<Record<string, unknown>>;
};

function scriptedDb(rows: ScriptRows): QueryExecutor {
  return {
    query: async (text: string) => {
      if (text.includes("from listings l")) {
        return { rows: rows.listings } as never;
      }

      if (text.includes("from issuer_aliases")) {
        return { rows: rows.aliases } as never;
      }

      if (text.includes("from issuers where upper")) {
        return { rows: [] } as never;
      }

      if (text.includes("from instruments i")) {
        return { rows: [] } as never;
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}
