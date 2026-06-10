import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResult } from "pg";
import type { GridColumnContext, GridColumnProducer } from "../src/column-catalog.ts";
import { computeAndPersistCell } from "../src/cell-runner.ts";
import type { QueryExecutor } from "../src/types.ts";

test("cell runner passes column params and reader deps to the producer", async () => {
  let seenParams: unknown = "unset";
  let seenReader: unknown = "unset";
  const producer: GridColumnProducer = async (deps, ctx: GridColumnContext) => {
    seenParams = ctx.params;
    seenReader = deps.reader;
    return { status: "missing_data", display: { value: "—", tone: null } };
  };
  const fakeDb: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      return { rows: [] as R[], rowCount: 1, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
  const fakeReader = { llm: { complete: async () => ({ text: "" }) }, loadDocumentText: async () => null };
  await computeAndPersistCell(
    { db: fakeDb, pool: { connect: async () => { throw new Error("unused"); } }, reader: fakeReader },
    {
      column: { column_key: "x", label: "X", kind: "reader", producer },
      params: { prompt: "Any China exposure?" },
      gridRowId: "11111111-1111-4111-8111-111111111111",
      subject: { kind: "issuer", id: "22222222-2222-4222-8222-222222222222" },
      period: null,
      asOf: "2026-06-10T00:00:00Z",
    },
  );
  assert.deepEqual(seenParams, { prompt: "Any China exposure?" });
  assert.equal(seenReader, fakeReader);
});
