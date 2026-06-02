import { useFetched, type VisibleFetchState } from './useFetched.ts'
import {
  consensusBelongsToIssuer,
  fetchConsensus,
  type AnalystConsensusEnvelope,
} from './consensus.ts'

// Shared analyst-consensus fetch for the symbol sections that surface it
// (Overview + Earnings). Wraps useFetched with the issuer ownership guard so the
// fetch-and-verify closure isn't copy-pasted per section. Returns idle when the
// subject has no issuer context (issuerId === null), matching useFetched.
export function useConsensus(
  issuerId: string | null,
): VisibleFetchState<AnalystConsensusEnvelope> {
  return useFetched<AnalystConsensusEnvelope>(issuerId, async (id, signal) => {
    const data = await fetchConsensus(id, { signal })
    if (!consensusBelongsToIssuer(data, id)) {
      return { kind: 'unavailable', reason: 'consensus response did not match requested issuer' }
    }
    return { kind: 'ready', data }
  })
}
