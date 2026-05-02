import test from "node:test";
import assert from "node:assert/strict";

import { snapshotTransactionClient } from "../src/snapshot-sealer.ts";
import {
  bootstrapDatabase,
  connectedPool,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

// fra-asy regression: pg.PoolClient inherits .connect from pg.Client AND
// adds .release. The brand check used to misclassify it as a raw pool and
// reject the *WithPool callers that did exactly what the API asked for.
// Unit coverage simulates the shape via Object.assign; this test exercises
// the real pg surface so a future refactor that drifts the shape check
// (e.g. instanceof Pool, prototype probing) trips here against actual pg.
test(
  "snapshotTransactionClient accepts a client acquired from a real pg.Pool (fra-asy regression)",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "snapshot-sealer-fra-asy");
    const pool = await connectedPool(t, databaseUrl);
    const client = await pool.connect();
    try {
      assert.doesNotThrow(() => snapshotTransactionClient(client));
    } finally {
      client.release();
    }
  },
);
