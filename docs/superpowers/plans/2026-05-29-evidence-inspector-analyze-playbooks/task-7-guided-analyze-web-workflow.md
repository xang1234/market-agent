# Task 7: Guided Analyze Web Workflow


**Files:**
- Create: `web/src/analyze/playbooks.ts`
- Create: `web/src/analyze/runHistory.ts`
- Test: `web/src/analyze/runDiff.test.ts`
- Modify: `web/src/pages/AnalyzePage.tsx`
- Test: `web/src/pages/workflowSurfaces.test.tsx`

- [ ] **Step 1: Write failing diff tests**

Create `web/src/analyze/runDiff.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { diffAnalyzeRuns } from "./runHistory.ts";

test("diffAnalyzeRuns matches sections by playbook section id before title", () => {
  const diff = diffAnalyzeRuns(
    {
      run_id: "run-a",
      template_name: "Earnings template",
      playbook_id: "earnings_quality",
      playbook_name: "Earnings quality",
      playbook_version: 1,
      display_title: "Earnings quality",
      run_metadata: {},
      can_rerun: true,
      rerun_unavailable_reason: null,
      created_at: "2026-05-28T00:00:00.000Z",
      snapshot_id: "11111111-1111-4111-8111-111111111111",
      blocks: [
        { id: "old-summary", kind: "rich_text", title: "Summary", snapshot_id: "11111111-1111-4111-8111-111111111111", data_ref: { kind: "analyze_run", id: "old-summary", params: { playbook_section_id: "summary" } } },
        { id: "old-cash", kind: "rich_text", title: "Cash conversion", snapshot_id: "11111111-1111-4111-8111-111111111111", data_ref: { kind: "analyze_run", id: "old-cash", params: { playbook_section_id: "cash_conversion" } } },
      ],
    },
    {
      run_id: "run-b",
      template_name: "Earnings template",
      playbook_id: "earnings_quality",
      playbook_name: "Earnings quality",
      playbook_version: 1,
      display_title: "Earnings quality",
      run_metadata: {},
      can_rerun: true,
      rerun_unavailable_reason: null,
      created_at: "2026-05-29T00:00:00.000Z",
      snapshot_id: "22222222-2222-4222-8222-222222222222",
      blocks: [
        { id: "new-summary", kind: "rich_text", title: "Executive summary", snapshot_id: "22222222-2222-4222-8222-222222222222", data_ref: { kind: "analyze_run", id: "new-summary", params: { playbook_section_id: "summary" } } },
        { id: "new-watch", kind: "table", title: "Watch items", snapshot_id: "22222222-2222-4222-8222-222222222222", data_ref: { kind: "analyze_run", id: "new-watch", params: { playbook_section_id: "watch_items" } } },
      ],
    },
  );
  assert.deepEqual(diff.rows.map((row) => `${row.status}:${row.title}`), [
    "changed:Executive summary",
    "added:Watch items",
    "removed:Cash conversion",
  ]);
});

test("diffAnalyzeRuns ignores volatile block identity fields", () => {
  const diff = diffAnalyzeRuns(
    runDetail({
      runId: "run-a",
      snapshotId: "11111111-1111-4111-8111-111111111111",
      blocks: [
        {
          id: "old-summary",
          kind: "rich_text",
          title: "Summary",
          snapshot_id: "11111111-1111-4111-8111-111111111111",
          data_ref: { kind: "analyze_run", id: "old-summary", params: { playbook_section_id: "summary" } },
          rich_text: { segments: [{ text: "Revenue grew 9%.", claim_refs: [{ kind: "claim", id: "claim-1" }] }] },
          source_refs: [{ kind: "source", id: "source-1" }],
        },
      ],
    }),
    runDetail({
      runId: "run-b",
      snapshotId: "22222222-2222-4222-8222-222222222222",
      blocks: [
        {
          id: "new-summary",
          kind: "rich_text",
          title: "Summary",
          snapshot_id: "22222222-2222-4222-8222-222222222222",
          data_ref: { kind: "analyze_run", id: "new-summary", params: { playbook_section_id: "summary" } },
          rich_text: { segments: [{ text: "Revenue grew 9%.", claim_refs: [{ kind: "claim", id: "claim-1" }] }] },
          source_refs: [{ kind: "source", id: "source-1" }],
        },
      ],
    }),
  );

  assert.equal(diff.rows[0]?.status, "unchanged");
});

test("diffAnalyzeRuns marks rich text content changes as changed", () => {
  const before = runDetail({
    runId: "run-a",
    snapshotId: "11111111-1111-4111-8111-111111111111",
    blocks: [
      {
        id: "old-summary",
        kind: "rich_text",
        title: "Summary",
        data_ref: { kind: "analyze_run", id: "old-summary", params: { playbook_section_id: "summary" } },
        rich_text: { segments: [{ text: "Revenue grew 9%." }] },
      },
    ],
  });
  const after = runDetail({
    runId: "run-b",
    snapshotId: "22222222-2222-4222-8222-222222222222",
    blocks: [
      {
        id: "new-summary",
        kind: "rich_text",
        title: "Summary",
        data_ref: { kind: "analyze_run", id: "new-summary", params: { playbook_section_id: "summary" } },
        rich_text: { segments: [{ text: "Revenue grew 11%." }] },
      },
    ],
  });

  assert.equal(diffAnalyzeRuns(before, after).rows[0]?.status, "changed");
});

test("diffAnalyzeRuns marks table row changes as changed", () => {
  const before = runDetail({
    runId: "run-a",
    snapshotId: "11111111-1111-4111-8111-111111111111",
    blocks: [
      {
        id: "old-table",
        kind: "table",
        title: "Margin bridge",
        data_ref: { kind: "analyze_run", id: "old-table", params: { playbook_section_id: "margin_bridge" } },
        table: { columns: ["Metric", "Value"], rows: [["Gross margin", "42%"]] },
      },
    ],
  });
  const after = runDetail({
    runId: "run-b",
    snapshotId: "22222222-2222-4222-8222-222222222222",
    blocks: [
      {
        id: "new-table",
        kind: "table",
        title: "Margin bridge",
        data_ref: { kind: "analyze_run", id: "new-table", params: { playbook_section_id: "margin_bridge" } },
        table: { columns: ["Metric", "Value"], rows: [["Gross margin", "43%"]] },
      },
    ],
  });

  assert.equal(diffAnalyzeRuns(before, after).rows[0]?.status, "changed");
});

test("diffAnalyzeRuns returns drift summary separately from block rows", () => {
  const unchangedBlock = {
    kind: "rich_text",
    title: "Summary",
    rich_text: { segments: [{ text: "Revenue grew 9%." }] },
    data_ref: { kind: "analyze_run", id: "old-summary", params: { playbook_section_id: "summary" } },
  };
  const before = runDetail({
    runId: "run-a",
    snapshotId: "11111111-1111-4111-8111-111111111111",
    templateVersion: 1,
    playbookVersion: 1,
    blocks: [{ ...unchangedBlock, id: "old-summary", snapshot_id: "11111111-1111-4111-8111-111111111111" }],
  });
  const after = runDetail({
    runId: "run-b",
    snapshotId: "22222222-2222-4222-8222-222222222222",
    templateVersion: 2,
    playbookVersion: 2,
    blocks: [{ ...unchangedBlock, id: "new-summary", snapshot_id: "22222222-2222-4222-8222-222222222222" }],
  });

  const diff = diffAnalyzeRuns(before, after);

  assert.equal(diff.rows[0]?.status, "unchanged");
  assert.deepEqual(diff.summary, {
    template_changed: true,
    evidence_snapshot_changed: true,
    playbook_changed: true,
    template_name_before: "Earnings template",
    template_name_after: "Earnings template",
    template_version_before: 1,
    template_version_after: 2,
    playbook_name_before: "Earnings quality",
    playbook_name_after: "Earnings quality",
    playbook_version_before: 1,
    playbook_version_after: 2,
    snapshot_id_before: "11111111-1111-4111-8111-111111111111",
    snapshot_id_after: "22222222-2222-4222-8222-222222222222",
  });
});

function runDetail(input: {
  runId: string;
  snapshotId: string;
  templateId?: string;
  templateVersion?: number;
  playbookId?: string | null;
  playbookVersion?: number | null;
  blocks: ReadonlyArray<Record<string, unknown>>;
}): Parameters<typeof diffAnalyzeRuns>[0] {
  const templateId = input.templateId ?? "33333333-3333-4333-8333-333333333333";
  const templateVersion = input.templateVersion ?? 1;
  const playbookId = input.playbookId === undefined ? "earnings_quality" : input.playbookId;
  const playbookVersion = input.playbookVersion === undefined ? 1 : input.playbookVersion;
  return {
    run_id: input.runId,
    template_name: "Earnings template",
    playbook_id: playbookId,
    playbook_name: playbookId ? "Earnings quality" : null,
    playbook_version: playbookVersion,
    display_title: "Earnings quality",
    run_metadata: {
      schema_version: 1,
      template_id: templateId,
      template_version: templateVersion,
      playbook_id: playbookId,
      playbook_version: playbookVersion,
      instructions: "Focus on cash conversion.",
      source_categories: ["filings"],
      subject_refs: [],
    },
    can_rerun: true,
    rerun_unavailable_reason: null,
    created_at: "2026-05-29T00:00:00.000Z",
    snapshot_id: input.snapshotId,
    blocks: input.blocks,
  };
}
```

- [ ] **Step 2: Run diff test to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/analyze/runDiff.test.ts
```

Expected: FAIL with module-not-found for `runHistory.ts`.

- [ ] **Step 3: Add playbook and run-history helpers**

Create `web/src/analyze/playbooks.ts`:

```ts
import { authenticatedJson, type FetchImpl } from "../http/authFetch.ts";

export type AnalyzePlaybookSection = {
  section_id: string;
  title: string;
  required: boolean;
  block_hint: string;
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

export async function fetchAnalyzePlaybooks(input: {
  userId: string;
  fetchImpl?: FetchImpl;
}): Promise<ReadonlyArray<AnalyzePlaybook>> {
  const body = await authenticatedJson<{ playbooks: AnalyzePlaybook[] }>("/v1/analyze/playbooks", {
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  });
  return body.playbooks;
}
```

Create `web/src/analyze/runHistory.ts`:

```ts
import { authenticatedJson, type FetchImpl } from "../http/authFetch.ts";

export type AnalyzeRunMetadata = {
  schema_version: 1;
  template_id: string;
  template_version: number;
  playbook_id: string | null;
  playbook_version: number | null;
  instructions: string;
  source_categories: ReadonlyArray<string>;
  subject_refs: ReadonlyArray<{ kind: string; id: string }>;
  rerun_of_run_id?: string;
};

export type AnalyzeRunHistoryItem = {
  run_id: string;
  template_name: string;
  playbook_id: string | null;
  playbook_name: string | null;
  playbook_version: number | null;
  display_title: string;
  run_metadata: AnalyzeRunMetadata | Record<string, unknown>;
  can_rerun: boolean;
  rerun_unavailable_reason: string | null;
  created_at: string;
  snapshot_id: string;
};

export type AnalyzeRunDetail = AnalyzeRunHistoryItem & {
  blocks: ReadonlyArray<Record<string, unknown>>;
};

export type AnalyzeRunDiffRow = {
  status: "added" | "removed" | "changed" | "unchanged";
  key: string;
  title: string;
};

export type AnalyzeRunDiffSummary = {
  template_changed: boolean;
  evidence_snapshot_changed: boolean;
  playbook_changed: boolean;
  template_name_before: string;
  template_name_after: string;
  template_version_before: number | null;
  template_version_after: number | null;
  playbook_name_before: string | null;
  playbook_name_after: string | null;
  playbook_version_before: number | null;
  playbook_version_after: number | null;
  snapshot_id_before: string;
  snapshot_id_after: string;
};

export type AnalyzeRunDiff = {
  summary: AnalyzeRunDiffSummary;
  rows: ReadonlyArray<AnalyzeRunDiffRow>;
};

export type AnalyzeRunListResponse = {
  runs: ReadonlyArray<AnalyzeRunHistoryItem>;
  next_cursor: string | null;
};

export async function fetchAnalyzeRuns(input: {
  userId: string;
  limit?: number;
  cursor?: string | null;
  fetchImpl?: FetchImpl;
}): Promise<AnalyzeRunListResponse> {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);
  const path = params.size > 0 ? `/v1/analyze/runs?${params.toString()}` : "/v1/analyze/runs";
  return authenticatedJson<AnalyzeRunListResponse>(path, {
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  });
}

export async function fetchAnalyzeRun(input: {
  userId: string;
  runId: string;
  fetchImpl?: FetchImpl;
}): Promise<AnalyzeRunDetail> {
  return authenticatedJson<AnalyzeRunDetail>(`/v1/analyze/runs/${input.runId}`, {
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  });
}

export async function rerunAnalyzeRun(input: {
  userId: string;
  runId: string;
  fetchImpl?: FetchImpl;
}): Promise<AnalyzeRunDetail> {
  return authenticatedJson<AnalyzeRunDetail>(`/v1/analyze/runs/${input.runId}/rerun`, {
    method: "POST",
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  });
}

export function isRerunnableRun(run: AnalyzeRunHistoryItem): boolean {
  return run.can_rerun;
}

export function diffAnalyzeRuns(
  before: AnalyzeRunDetail,
  after: AnalyzeRunDetail,
): AnalyzeRunDiff {
  const beforeRows = blockRows(before.blocks);
  const afterRows = blockRows(after.blocks);
  const keys = orderedBlockKeys(before.blocks, after.blocks);
  return {
    summary: diffSummary(before, after),
    rows: keys.map((key) => {
      const left = beforeRows.get(key);
      const right = afterRows.get(key);
      const title = right?.title ?? left?.title ?? key;
      if (left === undefined) return { status: "added", key, title };
      if (right === undefined) return { status: "removed", key, title };
      if (left.signature !== right.signature) return { status: "changed", key, title };
      return { status: "unchanged", key, title };
    }),
  };
}

function diffSummary(before: AnalyzeRunDetail, after: AnalyzeRunDetail): AnalyzeRunDiffSummary {
  const templateVersionBefore = templateVersion(before);
  const templateVersionAfter = templateVersion(after);
  return {
    template_changed: templateId(before) !== templateId(after) || templateVersionBefore !== templateVersionAfter,
    evidence_snapshot_changed: before.snapshot_id !== after.snapshot_id,
    playbook_changed: before.playbook_id !== after.playbook_id || before.playbook_version !== after.playbook_version,
    template_name_before: before.template_name,
    template_name_after: after.template_name,
    template_version_before: templateVersionBefore,
    template_version_after: templateVersionAfter,
    playbook_name_before: before.playbook_name,
    playbook_name_after: after.playbook_name,
    playbook_version_before: before.playbook_version,
    playbook_version_after: after.playbook_version,
    snapshot_id_before: before.snapshot_id,
    snapshot_id_after: after.snapshot_id,
  };
}

function templateId(run: AnalyzeRunHistoryItem): string | null {
  return stringValue(metadataRecord(run.run_metadata).template_id);
}

function templateVersion(run: AnalyzeRunHistoryItem): number | null {
  return numberValue(metadataRecord(run.run_metadata).template_version);
}

function metadataRecord(metadata: AnalyzeRunHistoryItem["run_metadata"]): Record<string, unknown> {
  return isRecord(metadata) ? metadata : {};
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type DiffBlockRow = {
  title: string;
  signature: string;
};

function blockRows(blocks: ReadonlyArray<Record<string, unknown>>): Map<string, DiffBlockRow> {
  return new Map(blocks.map((block) => {
    const key = blockDiffKey(block);
    const title = blockTitle(block);
    return [key, {
      title,
      signature: canonicalBlockDiffSignature(block),
    }];
  }));
}

const VOLATILE_BLOCK_DIFF_FIELDS = new Set(["id", "snapshot_id", "data_ref", "as_of"]);

function canonicalBlockDiffSignature(block: Record<string, unknown>): string {
  return stableJson(canonicalizeBlockContent(block));
}

function canonicalizeBlockContent(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeBlockContent(item));
  }
  if (!isRecord(value)) {
    return value;
  }

  const stripBlockFields = isBlockLikeRecord(value);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (stripBlockFields && VOLATILE_BLOCK_DIFF_FIELDS.has(key)) continue;
    output[key] = canonicalizeBlockContent(child);
  }
  return output;
}

function isBlockLikeRecord(value: Record<string, unknown>): boolean {
  return typeof value.kind === "string" && (
    "title" in value ||
    "snapshot_id" in value ||
    "data_ref" in value ||
    "children" in value
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function orderedBlockKeys(
  before: ReadonlyArray<Record<string, unknown>>,
  after: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const keys: string[] = [];
  const push = (block: Record<string, unknown>) => {
    const key = blockDiffKey(block);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  for (const block of after) push(block);
  for (const block of before) push(block);
  return keys;
}

function blockDiffKey(block: Record<string, unknown>): string {
  return playbookSectionId(block) ?? stringValue(block.id) ?? blockTitle(block) ?? stringValue(block.kind) ?? "Untitled";
}

function blockTitle(block: Record<string, unknown>): string {
  return stringValue(block.title) ?? stringValue(block.id) ?? stringValue(block.kind) ?? "Untitled";
}

function playbookSectionId(block: Record<string, unknown>): string | null {
  const dataRef = isRecord(block.data_ref) ? block.data_ref : {};
  const params = isRecord(dataRef.params) ? dataRef.params : {};
  return stringValue(params.playbook_section_id);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

The diff canonicalizer must be block-aware: strip volatile ids only from block-shaped
objects, not from provenance refs such as `{ kind: "claim", id: "..." }`, because
changing cited evidence is a semantic diff.

- [ ] **Step 4: Update AnalyzePage state and loading**

Modify `web/src/pages/AnalyzePage.tsx` imports:

```tsx
import {
  fetchAnalyzePlaybooks,
  type AnalyzePlaybook,
} from "../analyze/playbooks.ts";
import {
  diffAnalyzeRuns,
  fetchAnalyzeRun,
  fetchAnalyzeRuns,
  isRerunnableRun,
  rerunAnalyzeRun,
  type AnalyzeRunDetail,
  type AnalyzeRunHistoryItem,
} from "../analyze/runHistory.ts";
```

Inside `AnalyzeWorkspace`, keep the existing template state and add playbook/run-history state:

```tsx
const [playbooks, setPlaybooks] = useState<ReadonlyArray<AnalyzePlaybook>>([]);
const [selectedPlaybookId, setSelectedPlaybookId] = useState("earnings_quality");
const selectedPlaybook = playbooks.find((playbook) => playbook.playbook_id === selectedPlaybookId);
const selectedTemplate = templates.find((template) => template.template_id === selectedTemplateId) ?? templates[0];
const [runHistory, setRunHistory] = useState<ReadonlyArray<AnalyzeRunHistoryItem>>([]);
const [runHistoryCursor, setRunHistoryCursor] = useState<string | null>(null);
const [compareRunId, setCompareRunId] = useState<string>("");
const [openedRunDetails, setOpenedRunDetails] = useState<Record<string, AnalyzeRunDetail>>({});
```

Add this effect:

```tsx
useEffect(() => {
  if (!session) return;
  const controller = new AbortController();
  Promise.all([
    authenticatedJson<{ templates?: AnalyzeTemplate[] }>("/v1/analyze/templates", { userId: session.userId, fetchImpl: (input, init) => fetch(input, { ...init, signal: controller.signal }) }),
    fetchAnalyzePlaybooks({ userId: session.userId, fetchImpl: (input, init) => fetch(input, { ...init, signal: controller.signal }) }),
    fetchAnalyzeRuns({ userId: session.userId, limit: 25, fetchImpl: (input, init) => fetch(input, { ...init, signal: controller.signal }) }),
  ])
    .then(([templateBody, nextPlaybooks, nextRunPage]) => {
      if (controller.signal.aborted) return;
      if (templateBody.templates?.length) {
        setTemplates(templateBody.templates);
        setSelectedTemplateId(templateBody.templates[0].template_id);
      }
      setPlaybooks(nextPlaybooks);
      setRunHistory(nextRunPage.runs);
      setRunHistoryCursor(nextRunPage.next_cursor);
      const first = nextPlaybooks[0];
      if (first) {
        setSelectedPlaybookId(first.playbook_id);
        setInstructions(first.default_instructions);
        setSources(new Set(first.default_source_categories));
      }
    })
    .catch(() => undefined);
  return () => controller.abort();
}, [session]);
```

- [ ] **Step 5: Send playbook_id when generating memos**

Modify the `generateMemo` body payload:

```tsx
body: JSON.stringify({
  playbook_id: selectedPlaybook?.playbook_id ?? selectedPlaybookId,
  template_id: selectedTemplate.template_id,
  instructions,
  source_categories: [...sources],
  subject_ref: subject?.subject_ref ?? null,
}),
```

After a successful run:

```tsx
setOpenedRunDetails((current) => ({ ...current, [run.run_id]: run as AnalyzeRunDetail }));
setRunHistory((current) => [toAnalyzeRunHistoryItem(run as AnalyzeRunDetail), ...current.filter((item) => item.run_id !== run.run_id)]);
```

Add open and rerun handling that fetches full run details only when needed:

```tsx
async function handleOpenRun(runId: string) {
  if (!session) return;
  const cached = openedRunDetails[runId];
  const run = cached ?? await fetchAnalyzeRun({ userId: session.userId, runId });
  if (!cached) setOpenedRunDetails((current) => ({ ...current, [run.run_id]: run }));
  setMemoRun(run as AnalyzeRun);
}

async function handleRerun(runId: string) {
  if (!session) return;
  const run = await rerunAnalyzeRun({ userId: session.userId, runId });
  setOpenedRunDetails((current) => ({ ...current, [run.run_id]: run }));
  setRunHistory((current) => [toAnalyzeRunHistoryItem(run), ...current.filter((item) => item.run_id !== run.run_id)]);
  setMemoRun(run as AnalyzeRun);
}

async function handleLoadMoreRuns() {
  if (!session || !runHistoryCursor) return;
  const page = await fetchAnalyzeRuns({ userId: session.userId, cursor: runHistoryCursor, limit: 25 });
  setRunHistory((current) => [...current, ...page.runs]);
  setRunHistoryCursor(page.next_cursor);
}

function toAnalyzeRunHistoryItem(run: AnalyzeRunDetail): AnalyzeRunHistoryItem {
  const { blocks: _blocks, ...summary } = run;
  return summary;
}
```

- [ ] **Step 6: Render playbook picker, section preview, history, and diff**

Render a playbook selector above the existing template selector, not instead of it:

```tsx
<label className="flex flex-col gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
  Playbook
  <select
    value={selectedPlaybookId}
    onChange={(event) => {
      const next = playbooks.find((playbook) => playbook.playbook_id === event.currentTarget.value);
      if (!next) return;
      setSelectedPlaybookId(next.playbook_id);
      setInstructions(next.default_instructions);
      setSources(new Set(next.default_source_categories));
      setMemoRun(null);
      setStatus("Ready");
    }}
    className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
  >
    {playbooks.map((playbook) => (
      <option key={playbook.playbook_id} value={playbook.playbook_id}>
        {playbook.name}
      </option>
    ))}
  </select>
</label>
{selectedPlaybook ? (
  <section className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
    <h3 className="font-medium text-neutral-900 dark:text-neutral-100">Sections</h3>
    <ul className="mt-2 flex flex-col gap-1 text-neutral-600 dark:text-neutral-300">
      {selectedPlaybook.sections.map((section) => (
        <li key={section.section_id}>{section.title}</li>
      ))}
    </ul>
  </section>
) : null}
```

Keep the executable template selector below the playbook selector. The playbook can
set default instructions/source policy, but `template_id` must remain explicit because
durable runs execute a user-owned `AnalyzeTemplate`.

Add a history panel below the memo canvas:

```tsx
{runHistory.length > 0 ? (
  <section className="mt-6 rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
    <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Run history</h2>
    <ul className="mt-3 flex flex-col gap-2">
      {runHistory.map((run) => (
        <li key={run.run_id} className="flex items-center justify-between gap-3 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
          <span>{run.display_title} · {run.playbook_version ? `v${run.playbook_version}` : run.template_name} · {run.created_at}</span>
          <button type="button" className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700" onClick={() => void handleOpenRun(run.run_id)}>
            Open
          </button>
          <button type="button" className="rounded-md border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700" disabled={!isRerunnableRun(run)} title={isRerunnableRun(run) ? "Rerun" : run.rerun_unavailable_reason ?? "This run cannot be rerun"} onClick={() => void handleRerun(run.run_id)}>
            Rerun
          </button>
        </li>
      ))}
    </ul>
    {runHistoryCursor ? (
      <button type="button" className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700" onClick={() => void handleLoadMoreRuns()}>
        Load more
      </button>
    ) : null}
  </section>
) : null}
```

Render diff only after both full run details are available:

```tsx
const compareRunDetail = compareRunId ? openedRunDetails[compareRunId] : null;
const memoRunDetail = memoRun ? openedRunDetails[memoRun.run_id] ?? (memoRun as AnalyzeRunDetail) : null;
const runDiff = memoRunDetail && compareRunDetail ? diffAnalyzeRuns(compareRunDetail, memoRunDetail) : null;
const runDiffDriftLabels = runDiff ? [
  runDiff.summary.evidence_snapshot_changed ? "Evidence snapshot changed" : null,
  runDiff.summary.template_changed ? `Template changed v${runDiff.summary.template_version_before ?? "?"} -> v${runDiff.summary.template_version_after ?? "?"}` : null,
  runDiff.summary.playbook_changed ? `Playbook changed v${runDiff.summary.playbook_version_before ?? "?"} -> v${runDiff.summary.playbook_version_after ?? "?"}` : null,
].filter((label): label is string => label !== null) : [];
```

When the user selects a run for comparison, call a small `fetchAnalyzeRun` wrapper
that stores the detail in `openedRunDetails` without changing the currently opened
memo.
Keep diff computation client-side for this slice. Do not add a server-side diff
endpoint until we need cross-client saved comparisons or heavier evidence-aware diff
queries.

```tsx
{runDiff ? (
  <section className="mt-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
    <h3 className="text-sm font-semibold">Run diff</h3>
    {runDiffDriftLabels.length > 0 ? (
      <ul className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600 dark:text-neutral-300">
        {runDiffDriftLabels.map((label) => (
          <li key={label} className="rounded border border-neutral-200 px-2 py-1 dark:border-neutral-800">{label}</li>
        ))}
      </ul>
    ) : null}
    <ul className="mt-2 text-sm">
      {runDiff.rows.map((row) => (
        <li key={`${row.status}:${row.title}`}>{row.status}: {row.title}</li>
      ))}
    </ul>
  </section>
) : null}
```

- [ ] **Step 7: Run web tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/analyze/runDiff.test.ts src/pages/workflowSurfaces.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/analyze/playbooks.ts web/src/analyze/runHistory.ts web/src/analyze/runDiff.test.ts web/src/pages/AnalyzePage.tsx web/src/pages/workflowSurfaces.test.tsx
git commit -m "feat(web): add guided analyze playbooks"
```
