import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadMigrationFiles } from "../scripts/schema-support.ts";

test("loadMigrationFiles rejects incomplete migration pairs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fra-6al-7-2-incomplete-"));
  await writeFile(join(dir, "0001_init.up.sql"), "select 1;");

  await assert.rejects(
    () => loadMigrationFiles(dir),
    /Migration pair is incomplete for version 0001/,
  );
});

test("loadMigrationFiles rejects duplicate version names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fra-6al-7-2-duplicate-"));
  await writeFile(join(dir, "0001_init.up.sql"), "select 1;");
  await writeFile(join(dir, "0001_init.down.sql"), "select 1;");
  await writeFile(join(dir, "0001_other.up.sql"), "select 1;");
  await writeFile(join(dir, "0001_other.down.sql"), "select 1;");

  await assert.rejects(
    () => loadMigrationFiles(dir),
    /Duplicate migration version 0001/,
  );
});

test("loadMigrationFiles rejects unexpected sql filenames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fra-6al-7-2-unexpected-"));
  await writeFile(join(dir, "0001_init.up.sql"), "select 1;");
  await writeFile(join(dir, "0001_init.down.sql"), "select 1;");
  await writeFile(join(dir, "0002_broken.sql"), "select 1;");

  await assert.rejects(
    () => loadMigrationFiles(dir),
    /Unexpected SQL file in migrations directory: 0002_broken\.sql/,
  );
});
