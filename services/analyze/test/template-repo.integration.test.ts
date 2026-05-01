import test from "node:test";
import assert from "node:assert/strict";

import type { Client } from "pg";

import {
  AnalyzeTemplateNotFoundError,
  createAnalyzeTemplate,
  deleteAnalyzeTemplate,
  getAnalyzeTemplate,
  listAnalyzeTemplatesByUser,
  updateAnalyzeTemplate,
} from "../src/template-repo.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

const ISSUER_ID = "10000000-0000-4000-8000-000000000001";
const PEER_ID = "20000000-0000-4000-8000-000000000002";

async function seedUser(client: Client, email: string): Promise<string> {
  const { rows } = await client.query<{ user_id: string }>(
    `insert into users (email) values ($1) returning user_id::text as user_id`,
    [email],
  );
  return rows[0].user_id;
}

test(
  "analyze_templates: create / get / list / update / delete round-trip against real pg (fra-ast)",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "analyze-template-crud");
    const client = await connectedClient(t, databaseUrl);
    const userId = await seedUser(client, "fra-ast@example.com");

    // CREATE — defaults populated, version 1, jsonb fields round-trip.
    const created = await createAnalyzeTemplate(client, {
      user_id: userId,
      name: "Quarterly earnings memo",
      prompt_template: "Summarize the latest quarter for {subject}.",
      source_categories: ["financials_quarterly", "news"],
      added_subject_refs: [{ kind: "issuer", id: ISSUER_ID }],
      block_layout_hint: { sections: ["overview", "financials"] },
      peer_policy: { mode: "benchmark", max_peers: 5 },
    });
    assert.equal(created.version, 1);
    assert.equal(created.user_id, userId);
    assert.deepEqual([...created.source_categories], ["financials_quarterly", "news"]);
    assert.deepEqual([...created.added_subject_refs], [{ kind: "issuer", id: ISSUER_ID }]);
    assert.deepEqual(created.block_layout_hint, { sections: ["overview", "financials"] });
    assert.equal(created.disclosure_policy, null, "unspecified jsonb columns must default to SQL NULL");

    // GET — same row by id.
    const fetched = await getAnalyzeTemplate(client, created.template_id);
    assert.ok(fetched);
    assert.equal(fetched.template_id, created.template_id);
    assert.deepEqual([...fetched.added_subject_refs], [{ kind: "issuer", id: ISSUER_ID }]);

    // LIST — must scope by user. Seed a second user with a template that
    // must NOT appear in the first user's list (data-isolation invariant).
    const otherUserId = await seedUser(client, "other-user@example.com");
    await createAnalyzeTemplate(client, {
      user_id: otherUserId,
      name: "Other user's template",
      prompt_template: "irrelevant",
    });
    // Add a second template for the original user; verify alpha order.
    await createAnalyzeTemplate(client, {
      user_id: userId,
      name: "Aardvark scan",
      prompt_template: "irrelevant",
    });
    const myList = await listAnalyzeTemplatesByUser(client, userId);
    assert.equal(myList.length, 2, "list must NOT include other users' templates");
    assert.deepEqual(
      myList.map((r) => r.name),
      ["Aardvark scan", "Quarterly earnings memo"],
      "list must order by name asc",
    );

    // UPDATE — version bump is atomic; omitted fields preserved; specified
    // fields overwritten. Run twice to confirm the bump persists.
    const updated = await updateAnalyzeTemplate(client, created.template_id, {
      name: "Quarterly earnings memo (renamed)",
      added_subject_refs: [
        { kind: "issuer", id: ISSUER_ID },
        { kind: "issuer", id: PEER_ID },
      ],
    });
    assert.equal(updated.version, 2);
    assert.equal(updated.name, "Quarterly earnings memo (renamed)");
    assert.equal(updated.added_subject_refs.length, 2);
    // prompt_template was NOT in the patch — must be preserved verbatim.
    assert.equal(updated.prompt_template, created.prompt_template);
    // source_categories and block_layout_hint were also omitted.
    assert.deepEqual([...updated.source_categories], ["financials_quarterly", "news"]);
    assert.deepEqual(updated.block_layout_hint, { sections: ["overview", "financials"] });

    const updatedAgain = await updateAnalyzeTemplate(client, created.template_id, {
      prompt_template: "Updated prompt.",
    });
    assert.equal(updatedAgain.version, 3, "version must increment monotonically per update");

    // DELETE — succeeds, then a second delete throws not-found.
    await deleteAnalyzeTemplate(client, created.template_id);
    const afterDelete = await getAnalyzeTemplate(client, created.template_id);
    assert.equal(afterDelete, null);
    await assert.rejects(
      deleteAnalyzeTemplate(client, created.template_id),
      (err: Error) => err instanceof AnalyzeTemplateNotFoundError,
    );
  },
);

test(
  "analyze_templates: cascade delete from users wipes a user's templates (fra-ast)",
  { skip: !dockerAvailable() },
  async (t) => {
    // The schema declares ON DELETE CASCADE from analyze_templates.user_id
    // to users.user_id. Removing a user must remove their templates — both
    // for tenant cleanup and to prevent orphaned rows that the list query
    // (scoped by user_id) would never surface again.
    const { databaseUrl } = await bootstrapDatabase(t, "analyze-template-cascade");
    const client = await connectedClient(t, databaseUrl);
    const userId = await seedUser(client, "cascade-victim@example.com");

    await createAnalyzeTemplate(client, {
      user_id: userId,
      name: "Doomed template",
      prompt_template: "irrelevant",
    });

    await client.query("delete from users where user_id = $1::uuid", [userId]);

    const surviving = (
      await client.query<{ count: string }>(
        "select count(*)::text as count from analyze_templates where user_id = $1::uuid",
        [userId],
      )
    ).rows[0].count;
    assert.equal(surviving, "0", "ON DELETE CASCADE must wipe templates when the owner is deleted");
  },
);
