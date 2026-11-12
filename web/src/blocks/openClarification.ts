import { createContext } from 'react'

// The block id of the clarification whose options show as buttons below the
// thread (ChoiceBar). Every other clarification lists its options in place.
export const OpenClarificationContext = createContext<string | null>(null)
