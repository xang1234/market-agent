import { authenticatedJson, type FetchImpl } from "../http/authFetch.ts";
import type { GridColumn, GridRunDetail } from "./gridsTypes.ts";

export async function fetchColumns(args: { userId: string; fetchImpl?: FetchImpl }): Promise<GridColumn[]> {
  const body = await authenticatedJson<{ columns: GridColumn[] }>("/v1/analyst-grids/columns", {
    userId: args.userId,
    fetchImpl: args.fetchImpl,
  });
  return body.columns;
}

export async function createRun(args: { userId: string; gridId: string; fetchImpl?: FetchImpl }): Promise<{ runId: string; status: "pending" }> {
  return authenticatedJson(`/v1/analyst-grids/${args.gridId}/runs`, {
    method: "POST",
    userId: args.userId,
    headers: { "content-type": "application/json" },
    body: "{}",
    fetchImpl: args.fetchImpl,
  });
}

export async function fetchRun(args: { userId: string; runId: string; fetchImpl?: FetchImpl }): Promise<GridRunDetail> {
  return authenticatedJson<GridRunDetail>(`/v1/analyst-grids/runs/${args.runId}`, {
    userId: args.userId,
    fetchImpl: args.fetchImpl,
  });
}

export type CreateGridBody = {
  name: string;
  universe_spec: unknown;
  column_specs: Array<{ column_key: string }>;
};

export async function createGrid(args: { userId: string; body: CreateGridBody; fetchImpl?: FetchImpl }): Promise<{
  grid_id: string;
  name: string;
  description: string | null;
  universe_spec: unknown;
  column_specs: ReadonlyArray<{ column_key: string }>;
  created_at: string;
  updated_at: string;
}> {
  return authenticatedJson<{
    grid_id: string;
    name: string;
    description: string | null;
    universe_spec: unknown;
    column_specs: ReadonlyArray<{ column_key: string }>;
    created_at: string;
    updated_at: string;
  }>("/v1/analyst-grids", {
    method: "POST",
    userId: args.userId,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args.body),
    fetchImpl: args.fetchImpl,
  });
}
