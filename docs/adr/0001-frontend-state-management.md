# ADR 0001: Frontend State Management

## Status

Accepted.

## Context

`stock-agent-v2.md` originally listed TanStack Query for server state and Zustand for local UI state. The implemented web client instead uses React state primitives (`useState`, `useReducer`) and focused React contexts for shell-wide concerns such as auth, theme, right rail content, watchlist membership, and protected-action resumption.

The current app is still small enough that most server state is page-local and request-scoped. Introducing a global server-state cache now would add cache invalidation and query-key policy before the product has enough shared read paths to justify it.

## Decision

Keep the current React-native state approach for the present stage:

- Page-local server state may stay in component state when it is fetched by one route and discarded on route exit.
- Shared UI state may use small React context providers when the state belongs to the workspace shell.
- Reducers are preferred for event streams or state machines, such as chat SSE turn state.
- Do not add TanStack Query or Zustand until a concrete cross-surface cache/store need appears.

## Migration Triggers

Revisit TanStack Query when at least one of these is true:

- the same server resource is fetched and invalidated by multiple routes;
- stale-while-revalidate behavior is required for quotes, findings, or chat history;
- optimistic mutation handling becomes duplicated across pages;
- pagination, polling, retries, or background refetch policy becomes common enough to centralize.

Revisit Zustand when at least one of these is true:

- non-shell UI state must be shared across distant route branches;
- selection, chart-range, or panel state must survive route transitions without becoming URL state;
- context provider nesting or rerender boundaries start causing measurable complexity.

## Consequences

This ratifies the implementation as a deliberate divergence from the original stack list. It keeps dependency and cache policy surface area small, while preserving a clear migration path for TanStack Query and Zustand when shared state pressure becomes real.
