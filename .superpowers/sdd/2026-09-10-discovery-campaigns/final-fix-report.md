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
