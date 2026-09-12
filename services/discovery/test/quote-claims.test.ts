import assert from "node:assert/strict";
import test from "node:test";

import { canonicalCampaignQuotes } from "../src/quote-claims.ts";
import { analystFixture, packetFixture } from "./fixtures.ts";

test("exact excerpt quotes carry the canonical document offset, source, and hash", () => {
  const packet = packetFixture();
  packet.excerpts[0] = { ...packet.excerpts[0]!, normalized_start: 140 };
  const quote = "company sells grid modernization equipment.";
  const role = analystFixture();
  role.exposure = {
    ...role.exposure,
    citations: [{ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote }],
  };

  assert.deepEqual(canonicalCampaignQuotes(role, packet), [{
    excerpt_id: packet.excerpts[0]!.excerpt_id,
    document_id: packet.excerpts[0]!.document_id,
    source_id: packet.excerpts[0]!.source_id,
    document_hash: packet.excerpts[0]!.document_hash,
    normalized_start: 144,
    quote,
  }]);
});

test("an excerpt quote with multiple source locations is rejected as ambiguous", () => {
  const packet = packetFixture();
  packet.excerpts[0] = { ...packet.excerpts[0]!, text: "The same exact quoted phrase appears. The same exact quoted phrase appears." };
  const role = analystFixture();
  role.exposure = {
    ...role.exposure,
    citations: [{ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote: "The same exact quoted phrase appears." }],
  };

  assert.throws(() => canonicalCampaignQuotes(role, packet), /ambiguous/i);
});
