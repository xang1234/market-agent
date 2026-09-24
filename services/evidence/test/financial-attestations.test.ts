import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import {
  FinancialAttestationError,
  normalizeContentHash,
  recordFactPrecisionAttestation,
  recordSourcePublicationAttestation,
  supersedeSourcePublicationAttestation,
} from "../src/financial-attestations.ts";
import { recordFactFinancialContext } from "../src/financial-context.ts";
import { financialDatabase, H, IDS, ORIGINAL_VALUE, publicationInput } from "./financial-fixtures.ts";

test("content hashes normalize to bare sha256 hex", () => {
  assert.equal(normalizeContentHash(`sha256:${H.v1}`), H.v1);
  assert.equal(normalizeContentHash(H.v1), H.v1);
  assert.equal(normalizeContentHash("md5:abc"), null);
  assert.equal(normalizeContentHash(null), null);
});

test("financial attestation writers", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial attestation coverage");
    return;
  }
  const db = await financialDatabase(t, "fin-attestations");

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
});
