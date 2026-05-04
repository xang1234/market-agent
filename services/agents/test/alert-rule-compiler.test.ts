import assert from "node:assert/strict";
import test from "node:test";

import {
  AlertRuleValidationError,
  compileAlertRule,
} from "../src/alert-rule-compiler.ts";

const ISSUER_ID = "11111111-1111-4111-8111-111111111111";
const THEME_ID = "22222222-2222-4222-8222-222222222222";
const FINDING_ID = "33333333-3333-4333-8333-333333333333";
const CLUSTER_ID = "44444444-4444-4444-8444-444444444444";

test("compileAlertRule evaluates canonical finding predicates with deterministic trigger refs", () => {
  const compiled = compileAlertRule({
    rule_id: "critical-ai-cluster",
    subject: { kind: "issuer", id: ISSUER_ID },
    severity_at_least: "high",
    headline_contains: "margin risk",
    claim_cluster_id_in: [CLUSTER_ID],
    channels: ["email", "web_push"],
  });

  const result = compiled.evaluateFinding({
    finding_id: FINDING_ID,
    subject_refs: [
      { kind: "theme", id: THEME_ID },
      { kind: "issuer", id: ISSUER_ID },
    ],
    claim_cluster_ids: [CLUSTER_ID],
    severity: "critical",
    headline: "Margin risk widened after supplier warning",
  });

  assert.equal(result.matched, true);
  assert.deepEqual(result.trigger_refs, [
    { kind: "finding", id: FINDING_ID },
    { kind: "subject", subject: { kind: "issuer", id: ISSUER_ID } },
    { kind: "claim_cluster", id: CLUSTER_ID },
  ]);
  assert.deepEqual(compiled.channels, ["email", "web_push"]);
});

test("compileAlertRule returns a non-match with unmet predicate explanations", () => {
  const compiled = compileAlertRule({
    rule_id: "high-margin-risk",
    severity_at_least: "high",
    headline_contains: "margin risk",
    channels: ["email"],
  });

  const result = compiled.evaluateFinding({
    finding_id: FINDING_ID,
    subject_refs: [{ kind: "issuer", id: ISSUER_ID }],
    claim_cluster_ids: [],
    severity: "medium",
    headline: "Revenue growth accelerated",
  });

  assert.equal(result.matched, false);
  assert.deepEqual(result.unmet_predicates, ["severity_at_least", "headline_contains"]);
});

test("compileAlertRule rejects unknown operators and private/raw fields", () => {
  assert.throws(
    () =>
      compileAlertRule({
        rule_id: "opaque",
        severity_at_least: "high",
        javascript: "finding.severity === 'high'",
        channels: ["email"],
      }),
    /unsupported alert rule field "javascript"/,
  );

  assert.throws(
    () =>
      compileAlertRule({
        rule_id: "raw",
        severity_at_least: "high",
        channels: ["email"],
        metadata: { raw_text: "do not allow raw document content" },
      }),
    AlertRuleValidationError,
  );
});

test("compileAlertRule requires at least one predicate or subject scope", () => {
  assert.throws(
    () =>
      compileAlertRule({
        rule_id: "too-broad",
        channels: ["email"],
      }),
    /must include at least one predicate or subject scope/,
  );
});

test("compileAlertRule rejects duplicate channels", () => {
  assert.throws(
    () =>
      compileAlertRule({
        rule_id: "duplicate-channel",
        severity_at_least: "high",
        channels: ["email", "email"],
      }),
    /channels must not contain duplicate "email"/,
  );
});
