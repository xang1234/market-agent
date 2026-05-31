# Task 4: Inspectable Block Renderers


**Files:**
- Create: `web/src/evidence/InspectableRef.tsx`
- Create: `web/src/evidence/inspectableRefs.ts`
- Test: `web/src/evidence/inspectableRefs.test.ts`
- Modify: `web/src/blocks/RichText.tsx`
- Modify: `web/src/blocks/MetricRow.tsx`
- Modify: `web/src/blocks/Sources.tsx`
- Test: `web/src/blocks/richText.test.ts`
- Test: `web/src/blocks/metricRow.test.ts`
- Test: `web/src/blocks/fixtures.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Create `web/src/evidence/inspectableRefs.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { extractInspectableRefs } from "./inspectableRefs.ts";

const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
const FACT_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_ID = "44444444-4444-4444-8444-444444444444";
const DOCUMENT_ID = "55555555-5555-4555-8555-555555555555";
const DELTA_FACT_ID = "66666666-6666-4666-8666-666666666666";

test("extractInspectableRefs derives schema-native refs from blocks", () => {
  const refs = extractInspectableRefs({
    id: "metric-row-1",
    kind: "metric_row",
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: "metric_row", id: "metric-row-1" },
    source_refs: [SOURCE_ID],
    claim_refs: [CLAIM_ID],
    as_of: "2026-05-29T00:00:00.000Z",
    items: [{ label: "Revenue", value_ref: FACT_ID }],
  });

  assert.deepEqual(refs.map((ref) => `${ref.ref.kind}:${ref.ref.id}`), [
    `source:${SOURCE_ID}`,
    `claim:${CLAIM_ID}`,
    `fact:${FACT_ID}`,
  ]);
});

test("extractInspectableRefs mirrors verifier refs for nested chart and research blocks", () => {
  const refs = extractInspectableRefs({
    id: "section-1",
    kind: "section",
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: "section", id: "section-1" },
    source_refs: [],
    as_of: "2026-05-29T00:00:00.000Z",
    children: [
      {
        id: "revenue-bars-1",
        kind: "revenue_bars",
        snapshot_id: SNAPSHOT_ID,
        data_ref: { kind: "revenue_bars", id: "revenue-bars-1" },
        source_refs: [],
        as_of: "2026-05-29T00:00:00.000Z",
        bars: [{ label: "Revenue", value_ref: FACT_ID, delta_ref: DELTA_FACT_ID }],
      },
      {
        id: "news-1",
        kind: "news_cluster",
        snapshot_id: SNAPSHOT_ID,
        data_ref: { kind: "news_cluster", id: "news-1" },
        source_refs: [],
        as_of: "2026-05-29T00:00:00.000Z",
        cluster_id: "cluster-1",
        headline: "Channel checks improved",
        claim_refs: [CLAIM_ID],
        document_refs: [DOCUMENT_ID],
      },
    ],
  });

  assert.deepEqual(refs.map((ref) => `${ref.ref.kind}:${ref.ref.id}`), [
    `fact:${FACT_ID}`,
    `fact:${DELTA_FACT_ID}`,
    `claim:${CLAIM_ID}`,
    `document:${DOCUMENT_ID}`,
  ]);
});
```

Add a test to `web/src/blocks/metricRow.test.ts`:

```ts
test("MetricRow renders value refs as inspectable controls", () => {
  const block: MetricRowBlock = {
    id: "metric-row-1",
    kind: "metric_row",
    snapshot_id: "11111111-1111-4111-8111-111111111111",
    data_ref: { kind: "metric_row", id: "metric-row-1" },
    source_refs: [],
    as_of: "2026-05-29T00:00:00.000Z",
    items: [{ label: "Revenue", value_ref: "22222222-2222-4222-8222-222222222222" }],
  };
  const html = renderToStaticMarkup(<MetricRow block={block} />);
  assert.match(html, /data-inspection-kind="fact"/);
  assert.match(html, /data-inspection-id="22222222-2222-4222-8222-222222222222"/);
});

test("MetricRow inspectable controls render outside the shell inspector provider", () => {
  const block: MetricRowBlock = {
    id: "metric-row-1",
    kind: "metric_row",
    snapshot_id: "11111111-1111-4111-8111-111111111111",
    data_ref: { kind: "metric_row", id: "metric-row-1" },
    source_refs: [],
    as_of: "2026-05-29T00:00:00.000Z",
    items: [{ label: "Revenue", value_ref: "22222222-2222-4222-8222-222222222222", format: "$85.8B" }],
  };
  const html = renderToStaticMarkup(<MetricRow block={block} />);
  assert.match(html, /\$85\.8B/);
  assert.match(html, /data-inspection-disabled="true"/);
});
```

- [ ] **Step 2: Run renderer test to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/blocks/metricRow.test.ts
```

Expected: FAIL because the shared inspectable-ref helper and metric controls do not exist yet.

- [ ] **Step 3: Add inspectable-ref helper and wrapper**

Create `web/src/evidence/inspectableRefs.ts`:

```ts
import type { Block } from "../blocks/types.ts";
import type { EvidenceInspectionRef } from "./inspectionTypes.ts";

export type InspectableBlockRef = {
  snapshotId: string;
  ref: EvidenceInspectionRef;
};

export function extractInspectableRefs(block: Block): ReadonlyArray<InspectableBlockRef> {
  const refs: InspectableBlockRef[] = [];
  collectBlockRefs(block as Record<string, unknown>, refs);
  return dedupeInspectableRefs(refs);
}

// Keep this aligned with services/snapshot/src/snapshot-verifier.ts extractBlockRefs.
function collectBlockRefs(block: Record<string, unknown>, refs: InspectableBlockRef[]): void {
  const snapshotId = stringValue(block.snapshot_id);
  const push = (kind: EvidenceInspectionRef["kind"], id: unknown) => {
    const value = stringValue(id);
    if (snapshotId !== null && value !== null) {
      refs.push({ snapshotId, ref: { kind, id: value } });
    }
  };

  pushArrayRefs(block, "source_refs", "source", push);

  if (block.kind === "section") {
    for (const child of arrayValue(block.children)) {
      if (isRecord(child)) collectBlockRefs(child, refs);
    }
  }

  if (block.kind === "rich_text") {
    for (const segment of arrayValue(block.segments)) {
      if (isRecord(segment) && segment.type === "ref" && isInspectionKind(segment.ref_kind)) {
        push(segment.ref_kind, segment.ref_id);
      }
    }
  }

  if (block.kind === "metric_row") {
    for (const item of arrayValue(block.items)) {
      if (!isRecord(item)) continue;
      push("fact", item.value_ref);
      push("fact", item.delta_ref);
    }
  }

  if (block.kind === "revenue_bars") {
    for (const bar of arrayValue(block.bars)) {
      if (!isRecord(bar)) continue;
      push("fact", bar.value_ref);
      push("fact", bar.delta_ref);
    }
  }

  if (block.kind === "segment_donut") {
    for (const segment of arrayValue(block.segments)) {
      if (isRecord(segment)) push("fact", segment.value_ref);
    }
  }

  if (block.kind === "analyst_consensus") {
    push("fact", block.analyst_count_ref);
    for (const item of arrayValue(block.distribution)) {
      if (isRecord(item)) push("fact", item.count_ref);
    }
  }

  if (block.kind === "price_target_range") {
    push("fact", block.current_price_ref);
    push("fact", block.low_ref);
    push("fact", block.avg_ref);
    push("fact", block.high_ref);
    push("fact", block.upside_ref);
  }

  if (block.kind === "eps_surprise") {
    for (const quarter of arrayValue(block.quarters)) {
      if (!isRecord(quarter)) continue;
      push("fact", quarter.estimate_ref);
      push("fact", quarter.actual_ref);
      push("fact", quarter.surprise_ref);
    }
  }

  if (block.kind === "sources") {
    for (const item of arrayValue(block.items)) {
      if (isRecord(item)) push("source", item.source_id);
    }
  }

  if (block.kind === "news_cluster" || block.kind === "filings_list") {
    for (const item of arrayValue(block.items)) {
      if (isRecord(item)) push("document", item.document_id);
    }
  }

  pushArrayRefs(block, "fact_refs", "fact", push);
  pushArrayRefs(block, "claim_refs", "claim", push);
  pushArrayRefs(block, "event_refs", "event", push);
  pushArrayRefs(block, "document_refs", "document", push);
}

function pushArrayRefs(
  block: Record<string, unknown>,
  key: "source_refs" | "fact_refs" | "claim_refs" | "event_refs" | "document_refs",
  kind: EvidenceInspectionRef["kind"],
  push: (kind: EvidenceInspectionRef["kind"], id: unknown) => void,
): void {
  for (const id of arrayValue(block[key])) push(kind, id);
}

function dedupeInspectableRefs(refs: InspectableBlockRef[]): ReadonlyArray<InspectableBlockRef> {
  const seen = new Set<string>();
  return Object.freeze(refs.filter(({ snapshotId, ref }) => {
    const key = `${snapshotId}:${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function arrayValue(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function isInspectionKind(value: unknown): value is EvidenceInspectionRef["kind"] {
  return value === "source" || value === "document" || value === "claim" || value === "event" || value === "fact";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

Create `web/src/evidence/InspectableRef.tsx`:

```tsx
import type { ReactNode } from "react";

import { useEvidenceInspector } from "./EvidenceInspectorProvider.tsx";
import type { EvidenceInspectionRef } from "./inspectionTypes.ts";

export function InspectableRef({
  snapshotId,
  ref,
  children,
  className,
}: {
  snapshotId: string;
  ref: EvidenceInspectionRef;
  children: ReactNode;
  className?: string;
}) {
  const inspector = useEvidenceInspector();
  if (inspector === null) {
    return (
      <span
        data-inspection-kind={ref.kind}
        data-inspection-id={ref.id}
        data-inspection-disabled="true"
        className={className}
      >
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-inspection-kind={ref.kind}
      data-inspection-id={ref.id}
      onClick={() => inspector.openInspection({ snapshotId, ref })}
      className={className ?? "text-left underline decoration-dotted underline-offset-2"}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Make metric rows inspectable through the helper**

Modify `web/src/blocks/MetricRow.tsx`:

```tsx
import { InspectableRef } from "../evidence/InspectableRef.tsx";
import { extractInspectableRefs } from "../evidence/inspectableRefs.ts";
```

Change `MetricChip` props and call site:

```tsx
{block.items.map((cell, index) => (
  <MetricChip key={`${block.id}-${index}`} snapshotId={block.snapshot_id} blockId={block.id} index={index} cell={cell} />
))}
```

```tsx
type MetricChipProps = { snapshotId: string; blockId: string; index: number; cell: MetricCell };

function MetricChip({ snapshotId, blockId, index, cell }: MetricChipProps): ReactElement {
  return (
    <li
      data-testid={`block-metric-row-${blockId}-cell-${index}`}
      data-value-ref={cell.value_ref}
      data-delta-ref={cell.delta_ref}
      className="flex flex-col gap-0.5 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <span className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {cell.label}
      </span>
      <InspectableRef
        snapshotId={snapshotId}
        ref={{ kind: "fact", id: cell.value_ref }}
        className="text-left text-sm font-medium text-neutral-900 underline decoration-dotted underline-offset-2 dark:text-neutral-100"
      >
        {metricCellDisplayValue(cell)}
      </InspectableRef>
      {metricCellHasDelta(cell) ? (
        <span className="text-xs text-neutral-500 dark:text-neutral-400" data-testid={`block-metric-row-${blockId}-cell-${index}-delta`}>
          Δ pending
        </span>
      ) : null}
    </li>
  );
}
```

Use `extractInspectableRefs(block)` to derive the fact ref passed into each chip, rather than deriving the ref ad hoc in the renderer. The simple implementation can map `cell.value_ref` to the matching helper result for that block.

- [ ] **Step 5: Make rich text refs and source rows inspectable**

In `web/src/blocks/RichText.tsx`, wrap `ref` segments:

```tsx
<InspectableRef
  key={`${block.id}-${index}`}
  snapshotId={block.snapshot_id}
  ref={{ kind: segment.ref_kind, id: segment.ref_id }}
>
  {resolved.state === "resolved" ? resolved.value : segment.ref_id}
</InspectableRef>
```

In `web/src/blocks/Sources.tsx`, add `snapshotId` to `SourceRow` and wrap the source label:

```tsx
<InspectableRef
  snapshotId={snapshotId}
  ref={{ kind: "source", id: item.source_id }}
  className="text-left underline decoration-neutral-300 hover:decoration-neutral-500 dark:decoration-neutral-600"
>
  {item.label}
</InspectableRef>
```

When `item.url` exists, keep the external link as a separate small `Open` link so inspection and navigation are distinct.

- [ ] **Step 6: Run block tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/evidence/inspectableRefs.test.ts src/blocks/metricRow.test.ts src/blocks/richText.test.ts src/blocks/fixtures.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/evidence/InspectableRef.tsx web/src/evidence/inspectableRefs.ts web/src/evidence/inspectableRefs.test.ts web/src/blocks/RichText.tsx web/src/blocks/MetricRow.tsx web/src/blocks/Sources.tsx web/src/blocks/*.test.ts
git commit -m "feat(blocks): make snapshot refs inspectable"
```
