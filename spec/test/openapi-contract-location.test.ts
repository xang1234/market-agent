import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("OpenAPI commodity contract tests are owned by the spec package, not services/shared", () => {
  const sharedContractTest = join(
    import.meta.dirname,
    "../../services/shared/test/openapi-commodities-contract.test.ts",
  );

  assert.equal(existsSync(sharedContractTest), false);
});
