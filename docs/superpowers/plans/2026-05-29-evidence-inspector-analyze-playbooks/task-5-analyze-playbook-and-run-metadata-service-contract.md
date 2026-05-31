# Task 5: Analyze Playbook And Run Metadata Service Contract


**Files:**
- Create: `services/analyze/src/playbook.ts`
- Create: `services/analyze/src/runMetadata.ts`
- Modify: `services/analyze/src/index.ts`
- Test: `services/analyze/test/playbook.test.ts`
- Test: `services/analyze/test/runMetadata.test.ts`

- [ ] **Step 1: Write failing playbook tests**

Create `services/analyze/test/playbook.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYZE_PLAYBOOKS,
  resolveAnalyzePlaybookRequest,
} from "../src/playbook.ts";

test("built-in playbooks expose analyst-facing source policies and sections", () => {
  const earningsQuality = ANALYZE_PLAYBOOKS.find((playbook) => playbook.playbook_id === "earnings_quality");
  assert.ok(earningsQuality);
  assert.equal(earningsQuality.version, 1);
  assert.deepEqual(earningsQuality.default_source_categories, ["filings", "transcripts", "news"]);
  assert.deepEqual(earningsQuality.sections.map((section) => section.section_id), [
    "summary",
    "quality_of_revenue",
    "margin_bridge",
    "cash_conversion",
    "management_tone",
    "watch_items",
  ]);
});

test("resolveAnalyzePlaybookRequest overlays user instructions without dropping defaults", () => {
  const request = resolveAnalyzePlaybookRequest({
    playbook_id: "variant_view",
    instructions: "Focus on hyperscaler capex risk.",
    source_categories: ["filings"],
  });
  assert.equal(request.playbook.playbook_id, "variant_view");
  assert.equal(request.playbook.version, 1);
  assert.equal(request.instructions, "Focus on hyperscaler capex risk.");
  assert.deepEqual(request.source_categories, ["filings"]);
  assert.ok(request.prompt.includes("Variant view"));
  assert.ok(request.prompt.includes("Focus on hyperscaler capex risk."));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyze
npm test -- test/playbook.test.ts
```

Expected: FAIL with module-not-found for `playbook.ts`.

- [ ] **Step 3: Implement playbook definitions**

Create `services/analyze/src/playbook.ts`:

```ts
export type AnalyzePlaybookSection = {
  section_id: string;
  title: string;
  required: boolean;
  block_hint: "rich_text" | "metric_row" | "table" | "line_chart" | "section";
};

export type AnalyzePlaybook = {
  playbook_id: string;
  version: number;
  name: string;
  description: string;
  default_instructions: string;
  default_source_categories: ReadonlyArray<string>;
  sections: ReadonlyArray<AnalyzePlaybookSection>;
};

export type AnalyzePlaybookRunRequest = {
  playbook_id: string;
  instructions?: string;
  source_categories?: ReadonlyArray<string>;
};

export type ResolvedAnalyzePlaybookRequest = {
  playbook: AnalyzePlaybook;
  instructions: string;
  source_categories: ReadonlyArray<string>;
  prompt: string;
};

export class AnalyzePlaybookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzePlaybookError";
  }
}

export const ANALYZE_PLAYBOOKS: ReadonlyArray<AnalyzePlaybook> = Object.freeze([
  Object.freeze({
    playbook_id: "earnings_quality",
    version: 1,
    name: "Earnings quality",
    description: "Assess revenue quality, margins, cash conversion, and management commentary.",
    default_instructions: "Assess revenue quality, margins, cash conversion, and management commentary.",
    default_source_categories: Object.freeze(["filings", "transcripts", "news"]),
    sections: Object.freeze([
      section("summary", "Summary", true, "rich_text"),
      section("quality_of_revenue", "Quality of revenue", true, "metric_row"),
      section("margin_bridge", "Margin bridge", true, "table"),
      section("cash_conversion", "Cash conversion", true, "metric_row"),
      section("management_tone", "Management tone", true, "rich_text"),
      section("watch_items", "Watch items", true, "table"),
    ]),
  }),
  Object.freeze({
    playbook_id: "variant_view",
    version: 1,
    name: "Variant view",
    description: "Compare the market narrative with evidence-backed counterpoints.",
    default_instructions: "Compare the market narrative with evidence-backed counterpoints.",
    default_source_categories: Object.freeze(["filings", "news", "social"]),
    sections: Object.freeze([
      section("summary", "Variant summary", true, "rich_text"),
      section("consensus_view", "Consensus view", true, "rich_text"),
      section("counter_evidence", "Counter-evidence", true, "table"),
      section("disconfirming_signals", "Disconfirming signals", true, "table"),
      section("decision_points", "Decision points", true, "table"),
    ]),
  }),
  Object.freeze({
    playbook_id: "peer_comparison",
    version: 1,
    name: "Peer comparison",
    description: "Compare a subject against peers on fundamentals, estimates, and evidence-backed risks.",
    default_instructions: "Compare the subject against peers on growth, margins, valuation, estimates, and evidence-backed risks.",
    default_source_categories: Object.freeze(["filings", "news"]),
    sections: Object.freeze([
      section("summary", "Comparison summary", true, "rich_text"),
      section("peer_table", "Peer table", true, "table"),
      section("relative_strengths", "Relative strengths", true, "table"),
      section("relative_risks", "Relative risks", true, "table"),
    ]),
  }),
]);

export function resolveAnalyzePlaybookRequest(
  input: AnalyzePlaybookRunRequest,
): ResolvedAnalyzePlaybookRequest {
  const playbook = ANALYZE_PLAYBOOKS.find((item) => item.playbook_id === input.playbook_id);
  if (!playbook) throw new AnalyzePlaybookError("playbook_id is unknown");
  const instructions = normalizeText(input.instructions) ?? playbook.default_instructions;
  const sourceCategories = normalizeSourceCategories(input.source_categories) ?? playbook.default_source_categories;
  return Object.freeze({
    playbook,
    instructions,
    source_categories: Object.freeze([...sourceCategories]),
    prompt: [
      `${playbook.name}: ${playbook.description}`,
      `Instructions: ${instructions}`,
      `Required sections: ${playbook.sections.map((section) => section.title).join("; ")}`,
      `Source categories: ${sourceCategories.join(", ")}`,
    ].join("\n"),
  });
}

function section(
  section_id: string,
  title: string,
  required: boolean,
  block_hint: AnalyzePlaybookSection["block_hint"],
): AnalyzePlaybookSection {
  return Object.freeze({ section_id, title, required, block_hint });
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeSourceCategories(value: unknown): ReadonlyArray<string> | null {
  if (!Array.isArray(value)) return null;
  const categories = value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
  return categories.length === 0 ? null : Object.freeze([...new Set(categories)]);
}
```

- [ ] **Step 4: Export playbooks**

Modify `services/analyze/src/index.ts`:

```ts
export * from "./playbook.ts";
```

- [ ] **Step 5: Write failing run metadata tests**

Create `services/analyze/test/runMetadata.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  AnalyzeRunMetadataError,
  parseAnalyzeRunMetadata,
  serializeAnalyzeRunMetadataV1,
} from "../src/runMetadata.ts";

test("serializeAnalyzeRunMetadataV1 records schema version and resolved inputs", () => {
  const metadata = serializeAnalyzeRunMetadataV1({
    template_id: "11111111-1111-4111-8111-111111111111",
    template_version: 3,
    playbook_id: "earnings_quality",
    playbook_version: 1,
    instructions: "Focus on cash conversion.",
    source_categories: ["filings"],
    subject_refs: [{ kind: "issuer", id: "22222222-2222-4222-8222-222222222222" }],
  });

  assert.equal(metadata.schema_version, 1);
  assert.equal(metadata.template_version, 3);
  assert.deepEqual(metadata.source_categories, ["filings"]);
});

test("parseAnalyzeRunMetadata accepts schema v1 and rejects unsupported versions", () => {
  const metadata = parseAnalyzeRunMetadata({
    schema_version: 1,
    template_id: "11111111-1111-4111-8111-111111111111",
    template_version: 1,
    playbook_id: "earnings_quality",
    playbook_version: 1,
    instructions: "Focus on cash conversion.",
    source_categories: ["filings"],
    subject_refs: [],
  });
  assert.equal(metadata.schema_version, 1);

  assert.throws(
    () => parseAnalyzeRunMetadata({ schema_version: 2 }),
    AnalyzeRunMetadataError,
  );
});
```

- [ ] **Step 6: Implement versioned run metadata helpers**

Create `services/analyze/src/runMetadata.ts`:

```ts
export const ANALYZE_RUN_METADATA_SCHEMA_VERSION = 1;

export type AnalyzeRunMetadataSubjectRef = {
  kind: string;
  id: string;
};

export type AnalyzeRunMetadataV1 = {
  schema_version: 1;
  template_id: string;
  template_version: number;
  playbook_id: string | null;
  playbook_version: number | null;
  instructions: string;
  source_categories: ReadonlyArray<string>;
  subject_refs: ReadonlyArray<AnalyzeRunMetadataSubjectRef>;
  rerun_of_run_id?: string;
};

export class AnalyzeRunMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeRunMetadataError";
  }
}

export function serializeAnalyzeRunMetadataV1(input: Omit<AnalyzeRunMetadataV1, "schema_version">): AnalyzeRunMetadataV1 {
  return Object.freeze({
    schema_version: ANALYZE_RUN_METADATA_SCHEMA_VERSION,
    template_id: expectString(input.template_id, "template_id"),
    template_version: expectPositiveInteger(input.template_version, "template_version"),
    playbook_id: nullableString(input.playbook_id, "playbook_id"),
    playbook_version: nullablePositiveInteger(input.playbook_version, "playbook_version"),
    instructions: expectString(input.instructions, "instructions"),
    source_categories: Object.freeze(input.source_categories.map((category) => expectString(category, "source_category"))),
    subject_refs: Object.freeze(input.subject_refs.map(parseSubjectRef)),
    ...(input.rerun_of_run_id ? { rerun_of_run_id: expectString(input.rerun_of_run_id, "rerun_of_run_id") } : {}),
  });
}

export function parseAnalyzeRunMetadata(value: unknown): AnalyzeRunMetadataV1 {
  if (!isRecord(value)) throw new AnalyzeRunMetadataError("run_metadata must be an object");
  if (value.schema_version !== ANALYZE_RUN_METADATA_SCHEMA_VERSION) {
    throw new AnalyzeRunMetadataError("run_metadata schema version is unsupported");
  }
  return serializeAnalyzeRunMetadataV1({
    template_id: value.template_id,
    template_version: value.template_version,
    playbook_id: value.playbook_id ?? null,
    playbook_version: value.playbook_version ?? null,
    instructions: value.instructions,
    source_categories: expectStringArray(value.source_categories, "source_categories"),
    subject_refs: expectSubjectRefs(value.subject_refs),
    rerun_of_run_id: typeof value.rerun_of_run_id === "string" ? value.rerun_of_run_id : undefined,
  });
}

export function withRerunOfRunId(metadata: AnalyzeRunMetadataV1, runId: string): AnalyzeRunMetadataV1 {
  return serializeAnalyzeRunMetadataV1({
    ...metadata,
    rerun_of_run_id: runId,
  });
}

function parseSubjectRef(value: AnalyzeRunMetadataSubjectRef): AnalyzeRunMetadataSubjectRef {
  return Object.freeze({
    kind: expectString(value.kind, "subject_ref.kind"),
    id: expectString(value.id, "subject_ref.id"),
  });
}

function expectSubjectRefs(value: unknown): ReadonlyArray<AnalyzeRunMetadataSubjectRef> {
  if (!Array.isArray(value)) throw new AnalyzeRunMetadataError("subject_refs must be an array");
  return Object.freeze(value.map((item) => {
    if (!isRecord(item)) throw new AnalyzeRunMetadataError("subject_ref must be an object");
    return parseSubjectRef({ kind: item.kind, id: item.id } as AnalyzeRunMetadataSubjectRef);
  }));
}

function expectStringArray(value: unknown, field: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) throw new AnalyzeRunMetadataError(`${field} must be an array`);
  return Object.freeze(value.map((item) => expectString(item, field)));
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AnalyzeRunMetadataError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : expectString(value, field);
}

function expectPositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AnalyzeRunMetadataError(`${field} must be a positive integer`);
  }
  return value;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  return value === null ? null : expectPositiveInteger(value, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

Modify `services/analyze/src/index.ts`:

```ts
export * from "./runMetadata.ts";
```

- [ ] **Step 7: Run analyze tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyze
npm test -- test/playbook.test.ts test/runMetadata.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/analyze/src/playbook.ts services/analyze/src/runMetadata.ts services/analyze/src/index.ts services/analyze/test/playbook.test.ts services/analyze/test/runMetadata.test.ts
git commit -m "feat(analyze): define guided playbooks"
```
