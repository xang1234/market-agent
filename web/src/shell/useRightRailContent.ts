import { useEffect, type DependencyList, type ReactNode } from 'react'
import { useRightRail } from './useRightRail'

// Push content into the shell-owned right rail for the lifetime of the calling
// surface, clearing it on unmount so a tab without a rail falls back to the
// empty landmark (RightRailSlot). The rail node is re-applied only when `deps`
// change — include any dynamic values the node closes over (e.g. a saved-
// screens list) so the rail refreshes in step with the surface, mirroring the
// dependency contract of useEffect/useMemo.
export function useRightRailContent(content: ReactNode, deps: DependencyList): void {
  const { setContent } = useRightRail()
  useEffect(() => {
    setContent(content)
    return () => setContent(null)
    // `content` is deliberately not a dep — `deps` is the explicit refresh key,
    // and `setContent` is a stable context setter (parent state, not local), so
    // this push/clear is the standard portal pattern rather than a re-render
    // cascade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
