import assert from "node:assert/strict";
import test from "node:test";

import { fetchEvidenceInspection } from "./inspectionClient.ts";

test("fetchEvidenceInspection requests the normalized inspect endpoint", async () => {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const result = await fetchEvidenceInspection({
    userId: "00000000-0000-4000-8000-000000000001",
    snapshotId: "11111111-1111-4111-8111-111111111111",
    ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
    fetchImpl: async (input, init) => {
      calls.push(String(input));
      assert.equal((init?.headers as Record<string, string>)["x-user-id"], "00000000-0000-4000-8000-000000000001");
      assert.equal((init?.headers as Record<string, string>)["content-type"], "application/json");
      assert.equal(init?.method, "POST");
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        snapshot_id: "11111111-1111-4111-8111-111111111111",
        ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
        kind: "source",
        title: "sec filing",
        subtitle: null,
        badges: ["primary"],
        rows: [{ label: "Provider", value: "sec" }],
        links: [],
        related_refs: [],
      }), { status: 200 });
    },
  });

  assert.equal(calls[0], "/v1/evidence/inspect");
  assert.deepEqual(bodies[0], {
    snapshot_id: "11111111-1111-4111-8111-111111111111",
    ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
  });
  assert.equal(result.title, "sec filing");
});
