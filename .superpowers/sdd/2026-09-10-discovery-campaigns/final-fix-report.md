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

## Final re-review 2 fix

### RED

- Actual Ajv validation accepted a JSON numeric `0.0000001` and a 101-digit string through the published `DiscoveryMetricCheck` schema, while `parseBrief` rejected both. JavaScript serializes the fractional number as `1e-7`, which cannot be treated as an exact public decimal; the parser also limits total decimal digits to 100.

### GREEN

- Public fractional thresholds are now canonical decimal strings. The only JSON-number compatibility branch is an exactly representable safe integer from `-9007199254740991` through `9007199254740991`. The parser, OpenAPI schema, and browser decoder use the same canonical grammar: an optional minus sign, one `0` or a nonzero-leading integer, optional fractional digits, at most 100 digits and 100 fractional places, with no whitespace, plus sign, exponent, leading zeros, or trailing decimal point.
- Durable campaign briefs and thesis versions still accept earlier finite fractional JSON numbers on read, convert their JavaScript representation (including scientific serialization) to bounded canonical text, and then use the normal public parser. New writes and browser responses use the strict contract. The thesis editor displays a text decimal field and normalizes a legacy fractional draft before saving.
- The executable OpenAPI semantic test compiles the real component with Ajv and checks every comparison operator. It proves agreement with `parseBrief` for `"0.3"`, `"0.0000001"`, a 100-digit integer string, safe integer numbers, numerical `0.0000001`, unsafe numbers, 101 digits, excess scale, signs, exponents, leading zeros, and malformed literals. Contract mutations of the comparison enum, numeric branch, and decimal pattern fail.

Focused verification: Dev API thesis evidence **1/1**; Agents types/evaluator **24/24**; Discovery assessment/validation/contracts **23/23**; OpenAPI **12/12**; focused web API/ThesisPanel **15/15**; web typecheck and production build pass. Strict affected-source TypeScript passes with `--skipLibCheck`; the unskipped direct invocation reaches pre-existing Node declaration incompatibilities only. Lint remains clean apart from the unrelated `web/src/analyst-grids/useGridRun.ts:52` warning. `DISCOVERY_ENABLED=false` is unchanged and the human release evaluation remains Pending.
