import test from "node:test";
import assert from "node:assert/strict";

import {
  FAST_PATH_DETECTOR_VERSION,
  FAST_PATH_QUOTE_BUNDLE_ID,
  FAST_PATH_QUOTE_TOOL_NAME,
  detectFastPath,
} from "../src/fast-path.ts";
import { loadToolRegistry } from "../src/registry.ts";

test("detectFastPath matches the canonical 'AAPL price' contract under 100ms", () => {
  const decision = detectFastPath({
    user_turn: "AAPL price",
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
    "AAPL price",
    "Show me MSFT quote",
    "What's the current price of AAPL?",
    "GOOG quote please",
    "current MSFT price",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, true, `expected match for: ${user_turn}`);
  }
});

test("detectFastPath rejects analytical signals that imply more than a quote", () => {
  const cases: Array<{ user_turn: string; signal: string }> = [
    { user_turn: "Why did AAPL price drop?", signal: "explanatory_question" },
    { user_turn: "AAPL price vs MSFT price", signal: "comparison" },
    { user_turn: "AAPL price history", signal: "temporal_range" },
    { user_turn: "AAPL price and earnings", signal: "analytical_topic" },
    { user_turn: "AAPL price change", signal: "performance_metric" },
    { user_turn: "AAPL price 5%", signal: "percent_sign" },
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
  // for analyst output (price targets, ratings, rec) — not a live quote.
  // Routing them to get_quote silently returns the wrong answer.
  for (const user_turn of [
    "AAPL price target",
    "AAPL price target 200",
    "TSLA buy price",
    "MSFT sell price",
    "AAPL price rating",
    "AAPL fair price",
    "AAPL analyst price",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, "analyst_opinion");
  }
});

test("detectFastPath rejects session-qualified phrasings that get_quote cannot session-discriminate", () => {
  // get_quote returns last-trade only; routing pre/post-market, intraday,
  // OHLC, or bid/ask requests silently returns wrong-session data.
  for (const user_turn of [
    "AAPL premarket price",
    "AAPL pre-market price",
    "AAPL afterhours price",
    "AAPL after-hours price",
    "AAPL intraday price",
    "AAPL opening price",
    "AAPL closing price",
    "AAPL bid price",
    "AAPL ask price",
    "AAPL price high",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, "session_qualifier");
  }
});

test("detectFastPath rejects derivative-instrument phrasings that need an options/futures tool surface", () => {
  for (const user_turn of [
    "AAPL call option price",
    "AAPL put price",
    "AAPL options price",
    "AAPL strike price",
    "AAPL futures price",
    "ES futures price",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, "derivative_instrument");
  }
});

test("detectFastPath rejects non-equity instrument phrasings that get_quote (equity-scoped) would mishandle", () => {
  for (const user_turn of [
    "BTC price",
    "bitcoin price",
    "ETH price",
    "ethereum price",
    "gold price",
    "oil price",
    "WTI crude price",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, "non_equity_instrument");
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
    "alert me on AAPL price",
    "AAPL price alert",
    "screen by price",
    "scan AAPL price",
    "AAPL price above 200",
    "AAPL price below 150",
  ]) {
    const decision = detectFastPath({ user_turn, resolved_subject_count: 1 });
    assert.equal(decision.ok, false, `expected rejection for: ${user_turn}`);
    assert.equal(decision.reason, "analytical_signal");
    assert.equal(decision.detail, "actionable_intent");
  }
});

test("detectFastPath rejects requests with no quote intent", () => {
  for (const user_turn of [
    "AAPL",
    "Tell me about Apple",
    "Apple supplier risk",
    "MSFT segment revenue",
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
  const tooLong = "AAPL price " + "x".repeat(80);
  const tooManyTokens = "give me the the the the the the the the AAPL price";

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
  const multiClause = "AAPL price and 52-week high yesterday";
  const multiClauseDecision = detectFastPath({
    user_turn: multiClause,
    resolved_subject_count: 1,
  });
  assert.equal(multiClauseDecision.ok, false, `expected rejection for: ${multiClause}`);
});

test("detectFastPath requires resolved_subject_count to be exactly 1", () => {
  for (const subject_count of [0, 2, 5]) {
    const decision = detectFastPath({
      user_turn: "AAPL price",
      resolved_subject_count: subject_count,
    });
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, "subject_count_mismatch");
    assert.match(decision.detail ?? "", new RegExp(`received ${subject_count}`));
  }

  const ok = detectFastPath({
    user_turn: "AAPL price",
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
    user_turn: "AAPL price",
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
    user_turn: "AAPL price",
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
