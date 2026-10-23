import assert from "node:assert/strict";
import test from "node:test";

import { hashCanonical, type MeasureDefaultRecord } from "../../financial-core/src/index.ts";
import { MEASURE_DEFAULTS, MEASURE_DEFAULTS_VERSION, measureDefaultsNote } from "../src/measure-defaults.ts";

const V1 = "measure-defaults.v1";
const LATEST_QUARTER = { kind: "latest", period_type: "quarterly", offset: 0 } as const;
const LATEST_FISCAL_YEAR = { kind: "latest", period_type: "annual", offset: 0 } as const;
const TAIL = "Name a measure or a period to change it.";

test("a table edit fails until its version is bumped (#517)", () => {
  assert.deepEqual([MEASURE_DEFAULTS_VERSION, hashCanonical("plan_semantic", MEASURE_DEFAULTS)], [V1, "e5678f17449e352313cf12043db03f718109933f20c3d8ba93ba8172a57f74ce"]);
});

test("each family reads as one sentence over its periods, and one tail closes the note (#517)", () => {
  const records: MeasureDefaultRecord[] = [
    { family: "revenue", table_version: V1, period: "default" },
    { family: "profit", table_version: V1, period: "default" },
    { family: "eps", table_version: V1, period: "requested", requested_period: { kind: "fiscal_period", fiscal_year: 2025, fiscal_period: "Q2" } },
  ];
  assert.equal(measureDefaultsNote(records), [
    "Revenue is shown for the latest fiscal year and the latest quarter.",
    "Profit is read as gross profit, operating income and net income, with their margins, for the latest fiscal year and the latest quarter.",
    "Earnings per share is read as EPS (diluted) for Q2 2025.",
    TAIL,
  ].join(" "));
});

test("a family cited twice lists each period once (#517)", () => {
  assert.equal(measureDefaultsNote([
    { family: "revenue", table_version: V1, period: "requested", requested_period: LATEST_QUARTER },
    { family: "revenue", table_version: V1, period: "default" },
    { family: "revenue", table_version: V1, period: "requested", requested_period: { offset: 0, period_type: "annual", kind: "latest" } },
  ]), `Revenue is shown for the latest quarter and the latest fiscal year. ${TAIL}`);
});

test("a requested period words as a default one does, and others as the plan names them (#517)", () => {
  assert.equal(measureDefaultsNote([{ family: "eps", table_version: V1, period: "requested", requested_period: LATEST_FISCAL_YEAR }]), `Earnings per share is read as EPS (diluted) for the latest fiscal year. ${TAIL}`);
  assert.equal(measureDefaultsNote([{ family: "revenue", table_version: V1, period: "requested", requested_period: { kind: "latest", period_type: "quarterly", offset: 1 } }]),
    `Revenue is shown for the fiscal quarter 1 before the latest at the cutoff. ${TAIL}`);
});

test("a record the table cannot describe still says the server chose defaults (#517)", () => {
  const generic = `Some figures are defaults the server chose. ${TAIL}`;
  assert.equal(measureDefaultsNote([{ family: "profit", table_version: "measure-defaults.v0", period: "default" }]), generic);
  assert.equal(measureDefaultsNote([{ family: "cash", table_version: V1, period: "default" }]), generic);
  assert.equal(measureDefaultsNote([{ family: "toString", table_version: V1, period: "default" }]), generic);
  assert.equal(measureDefaultsNote([
    { family: "cash", table_version: V1, period: "default" },
    { family: "revenue", table_version: V1, period: "default" },
  ]), `Revenue is shown for the latest fiscal year and the latest quarter. ${generic}`);
});

test("a plan that cited no family gets no note (#517)", () => {
  assert.equal(measureDefaultsNote([]), null);
});
