import test from "node:test";
import assert from "node:assert/strict";

import {
  FAST_PATH_DETECTOR_VERSION,
  FAST_PATH_QUOTE_BUNDLE_ID,
  FAST_PATH_QUOTE_TOOL_NAME,
  detectFastPath,
} from "../src/fast-path.ts";
import { loadToolRegistry } from "../src/registry.ts";

test("detectFastPath matches the canonical 'copper price' contract under 100ms", () => {
  const decision = detectFastPath({
    user_turn: "copper price",
    resolved_subject_count: 1,
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.kind, "quote_only");
  assert.equal(decision.bundle_id, FAST_PATH_QUOTE_BUNDLE_ID);
  assert.equal(decision.tool_name, FAST_PATH_QUOTE_TOOL_NAME);
  assert.equal(decision.detected_intent, "quote");
  assert.equal(decision.classification.bundle_id, FAST_PATH_QUOTE_BUNDLE_ID);
  assert.equal(decision.detector_version, FAST_PATH_DETECTOR_VERSION);
  assert.ok(
    decision.heuristic_ms < 100,
    `heuristic_ms must be < 100ms, got ${decision.heuristic_ms}`,
  );
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.classification), true);
});

test("detectFastPath matches common quote-only natural-language phrasings", () => {
  for (const user_turn of [
    "copper price",
    "Show me iron ore quote",
    "What's the current price of copper?",
    "LME copper quote please",
    "current iron ore price",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, true, `expected match for: ${user_turn}`);
  }
});

test("detectFastPath rejects analytical signals that imply more than a quote", () => {
  const cases: Array<{ user_turn: string; signal: string }> = [
    { user_turn: "Why did copper price drop?", signal: "explanatory_question" },
    { user_turn: "copper price vs iron ore price", signal: "comparison" },
    { user_turn: "copper price history", signal: "temporal_range" },
    { user_turn: "copper price and report", signal: "analytical_topic" },
    { user_turn: "copper price change", signal: "performance_metric" },
    { user_turn: "copper price 5%", signal: "percent_sign" },
  ];

  for (const { user_turn, signal } of cases) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, signal);
  }
});

test("detectFastPath rejects analyst-opinion phrasings that look quote-shaped but want analyst coverage", () => {
  // These are short, structurally-similar inputs where the user is asking
  // for analyst output (targets, ratings, recommendations) — not a latest price.
  // Routing them to get_commodity_latest silently returns the wrong answer.
  for (const user_turn of [
    "copper price target",
    "copper price target 10500",
    "copper buy price",
    "iron ore sell price",
    "copper price rating",
    "copper fair price",
    "copper analyst price",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, "analyst_opinion");
  }
});

test("detectFastPath rejects session-qualified phrasings that latest-price lookup cannot session-discriminate", () => {
  // get_commodity_latest returns latest normalized price only; routing intraday,
  // OHLC, or bid/ask requests silently returns the wrong market surface.
  for (const user_turn of [
    "copper premarket price",
    "copper pre-market price",
    "copper afterhours price",
    "copper after-hours price",
    "copper intraday price",
    "copper opening price",
    "copper closing price",
    "copper bid price",
    "copper ask price",
    "copper price high",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, "session_qualifier");
  }
});

test("detectFastPath rejects option-style derivative phrasings that need a different tool surface", () => {
  for (const user_turn of [
    "copper call option price",
    "copper put price",
    "copper options price",
    "copper strike price",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, "derivative_instrument");
  }
});

test("detectFastPath rejects explicit equity phrasings that commodity lookup would mishandle", () => {
  for (const user_turn of [
    "Apple stock price",
    "Rio shares price",
    "BHP equity price",
    "mining stocks price",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, "equity_instrument");
  }
});

test("detectFastPath rejects actionable-intent phrasings (alerts, screening) that need different tools", () => {
  // Inputs chosen so no earlier signal pattern fires first; the actionable
  // intent is the discriminating reason. Note that some realistic queries
  // like "screen low price stocks" trip the session_qualifier signal on
  // `low` first — that's still a rejection (correct), just a different
  // category. The contract this test pins is that actionable_intent IS a
  // dedicated signal class.
  for (const user_turn of [
    "alert me on copper price",
    "copper price alert",
    "screen by price",
    "scan copper price",
    "copper price above 10500",
    "copper price below 9000",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, "actionable_intent");
  }
});

test("detectFastPath rejects requests with no quote intent", () => {
  for (const user_turn of [
    "copper",
    "Tell me about copper",
    "Chile supply risk",
    "iron ore steel margins",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "no_quote_intent");
  }
});

test("detectFastPath rejects empty or whitespace-only user turns", () => {
  for (const user_turn of ["", "   ", "\n\t"]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, "missing_user_turn");
  }
});

test("detectFastPath rejects long, many-token, and realistic multi-clause requests", () => {
  const tooLong = "copper price " + "x".repeat(80);
  const tooManyTokens = "give me the the the the the the the the copper price";

  const longDecision = detectFastPath({ user_turn: tooLong, resolved_subject_count: 1 });
  assert.equal(longDecision.ok, false);
  assert.equal(longDecision.reason, "too_many_characters");

  const manyTokensDecision = detectFastPath({
    user_turn: tooManyTokens,
    resolved_subject_count: 1,
  });
  assert.equal(manyTokensDecision.ok, false);
  assert.equal(manyTokensDecision.reason, "too_many_tokens");

  // Realistic multi-clause: a quote-shaped lead clause with a temporal
  // follow-on. This must NOT slip through — it should hit either the token
  // cap or the temporal_range signal, depending on which gate fires first.
  const multiClause = "copper price and 52-week high yesterday";
  const multiClauseDecision = detectFastPath({
    user_turn: multiClause,
    resolved_subject_count: 1,
  });
  assert.equal(multiClauseDecision.ok, false, `expected rejection for: ${multiClause}`);
});

test("detectFastPath requires resolved_subject_count to be exactly 1", () => {
  for (const subject_count of [0, 2, 5]) {
    const decision = detectFastPath({
      user_turn: "copper price",
      resolved_subject_count: subject_count,
    });
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, "subject_count_mismatch");
    assert.match(decision.detail ?? "", new RegExp(`received ${subject_count}`));
  }

  const ok = detectFastPath({
    user_turn: "copper price",
    resolved_subject_count: 1,
  });
  assert.equal(ok.ok, true);
});

test("detectFastPath records heuristic_ms via the injected clock for instrumentation contracts", () => {
  let clockCalls = 0;
  const fakeNow = () => {
    clockCalls += 1;
    return clockCalls === 1 ? 1000 : 1003.5;
  };

  const decision = detectFastPath({
    user_turn: "copper price",
    resolved_subject_count: 1,
    now: fakeNow,
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.heuristic_ms, 3.5);
  assert.equal(clockCalls, 2);
});

test("detectFastPath dispatches deterministically into the live tool registry", () => {
  const registry = loadToolRegistry();
  const decision = detectFastPath({
    user_turn: "copper price",
    resolved_subject_count: 1,
  });

  assert.equal(decision.ok, true);
  const bundle = registry.getBundle(decision.bundle_id);
  assert.ok(bundle, `bundle ${decision.bundle_id} must exist in the registry`);
  const tool = registry.getTool(decision.tool_name);
  assert.ok(tool, `tool ${decision.tool_name} must exist in the registry`);
  assert.ok(
    tool.bundles.includes(decision.bundle_id),
    `${decision.tool_name} must belong to ${decision.bundle_id}`,
  );
  assert.equal(tool.cost_class, "low");
});
