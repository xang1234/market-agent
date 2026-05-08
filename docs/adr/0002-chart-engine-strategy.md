# ADR 0002: Chart Engine Strategy

## Status

Accepted.

## Context

`stock-agent-v2.md` originally listed TradingView Lightweight Charts for price/performance blocks, Recharts or Visx for smaller analytical blocks, and Motion for animation. The current implementation renders block charts with typed React components and small SVG renderers:

- `SeriesChart` for `line_chart`, `sentiment_trend`, `mention_volume`, and `segment_trajectory`;
- SVG/HTML renderers for `revenue_bars`, `perf_comparison`, segment, consensus, and related analytical blocks;
- backend snapshot transform endpoints as the boundary for old-message chart interactions.

This is functional and keeps chart rendering inside the same BlockRegistry and snapshot contract as the rest of the UI. It also avoids a chart dependency before the product has finalized which interactions need a full chart engine.

## Decision

Keep the hand-rolled SVG/HTML chart renderers for the current app stage. Treat TradingView Lightweight Charts, Recharts, Visx, and Motion as optional future dependencies, not current requirements.

The current renderers are acceptable for:

- static and lightly interactive Block[] artifacts;
- old assistant messages that remain pinned to `snapshot_id` and use backend transform routes for allowed interactions;
- compact analytical blocks where visual grammar is simple and easier to verify with deterministic fixtures.

## Constraints

Chart blocks must still satisfy the snapshot contract:

- chart state is scoped to a sealed snapshot;
- transform requests go through backend routes keyed by `snapshot_id`;
- changing basis, normalization, peer set, subject set, or freshness boundary requires refresh rather than in-place mutation;
- tests must keep chart geometry and block schema behavior deterministic.

## Migration Triggers

Adopt TradingView Lightweight Charts for price/performance blocks if the product needs:

- pan/zoom/crosshair interactions;
- dense intraday or multi-year time series;
- synchronized chart panes;
- production-grade performance for large bar sets.

Adopt Recharts or Visx for analytical blocks if the product needs:

- complex axes, tooltips, legends, brushing, or stacked/composed layouts;
- accessibility features that become expensive to maintain by hand;
- chart behaviors repeated across enough block kinds to justify a shared engine.

Adopt Motion when animated transitions become part of the product language rather than isolated polish.

## Consequences

This documents the current divergence from the original stack list. It keeps the renderer deterministic and dependency-light now, while preserving clear criteria for moving specific block families to dedicated chart libraries later.
