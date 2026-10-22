import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import {
  recordFactPrecisionAttestation,
  recordSourcePublicationAttestation,
  supersedeSourcePublicationAttestation,
} from "../src/financial-attestations.ts";
import { recordFactFinancialContext } from "../src/financial-context.ts";
import { listFinancialInputCandidates, type FinancialCandidateRequest } from "../src/financial-input-repo.ts";
import { financialDatabase, H, IDS, ORIGINAL_VALUE, publicationInput } from "./financial-fixtures.ts";

function request(overrides: Partial<FinancialCandidateRequest> = {}): FinancialCandidateRequest {
  return {
    user_id: IDS.owner,
    channel: "app",
    scope: "public_information",
    subject: { kind: "issuer", id: IDS.issuer },
    metric_key: "revenue",
    fiscal_year: null,
    fiscal_period: null,
    limit: 100,
    ...overrides,
  };
}

test("financial input candidates", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial input coverage");
    return;
  }
  const db = await financialDatabase(t, "fin-input-repo");

  await t.test("only promoted, entitled, valid reported or extracted facts are candidates", async () => {
    const page = await listFinancialInputCandidates(db, request());
    assert.deepEqual(page.candidates.map((candidate) => candidate.fact_id).sort(), [IDS.original, IDS.restated, IDS.fy2022].sort());
    assert.equal(page.truncated, false);
  });

  await t.test("numerics stay exact text and superseded originals remain available", async () => {
    const original = (await listFinancialInputCandidates(db, request())).candidates.find((candidate) => candidate.fact_id === IDS.original)!;
    assert.equal(original.value_text, ORIGINAL_VALUE);
    assert.equal(original.scale_text, "1");
    assert.equal(original.superseded_by, IDS.restated);
    assert.equal(original.source_version_hash, H.v1);
    assert.equal(original.source_kind, "filing");
    assert.equal(original.reported_at, "2024-01-10T00:00:00.000Z");
  });

  await t.test("private facts need owner-visible scope and the owner's identity", async () => {
    const owner = await listFinancialInputCandidates(db, request({ scope: "owner_visible" }));
    assert.equal(owner.candidates.find((candidate) => candidate.fact_id === IDS.privateFact)?.source_kind, "upload");
    const other = await listFinancialInputCandidates(db, request({ scope: "owner_visible", user_id: IDS.other }));
    assert.ok(!other.candidates.some((candidate) => candidate.fact_id === IDS.privateFact));
  });

  await t.test("an inaccessible subject is indistinguishable from an unknown one", async () => {
    const probe = await listFinancialInputCandidates(db, request({ scope: "owner_visible", user_id: IDS.other, subject: { kind: "issuer", id: IDS.privateOnlyIssuer } }));
    const unknown = await listFinancialInputCandidates(db, request({ subject: { kind: "issuer", id: "1f000000-0000-4000-8000-0000000000ff" } }));
    assert.deepEqual(probe, { candidates: [], truncated: false });
    assert.deepEqual(unknown, probe);
    const owner = await listFinancialInputCandidates(db, request({ scope: "owner_visible", subject: { kind: "issuer", id: IDS.privateOnlyIssuer } }));
    assert.equal(owner.candidates.length, 1);
  });

  await t.test("period filters and limits disclose truncation", async () => {
    const fy2022 = await listFinancialInputCandidates(db, request({ fiscal_year: 2022, fiscal_period: "FY" }));
    assert.deepEqual(fy2022.candidates.map((candidate) => candidate.fact_id), [IDS.fy2022]);
    const capped = await listFinancialInputCandidates(db, request({ limit: 2 }));
    assert.equal(capped.candidates.length, 2);
    assert.equal(capped.truncated, true);
    await assert.rejects(() => listFinancialInputCandidates(db, request({ limit: 10_001 })), RangeError);
  });

  await t.test("publication proofs attach only to the matching, current, undeleted source version", async () => {
    const onDocument = await recordSourcePublicationAttestation(db, publicationInput({ document_id: IDS.document, proof_ref: "doc" }));
    const replaced = await recordSourcePublicationAttestation(db, publicationInput({ proof_ref: "first" }));
    const correction = await supersedeSourcePublicationAttestation(db, replaced.attestation_id, publicationInput({ proof_ref: "second" }), "correction");
    const proofsFor = async (factId: string) =>
      (await listFinancialInputCandidates(db, request())).candidates.find((candidate) => candidate.fact_id === factId)!.publication;

    const original = await proofsFor(IDS.original);
    assert.deepEqual(original.map((proof) => proof.attestation_id).sort(), [onDocument.attestation_id, correction.attestation_id].sort());
    assert.equal(original[0]!.available_no_later_than, "2024-01-11T04:59:59.999Z");
    assert.deepEqual(await proofsFor(IDS.restated), []);

    await db.query(`update documents set deleted_at = now() where document_id = $1`, [IDS.document]);
    assert.deepEqual((await proofsFor(IDS.original)).map((proof) => proof.attestation_id), [correction.attestation_id]);
  });

  await t.test("a proof of a document's own version is not a proof of its source's, so it is not a candidate's (#320 review)", async () => {
    const exhibit = "1f000000-0000-4000-8000-0000000000e2";
    const exhibitHash = "6".repeat(64);
    await db.query(
      `insert into documents (document_id, source_id, kind, content_hash, raw_blob_id) values ($1, $2, 'filing', $3, $3)`,
      [exhibit, IDS.sourceV1, `sha256:${exhibitHash}`],
    );
    const onExhibit = await recordSourcePublicationAttestation(db, publicationInput({ document_id: exhibit, source_version_hash: exhibitHash, proof_ref: "exhibit" }));
    const original = (await listFinancialInputCandidates(db, request())).candidates.find((candidate) => candidate.fact_id === IDS.original)!;
    assert.equal(original.publication.some((proof) => proof.attestation_id === onExhibit.attestation_id), false);
    assert.equal(original.source_version_hash, H.v1);
  });

  await t.test("the latest precision proof and the financial context are returned", async () => {
    await recordFactPrecisionAttestation(db, { fact_id: IDS.original, precision_class: "legacy_unverified", validation_method: "no_retained_bytes" });
    const proven = await recordFactPrecisionAttestation(db, {
      fact_id: IDS.original,
      precision_class: "revalidated_against_source",
      raw_token: ORIGINAL_VALUE,
      token_proof_hash: H.proof,
      source_locator: "us-gaap:Revenues",
      validation_method: "retained_bytes",
    });
    await recordFactFinancialContext(db, {
      fact_id: IDS.original,
      context_version: "context.v1",
      period_type: "duration",
      dimension_scope: "consolidated",
      dimension_members: [],
      reporting_basis: "as_reported",
      adjustment_basis: "unadjusted",
      share_basis: "not_applicable",
      fiscal_calendar_version: "fiscal-calendar.v1",
      disclosure_relation: "original",
      source_context_ref: null,
    });
    const original = (await listFinancialInputCandidates(db, request())).candidates.find((candidate) => candidate.fact_id === IDS.original)!;
    assert.equal(original.precision?.precision_attestation_id, proven.precision_attestation_id);
    assert.equal(original.precision?.precision_class, "revalidated_against_source");
    assert.equal(original.precision?.derivation, null);
    assert.equal(original.context?.disclosure_relation, "original");
    const restated = (await listFinancialInputCandidates(db, request())).candidates.find((candidate) => candidate.fact_id === IDS.restated)!;
    assert.equal(restated.precision, null);
    assert.equal(restated.context, null);
  });

  await t.test("an as-filed context carries its filing date, and no other context names one", async () => {
    await recordFactFinancialContext(db, {
      fact_id: IDS.fy2022,
      context_version: "context.v1",
      period_type: "duration",
      dimension_scope: "consolidated",
      dimension_members: [],
      reporting_basis: "as_reported",
      adjustment_basis: "as_filed",
      as_filed_on: "2024-02-21",
      share_basis: "diluted",
      fiscal_calendar_version: "fiscal-calendar.v1",
      disclosure_relation: "original",
      source_context_ref: null,
    });
    const candidates = (await listFinancialInputCandidates(db, request())).candidates;
    const asFiled = candidates.find((candidate) => candidate.fact_id === IDS.fy2022)!.context;
    assert.deepEqual([asFiled?.adjustment_basis, asFiled?.as_filed_on, asFiled?.share_basis], ["as_filed", "2024-02-21", "diluted"]);
    const unadjusted = candidates.find((candidate) => candidate.fact_id === IDS.original)!.context!;
    assert.deepEqual([unadjusted.adjustment_basis, "as_filed_on" in unadjusted], ["unadjusted", false]);
  });

  await t.test("a derived value's proof is returned with its derivation, and its raw token is the derivation's sum (#481)", async () => {
    const term = (sign: "+" | "-", fiscal_period: "FY" | "Q3", source_id: string, filed: string, raw_token: string) => ({
      sign, span: fiscal_period === "FY" ? ("fiscal_year" as const) : ("year_to_date" as const), fiscal_year: 2022, fiscal_period,
      start: "2022-01-01", end: fiscal_period === "FY" ? "2022-12-31" : "2022-09-30", raw_token, token_proof_hash: H.proof,
      source: { source_id, accession: `acc-${fiscal_period}`, form: fiscal_period === "FY" ? "10-K" : "10-Q", filed, locator: `loc-${fiscal_period}` },
    });
    const derivation = { version: "period_difference.v1" as const, concept: "Revenues", unit: "USD",
      terms: [term("+", "FY", IDS.sourceV1, "2023-01-10", "400000000000"), term("-", "Q3", IDS.sourceV2, "2022-11-01", "34183000000")] };
    await recordFactPrecisionAttestation(db, { fact_id: IDS.fy2022, precision_class: "derived_from_source_tokens", derivation, source_locator: "loc-Q4", validation_method: "test" });
    const derived = (await listFinancialInputCandidates(db, request())).candidates.find((candidate) => candidate.fact_id === IDS.fy2022)!;
    assert.deepEqual([derived.precision?.precision_class, derived.precision?.raw_token, derived.precision?.source_locator, derived.precision?.derivation],
      ["derived_from_source_tokens", "365817000000", "loc-Q4", derivation]);
  });
});
