import test from "node:test";
import assert from "node:assert/strict";
import { DELAY_CLASSES } from "../../market/src/quote.ts";
import { DELAY_CLASSES_FOR_SCREENER } from "../src/fields.ts";

// The screener re-states the market service's DELAY_CLASSES so that
// `services/screener/src/fields.ts` doesn't have to cross the package
// boundary. That's only safe if the two stay byte-for-byte identical —
// otherwise a typo (e.g. `realtime` vs `real_time`) silently rejects
// valid quotes at the screener boundary while market still accepts them.
test("DELAY_CLASSES_FOR_SCREENER mirrors market.DELAY_CLASSES exactly", () => {
  assert.deepEqual([...DELAY_CLASSES_FOR_SCREENER], [...DELAY_CLASSES]);
});
