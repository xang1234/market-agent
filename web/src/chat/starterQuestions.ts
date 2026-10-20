import { createContext } from 'react'

// The questions the empty chat offers. The static demo narrows them to what it recorded
// (src/demo/DemoFrame.tsx), so a starter never asks something it has no answer for.
export const StarterQuestionsContext = createContext<readonly string[]>([
  'Analyze NVDA',
  'Compare NVDA with AMD year to date',
  "What drives Apple's margins?",
])
