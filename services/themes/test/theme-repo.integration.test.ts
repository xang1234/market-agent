import test from "node:test";
import assert from "node:assert/strict";

import { addThemeMembership } from "../src/theme-repo.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

const ISSUER_ID = "10000000-0000-4000-8000-000000000001";

test("addThemeMembership: concurrent inserts collapse to one row via the unique constraint (fra-4ut race fix)", { skip: !dockerAvailable() }, async (t) => {
  // The whole point of fra-4ut: without the unique constraint and ON CONFLICT
  // clause, two writers that race past the old select-before-insert both
  // succeed, producing duplicate (theme, subject) rows. With the constraint
  // in place, exactly one INSERT wins and the rest fall through to the
  // select fallback. We need true concurrency (separate connections) to
  // exercise this — a single client serialises statements.
  const { databaseUrl } = await bootstrapDatabase(t, "themes-race-test");

  const seedClient = await connectedClient(t, databaseUrl);
  const themeId = (
    await seedClient.query<{ theme_id: string }>(
      `insert into themes (name, membership_mode)
       values ('race-test theme', 'inferred')
       returning theme_id::text as theme_id`,
    )
  ).rows[0].theme_id;

  const concurrency = 10;
  const writers = await Promise.all(
    Array.from({ length: concurrency }, () => connectedClient(t, databaseUrl)),
  );
  const results = await Promise.all(
    writers.map((client) =>
      addThemeMembership(client, {
        theme_id: themeId,
        subject_ref: { kind: "issuer", id: ISSUER_ID },
        score: 0.5,
        rationale_claim_ids: [],
      }),
    ),
  );

  const createdCount = results.filter((r) => r.status === "created").length;
  const alreadyPresentCount = results.filter((r) => r.status === "already_present").length;
  assert.equal(createdCount, 1, "exactly one writer must report status=created");
  assert.equal(
    alreadyPresentCount,
    concurrency - 1,
    "every other writer must report status=already_present (none should error)",
  );

  const rowCount = (
    await seedClient.query<{ count: string }>(
      `select count(*)::text as count
         from theme_memberships
        where theme_id = $1::uuid and subject_kind = 'issuer' and subject_id = $2::uuid`,
      [themeId, ISSUER_ID],
    )
  ).rows[0].count;
  assert.equal(rowCount, "1", "schema must hold exactly one (theme, subject) row regardless of concurrency");

  // Every result resolves to the same theme_membership_id — the surviving
  // row. If the conflict-fallback select ever returned a stale or
  // unrelated row (e.g. from a different theme), this catches it.
  const membershipIds = new Set(results.map((r) => r.membership.theme_membership_id));
  assert.equal(membershipIds.size, 1, "all writers must point at the same surviving membership row");
});

test("addThemeMembership: sequential re-add against real pg returns already_present from the conflict-fallback select", { skip: !dockerAvailable() }, async (t) => {
  // Sanity check that the ON CONFLICT path round-trips correctly against
  // a real Postgres (not the mock from the unit tests). Catches regressions
  // where the conflict target column order or names drift between the
  // schema and the SQL string.
  const { databaseUrl } = await bootstrapDatabase(t, "themes-reidem-test");
  const client = await connectedClient(t, databaseUrl);
  const themeId = (
    await client.query<{ theme_id: string }>(
      `insert into themes (name, membership_mode) values ('idem theme', 'manual')
       returning theme_id::text as theme_id`,
    )
  ).rows[0].theme_id;

  const first = await addThemeMembership(client, {
    theme_id: themeId,
    subject_ref: { kind: "issuer", id: ISSUER_ID },
  });
  const second = await addThemeMembership(client, {
    theme_id: themeId,
    subject_ref: { kind: "issuer", id: ISSUER_ID },
  });

  assert.equal(first.status, "created");
  assert.equal(second.status, "already_present");
  assert.equal(
    second.membership.theme_membership_id,
    first.membership.theme_membership_id,
    "re-add must return the original row id, not mint a new one",
  );
});
