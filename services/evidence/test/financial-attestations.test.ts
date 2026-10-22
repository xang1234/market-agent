import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { hashCanonical } from "../../financial-core/src/canonical.ts";
import type { DerivationProofV1 } from "../../financial-core/src/contracts.ts";
import {
  FinancialAttestationError,
  recordFactPrecisionAttestation,
  recordSourcePublicationAttestation,
  supersedeSourcePublicationAttestation,
} from "../src/financial-attestations.ts";
import { recordFactFinancialContext } from "../src/financial-context.ts";
import { financialDatabase, H, IDS, ORIGINAL_VALUE, publicationInput } from "./financial-fixtures.ts";

test("financial attestation writers", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial attestation coverage");
    return;
  }
  const db = await financialDatabase(t, "fin-attestations");

  await t.test("content hashes normalize to bare sha256 hex in one database function", async () => {
    const normalized = (await db.query(
      `select normalized_content_hash($1) as prefixed, normalized_content_hash($2) as bare, normalized_content_hash('md5:abc') as other,
              normalized_content_hash(null) as missing`,
      [`sha256:${H.v1}`, H.v1],
    )).rows[0];
    assert.deepEqual(normalized, { prefixed: H.v1, bare: H.v1, other: null, missing: null });
  });

  await t.test("a publication proof must name the stored source version it attests", async () => {
    const row = await recordSourcePublicationAttestation(db, publicationInput());
    assert.equal(row.source_version_hash, H.v1);
    assert.equal(row.available_no_later_than, "2024-01-11T04:59:59.999Z");

    await assert.rejects(() => recordSourcePublicationAttestation(db, publicationInput({ source_version_hash: H.v2 })), /does not identify the stored source version/);
    await assert.rejects(
      () => recordSourcePublicationAttestation(db, publicationInput({ source_id: IDS.sourceV2, source_version_hash: H.v2, document_id: IDS.document })),
      /document does not belong/,
    );
    const withDocument = await recordSourcePublicationAttestation(db, publicationInput({ document_id: IDS.document }));
    assert.equal(withDocument.document_id, IDS.document);
  });

  await t.test("timing proofs are server-attested with real time zones and ordered bounds", async () => {
    await assert.rejects(() => recordSourcePublicationAttestation(db, publicationInput({ proof_method: "model_assertion" })), /proof_method/);
    await assert.rejects(() => recordSourcePublicationAttestation(db, publicationInput({ source_timezone: "Mars/Olympus" })), FinancialAttestationError);
    await assert.rejects(
      () => recordSourcePublicationAttestation(db, publicationInput({ available_not_before: "2024-01-12T00:00:00Z" })),
      /must not follow/,
    );
    await assert.rejects(() => recordSourcePublicationAttestation(db, publicationInput({ proof_hash: "short" })), /proof_hash/);
  });

  await t.test("a fixture_declaration proof attests only a golden fixture source", async () => {
    await assert.rejects(
      () => recordSourcePublicationAttestation(db, publicationInput({ proof_method: "fixture_declaration" })),
      /a fixture_declaration proof may only attest a golden_fixture source/,
    );
    const fixtureSource = "1f000000-0000-4000-8000-0000000000c4";
    const fixtureHash = "6".repeat(64);
    await db.query(
      `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash)
       values ($1, 'golden_fixture', 'filing', 'primary', 'internal', '2024-02-01T00:00:00Z', $2)`,
      [fixtureSource, `sha256:${fixtureHash}`],
    );
    const accepted = await recordSourcePublicationAttestation(
      db,
      publicationInput({ proof_method: "fixture_declaration", source_id: fixtureSource, source_version_hash: fixtureHash }),
    );
    const stored = (await db.query(`select proof_method from source_publication_attestations where attestation_id = $1`, [accepted.attestation_id])).rows[0];
    assert.equal(stored.proof_method, "fixture_declaration");
  });

  await t.test("corrections supersede the same source version and leave the original intact", async () => {
    const original = await recordSourcePublicationAttestation(db, publicationInput({ proof_ref: "original" }));
    const corrected = await supersedeSourcePublicationAttestation(
      db,
      original.attestation_id,
      publicationInput({ proof_ref: "corrected", available_no_later_than: "2024-01-09T23:59:59.999-05:00" }),
      "correction",
    );
    assert.equal(corrected.supersedes, original.attestation_id);
    assert.equal(corrected.supersession_reason, "correction");
    const stored = (await db.query(`select proof_ref from source_publication_attestations where attestation_id = $1`, [original.attestation_id])).rows[0];
    assert.equal(stored.proof_ref, "original");
    await assert.rejects(
      () => supersedeSourcePublicationAttestation(db, original.attestation_id, publicationInput({ source_id: IDS.sourceV2, source_version_hash: H.v2 }), "correction"),
      /same source version/,
    );
  });

  await t.test("precision proofs require the token to equal the stored value exactly", async () => {
    const proven = await recordFactPrecisionAttestation(db, {
      fact_id: IDS.original,
      precision_class: "source_token_preserved",
      raw_token: "3.83285000000123456789012345678e+11",
      token_proof_hash: H.proof,
      source_locator: "us-gaap:Revenues#FY2023",
      validation_method: "lossless_json_token",
    });
    assert.equal(proven.value_text, ORIGINAL_VALUE);
    assert.equal(proven.scale_text, "1");
    assert.equal(proven.source_id, IDS.sourceV1);
    assert.equal(proven.supersedes, null);

    await assert.rejects(
      () =>
        recordFactPrecisionAttestation(db, {
          fact_id: IDS.original,
          precision_class: "revalidated_against_source",
          raw_token: "383285000000.12",
          token_proof_hash: H.proof,
          source_locator: null,
          validation_method: "rounded_json_number",
        }),
      /does not equal the stored fact value/,
    );

    const legacy = await recordFactPrecisionAttestation(db, { fact_id: IDS.original, precision_class: "legacy_unverified", validation_method: "no_retained_bytes" });
    assert.equal(legacy.supersedes, proven.precision_attestation_id);
    assert.equal(legacy.raw_token, null);
  });

  await t.test("a derived proof is its own filing's term less terms that tile the rest of it, summing to the stored value, its other terms filed first (#481)", async () => {
    const q4 = "1f000000-0000-4000-8000-0000000000e1";
    await db.query(
      `insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                          value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                          freshness_class, coverage_level, entitlement_channels, confidence)
       values ($1, 'issuer', $2, $3, 'fiscal_q', '2022-10-01', '2022-12-31', 2022, 'Q4', 170, 'currency', 'USD', 1,
               '2023-01-10T00:00:00Z', '2023-01-10T00:00:00Z', '2023-02-01T00:00:00Z', $4, 'reported', 'authoritative', 'filing_time', 'full', '["app"]'::jsonb, 1)`,
      [q4, IDS.issuer, IDS.metric, IDS.sourceV1],
    );
    type Term = DerivationProofV1["terms"][number];
    const term = (sign: "+" | "-", fiscal_period: "FY" | "Q1" | "Q2" | "Q3", start: string, end: string, raw_token: string, filed: string): Term => ({
      sign,
      span: fiscal_period === "FY" ? "fiscal_year" : "quarter",
      fiscal_year: 2022,
      fiscal_period,
      start,
      end,
      raw_token,
      token_proof_hash: H.proof,
      source: { source_id: fiscal_period === "FY" ? IDS.sourceV1 : IDS.sourceV2, accession: `0000320193-${filed}`, form: fiscal_period === "FY" ? "10-K" : "10-Q", filed, locator: `us-gaap:Revenues#${fiscal_period}` },
    });
    const derivation = (terms: Term[]) => ({ version: "period_difference.v1" as const, concept: "Revenues", unit: "USD", terms });
    const fy = term("+", "FY", "2022-01-01", "2022-12-31", "6.2E2", "2023-01-10");
    const q1 = term("-", "Q1", "2022-01-01", "2022-03-31", "140", "2022-05-01");
    const q2 = term("-", "Q2", "2022-04-01", "2022-06-30", "150", "2022-08-01");
    const q3 = term("-", "Q3", "2022-07-01", "2022-09-30", "160", "2022-11-01");
    const proven = derivation([fy, q1, q2, q3]);
    const record = (proof: ReturnType<typeof derivation>) =>
      recordFactPrecisionAttestation(db, { fact_id: q4, precision_class: "derived_from_source_tokens", derivation: proof, source_locator: "us-gaap:Revenues#Q4", validation_method: "test" });
    const lastYear = (t: Term): Term => ({ ...t, fiscal_year: 2021, start: t.start.replace("2022", "2021"), end: t.end.replace("2022", "2021") });

    await assert.rejects(() => record(derivation([fy, q1, q2, { ...q3, raw_token: "161" }])), /does not sum to the stored fact value/);
    await assert.rejects(() => record(derivation([fy, q1, q2, { ...q3, source: { ...q3.source, filed: "2023-01-10" } }])), /filed on or after the fact's own filing/);
    await assert.rejects(() => record(derivation([{ ...fy, source: { ...fy.source, source_id: IDS.privateSource } }, q1, q2, q3])), /adds exactly one term, its first, from the fact's own source/);
    await assert.rejects(() => record(derivation([fy, q1, q2, { ...q3, raw_token: "0x85" }])), /not a period_difference\.v1 proof/);
    await assert.rejects(() => record(derivation([fy, q1, q2, { ...q3, token_proof_hash: "short" }])), /not a period_difference\.v1 proof/);
    await assert.rejects(() => record(derivation([fy, q1, q2, { ...q3, span: "year_to_date", start: "2022-01-01" }])), /do not cover its first term exactly/, "Q1 and Q2 subtracted twice");
    await assert.rejects(() => record(derivation([fy, q1, term("-", "Q2", "2022-04-01", "2022-06-30", "310", "2022-08-01")])), /do not cover its first term exactly/, "a gap before the fact's start");
    await assert.rejects(() => record(derivation([fy, q1, q2, q3].map(lastYear))), /adds exactly one term, its first/, "every term a year early");
    await assert.rejects(() => record(derivation([fy, q1, q2, q3].map((t) => ({ ...t, fiscal_year: 2021 })))), /not of the fact's fiscal year/);
    await assert.rejects(
      () => record(derivation([{ ...term("-", "Q1", "2022-01-01", "2022-03-31", "-100", "2023-01-10"), source: { ...fy.source } }, term("+", "Q2", "2022-04-01", "2022-06-30", "70", "2022-08-01")])),
      /adds exactly one term, its first/,
      "the own term subtracted",
    );

    const row = await record(proven);
    assert.deepEqual(
      [row.precision_class, row.raw_token, row.value_text, row.scale_text, row.source_locator, row.derivation, row.supersedes],
      ["derived_from_source_tokens", "170", "170", "1", "us-gaap:Revenues#Q4", proven, null],
    );
    assert.equal(row.token_proof_hash, hashCanonical("derivation", proven), "the proof hash binds the whole derivation");
    const stored = (await db.query(`select derivation from current_fact_precision_attestations where fact_id = $1`, [q4])).rows[0];
    assert.deepEqual(stored.derivation, proven);
  });

  await t.test("financial contexts are recorded once per fact", async () => {
    const context = {
      fact_id: IDS.fy2022,
      context_version: "context.v1",
      period_type: "duration" as const,
      dimension_scope: "consolidated" as const,
      dimension_members: [],
      reporting_basis: "as_reported" as const,
      adjustment_basis: "unadjusted" as const,
      share_basis: "not_applicable" as const,
      fiscal_calendar_version: "fiscal-calendar.v1",
      disclosure_relation: "original" as const,
      source_context_ref: "FY2022",
    };
    await recordFactFinancialContext(db, context);
    await assert.rejects(() => recordFactFinancialContext(db, context), /duplicate key/);
    await assert.rejects(() => recordFactFinancialContext(db, { ...context, fact_id: IDS.original, reporting_basis: "guessed" as "as_reported" }), /reporting_basis/);
  });

  await t.test("an as-filed context names a real filing date, and no other context names one", async () => {
    const asFiled = {
      fact_id: IDS.original,
      context_version: "context.v1",
      period_type: "duration" as const,
      dimension_scope: "consolidated" as const,
      dimension_members: [],
      reporting_basis: "as_reported" as const,
      adjustment_basis: "as_filed" as const,
      as_filed_on: "2024-02-21",
      share_basis: "diluted" as const,
      fiscal_calendar_version: "fiscal-calendar.v1",
      disclosure_relation: "original" as const,
      source_context_ref: null,
    };
    await assert.rejects(() => recordFactFinancialContext(db, { ...asFiled, as_filed_on: "2024-02-30" }), /as_filed_on/);
    // A caller outside the type system can still pair a date with another basis.
    await assert.rejects(() => recordFactFinancialContext(db, { ...asFiled, adjustment_basis: "unadjusted" } as never), /as_filed_on/);
    await recordFactFinancialContext(db, asFiled);
    const stored = (await db.query(`select adjustment_basis, as_filed_on::text as as_filed_on, share_basis from fact_financial_contexts where fact_id = $1`, [IDS.original])).rows[0];
    assert.deepEqual(stored, { adjustment_basis: "as_filed", as_filed_on: "2024-02-21", share_basis: "diluted" });
  });
});
