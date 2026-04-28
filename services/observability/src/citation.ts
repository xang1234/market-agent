import type { QueryExecutor } from "./types.ts";

export type CitationRefKind = "fact" | "claim" | "event" | string;

export type CitationLogInput = {
  snapshot_id: string;
  block_id: string;
  ref_kind: CitationRefKind;
  ref_id: string;
  source_id?: string | null;
};

export type CitationLogRow = {
  citation_log_id: string;
  created_at: Date;
};

export type CitationLogBlock = {
  id: string;
  kind: string;
  snapshot_id: string;
  source_refs?: ReadonlyArray<string>;
  segments?: ReadonlyArray<unknown>;
  children?: ReadonlyArray<CitationLogBlock>;
  items?: ReadonlyArray<unknown>;
  bars?: ReadonlyArray<unknown>;
  distribution?: ReadonlyArray<unknown>;
  quarters?: ReadonlyArray<unknown>;
  analyst_count_ref?: string;
  current_price_ref?: string;
  low_ref?: string;
  avg_ref?: string;
  high_ref?: string;
  upside_ref?: string;
  claim_refs?: ReadonlyArray<string>;
  event_refs?: ReadonlyArray<string>;
  fact_refs?: ReadonlyArray<string>;
};

// Writes a row to citation_logs. `snapshot_id` is required and references
// snapshots(snapshot_id) — callers must create the snapshot first.
export async function writeCitationLog(
  db: QueryExecutor,
  input: CitationLogInput,
): Promise<CitationLogRow> {
  const { rows } = await db.query<CitationLogRow>(
    `insert into citation_logs
       (snapshot_id, block_id, ref_kind, ref_id, source_id)
     values ($1, $2, $3, $4, $5)
     returning citation_log_id, created_at`,
    [input.snapshot_id, input.block_id, input.ref_kind, input.ref_id, input.source_id ?? null],
  );
  return rows[0];
}

export async function writeCitationLogsForBlocks(
  db: QueryExecutor,
  blocks: ReadonlyArray<CitationLogBlock>,
): Promise<ReadonlyArray<CitationLogRow>> {
  const rows: CitationLogRow[] = [];

  for (const input of citationLogInputsForBlocks(blocks)) {
    rows.push(await writeCitationLog(db, input));
  }

  return Object.freeze(rows);
}

export function citationLogInputsForBlocks(
  blocks: ReadonlyArray<CitationLogBlock>,
): ReadonlyArray<CitationLogInput> {
  const rows: CitationLogInput[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    collectBlockCitationInputs(block, rows, seen);
  }

  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function collectBlockCitationInputs(
  block: CitationLogBlock,
  rows: CitationLogInput[],
  seen: Set<string>,
): void {
  const source_id = primarySourceId(block);

  for (const ref of extractBlockRefs(block)) {
    const row = {
      snapshot_id: block.snapshot_id,
      block_id: block.id,
      ref_kind: ref.ref_kind,
      ref_id: ref.ref_id,
      source_id,
    };
    const key = [
      row.snapshot_id,
      row.block_id,
      row.ref_kind,
      row.ref_id,
      row.source_id ?? "",
    ].join("\u0000");
    if (!seen.has(key)) {
      seen.add(key);
      rows.push(row);
    }
  }

  for (const child of block.children ?? []) {
    collectBlockCitationInputs(child, rows, seen);
  }
}

function primarySourceId(block: CitationLogBlock): string | null {
  const [sourceId] = block.source_refs ?? [];
  return typeof sourceId === "string" && sourceId.length > 0 ? sourceId : null;
}

function extractBlockRefs(
  block: CitationLogBlock,
): ReadonlyArray<{ ref_kind: CitationRefKind; ref_id: string }> {
  const refs: Array<{ ref_kind: CitationRefKind; ref_id: string }> = [];

  if (block.kind === "rich_text") {
    for (const segment of block.segments ?? []) {
      if (!isRecord(segment) || segment.type !== "ref") {
        continue;
      }
      pushRef(refs, segment.ref_kind, segment.ref_id);
    }
  }

  if (block.kind === "metric_row") {
    for (const item of block.items ?? []) {
      if (!isRecord(item)) {
        continue;
      }
      pushRef(refs, "fact", item.value_ref);
      pushRef(refs, "fact", item.delta_ref);
    }
  }

  if (block.kind === "revenue_bars") {
    for (const bar of block.bars ?? []) {
      if (!isRecord(bar)) {
        continue;
      }
      pushRef(refs, "fact", bar.value_ref);
      pushRef(refs, "fact", bar.delta_ref);
    }
  }

  if (block.kind === "segment_donut") {
    for (const segment of block.segments ?? []) {
      if (!isRecord(segment)) {
        continue;
      }
      pushRef(refs, "fact", segment.value_ref);
    }
  }

  if (block.kind === "analyst_consensus") {
    pushRef(refs, "fact", block.analyst_count_ref);
    for (const item of block.distribution ?? []) {
      if (!isRecord(item)) {
        continue;
      }
      pushRef(refs, "fact", item.count_ref);
    }
  }

  if (block.kind === "price_target_range") {
    pushRef(refs, "fact", block.current_price_ref);
    pushRef(refs, "fact", block.low_ref);
    pushRef(refs, "fact", block.avg_ref);
    pushRef(refs, "fact", block.high_ref);
    pushRef(refs, "fact", block.upside_ref);
  }

  if (block.kind === "eps_surprise") {
    for (const quarter of block.quarters ?? []) {
      if (!isRecord(quarter)) {
        continue;
      }
      pushRef(refs, "fact", quarter.estimate_ref);
      pushRef(refs, "fact", quarter.actual_ref);
      pushRef(refs, "fact", quarter.surprise_ref);
    }
  }

  pushArrayRefs(refs, "fact", block.fact_refs);
  pushArrayRefs(refs, "claim", block.claim_refs);
  pushArrayRefs(refs, "event", block.event_refs);

  return Object.freeze(refs);
}

function pushArrayRefs(
  refs: Array<{ ref_kind: CitationRefKind; ref_id: string }>,
  ref_kind: CitationRefKind,
  values: ReadonlyArray<string> | undefined,
): void {
  for (const value of values ?? []) {
    pushRef(refs, ref_kind, value);
  }
}

function pushRef(
  refs: Array<{ ref_kind: CitationRefKind; ref_id: string }>,
  ref_kind: unknown,
  ref_id: unknown,
): void {
  if (
    typeof ref_kind === "string" &&
    ref_kind.length > 0 &&
    typeof ref_id === "string" &&
    ref_id.length > 0
  ) {
    refs.push({ ref_kind, ref_id });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
