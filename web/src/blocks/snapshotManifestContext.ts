import { createContext, useContext } from 'react'
import type { SnapshotManifest } from './snapshotManifest.ts'

export const SnapshotManifestContext = createContext<SnapshotManifest | null>(null)

export function useSnapshotManifest(): SnapshotManifest | null {
  return useContext(SnapshotManifestContext)
}
