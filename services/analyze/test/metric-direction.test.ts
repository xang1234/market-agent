import test from "node:test";
import assert from "node:assert/strict";

import { METRIC_DIRECTION, columnTones } from "../src/metric-direction.ts";

test("METRIC_DIRECTION encodes the signed-off v1 directions", () => {
  assert.deepEqual(METRIC_DIRECTION, {
    revenue: "none",
    gross_margin: "higher",
    net_margin: "higher",
    revenue_growth_yoy: "higher",
    pe_ratio: "lower",
  });
});

test("higher-is-better: max is positive, min is negative, middle neutral", () => {
  assert.deepEqual(columnTones("gross_margin", [0.3, 0.5, 0.4]), ["negative", "positive", "neutral"]);
});

test("lower-is-better (P/E): min is positive, max is negative", () => {
  assert.deepEqual(columnTones("pe_ratio", [20, 15, 30]), ["neutral", "positive", "negative"]);
});

test("directionless metric (revenue) gets no tone", () => {
  assert.deepEqual(columnTones("revenue", [1, 2, 3]), [undefined, undefined, undefined]);
});

test("fewer than two comparable values get no tone", () => {
  assert.deepEqual(columnTones("gross_margin", [0.5]), [undefined]);
  assert.deepEqual(columnTones("gross_margin", []), []);
});

test("an all-equal column has no leader to highlight", () => {
  assert.deepEqual(columnTones("gross_margin", [0.4, 0.4, 0.4]), [undefined, undefined, undefined]);
});

test("ties at an extreme share that extreme's tone", () => {
  // Two leaders, one laggard.
  assert.deepEqual(columnTones("gross_margin", [0.5, 0.5, 0.3]), ["positive", "positive", "negative"]);
  // Two laggards, one leader.
  assert.deepEqual(columnTones("net_margin", [0.5, 0.3, 0.3]), ["positive", "negative", "negative"]);
});
