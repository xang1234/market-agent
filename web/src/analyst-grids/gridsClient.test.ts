import test from "node:test";
import assert from "node:assert/strict";
import { fetchColumns, createRun, fetchRun } from "./gridsClient.ts";

const USER = "11111111-1111-4111-a111-111111111111";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("fetchColumns returns the catalog", async () => {
  const fetchImpl = async () => jsonResponse({ columns: [{ column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" }] });
  const columns = await fetchColumns({ userId: USER, fetchImpl });
  assert.equal(columns[0].column_key, "latest_market_cap");
});

test("createRun posts to the grid's runs route and returns the run id", async () => {
  let calledUrl = "";
  const fetchImpl = async (input: RequestInfo | URL) => {
    calledUrl = String(input);
    return jsonResponse({ run_id: "99999999-9999-4999-a999-999999999999", status: "pending" }, 202);
  };
  const result = await createRun({ userId: USER, gridId: "g1", fetchImpl });
  assert.match(calledUrl, /\/v1\/analyst-grids\/g1\/runs$/);
  assert.equal(result.status, "pending");
});

test("fetchRun returns run detail", async () => {
  const fetchImpl = async () => jsonResponse({ run: { grid_run_id: "r1", status: "completed", cell_total: 1, cell_done: 1, dropped_row_count: 0 }, rows: [], cells: [] });
  const detail = await fetchRun({ userId: USER, runId: "r1", fetchImpl });
  assert.equal(detail.run.status, "completed");
});
