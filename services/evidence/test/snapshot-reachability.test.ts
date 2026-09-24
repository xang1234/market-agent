import assert from "node:assert/strict";
import test from "node:test";

import { snapshotHasCurrentReachability } from "../src/snapshot-reachability.ts";

const SNAPSHOT = "11111111-1111-4111-8111-111111111111";

test("snapshot reachability recognizes a discovery candidate alongside chat, analyze, grid, and thesis consumers", async () => {
  const queries: string[] = [];
  const db = {
    async query(text: string) {
      queries.push(text);
      return { rows: [{ reachable: true }], rowCount: 1 };
    },
  };
  assert.equal(await snapshotHasCurrentReachability(db, SNAPSHOT), true);
  const query = queries.join("\n");
  for (const table of ["chat_messages", "analyze_template_runs", "grid_cells", "agent_thesis_assessments", "discovery_candidates"]) {
    assert.match(query, new RegExp(table));
  }
});

test("snapshot reachability returns false only when every product consumer is absent", async () => {
  const db = { async query() { return { rows: [{ reachable: false }], rowCount: 1 }; } };
  assert.equal(await snapshotHasCurrentReachability(db, SNAPSHOT), false);
});
