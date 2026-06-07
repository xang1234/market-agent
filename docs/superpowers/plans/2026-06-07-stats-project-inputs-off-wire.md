# Project Key-Stat inputs Off the Stats Wire — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `GET /v1/fundamentals/stats` from shipping `stats[].inputs[]` (internal `metric_id`/`source_id` + evidence-plane `fact_id`) on the public wire, while keeping the in-process `KeyStatsEnvelope.inputs` intact for peer-metrics.

**Architecture:** Project `inputs` off at the HTTP serialization boundary in `services/fundamentals/src/http.ts` via a public DTO (`PublicKeyStatsEnvelope`) and a `toPublicStatsEnvelope` mapper. The internal model (`key-stats.ts`, `StatsRepository`, `buildKeyStats`) is untouched; peer-metrics consumes that in-process and is unaffected.

**Tech Stack:** Node `--experimental-strip-types` + `node:test` (fundamentals), React + tsc (web).

---

## File Structure

- `services/fundamentals/src/http.ts` — **Modify.** Import `KeyStat`; add `PublicKeyStat`/`PublicKeyStatsEnvelope`; retype `GetStatsResponse`; add `toPublicStatsEnvelope`; apply it at the `get_stats` case.
- `services/fundamentals/test/stats.http.test.ts` — **Modify.** Flip the provenance test (lines 135-157) to assert `inputs` is absent on the wire + headline fields present; drop the now-unused `DEV_PRICE_SOURCE_ID`/`DEV_STATEMENT_SOURCE_ID` imports.
- `web/src/symbol/stats.ts` — **Modify.** Remove the `inputs: ReadonlyArray<unknown>` field from web's `KeyStat` type (no longer on the wire; web never reads it).

No CI workflow change.

---

## Task 1: Flip the wire-contract test (failing)

**Files:**
- Modify: `services/fundamentals/test/stats.http.test.ts`

- [ ] **Step 1: Replace the provenance test (lines 135-157)**

Replace the entire test block that begins `test("GET /v1/fundamentals/stats exposes per-input source_id on every stat input (provenance)", …)` and ends at its closing `});` with:

```ts
test("GET /v1/fundamentals/stats projects per-input provenance off the public wire", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/fundamentals/stats?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  );
  const body = (await res.json()) as GetStatsResponse;

  assert.ok(body.stats.stats.length > 0, "envelope should carry stats");
  for (const stat of body.stats.stats) {
    // Provenance (internal metric_id/source_id + evidence-plane fact_id) is not on the wire.
    assert.equal(
      (stat as { inputs?: unknown }).inputs,
      undefined,
      `${stat.stat_key} should not ship inputs on the public wire`,
    );
    // The headline fields a wire client actually consumes remain present.
    assert.ok(typeof stat.stat_key === "string" && stat.stat_key.length > 0);
    assert.ok("value_num" in stat, `${stat.stat_key} should carry value_num`);
    assert.ok(
      stat.computation !== undefined && typeof stat.computation.expression === "string",
      `${stat.stat_key} should carry its computation`,
    );
    assert.ok(Array.isArray(stat.warnings), `${stat.stat_key} should carry warnings`);
  }
});
```

- [ ] **Step 2: Remove the now-unused source-id imports**

In the import block at the top of the file, delete these two lines (they were only used by the replaced test):

```ts
  DEV_PRICE_SOURCE_ID,
  DEV_STATEMENT_SOURCE_ID,
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
cd services/fundamentals && node --experimental-strip-types --test 'test/stats.http.test.ts' 2>&1 | grep -E "ℹ (tests|pass|fail)|projects per-input|✖"
```
Expected: the new "projects per-input provenance off the public wire" test FAILS — `http.ts` still serializes `inputs`, so `stat.inputs` is defined (not `undefined`).

- [ ] **Step 4: Commit**

```bash
git add services/fundamentals/test/stats.http.test.ts
git commit -m "test(fundamentals): pin that stats inputs are projected off the wire (fra-7n92)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Project inputs off in the HTTP handler

**Files:**
- Modify: `services/fundamentals/src/http.ts`

- [ ] **Step 1: Import `KeyStat` alongside `KeyStatsEnvelope`**

Replace line 15:

```ts
import type { KeyStatsEnvelope } from "./key-stats.ts";
```

with:

```ts
import type { KeyStat, KeyStatsEnvelope } from "./key-stats.ts";
```

- [ ] **Step 2: Add the public DTO types + mapper and retype `GetStatsResponse`**

Replace the `GetStatsResponse` definition (lines 56-58):

```ts
export type GetStatsResponse = {
  stats: KeyStatsEnvelope;
};
```

with:

```ts
// Public wire shape: the provenance-rich `inputs` array stays internal (peer-metrics
// reads it in-process via StatsRepository); it is projected off the HTTP response.
export type PublicKeyStat = Omit<KeyStat, "inputs">;
export type PublicKeyStatsEnvelope = Omit<KeyStatsEnvelope, "stats"> & {
  stats: ReadonlyArray<PublicKeyStat>;
};

export type GetStatsResponse = {
  stats: PublicKeyStatsEnvelope;
};

function toPublicStatsEnvelope(envelope: KeyStatsEnvelope): PublicKeyStatsEnvelope {
  return { ...envelope, stats: envelope.stats.map(({ inputs, ...stat }) => stat) };
}
```

- [ ] **Step 3: Apply the projection at the `get_stats` case**

Replace line 139:

```ts
          const response: GetStatsResponse = { stats: outcome.data };
```

with:

```ts
          const response: GetStatsResponse = { stats: toPublicStatsEnvelope(outcome.data) };
```

- [ ] **Step 4: Run the flipped test to verify it passes**

Run:
```bash
cd services/fundamentals && node --experimental-strip-types --test 'test/stats.http.test.ts' 2>&1 | grep -E "ℹ (tests|pass|fail)|projects per-input|✖"
```
Expected: PASS — `inputs` is now absent on the wire; the other stats.http tests (which read `value_num`/`warnings`/`computation`, never `inputs`) still pass.

- [ ] **Step 5: Run the full fundamentals suite (in-process provenance + peer-metrics intact)**

Run (Docker up for any integration tests):
```bash
cd services/fundamentals && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```
Expected: `fail 0` — `key-stats.test.ts` (asserts `inputs` on the in-process `buildKeyStats` output) and the peer-metrics tests are unaffected.

- [ ] **Step 6: Commit**

```bash
git add services/fundamentals/src/http.ts
git commit -m "feat(fundamentals): project key-stat inputs off the public stats response (fra-7n92)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Trim the web type

**Files:**
- Modify: `web/src/symbol/stats.ts`

- [ ] **Step 1: Remove the `inputs` field from web's `KeyStat`**

In `web/src/symbol/stats.ts`, delete this line from the `KeyStat` type (line 43):

```ts
  inputs: ReadonlyArray<unknown>
```

- [ ] **Step 2: Typecheck + test the web app**

Run:
```bash
cd web && npm run typecheck && npm test 2>&1 | tail -15
```
Expected: typecheck passes (nothing reads `.inputs`; verified zero references) and web tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/src/symbol/stats.ts
git commit -m "refactor(web): drop key-stat inputs from the wire type (no longer served) (fra-7n92)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verification, close bead, push, PR

- [ ] **Step 1: Re-run both suites**

```bash
cd services/fundamentals && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
cd ../../web && npm run typecheck && npm test 2>&1 | tail -5
```
Expected: fundamentals `fail 0`; web typecheck clean + tests pass.

- [ ] **Step 2: Confirm inputs is gone from the public surface but kept internally**

```bash
cd /Users/admin/Documents/Work/market-agent
grep -n "toPublicStatsEnvelope\|PublicKeyStat" services/fundamentals/src/http.ts
grep -n "inputs" services/fundamentals/src/key-stats.ts | head -3   # in-process type still has inputs
```
Expected: `http.ts` shows the projection; `key-stats.ts` still defines `inputs` on `KeyStat`.

- [ ] **Step 3: Close the bead and push**

```bash
bd close fra-7n92 --reason="Decision: project key-stat inputs off the public /v1/fundamentals/stats wire (internal metric_id/source_id + evidence-plane fact_id). Done via a PublicKeyStatsEnvelope projection at http.ts; in-process KeyStatsEnvelope.inputs kept for peer-metrics; web type trimmed; wire-contract test flipped."
git push -u origin feat/fra-7n92-stats-project-inputs
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --title "Project key-stat inputs off the stats wire (fra-7n92)" --body "$(cat <<'EOF'
## Summary
- `GET /v1/fundamentals/stats` no longer ships `stats[].inputs[]` (internal `metric_id`/`source_id` + evidence-plane `fact_id`) on the public wire. Projected off at the HTTP boundary via `PublicKeyStatsEnvelope` + `toPublicStatsEnvelope`.
- The in-process `KeyStatsEnvelope.inputs` is untouched — peer-metrics consumes it via `StatsRepository` (in-process), not over HTTP.
- Web type trimmed (`inputs` removed; web never read it). Wire-contract test flipped to pin that `inputs` is absent.

## Why
The only wire consumer (web symbol pages) never read `inputs`; peer-metrics is in-process; and there is no public fact-lookup endpoint, so `fact_id` on the wire was unresolvable. The endpoint was leaking internal/evidence ids on a public surface for zero consumer benefit.

## Test Plan
- [x] `stats.http.test.ts`: new test asserts `inputs` absent on the wire + headline fields present; other stats.http tests unaffected
- [x] `key-stats.test.ts` (in-process `inputs`) + peer-metrics tests unchanged and green
- [x] `services/fundamentals` npm test green; `web` typecheck + test green

## Out of scope
- A public fact-lookup/provenance endpoint (deliberate future path if a wire client needs lineage).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **The projection is the whole fix.** `toPublicStatsEnvelope` strips `inputs` via destructuring rest; everything else on each stat (`stat_key`, `value_num`, `computation`, `warnings`, period fields) is preserved.
- **Do not touch `key-stats.ts` / `buildKeyStats` / peer-metrics.** The internal model must keep `inputs` — peer-metrics materializes derived facts from it.
- **`statByKey` in the test file** is typed on `KeyStat` but called on the (now public) wire stats; it still works at runtime (reads `stat_key`) and fundamentals isn't CI-typechecked. Leave it; other tests rely on it.
- **Docker** is only needed if `npm test` includes fundamentals integration tests; the stats.http tests themselves are in-memory.
