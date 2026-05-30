import assert from "node:assert/strict";
import test from "node:test";

import {
  AnalyzeRunMetadataError,
  parseAnalyzeRunMetadata,
  serializeAnalyzeRunMetadataV1,
} from "../src/runMetadata.ts";

test("serializeAnalyzeRunMetadataV1 records schema version and resolved inputs", () => {
  const metadata = serializeAnalyzeRunMetadataV1({
    template_id: "11111111-1111-4111-8111-111111111111",
    template_version: 3,
    playbook_id: "earnings_quality",
    playbook_version: 1,
    instructions: "Focus on cash conversion.",
    source_categories: ["filings"],
    subject_refs: [{ kind: "issuer", id: "22222222-2222-4222-8222-222222222222" }],
  });

  assert.equal(metadata.schema_version, 1);
  assert.equal(metadata.template_version, 3);
  assert.deepEqual(metadata.source_categories, ["filings"]);
});

test("parseAnalyzeRunMetadata accepts schema v1 and rejects unsupported versions", () => {
  const metadata = parseAnalyzeRunMetadata({
    schema_version: 1,
    template_id: "11111111-1111-4111-8111-111111111111",
    template_version: 1,
    playbook_id: "earnings_quality",
    playbook_version: 1,
    instructions: "Focus on cash conversion.",
    source_categories: ["filings"],
    subject_refs: [],
  });
  assert.equal(metadata.schema_version, 1);

  assert.throws(
    () => parseAnalyzeRunMetadata({ schema_version: 2 }),
    AnalyzeRunMetadataError,
  );
});
