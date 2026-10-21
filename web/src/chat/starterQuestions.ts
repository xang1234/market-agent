import { createContext } from 'react'
import { STARTER_QUESTIONS } from './starterQuestionList.ts'

// The questions the empty chat offers. The static demo narrows them to what it recorded
// (src/demo/DemoFrame.tsx), so a starter never asks something it has no answer for.
export const StarterQuestionsContext = createContext<readonly string[]>(STARTER_QUESTIONS)
