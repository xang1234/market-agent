import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationPath = join(import.meta.dirname, "..", "migrations", "0001_init.up.sql");

test("chat_messages requires snapshot_id for every persisted message", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const chatMessages = sql.match(/create table chat_messages \((?<body>[\s\S]*?)\n\);/);

  assert.ok(chatMessages?.groups?.body, "expected chat_messages table definition");
  assert.match(
    chatMessages.groups.body,
    /snapshot_id uuid not null references snapshots\(snapshot_id\)/,
  );
});
