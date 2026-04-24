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
  const listing = {
    listing_id: aaplXnas.id,
    instrument_id: appleInstrument,
    issuer_id: appleIssuer,
    mic: "XNAS",
    ticker: "AAPL",
    trading_currency: "USD",
    timezone: "America/New_York",
    active_from: null,
    active_to: null,
    asset_type: "common_stock",
    share_class: null,
    isin: "US0378331005",
    legal_name: "Apple Inc.",
    cik: "320193",
    lei: "HWUPKR0MPOU8FGXBT394",
    domicile: "US",
    sector: "Technology",
    industry: "Consumer Electronics",
  };

  return scriptedDb({
    listings: [listing],
    listingDetails: [listing],
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
        trading_currency: "USD",
        timezone: "America/New_York",
        share_class: null,
        legal_name: "Apple Inc.",
      },
      {
        listing_id: aaplXfra.id,
        instrument_id: appleInstrument,
        issuer_id: appleIssuer,
        mic: "XFRA",
        ticker: "AAPL",
        trading_currency: "EUR",
        timezone: "Europe/Berlin",
        share_class: null,
        legal_name: "Apple Inc.",
      },
    ],
    listingDetails: [
      {
        listing_id: aaplXnas.id,
        instrument_id: appleInstrument,
        issuer_id: appleIssuer,
        mic: "XNAS",
        ticker: "AAPL",
        trading_currency: "USD",
        timezone: "America/New_York",
        active_from: null,
        active_to: null,
        asset_type: "common_stock",
        share_class: null,
        isin: "US0378331005",
        legal_name: "Apple Inc.",
        cik: "320193",
        lei: "HWUPKR0MPOU8FGXBT394",
        domicile: "US",
        sector: "Technology",
        industry: "Consumer Electronics",
      },
      {
        listing_id: aaplXfra.id,
        instrument_id: appleInstrument,
        issuer_id: appleIssuer,
        mic: "XFRA",
        ticker: "AAPL",
        trading_currency: "EUR",
        timezone: "Europe/Berlin",
        active_from: null,
        active_to: null,
        asset_type: "common_stock",
        share_class: null,
        isin: "US0378331005",
        legal_name: "Apple Inc.",
        cik: "320193",
        lei: "HWUPKR0MPOU8FGXBT394",
        domicile: "US",
        sector: "Technology",
        industry: "Consumer Electronics",
      },
    ],
    aliases: [],
  });
}

function emptyDb(): QueryExecutor {
  return scriptedDb({ listings: [], aliases: [] });
}

function issuerIdentifierDb(): QueryExecutor {
  return scriptedDb({
    listings: [],
    aliases: [],
    issuerIdentifiers: [
      {
        issuer_id: appleIssuer,
        legal_name: "Apple Inc.",
      },
    ],
    issuerDetails: [
      {
        issuer_id: appleIssuer,
        legal_name: "Apple Inc.",
        cik: "320193",
        lei: "HWUPKR0MPOU8FGXBT394",
        domicile: "US",
        sector: "Technology",
        industry: "Consumer Electronics",
      },
    ],
    activeListings: [
      {
        listing_id: aaplXnas.id,
        instrument_id: appleInstrument,
        issuer_id: appleIssuer,
        mic: "XNAS",
        ticker: "AAPL",
        trading_currency: "USD",
        timezone: "America/New_York",
        active_from: null,
        active_to: null,
      },
    ],
  });
}

function instrumentIdentifierDb(): QueryExecutor {
  return scriptedDb({
    listings: [],
    aliases: [],
    instrumentIdentifiers: [
      {
        instrument_id: appleInstrument,
        issuer_id: appleIssuer,
        asset_type: "common_stock",
        share_class: null,
        legal_name: "Apple Inc.",
      },
    ],
    instrumentDetails: [
      {
        instrument_id: appleInstrument,
        issuer_id: appleIssuer,
        asset_type: "common_stock",
        share_class: null,
        isin: "US0378331005",
        legal_name: "Apple Inc.",
        cik: "320193",
        lei: "HWUPKR0MPOU8FGXBT394",
        domicile: "US",
        sector: "Technology",
        industry: "Consumer Electronics",
      },
    ],
    activeListings: [
      {
        listing_id: aaplXnas.id,
        instrument_id: appleInstrument,
        issuer_id: appleIssuer,
        mic: "XNAS",
        ticker: "AAPL",
        trading_currency: "USD",
        timezone: "America/New_York",
        active_from: null,
        active_to: null,
      },
    ],
  });
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

test("hydrated listing bundle carries canonical key plus issuer, instrument, and listing context", async () => {
  const result = await runSearchToSubjectFlow(singleListingDb(), { text: "AAPL" });

  assert.equal(result.status, "hydrated");
  assert.deepEqual(result.handoff.subject_ref, aaplXnas);
  assert.equal(result.handoff.display_labels.primary, "AAPL · XNAS — Apple Inc.");
  assert.equal(result.handoff.display_labels.ticker, "AAPL");
  assert.equal(result.handoff.display_labels.mic, "XNAS");
  assert.equal(result.handoff.context.issuer?.subject_ref.id, appleIssuer);
  assert.equal(result.handoff.context.issuer?.legal_name, "Apple Inc.");
  assert.equal(result.handoff.context.issuer?.cik, "320193");
  assert.equal(result.handoff.context.instrument?.subject_ref.id, appleInstrument);
  assert.equal(result.handoff.context.instrument?.asset_type, "common_stock");
  assert.equal(result.handoff.context.instrument?.isin, "US0378331005");
  assert.equal(result.handoff.context.listing?.subject_ref.id, aaplXnas.id);
  assert.equal(result.handoff.context.listing?.ticker, "AAPL");
  assert.equal(result.handoff.context.listing?.mic, "XNAS");
  assert.deepEqual(persistedSubjectRefs([result.handoff]), [aaplXnas]);
});

test("auto-advanced resolution writes resolution path telemetry", async () => {
  const { db, toolLogs } = withToolLogCapture(singleListingDb());

  await runSearchToSubjectFlow(db, { text: "AAPL" });

  assert.equal(toolLogs.length, 1);
  assert.equal(toolLogs[0].tool_name, "resolver.search_to_subject_flow");
  assert.equal(toolLogs[0].status, "ok");
  assert.deepEqual(toolLogs[0].args, {
    resolution_path: "auto_advanced",
    normalized_input: "AAPL",
    subject_ref: aaplXnas,
    identity_level: "listing",
  });
});

test("resolution telemetry failures prevent hydrated results from bypassing required logs", async () => {
  await assert.rejects(
    runSearchToSubjectFlow(withFailingToolLog(singleListingDb()), { text: "AAPL" }),
    /telemetry unavailable/,
  );
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

test("needs-choice flow does not write resolution path telemetry", async () => {
  const { db, toolLogs } = withToolLogCapture(ambiguousListingDb());

  const result = await runSearchToSubjectFlow(db, { text: "AAPL" });

  assert.equal(result.status, "needs_choice");
  assert.equal(toolLogs.length, 0);
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
  assert.equal(result.handoff.context.listing?.trading_currency, "EUR");
});

test("explicit-choice resolution writes resolution path telemetry", async () => {
  const { db, toolLogs } = withToolLogCapture(ambiguousListingDb());

  await runSearchToSubjectFlow(db, {
    text: "AAPL",
    choice: { subject_ref: aaplXfra },
  });

  assert.equal(toolLogs.length, 1);
  assert.equal(toolLogs[0].tool_name, "resolver.search_to_subject_flow");
  assert.equal(toolLogs[0].status, "ok");
  assert.deepEqual(toolLogs[0].args, {
    resolution_path: "explicit_choice",
    normalized_input: "AAPL",
    subject_ref: aaplXfra,
    identity_level: "listing",
  });
});

test("hydrated issuer bundle carries issuer context and active listing entry context", async () => {
  const result = await runSearchToSubjectFlow(issuerIdentifierDb(), { text: "0000320193" });

  assert.equal(result.status, "hydrated");
  assert.equal(result.handoff.identity_level, "issuer");
  assert.deepEqual(result.handoff.subject_ref, { kind: "issuer", id: appleIssuer });
  assert.equal(result.handoff.display_labels.legal_name, "Apple Inc.");
  assert.equal(result.handoff.context.issuer?.subject_ref.id, appleIssuer);
  assert.equal(result.handoff.context.issuer?.sector, "Technology");
  assert.equal(result.handoff.context.active_listings?.[0]?.subject_ref.id, aaplXnas.id);
  assert.equal(result.handoff.context.active_listings?.[0]?.ticker, "AAPL");
  assert.deepEqual(persistedSubjectRefs([result.handoff]), [{ kind: "issuer", id: appleIssuer }]);
});

test("hydrated instrument bundle carries instrument, issuer, and active listing context", async () => {
  const result = await runSearchToSubjectFlow(instrumentIdentifierDb(), {
    text: "US0378331005",
  });

  assert.equal(result.status, "hydrated");
  assert.equal(result.handoff.identity_level, "instrument");
  assert.deepEqual(result.handoff.subject_ref, { kind: "instrument", id: appleInstrument });
  assert.equal(result.handoff.context.issuer?.subject_ref.id, appleIssuer);
  assert.equal(result.handoff.context.instrument?.subject_ref.id, appleInstrument);
  assert.equal(result.handoff.context.instrument?.asset_type, "common_stock");
  assert.equal(result.handoff.context.instrument?.isin, "US0378331005");
  assert.equal(result.handoff.context.active_listings?.[0]?.subject_ref.id, aaplXnas.id);
});

test("search-to-subject flow ends not_found without subject hydration", async () => {
  const result = await runSearchToSubjectFlow(emptyDb(), { text: "NOTREAL" });

  assert.equal(result.status, "not_found");
  assert.equal(result.stage, "candidate_search");
  assert.equal(result.normalized_input, "NOTREAL");
  assert.equal(result.reason, "no_candidates");
  assert.equal("handoff" in result, false);
});

test("not_found flow does not write resolution path telemetry", async () => {
  const { db, toolLogs } = withToolLogCapture(emptyDb());

  const result = await runSearchToSubjectFlow(db, { text: "NOTREAL" });

  assert.equal(result.status, "not_found");
  assert.equal(toolLogs.length, 0);
});

type ScriptRows = {
  listings: Array<Record<string, unknown>>;
  listingDetails?: Array<Record<string, unknown>>;
  issuerIdentifiers?: Array<Record<string, unknown>>;
  issuerDetails?: Array<Record<string, unknown>>;
  instrumentIdentifiers?: Array<Record<string, unknown>>;
  instrumentDetails?: Array<Record<string, unknown>>;
  activeListings?: Array<Record<string, unknown>>;
  aliases: Array<Record<string, unknown>>;
};

function scriptedDb(rows: ScriptRows): QueryExecutor {
  return {
    query: async (text: string, values?: unknown[]) => {
      if (text.includes("insert into tool_call_logs")) {
        return {
          rows: [
            {
              tool_call_id: "55555555-5555-4555-a555-555555555555",
              created_at: new Date("2026-04-24T00:00:00.000Z"),
            },
          ],
        } as never;
      }

      if (text.includes("where l.listing_id = $1")) {
        return {
          rows: rows.listingDetails?.filter((row) => row.listing_id === values?.[0]) ?? [],
        } as never;
      }

      if (text.includes("where iss.issuer_id = $1")) {
        return {
          rows: rows.issuerDetails?.filter((row) => row.issuer_id === values?.[0]) ?? [],
        } as never;
      }

      if (text.includes("where i.instrument_id = $1")) {
        return {
          rows: rows.instrumentDetails?.filter((row) => row.instrument_id === values?.[0]) ?? [],
        } as never;
      }

      if (text.includes("i.issuer_id = $1")) {
        return {
          rows: rows.activeListings?.filter((row) => row.issuer_id === values?.[0]) ?? [],
        } as never;
      }

      if (text.includes("l.instrument_id = $1")) {
        return {
          rows: rows.activeListings?.filter((row) => row.instrument_id === values?.[0]) ?? [],
        } as never;
      }

      if (text.includes("from listings l")) {
        return { rows: rows.listings } as never;
      }

      if (text.includes("from issuer_aliases")) {
        return { rows: rows.aliases } as never;
      }

      if (text.includes("from issuers where upper")) {
        return { rows: rows.issuerIdentifiers ?? [] } as never;
      }

      if (text.includes("where upper(i.isin)")) {
        return { rows: rows.instrumentIdentifiers ?? [] } as never;
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

function persistedSubjectRefs(
  handoffs: Array<{ subject_ref: SubjectRef }>,
): SubjectRef[] {
  return handoffs.map((handoff) => handoff.subject_ref);
}

function withToolLogCapture(db: QueryExecutor): {
  db: QueryExecutor;
  toolLogs: Array<{ tool_name: string; args: unknown; status: string }>;
} {
  const toolLogs: Array<{ tool_name: string; args: unknown; status: string }> = [];
  return {
    toolLogs,
    db: {
      query: async (text, values) => {
        if (text.includes("insert into tool_call_logs")) {
          toolLogs.push({
            tool_name: String(values?.[0]),
            args: JSON.parse(String(values?.[1])),
            status: String(values?.[2]),
          });
          return {
            rows: [
              {
                tool_call_id: "55555555-5555-4555-a555-555555555555",
                created_at: new Date("2026-04-24T00:00:00.000Z"),
              },
            ],
          } as never;
        }

        return db.query(text, values);
      },
    },
  };
}

function withFailingToolLog(db: QueryExecutor): QueryExecutor {
  return {
    query: async (text, values) => {
      if (text.includes("insert into tool_call_logs")) {
        throw new Error("telemetry unavailable");
      }

      return db.query(text, values);
    },
  };
}
