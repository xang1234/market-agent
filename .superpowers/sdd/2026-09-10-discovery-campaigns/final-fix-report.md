# Discovery Campaigns final integration fixes

## RED

- CampaignPage and useCampaignRun tests demonstrated that an immediate same-route account switch rendered User A's campaign name, question, saved draft, candidate/event content, and polling error under User B before User B resolved.
- Thesis metric tests demonstrated that decimal text, equality/strict operators, and high-precision PostgreSQL facts were either rejected or evaluated through binary floating point. The required `0.1 × 3 <= 0.3` campaign criterion excluded a candidate.
- Discovery service and authenticated HTTP tests demonstrated repository run creation for missing model, search, or reference capabilities and a 500 response for the default unavailable composition.

## GREEN

- Campaign page state and polling results/errors carry account identity. Rendering requires the current account and route identity; the brief editor remounts for account-plus-campaign identity. Deferred User B 404 and authorized-response tests keep all User A content ineligible.
- Exact metric facts use bounded local coefficient-plus-scale decimals with BigInt arithmetic. PostgreSQL `numeric` text is retained at the financial adapter; thresholds may remain legacy numbers or use decimal text. Exact comparison supports `eq`, `lt`, `lte`, `gt`, and `gte`; malformed, unsafe, oversized, or excessive-scale values become unresolved rather than rounded. BigInt remains local and is never JSON serialized.
- The Task 5 numeric-prose utility in `assessment-validation.ts` was inspected. It canonicalizes cited text tokens (including scientific notation) and sits below the Agents dependency boundary; reusing it for arithmetic would invert that boundary and still would not represent multiplication. The new small Agents utility is limited to bounded decimal parsing, multiplication, and comparison; the Task 5 validator now consumes that exact representation for cited fact products.
- DiscoveryService.startRun checks normalized model/search/reference readiness before building the repository request and raises `DiscoveryError("unavailable", ...)`, yielding HTTP 503. Campaign creation and brief saving remain available.

Focused GREEN evidence:

- `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/discovery/CampaignPage.test.tsx src/discovery/useCampaignRun.test.tsx src/discovery/api.test.ts src/agents/ThesisPanel.test.tsx` — 36/36.
- `node --experimental-strip-types --test test/thesis-evaluator.test.ts test/thesis-types.test.ts` — 22/22.
- `node --experimental-strip-types --test test/financial-provider.test.ts test/assessment.test.ts test/service.test.ts test/validation.test.ts test/contracts.test.ts` — 30/30.
- `node --experimental-strip-types --test test/http.test.ts` — 8/8.
- `npm run typecheck` and `npm run build` in `web` — pass. The bounded metric source compile passes with strict TypeScript settings. `npm run lint` has its pre-existing unrelated `web/src/analyst-grids/useGridRun.ts:52` exhaustive-deps warning and no errors.

`DISCOVERY_ENABLED=false` is unchanged. Human release evaluation remains Pending.

## Final re-review 1 fixes

### RED

- `services/dev-api/test/thesis-evidence.test.ts` faithfully emulated the former PostgreSQL `numeric::float8` projection. A `0.1000000000000000000001 × 3 <= 0.3` condition became incorrectly `supported`, and `9007199254740993` became `unresolved` after its unsafe numeric was rounded before the shared evaluator.
- The expanded OpenAPI contract test found the stale `[gte, lte]` comparison enum and numeric-only threshold schema.

### GREEN

- `loadThesisPacket` projects `value_num` and `scale` with explicit `::text` aliases and preserves the existing NULL/non-finite fact filters. The packet-loader regression now reaches the shared evaluator as strings and produces `challenged` for the above-bound decimal and `supported` for the exact unsafe-in-JavaScript integer text. An audit found only this loader and the already-correct Discovery financial adapter feeding `evaluateThesisMetrics`; no service retains a `value_num::float8` or `scale::float8` projection.
- `DiscoveryMetricCheck` is the shared request/response component for every reachable Discovery brief surface. Its contract now lists `eq`, `lt`, `lte`, `gt`, and `gte`, preserves deliberately supported legacy JSON numbers, and documents bounded non-exponent decimal strings. Executable mutations of the enum, numeric union branch, and string pattern each fail. The manual web decoder’s `Brief` type remains the shared `ThesisMetricCheck` number-or-string contract; web typecheck/build pass.

Focused verification: dev-api thesis evidence 1/1, Agents thesis 22/22, Discovery assessment/validation/contracts 22/22, OpenAPI 11/11, and web typecheck/build passed. The strict direct source compile reached six pre-existing `services/snapshot` diagnostics through unchanged sealing imports; no changed-source diagnostic was reported. Lint has the existing unrelated `web/src/analyst-grids/useGridRun.ts:52` exhaustive-deps warning and no errors.
