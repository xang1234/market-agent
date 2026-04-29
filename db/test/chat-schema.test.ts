import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "./docker-pg.ts";

const initMigrationPath = join(import.meta.dirname, "..", "migrations", "0001_init.up.sql");
const forwardMigrationPath = join(
  import.meta.dirname,
  "..",
  "migrations",
  "0006_chat_messages_snapshot_not_null.up.sql",
);
const schemaPath = join(import.meta.dirname, "..", "..", "spec", "finance_research_db_schema.sql");

test("chat_messages baseline keeps historical nullable snapshot_id while normative schema requires it", () => {
  const initSql = readFileSync(initMigrationPath, "utf8");
  const initChatMessages = initSql.match(/create table chat_messages \((?<body>[\s\S]*?)\n\);/);
  assert.ok(initChatMessages?.groups?.body, "expected chat_messages table definition in init migration");
  assert.match(
    initChatMessages.groups.body,
    /snapshot_id uuid references snapshots\(snapshot_id\)/,
  );
  assert.doesNotMatch(
    initChatMessages.groups.body,
    /snapshot_id uuid not null references snapshots\(snapshot_id\)/,
  );

  const schemaSql = readFileSync(schemaPath, "utf8");
  const schemaChatMessages = schemaSql.match(/create table chat_messages \((?<body>[\s\S]*?)\n\);/);
  assert.ok(schemaChatMessages?.groups?.body, "expected chat_messages table definition in normative schema");
  assert.match(
    schemaChatMessages.groups.body,
    /snapshot_id uuid not null references snapshots\(snapshot_id\)/,
  );
});

test("forward migration upgrades existing chat_messages snapshot_id to not null", () => {
  const sql = readFileSync(forwardMigrationPath, "utf8");

  assert.match(sql, /chat_messages where snapshot_id is null/);
  assert.match(
    sql,
    /alter table chat_messages\s+alter column snapshot_id set not null/i,
  );
});

test("database rejects chat_messages without snapshot_id", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat message invariant integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-d7t");
  const client = await connectedClient(t, databaseUrl);
  const user = await client.query<{ user_id: string }>(
    "insert into users (email) values ($1) returning user_id",
    ["fra-d7t@example.test"],
  );
  const thread = await client.query<{ thread_id: string }>(
    "insert into chat_threads (user_id) values ($1) returning thread_id",
    [user.rows[0].user_id],
  );

  await assert.rejects(
    () =>
      client.query(
        `insert into chat_messages (thread_id, role, blocks, content_hash)
         values ($1, 'assistant', '[]'::jsonb, 'sha256:test')`,
        [thread.rows[0].thread_id],
      ),
    /null value in column "snapshot_id"|not-null/i,
  );
});
