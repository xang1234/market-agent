import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResult } from "pg";

import { computeAndPersistCell } from "../src/cell-runner.ts";
import type { ColumnCatalogEntry } from "../src/column-catalog.ts";
import type { QueryExecutor } from "../src/types.ts";

// Docker-free unit tests for the cell runner's failure paths. The real seal
// round-trip is covered by cell-runner.test.ts (docker-pg); here we only need to
// drive the error branches with fakes.

type Captured = { text: string; values?: unknown[] };

function fakeDb(): { db: QueryExecutor; queries: Captured[] } {
  const queries: Captured[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      // updateCellResult fails fast on rowCount 0, so report one affected row.
      return { rows: [] as R[], rowCount: 1, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
  return { db, queries };
}

function column(producer: ColumnCatalogEntry["producer"]): ColumnCatalogEntry {
  return { column_key: "latest_market_cap", label: "X", kind: "deterministic", producer };
}

const INPUT = {
  gridRowId: "55555555-5555-4555-a555-555555555555",
  params: null,
  subject: { kind: "issuer" as const, id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" },
  period: null,
  asOf: "2026-06-09T00:00:00.000Z",
  userId: "ffffffff-ffff-4fff-afff-ffffffffffff",
};

function statusOf(queries: Captured[]): unknown {
  const update = queries.find((q) => q.text.startsWith("update grid_cells"));
  assert.ok(update, "expected an update grid_cells call");
  return (update.values ?? [])[2]; // $3 = status
}

test("persists 'error' when sealSnapshotWithPool throws", async () => {
  const { db, queries } = fakeDb();
  const pool = {
    async connect() {
      throw new Error("database is unavailable");
    },
  };
  const col = column(async () => ({
    status: "ok",
    display: { value: "$3.2T", tone: null },
    primaryRef: { kind: "fact", id: "77777777-7777-4777-a777-777777777777" },
    seal: {} as never, // truthy; the throwing pool short-circuits before it's used
  }));

  await computeAndPersistCell({ db, pool: pool as never }, { column: col, ...INPUT });

  assert.equal(statusOf(queries), "error");
});

test("persists 'error' when the producer throws", async () => {
  const { db, queries } = fakeDb();
  const pool = { async connect() { throw new Error("should not be reached"); } };
  const col = column(async () => {
    throw new Error("producer blew up");
  });

  await computeAndPersistCell({ db, pool: pool as never }, { column: col, ...INPUT });

  assert.equal(statusOf(queries), "error");
});
