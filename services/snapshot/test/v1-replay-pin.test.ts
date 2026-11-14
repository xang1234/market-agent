// Every hash a v1 plan's seal certifies, pinned as computed before plan v2
// (#201). A change to lineage or plan identity that moves one would make
// existing sealed answers fail replay. The presentation hash and the
// certificate digest over it move only with a deliberate change to what an
// answer shows: replay compares result hashes, and a stored answer keeps the
// block and hash it was sealed with. These moved when amounts of a million or
// more began reading at their scale ("$383.3B").

import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, hashCanonical } from "../../financial-core/src/index.ts";
import { verifyFinancialUnit } from "../src/financial-verifier.ts";
import { FREE_CASH_FLOW, GROSS_MARGIN, OPERATING_MARGIN, SEAL_CONTEXT, validRecords, type FixtureCalculation } from "./financial-fixtures.ts";

function sealed(calculation: FixtureCalculation) {
  const records = validRecords(calculation);
  const outcome = verifyFinancialUnit(records, "section", SEAL_CONTEXT);
  assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failures));
  return {
    plan_semantic_hash: outcome.certificate.run.plan_semantic_hash,
    input_refs: hashCanonical("computation", records.computations.map((row) => row.input_refs)),
    certificate_digest: outcome.certificate_digest,
    presentation: [outcome.block.financial.presentation_version, outcome.certificate.presentation.hash],
  };
}

test("v1 seals keep the hashes they were certified with", () => {
  assert.equal(canonicalJson(Object.fromEntries([GROSS_MARGIN, OPERATING_MARGIN, FREE_CASH_FLOW].map((calculation) => [calculation.node.operation, sealed(calculation)]))), canonicalJson(PINNED));
});

const PINNED = {
  gross_margin: {
    plan_semantic_hash: "da4ba73536393bf24a1e80c7f2533c79e0bb5adfe4ed891cd32aed10197fc8b9",
    input_refs: "a616a386cead1fe351a04a67a83179521098bc1fd1c80a4f048096e59ee80db5",
    certificate_digest: "4a586c5382dbfe896be09dffbff8c01a5cf2bba8b5f3726cdd35b197bb65c0ec",
    presentation: ["financial-presentation.v2", "a71def7746c73d71f2853c94a774ea07400a56989fdad07533274bc714443391"],
  },
  operating_margin: {
    plan_semantic_hash: "c3393f994e4492f48251381ae670522f0c42a990bbe6a7df02ed8c77e274fb3b",
    input_refs: "eda026d89b92522bac2deb0810d0d7d1ab75ed270d8907d6e04ab67e33a48532",
    certificate_digest: "583cffe48fe349fd79b4e0582220eeaf43dd9e7b9417616423e9adedec180eb3",
    presentation: ["financial-presentation.v2", "ecec96606b2596db85d5dd923146cde38c7ba485904bb69facf1bc241643376f"],
  },
  free_cash_flow: {
    plan_semantic_hash: "1b4a9aac1d39792b1159b4463d8f56cefd1f068264e26b155f517fec446ba60a",
    input_refs: "96032f0691ddd45a49de0f30725f6c843d3b44377d32632e4a7385799fd99a7b",
    certificate_digest: "4f9b04c8f739a1b13e03837a37b2d7bee90858425b7c8bac6ab71a509b7639d8",
    presentation: ["financial-presentation.v2", "5b5529c2450eae4e36888941b0bedac845542ac52f366f75ada73b8e2a3183e1"],
  },
};
