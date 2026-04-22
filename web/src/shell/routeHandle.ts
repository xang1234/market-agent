// Route-level metadata for the in-shell auth gate (bead fra-6al.2.3).
// Attached to a <Route> via its `handle` prop; consumed by RouteScopeGate
// which walks useMatches() to decide whether to render the matched route
// content or the AuthGate.
//
// Declarative scope replaces the per-route <ProtectedSurface> wrapper used
// earlier — route protection is now a data attribute on the route table,
// not a JSX wrapper. Child routes inherit parent scope for free via the
// matches chain.
export type RouteScope = 'public' | 'protected'

export type RouteHandle = {
  scope: RouteScope
  // Required when scope === 'protected' — shown in the auth gate as the
  // destination label ("Sign in to continue to Chat"). Not enforced by the
  // type system because handle is structurally typed by React Router; see
  // resolveRouteHandle for the runtime check.
  label?: string
}

export function isRouteHandle(v: unknown): v is RouteHandle {
  if (!v || typeof v !== 'object') return false
  const scope = (v as { scope?: unknown }).scope
  return scope === 'public' || scope === 'protected'
}

// Walk matches deepest-first, return the first valid RouteHandle. "Deepest
// wins" lets a child route explicitly override a parent's scope — e.g., a
// hypothetical public sub-route inside an otherwise-protected tree.
export function resolveRouteHandle(
  matches: ReadonlyArray<{ handle: unknown }>,
): RouteHandle | null {
  for (let i = matches.length - 1; i >= 0; i--) {
    const h = matches[i].handle
    if (isRouteHandle(h)) return h
  }
  return null
}
