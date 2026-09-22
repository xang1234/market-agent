import type { CampaignEvent } from '../../../services/discovery/src/types.ts'

export type ResearchLearning = {
  title: string
  explanation: string
}

const LEARNING_BY_EVENT: Readonly<Partial<Record<CampaignEvent['kind'], ResearchLearning>>> = {
  lead_resolved: {
    title: 'How a company was identified',
    explanation: 'The saved brief guided planning for which possible companies to resolve. This records the result, not hidden model reasoning.',
  },
  search_completed: {
    title: 'How the agent searched',
    explanation: 'A search tool completed work for the saved research question. This trail entry describes only the recorded tool use.',
  },
  document_acquired: {
    title: 'How the agent gathered evidence',
    explanation: 'A document was retrieved as evidence for the recorded research work. Availability can change after the event was recorded.',
  },
  criterion_assessed: {
    title: 'How the research was checked',
    explanation: 'The assessment used structured outputs and verification against the saved criteria. An outcome can remain unknown when evidence is incomplete.',
  },
  skeptic_completed: {
    title: 'Why the research was challenged',
    explanation: 'A skeptic is a second model pass that adds independent context and counterarguments. It can also be wrong.',
  },
  budget_exhausted: {
    title: 'Why the agent stopped',
    explanation: 'The run reached a recorded resource control, so it stopped rather than continuing beyond its research budget.',
  },
  run_resumed: {
    title: 'How the research resumed',
    explanation: 'The run continued from a recorded checkpoint after an interruption. The trail shows only the resumed work that was recorded.',
  },
}

export function learningForEvent(event: CampaignEvent): ResearchLearning | null {
  return LEARNING_BY_EVENT[event.kind] ?? null
}
