import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";

import { approveFactReview } from "../src/fact-repo.ts";
import { storeReleaseFigures } from "../src/release-figures.ts";
import { createEvidenceReviewServer } from "../src/review-http.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const REVIEWER = "00000000-0000-4000-8000-000000000001";
const QUOTE = "Non-GAAP gross margin is expected to be approximately 54%.";

// An AMD release whose non-GAAP margin guide was read as GAAP, queued as the
// extraction queues it.
async function seedQueuedGuide(client: Awaited<ReturnType<typeof connectedClient>>) {
  const ids = (await client.query<{ issuer_id: string; source_id: string; document_id: string; claim_id: string }>(
    `with issuer as (insert into issuers (legal_name, cik) values ('Advanced Micro Devices Inc', '0000002488') returning issuer_id),
          source as (insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id),
          doc as (insert into documents (source_id, kind, provider_doc_id, content_hash, raw_blob_id)
                  select source_id, 'filing', '0000002488-25-000106', 'h', 'b' from source returning document_id, source_id),
          claim as (insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, confidence, status)
                    select document_id, 'guidance.gross_margin', $1, 'neutral', 'quoted', source_id, 0.8, 'extracted' from doc returning claim_id)
     select issuer.issuer_id::text, source.source_id::text, doc.document_id::text, claim.claim_id::text from issuer, source, doc, claim`,
    [QUOTE],
  )).rows[0]!;
  await storeReleaseFigures(client, { documentId: ids.document_id, issuerId: ids.issuer_id, sourceId: ids.source_id, quarterEnd: "2025-06-28", filedOn: "2025-08-05" }, [
    { kind: "guidance", metric: "gross_margin", quote: QUOTE, claimId: ids.claim_id, raw: { basis: "gaap", value: "54%" }, read: { review: "its sentence does not state a GAAP figure" } },
  ]);
  const review = (await client.query<{ review_id: string; candidate: Record<string, unknown> }>(`select review_id::text, candidate from fact_review_queue`)).rows[0]!;
  return { ...ids, ...review };
}

async function reviewServer(t: test.TestContext, databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const server = createEvidenceReviewServer(pool, { auth: { mode: "dev_user_header", env: {} } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/evidence/fact-review-queue`;
  return (reviewId: string, path: "approve" | "reject" | "candidate", body: unknown) =>
    fetch(`${base}/${reviewId}/${path}`, {
      method: path === "candidate" ? "PATCH" : "POST",
      headers: { "content-type": "application/json", "x-user-id": REVIEWER },
      body: JSON.stringify(body),
    });
}

test("a queued release figure is listed with the fact candidates; approving it stores the figure the reviewer set, and audits it", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-figure-review");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedQueuedGuide(client);
  const send = await reviewServer(t, databaseUrl);

  // The sentence stays as queued: a reviewer sets only the basis, low and high.
  const moved = await send(seeded.review_id, "approve", { candidate: { ...seeded.candidate, quote: "Gross margin is 99%.", basis: "non_gaap", low: 54, high: 54 } });
  assert.equal(moved.status, 400);
  assert.match((await moved.json() as { error: string }).error, /quote stay as queued/);
  // A fact review never takes a figure's row.
  await assert.rejects(approveFactReview(client, { review_id: seeded.review_id, reviewer_id: REVIEWER }), /not found or is no longer queued/);

  const approved = await send(seeded.review_id, "approve", { candidate: { ...seeded.candidate, basis: "non_gaap", low: 54, high: 54 }, notes: "the sentence says non-GAAP" });
  assert.equal(approved.status, 200);
  const figures = (await client.query(`select figure_id::text, claim_id::text, kind, metric, basis, low::float8 as low, high::float8 as high, quote from earnings_release_figures`)).rows;
  assert.deepEqual(figures.map(({ figure_id: _id, ...figure }) => figure), [
    { claim_id: seeded.claim_id, kind: "guidance", metric: "gross_margin", basis: "non_gaap", low: 54, high: 54, quote: QUOTE },
  ]);
  assert.deepEqual(
    (await client.query(`select status, reviewed_by, release_figure_id::text, fact_id from fact_review_queue`)).rows,
    [{ status: "reviewed", reviewed_by: REVIEWER, release_figure_id: figures[0]!.figure_id, fact_id: null }],
  );
  assert.deepEqual(
    (await client.query(`select action, notes, candidate_before->>'basis' as before, candidate_after->>'basis' as after from fact_review_actions`)).rows,
    [{ action: "approved", notes: "the sentence says non-GAAP", before: null, after: "non_gaap" }],
  );
});

test("a queued release figure can be edited, staying queued, or rejected, storing nothing", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "release-figure-reject");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedQueuedGuide(client);
  const send = await reviewServer(t, databaseUrl);

  assert.equal((await send(seeded.review_id, "candidate", { candidate: { ...seeded.candidate, basis: "non_gaap", low: 54, high: 54 } })).status, 200);
  assert.deepEqual((await client.query(`select status, candidate->>'basis' as basis from fact_review_queue`)).rows, [{ status: "queued", basis: "non_gaap" }]);
  assert.equal((await send(seeded.review_id, "reject", { notes: "no guide" })).status, 200);
  assert.deepEqual((await client.query(`select status, release_figure_id from fact_review_queue`)).rows, [{ status: "dismissed", release_figure_id: null }]);
  assert.equal((await client.query(`select 1 from earnings_release_figures`)).rowCount, 0);
  assert.deepEqual((await client.query(`select action from fact_review_actions order by created_at`)).rows.map((row) => row.action), ["edited", "rejected"]);
});
