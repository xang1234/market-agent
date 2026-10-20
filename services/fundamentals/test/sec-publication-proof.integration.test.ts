import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { recordFactPrecisionAttestation, recordSourcePublicationAttestation } from "../../evidence/src/financial-attestations.ts";
import { recordFactFinancialContext } from "../../evidence/src/financial-context.ts";
import type { SlotSelection } from "../../financial-engine/src/select-inputs.ts";
import { recordSecFetchPublication } from "../src/sec-publication-proof.ts";
import { secCompanyFetcher, secFetched } from "./fakes.ts";
import { originalContext, selectRevenue } from "./financial-selection.ts";

const ISSUER_ID = "33000000-0000-4000-8000-000000000001";
const FALLBACK_SOURCE_ID = "33000000-0000-4000-8000-000000000003";
const FY2023_ACCESSION = "0000320193-24-000006";

function companyFacts(accession = FY2023_ACCESSION, revenue = "383285000000.123456789012345678") {
  const value = (val: string) => ({ start: "2023-01-01", end: "2023-12-31", val: Number(val), val_token: val, accn: accession, fy: 2023, fp: "FY", form: "10-K", filed: "2024-01-10" });
  return {
    cik: 320193,
    entityName: "Example Corp",
    facts: { "us-gaap": { Revenues: { label: "Revenues", description: "", units: { USD: [value(revenue)] } } } },
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The deterministic source id ingestion derives from an accession. */
function accessionSourceId(accession: string): string {
  const hash = sha256(accession).slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = hash.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const utc = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const FY2023 = { issuer_id: ISSUER_ID, family: "income" as const, basis: "as_reported" as const, fiscal_year: 2023, fiscal_period: "FY" as const };

test("SEC ingestion binds source versions and their publication proofs", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for publication proof coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-publication");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Example Corp', '320193')`, [ISSUER_ID]);
  const repository = (completedAt: string, facts = companyFacts()) =>
    createSecBackedStatementRepository(db, {
      fetcher: secCompanyFetcher(() => facts, { completed_at: completedAt }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    });
  const proofsFor = async (sourceId: string) => (await db.query(
    `select source_version_hash, document_id, ${utc("available_not_before")} as available_not_before,
            ${utc("available_no_later_than")} as available_no_later_than, timing_precision, source_timezone,
            proof_method, proof_ref, proof_hash, mapping_version, supersedes
       from source_publication_attestations where source_id = $1 order by attested_at`,
    [sourceId],
  )).rows;
  // A backfill always downloads again: the re-ingest of a period already on file.
  const backfill = (completedAt: string, facts = companyFacts()) =>
    backfillSecCompanionStatements(db, {
      issuerId: ISSUER_ID,
      fetcher: secCompanyFetcher(() => facts, { completed_at: completedAt }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    });

  await t.test("a stored accession's version hash is never rewritten by a re-ingest", async () => {
    const otherIssuer = "33000000-0000-4000-8000-0000000000f1";
    const accession = "0000320199-24-000001";
    const sourceId = accessionSourceId(accession);
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Drifted Corp', '320199')`, [otherIssuer]);
    await db.query(
      `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash)
       values ($1, 'sec_edgar', 'filing', 'primary', 'public', '2024-01-01T00:00:00Z', $2)`,
      [sourceId, "f".repeat(64)],
    );
    const drifted = { ...companyFacts(accession), cik: 320199 };
    await assert.rejects(
      () => repository("2024-02-01T10:05:00.000Z", drifted).find({ ...FY2023, issuer_id: otherIssuer }),
      /has another content_hash; a source version never changes/,
    );
    const row = (await db.query(`select content_hash, ${utc("retrieved_at")} as retrieved_at from sources where source_id = $1`, [sourceId])).rows[0];
    assert.deepEqual(row, { content_hash: "f".repeat(64), retrieved_at: "2024-01-01T00:00:00.000Z" });
    assert.equal((await db.query(`select count(*)::int as n from facts where subject_id = $1`, [otherIssuer])).rows[0].n, 0);
  });

  await t.test("a re-ingest refreshes retrieved_at and keeps the accession hash", async () => {
    const sourceId = accessionSourceId(FY2023_ACCESSION);
    await repository("2024-02-01T10:05:00.000Z").find(FY2023);
    await backfill("2024-03-01T09:00:00.000Z");
    const row = (await db.query(`select content_hash, ${utc("retrieved_at")} as retrieved_at from sources where source_id = $1`, [sourceId])).rows[0];
    assert.deepEqual(row, { content_hash: sha256(FY2023_ACCESSION), retrieved_at: "2024-03-01T09:00:00.000Z" });
  });

  await t.test("ingestion records one controlled-fetch proof per source version, at its first fetch's completion", async () => {
    const fy2023 = accessionSourceId(FY2023_ACCESSION);
    // The 10:05 lookup and the March backfill above both stored this version.
    assert.deepEqual(await proofsFor(fy2023), [{
      source_version_hash: sha256(FY2023_ACCESSION),
      document_id: null,
      available_not_before: null,
      available_no_later_than: "2024-02-01T10:05:00.000Z",
      timing_precision: "instant",
      source_timezone: "UTC",
      proof_method: "controlled_public_fetch",
      proof_ref: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      proof_hash: secFetched(companyFacts()).body_sha256,
      mapping_version: "sec-companyfacts-controlled-fetch.v1",
      supersedes: null,
    }]);
    await backfill("2024-04-01T09:00:00.000Z");
    assert.equal((await proofsFor(fy2023)).length, 1, "a later fetch adds no proof");

    const amendment = "0000320193-24-000081";
    await backfill("2024-05-01T12:00:00.000Z", companyFacts(amendment, "383300000000"));
    assert.deepEqual(
      (await proofsFor(accessionSourceId(amendment))).map((proof) => [proof.source_version_hash, proof.available_no_later_than]),
      [[sha256(amendment), "2024-05-01T12:00:00.000Z"]],
      "a new accession gets its own proof",
    );
    assert.equal((await proofsFor(fy2023)).length, 1);
  });
  // An issuer whose FY2023 10-K was accepted Jan 10 and first fetched by
  // ingestion Feb 1 at 10:05 New York time.
  const SELECT_ISSUER = "33000000-0000-4000-8000-0000000000e1";
  const ORIGINAL = "0000320190-24-000010";
  const FETCHED_AT = "2024-02-01T15:05:00.000Z";
  const factOn = async (accession: string) => (await db.query<{ fact_id: string }>(
    `select fact_id::text from facts where source_id = $1`,
    [accessionSourceId(accession)],
  )).rows[0]!.fact_id;
  const proofIdFor = async (accession: string) => (await db.query<{ attestation_id: string }>(
    `select attestation_id::text from current_source_publication_attestations where source_id = $1 order by available_no_later_than`,
    [accessionSourceId(accession)],
  )).rows.map((row) => row.attestation_id);
  const chosen = (selection: SlotSelection) =>
    selection.status === "selected"
      ? { fact_id: selection.input.candidate.fact_id, attestation_id: selection.input.publication.attestation_id, public_by: selection.input.publication.available_no_later_than }
      : selection;

  await t.test("an ingested SEC fact carries its filing's original context; an untokened one is a precision gap", async () => {
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Select Corp', '320190')`, [SELECT_ISSUER]);
    const feed = { filings: { recent: { accessionNumber: [ORIGINAL], acceptanceDateTime: ["2024-01-10T16:30:05.000Z"] } } };
    await createSecBackedStatementRepository(db, {
      fetcher: secCompanyFetcher(() => ({ ...companyFacts(ORIGINAL), cik: 320190 }), { completed_at: FETCHED_AT, submissions: feed }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    }).find({ ...FY2023, issuer_id: SELECT_ISSUER });
    const factId = await factOn(ORIGINAL);
    assert.deepEqual(
      (await db.query(
        `select period_type, dimension_scope, reporting_basis, adjustment_basis, share_basis, disclosure_relation, source_context_ref
           from fact_financial_contexts where fact_id = $1`,
        [factId],
      )).rows,
      [{
        period_type: "duration",
        dimension_scope: "consolidated",
        reporting_basis: "as_reported",
        adjustment_basis: "unadjusted",
        share_basis: "not_applicable",
        disclosure_relation: "original",
        source_context_ref: `sec_edgar:companyfacts:CIK0000320190#Revenues|USD|${ORIGINAL}|2023-01-01..2023-12-31`,
      }],
    );
    const [fetchProof] = await proofIdFor(ORIGINAL);
    assert.deepEqual(chosen(await selectRevenue(db, SELECT_ISSUER, FETCHED_AT)), { fact_id: factId, attestation_id: fetchProof, public_by: FETCHED_AT });

    const legacyIssuer = "33000000-0000-4000-8000-0000000000e2";
    const legacy = "0000320191-24-000010";
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Legacy Corp', '320191')`, [legacyIssuer]);
    const untokened = companyFacts(legacy);
    delete (untokened.facts["us-gaap"].Revenues.units.USD[0] as { val_token?: string }).val_token;
    await createSecBackedStatementRepository(db, {
      fetcher: secCompanyFetcher(() => ({ ...untokened, cik: 320191 }), { completed_at: FETCHED_AT }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    }).find({ ...FY2023, issuer_id: legacyIssuer });
    await recordFactFinancialContext(db, originalContext(await factOn(legacy)));
    assert.deepEqual(await selectRevenue(db, legacyIssuer, FETCHED_AT), { status: "gap", reason_code: "precision_unverified" });
  });

  await t.test("a fetch completed at 10:05 cannot support a 10:00 cutoff, whatever acceptance says; it supports 10:05", async () => {
    const factId = await factOn(ORIGINAL);
    const [fetchProof] = await proofIdFor(ORIGINAL);
    assert.equal(
      (await db.query(`select raw_value from sec_filing_acceptances where accession = $1`, [ORIGINAL])).rows[0].raw_value,
      "2024-01-10T16:30:05.000Z",
      "an acceptance weeks before the cutoff, in any zone, is on file",
    );
    assert.deepEqual(await selectRevenue(db, SELECT_ISSUER, "2024-02-01T10:00:00-05:00"), { status: "gap", reason_code: "missing_input" });
    assert.deepEqual(chosen(await selectRevenue(db, SELECT_ISSUER, "2024-02-01T10:05:00-05:00")), { fact_id: factId, attestation_id: fetchProof, public_by: FETCHED_AT });
  });

  await t.test("stored by the cutoff and public by the cutoff stay distinct; an earlier cutoff needs a genuine historical proof", async () => {
    const factId = await factOn(ORIGINAL);
    const storedAtJan15 = () => createSecBackedStatementRepository(db, { fetcher: null, sourceId: FALLBACK_SOURCE_ID, cutoff: "2024-01-15T23:59:59.999-05:00" })
      .find({ ...FY2023, issuer_id: SELECT_ISSUER });
    assert.deepEqual(await selectRevenue(db, SELECT_ISSUER, "2024-01-15T23:59:59.999-05:00"), { status: "gap", reason_code: "missing_input" }, "the later fetch proves nothing about Jan 15");
    assert.equal(await storedAtJan15(), null);

    const archive = await recordSourcePublicationAttestation(db, {
      source_id: accessionSourceId(ORIGINAL),
      document_id: null,
      source_version_hash: sha256(ORIGINAL),
      available_not_before: null,
      available_no_later_than: "2024-01-10T00:00:00-05:00",
      timing_precision: "date",
      source_timezone: "America/New_York",
      proof_method: "accession_bound_archive",
      proof_ref: "https://www.sec.gov/Archives/edgar/data/320190/000032019024000010/",
      proof_hash: "c".repeat(64),
      mapping_version: "test-accession-archive.v1",
    });
    assert.deepEqual(chosen(await selectRevenue(db, SELECT_ISSUER, "2024-01-15T23:59:59.999-05:00")), { fact_id: factId, attestation_id: archive.attestation_id, public_by: "2024-01-11T04:59:59.999Z" });
    assert.equal(await storedAtJan15(), null, "public by Jan 15 is not stored by Jan 15");
    // A date proof covers its whole New York day, never midnight.
    assert.deepEqual(await selectRevenue(db, SELECT_ISSUER, "2024-01-10T12:00:00-05:00"), { status: "gap", reason_code: "missing_input" });
    assert.deepEqual(chosen(await selectRevenue(db, SELECT_ISSUER, "2024-01-10T23:59:59.999-05:00")), { fact_id: factId, attestation_id: archive.attestation_id, public_by: "2024-01-11T04:59:59.999Z" });
  });

  await t.test("as_reported and as_restated take distinct disclosures, each with its own accession's proof", async () => {
    const original = await factOn(ORIGINAL);
    const amendment = "0000320190-24-000077";
    const amendmentSource = accessionSourceId(amendment);
    const restated = "33000000-0000-4000-8000-0000000000e9";
    await db.query(
      `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash)
       values ($1, 'sec_edgar', 'filing', 'primary', 'public', '2024-06-03T14:00:00Z', $2)`,
      [amendmentSource, sha256(amendment)],
    );
    await db.query(
      `insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                          value_num, unit, currency, scale, as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
       select $1, 'issuer', $2, metric_id, 'fiscal_y', '2023-01-01', '2023-12-31', 2023, 'FY', 383000000000, 'currency', 'USD', 1,
              '2024-06-03T14:00:00Z', '2024-06-03T14:00:00Z', $3, 'reported', 'authoritative', 'filing_time', 'full', 1
         from metrics where metric_key = 'revenue'`,
      [restated, SELECT_ISSUER, amendmentSource],
    );
    await recordFactPrecisionAttestation(db, { fact_id: restated, precision_class: "source_token_preserved", raw_token: "383000000000", token_proof_hash: "d".repeat(64), source_locator: null, validation_method: "fixture" });
    await recordFactFinancialContext(db, originalContext(restated, "economic_restatement"));
    await recordSecFetchPublication(db, {
      sourceId: amendmentSource,
      accessionNumber: amendment,
      evidence: { url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320190.json", body_sha256: "a".repeat(64), completed_at: "2024-06-03T14:00:00.000Z" },
    });
    const [archive] = await proofIdFor(ORIGINAL);
    const [amendmentProof] = await proofIdFor(amendment);

    assert.deepEqual(chosen(await selectRevenue(db, SELECT_ISSUER, "2024-03-01T00:00:00Z", "as_restated")), { fact_id: original, attestation_id: archive, public_by: "2024-01-11T04:59:59.999Z" }, "a restatement not yet public");
    assert.deepEqual(chosen(await selectRevenue(db, SELECT_ISSUER, "2024-07-01T00:00:00Z", "as_restated")), { fact_id: restated, attestation_id: amendmentProof, public_by: "2024-06-03T14:00:00.000Z" });
    assert.deepEqual(chosen(await selectRevenue(db, SELECT_ISSUER, "2024-07-01T00:00:00Z", "as_reported")), { fact_id: original, attestation_id: archive, public_by: "2024-01-11T04:59:59.999Z" });
  });

  const REFETCHED_AT = "2024-03-01T09:00:00.000Z";
  const legacyIssuers = [
    { issuerId: "33000000-0000-4000-8000-0000000000d1", cik: 320181, accession: "0000320181-24-000010", proof: null },
    { issuerId: "33000000-0000-4000-8000-0000000000d2", cik: 320182, accession: "0000320182-24-000010", proof: "legacy_unverified" },
    { issuerId: "33000000-0000-4000-8000-0000000000d3", cik: 320183, accession: "0000320183-24-000010", proof: null },
    { issuerId: "33000000-0000-4000-8000-0000000000d4", cik: 320184, accession: "0000320184-24-000010", proof: null },
  ] as const;
  const refetch = (issuerId: string, cik: number, accession: string, facts: () => unknown = () => ({ ...companyFacts(accession), cik })) =>
    backfillSecCompanionStatements(db, {
      issuerId,
      fetcher: secCompanyFetcher(facts, { completed_at: REFETCHED_AT }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    });
  const precisionChain = async (factId: string) => (await db.query<{ precision_class: string; supersedes: boolean }>(
    `select precision_class, supersedes is not null as supersedes from fact_precision_attestations where fact_id = $1 order by attested_at`,
    [factId],
  )).rows;
  const ingestThenStripProofs = async ({ issuerId, cik, accession }: (typeof legacyIssuers)[number], revenue?: string) => {
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Legacy Corp', $2)`, [issuerId, String(cik)]);
    await createSecBackedStatementRepository(db, {
      fetcher: secCompanyFetcher(() => ({ ...companyFacts(accession, revenue), cik }), { completed_at: FETCHED_AT }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    }).find({ ...FY2023, issuer_id: issuerId });
    const factId = await factOn(accession);
    await db.query(`delete from fact_precision_attestations where fact_id = $1`, [factId]);
    await db.query(`delete from fact_financial_contexts where fact_id = $1`, [factId]);
    await db.query(`delete from source_publication_attestations where source_id = $1`, [accessionSourceId(accession)]);
    return factId;
  };

  await t.test("concurrent re-fetches prove a stored fact the filing still states, once", async () => {
    for (const legacy of legacyIssuers.slice(0, 2)) {
      const { issuerId, cik, accession, proof } = legacy;
      const factId = await ingestThenStripProofs(legacy);
      if (proof) await recordFactPrecisionAttestation(db, { fact_id: factId, precision_class: proof, validation_method: "no_retained_bytes" });

      await Promise.all([1, 2, 3, 4].map(() => refetch(issuerId, cik, accession)));
      const [publication] = await proofIdFor(accession);
      assert.deepEqual(chosen(await selectRevenue(db, issuerId, REFETCHED_AT)), { fact_id: factId, attestation_id: publication, public_by: REFETCHED_AT }, `proof ${proof}`);
      const proven = proof ? [{ precision_class: proof, supersedes: false }, { precision_class: "revalidated_against_source", supersedes: true }] : [{ precision_class: "revalidated_against_source", supersedes: false }];
      assert.deepEqual(await precisionChain(factId), proven);
      await refetch(issuerId, cik, accession);
      assert.deepEqual(await precisionChain(factId), proven, "a later re-fetch adds no proof");
    }
  });

  await t.test("a re-fetch replaces a stored income fact that only rounds the token", async () => {
    // The second token's rounding expands past the decimal parser's token length.
    for (const [legacy, token] of [[legacyIssuers[2], "383285000000.123456789012345678"], [legacyIssuers[3], "1.234567890123456789e-250"]] as const) {
      const rounded = await ingestThenStripProofs(legacy, token);
      await db.query(`update facts set value_num = $2::numeric where fact_id = $1`, [rounded, String(Number(token))]);
      await refetch(legacy.issuerId, legacy.cik, legacy.accession, () => ({ ...companyFacts(legacy.accession, token), cik: legacy.cik }));
      const exact = (await db.query<{ fact_id: string }>(
        `select fact_id::text from facts where source_id = $1 and invalidated_at is null and value_num = $2::numeric`,
        [accessionSourceId(legacy.accession), token],
      )).rows[0]?.fact_id;
      assert.ok(exact, token);
      assert.deepEqual(await precisionChain(exact), [{ precision_class: "source_token_preserved", supersedes: false }]);
      assert.equal((await db.query(`select superseded_by::text from facts where fact_id = $1`, [rounded])).rows[0].superseded_by, exact);
      const [publication] = await proofIdFor(legacy.accession);
      assert.deepEqual(chosen(await selectRevenue(db, legacy.issuerId, REFETCHED_AT)), { fact_id: exact, attestation_id: publication, public_by: REFETCHED_AT });
    }
  });

  await t.test("a stored companion fact the filing contradicts gains no proof", async () => {
    const { issuerId, cik, accession } = legacyIssuers[0];
    const withCapex = () => {
      const facts = companyFacts(accession);
      const capex = { start: "2023-01-01", end: "2023-12-31", val: 1000, val_token: "1000", accn: accession, fy: 2023, fp: "FY", form: "10-K", filed: "2024-01-10" };
      return { ...facts, cik, facts: { "us-gaap": { ...facts.facts["us-gaap"], PaymentsToAcquirePropertyPlantAndEquipment: { label: "", description: "", units: { USD: [capex] } } } } };
    };
    await db.query(
      `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                          value_num, unit, currency, scale, as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
       select 'issuer', $1, metric_id, 'fiscal_y', '2023-01-01', '2023-12-31', 2023, 'FY', 999, 'currency', 'USD', 1,
              $2, $2, $3, 'reported', 'authoritative', 'filing_time', 'full', 1
         from metrics where metric_key = 'capex'`,
      [issuerId, FETCHED_AT, accessionSourceId(accession)],
    );
    await refetch(issuerId, cik, accession, withCapex);
    assert.deepEqual(
      (await db.query(
        `select f.value_num::text as value, a.precision_class
           from facts f join metrics m on m.metric_id = f.metric_id
           left join fact_precision_attestations a on a.fact_id = f.fact_id
          where f.subject_id = $1 and m.metric_key = 'capex'`,
        [issuerId],
      )).rows,
      [{ value: "999", precision_class: null }],
    );
  });
});
