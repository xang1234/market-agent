# Fundamentals

Tracking beads: `fra-cw0.3` (and child beads `fra-cw0.3.1` … `fra-cw0.3.4`).

The fundamentals service: the issuer-anchored layer that turns
filing-backed or vendor-backed statement inputs into canonical value
objects keyed by metric definitions (spec §6.3.1).

`fra-cw0.3.1` lands the canonical statement value object (this module).
Sibling beads finish the picture:

- `fra-cw0.3.2` — fiscal-calendar normalization (derives `fiscal_year`,
  `fiscal_period`, `period_start`/`period_end`).
- `fra-cw0.3.3` — metric mapper (`metric_key` → `metrics.metric_id`).
- `fra-cw0.3.4` — SEC EDGAR primary-source anchor (populates
  `sources.source_id` and feeds the normalizer for US issuers).

## Commands

```bash
cd services/fundamentals
npm test         # contract + AAPL FY2024 income statement verification
```

## Contract notes

- Statement reads anchor on **issuer** identity (not listing or ticker);
  fra-6al.4 / P0.3b is the upstream subject handoff.
- The three statement families are explicit: `income`, `balance`,
  `cashflow`. They are never collapsed into a single "fundamentals" blob.
- Statement basis is explicit: `as_reported` and `as_restated` are
  distinct normalization modes and must not be silently merged. A
  restatement is a separate `NormalizedStatement` whose later promotion
  path (`facts.supersedes` / `superseded_by`) keeps the original visible.
- Period selection, fiscal labels, scale, and unit are part of the
  contract, not caller-side cleanup. `value_num × scale` resolves to the
  native unit (e.g. millions × 1_000_000 = native USD).
- A line whose `value_num` is `null` MUST carry `coverage_level !=
  "full"`; this preserves coverage when source material is incomplete or
  pending promotion instead of inventing a UI-only "unknown" cell.
