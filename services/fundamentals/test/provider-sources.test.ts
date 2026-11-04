import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID } from "../src/provider-sources.ts";

test("the Yahoo dev fundamentals source id names its own seeded source row (#448)", () => {
  const sourcesSql = readFileSync(new URL("../../../db/seed/sources.sql", import.meta.url), "utf8");

  assert.equal(YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID, "00000000-0000-4000-a000-000000000014");
  assert.match(
    sourcesSql,
    /\('00000000-0000-4000-a000-000000000014',\s*'yahoo_finance_dev_fundamentals',\s*'reference_data',\s*'https:\/\/finance\.yahoo\.com',\s*'tertiary',\s*'free_dev'/,
  );
});
