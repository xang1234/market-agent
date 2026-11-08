// Every hash a v1 plan's seal certifies, pinned as computed before plan v2
// (#201). A change to lineage, plan identity, or presentation that moves any
// of them would make existing sealed answers fail replay.

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
    certificate_digest: "12837091f0171377b097653e001887ae9553238ee3584e78a38f7b58c6691d8b",
    presentation: ["financial-presentation.v2", "97bf55f232f75250a8e39b64bd0b4594ea2c573e50ec42faccad98f6ad36126c"],
  },
  operating_margin: {
    plan_semantic_hash: "c3393f994e4492f48251381ae670522f0c42a990bbe6a7df02ed8c77e274fb3b",
    input_refs: "eda026d89b92522bac2deb0810d0d7d1ab75ed270d8907d6e04ab67e33a48532",
    certificate_digest: "8e8d919ee7f92ac6b6eb3873f8174525b9ae08ae1ef8da240efe693f7a17ad97",
    presentation: ["financial-presentation.v2", "174ce7fdc4fa06ab7e6fb7c7041ad67ed5ce41562d984450316c11d4e699c96f"],
  },
  free_cash_flow: {
    plan_semantic_hash: "1b4a9aac1d39792b1159b4463d8f56cefd1f068264e26b155f517fec446ba60a",
    input_refs: "96032f0691ddd45a49de0f30725f6c843d3b44377d32632e4a7385799fd99a7b",
    certificate_digest: "506246d18267c65ddcf0f39c09045f519bc82b55eaf95d0ac4f84f9f737e9f90",
    presentation: ["financial-presentation.v2", "56c51a9c039134e8a2c025135afd2740be5eb0c40eb548f3ba2b2434d08c6278"],
  },
};
