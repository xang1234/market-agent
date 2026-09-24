import assert from "node:assert/strict";
import test from "node:test";

import { chooseResearchCohort } from "../src/cohort.ts";
import type { DiscoveredCandidate } from "../src/types.ts";
import { briefFixture, identityFixture } from "./fixtures.ts";

function leadFixture(index: number, options: { mechanism: number }): DiscoveredCandidate {
  const suffix = (index + 1).toString(16).padStart(12, "0");
  const brief = briefFixture();
  return {
    candidate_id: `90000000-0000-4000-8000-${suffix}`,
    lead_key: `candidate-${index + 1}`,
    name: `Candidate ${index + 1}`,
    identity: identityFixture(index),
    origins: ["web"],
    mechanism_ids: [brief.mechanisms[options.mechanism]!.mechanism_id],
    seed: false,
    primary_domain_lead: false,
    first_seen: [Math.floor(index / 10), index % 10],
    lead_hit_ids: [],
    reason_codes: [],
  };
}

test("research cohort is stable and fairly round-robins resolved mechanisms", () => {
  const pool = Array.from({ length: 30 }, (_, index) => leadFixture(index, { mechanism: index % 2 }));

  const first = chooseResearchCohort(briefFixture(), pool);
  const reversed = chooseResearchCohort(briefFixture(), [...pool].reverse());

  assert.deepEqual(first, reversed);
  assert.equal(first.length, 25);
  assert.equal(new Set(first).size, 25);
  assert.deepEqual(first.slice(0, 6), [pool[0]!.candidate_id, pool[1]!.candidate_id, pool[2]!.candidate_id, pool[3]!.candidate_id, pool[4]!.candidate_id, pool[5]!.candidate_id]);
});

test("research cohort takes no more than five seeds first and selects an issuer once", () => {
  const brief = briefFixture();
  const seeds = Array.from({ length: 8 }, (_, index) => ({ ...leadFixture(index, { mechanism: index % 2 }), seed: true }));
  const primary = { ...leadFixture(20, { mechanism: 0 }), primary_domain_lead: true, first_seen: [9, 9] as [number, number] };
  const duplicateIssuer = { ...leadFixture(21, { mechanism: 1 }), identity: identityFixture(20), first_seen: [0, 0] as [number, number] };
  const cohort = chooseResearchCohort(brief, [...seeds, primary, duplicateIssuer]);

  assert.deepEqual(cohort.slice(0, 5), seeds.slice(0, 5).map((candidate) => candidate.candidate_id));
  assert.equal(cohort.filter((candidateId) => candidateId === primary.candidate_id || candidateId === duplicateIssuer.candidate_id).length, 1);
  assert.equal(cohort.includes(primary.candidate_id), true, "primary-domain lead wins ties within its mechanism");
});
